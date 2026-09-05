import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, relative, resolve, win32 } from "node:path";

export const STEP_ROLES = [
  "planner",
  "test-writer",
  "backend",
  "frontend",
  "document",
  "qa",
] as const;

export const STEP_STATUSES = [
  "pending",
  "in_progress",
  "blocked",
  "completed",
  "skipped",
] as const;

export type StepRole = (typeof STEP_ROLES)[number];
export type StepStatus = (typeof STEP_STATUSES)[number];
export type TaskStatus = "pending" | "in_progress" | "blocked" | "completed";
export type TaskProgressErrorCode =
  | "invalid_input"
  | "not_found"
  | "revision_conflict"
  | "invalid_transition"
  | "storage_error";

export interface CreateTaskStepInput {
  id: string;
  title: string;
  role: StepRole;
  dependsOn: string[];
  owner?: string;
}

export interface CreateTaskInput {
  workspaceRoot: string;
  title: string;
  specPath?: string;
  steps: CreateTaskStepInput[];
  idempotencyKey: string;
}

export interface UpdateTaskStepInput {
  workspaceRoot: string;
  taskId: string;
  stepId: string;
  status: StepStatus;
  summary?: string;
  blockedReason?: string;
  evidenceRefs?: string[];
  expectedRevision: number;
}

export interface GetTaskProgressInput {
  workspaceRoot: string;
  taskId?: string;
}

export interface TaskProgressStep {
  id: string;
  title: string;
  role: StepRole;
  status: StepStatus;
  dependsOn: string[];
  owner?: string;
  summary?: string;
  blockedReason?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface TaskProgressEvent {
  id: string;
  stepId?: string;
  kind:
    | "task_created"
    | "step_started"
    | "step_resumed"
    | "step_blocked"
    | "step_completed"
    | "step_skipped";
  at: string;
  summary: string;
  evidenceRefs: string[];
}

export interface TaskProgressSnapshot {
  schemaVersion: 1;
  workspaceKey: string;
  workspaceLabel: string;
  task: {
    id: string;
    title: string;
    specPath?: string;
    status: TaskStatus;
    revision: number;
    createdAt: string;
    updatedAt: string;
  };
  progress: {
    completedSteps: number;
    actionableSteps: number;
    percent: number | null;
    label: string;
  };
  steps: TaskProgressStep[];
  events: TaskProgressEvent[];
  nextRunnableStep: TaskProgressStep | null;
  isStale: boolean;
}

export interface TaskProgressError {
  code: TaskProgressErrorCode;
  message: string;
  latestRevision?: number;
}

export interface TaskProgressSuccess {
  ok: true;
  task: TaskProgressSnapshot["task"];
  revision: number;
  snapshot: TaskProgressSnapshot;
}

export interface TaskProgressFailure {
  ok: false;
  error: TaskProgressError;
}

export type TaskProgressResult = TaskProgressSuccess | TaskProgressFailure;

export interface TaskProgressService {
  createTask(input: CreateTaskInput): Promise<TaskProgressResult>;
  updateTaskStep(input: UpdateTaskStepInput): Promise<TaskProgressResult>;
  getTaskProgress(input: GetTaskProgressInput): Promise<TaskProgressResult>;
}

export interface TaskProgressServiceOptions {
  stateDirectory?: string;
  now?: () => Date;
  initializeStateDirectory?: boolean;
}

interface StoredTask {
  id: string;
  title: string;
  specPath?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  steps: TaskProgressStep[];
  events: TaskProgressEvent[];
}

interface StoredWorkspaceState {
  schemaVersion: 1;
  workspaceKey: string;
  workspaceLabel: string;
  tasks: StoredTask[];
  idempotency: Record<string, string>;
}

interface WorkspaceIdentity {
  root: string;
  key: string;
  legacyKey?: string;
  label: string;
}

const MAX_EVENTS = 100;
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const EVENT_KINDS: ReadonlySet<TaskProgressEvent["kind"]> = new Set([
  "task_created",
  "step_started",
  "step_resumed",
  "step_blocked",
  "step_completed",
  "step_skipped",
]);
const TRANSITIONS: Record<StepStatus, ReadonlySet<StepStatus>> = {
  pending: new Set(["in_progress", "blocked", "skipped"]),
  in_progress: new Set(["blocked", "completed"]),
  blocked: new Set(["in_progress", "skipped"]),
  completed: new Set(),
  skipped: new Set(),
};

class InputError extends Error {}
class StorageError extends Error {}

function failure(
  code: TaskProgressErrorCode,
  message: string,
  latestRevision?: number,
): TaskProgressFailure {
  return {
    ok: false,
    error: latestRevision === undefined ? { code, message } : { code, message, latestRevision },
  };
}

export function defaultTaskProgressStateDirectory(): string {
  if (process.platform === "win32") {
    return resolve(
      process.env.LOCALAPPDATA ?? resolve(homedir(), "AppData", "Local"),
      "rv-workflow",
    );
  }
  if (process.platform === "darwin") {
    return resolve(homedir(), "Library", "Application Support", "rv-workflow");
  }
  return resolve(
    process.env.XDG_STATE_HOME ?? resolve(homedir(), ".local", "state"),
    "rv-workflow",
  );
}

function cleanLabel(root: string): string {
  const value = basename(root).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return value.slice(0, 120) || "workspace";
}

async function identifyWorkspace(workspaceRoot: unknown): Promise<WorkspaceIdentity> {
  if (typeof workspaceRoot !== "string" || workspaceRoot.length === 0 || workspaceRoot.length > 4096) {
    throw new InputError("workspaceRoot must be a non-empty path no longer than 4096 characters.");
  }
  const requestedRoot = resolve(workspaceRoot);
  let root: string;
  try {
    root = await realpath(requestedRoot);
    if (!(await stat(root)).isDirectory()) {
      throw new InputError("workspaceRoot must refer to an existing directory.");
    }
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError("workspaceRoot must refer to an existing directory.");
  }
  return {
    root,
    key: createHash("sha256").update(root).digest("hex"),
    ...(requestedRoot === root
      ? {}
      : { legacyKey: createHash("sha256").update(requestedRoot).digest("hex") }),
    label: cleanLabel(root),
  };
}

function assertString(value: unknown, field: string, max: number): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    throw new InputError(`${field} must be a non-empty string no longer than ${max} characters.`);
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new InputError(`${field} contains unsupported control characters.`);
  }
}

function assertIdentifier(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new InputError(`${field} must contain only letters, numbers, period, underscore, or hyphen.`);
  }
}

function assertNoWorkspacePath(value: string, workspace: WorkspaceIdentity, field: string): void {
  if (value.includes(workspace.root)) {
    throw new InputError(`${field} must not contain an absolute workspace path.`);
  }
}

function normalizeWorkspacePath(
  value: string,
  workspace: WorkspaceIdentity,
  field: string,
): string {
  assertString(value, field, 512);
  const absolute = isAbsolute(value) ? resolve(value) : resolve(workspace.root, value);
  const normalized = relative(workspace.root, absolute);
  if (normalized === "" || normalized === ".." || normalized.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(normalized)) {
    throw new InputError(`${field} must be a file path inside the workspace.`);
  }
  return normalized.replaceAll("\\", "/");
}

function validateCreateInput(input: CreateTaskInput, workspace: WorkspaceIdentity): {
  title: string;
  specPath?: string;
  idempotencyKey: string;
  steps: TaskProgressStep[];
} {
  assertString(input.title, "title", 200);
  assertNoWorkspacePath(input.title, workspace, "title");
  assertString(input.idempotencyKey, "idempotencyKey", 200);
  if (!Array.isArray(input.steps) || input.steps.length === 0 || input.steps.length > 100) {
    throw new InputError("steps must contain between 1 and 100 dependency-ordered steps.");
  }

  const seen = new Set<string>();
  const steps = input.steps.map((step, index): TaskProgressStep => {
    if (!step || typeof step !== "object") throw new InputError(`steps[${index}] must be an object.`);
    assertIdentifier(step.id, `steps[${index}].id`);
    if (seen.has(step.id)) throw new InputError(`Duplicate step id: ${step.id}.`);
    assertString(step.title, `steps[${index}].title`, 200);
    assertNoWorkspacePath(step.title, workspace, `steps[${index}].title`);
    if (!STEP_ROLES.includes(step.role)) throw new InputError(`steps[${index}].role is not supported.`);
    if (!Array.isArray(step.dependsOn) || step.dependsOn.some((dependency) => typeof dependency !== "string")) {
      throw new InputError(`steps[${index}].dependsOn must be an array of step ids.`);
    }
    const dependencies = [...new Set(step.dependsOn)];
    if (dependencies.length !== step.dependsOn.length || dependencies.some((dependency) => !seen.has(dependency))) {
      throw new InputError(`steps[${index}].dependsOn must reference unique earlier steps.`);
    }
    if (step.owner !== undefined) {
      assertString(step.owner, `steps[${index}].owner`, 100);
      assertNoWorkspacePath(step.owner, workspace, `steps[${index}].owner`);
    }
    seen.add(step.id);
    return {
      id: step.id,
      title: step.title.trim(),
      role: step.role,
      status: "pending",
      dependsOn: dependencies,
      ...(step.owner === undefined ? {} : { owner: step.owner.trim() }),
    };
  });

  return {
    title: input.title.trim(),
    idempotencyKey: input.idempotencyKey,
    steps,
    ...(input.specPath === undefined
      ? {}
      : { specPath: normalizeWorkspacePath(input.specPath, workspace, "specPath") }),
  };
}

function validateUpdateInput(input: UpdateTaskStepInput, workspace: WorkspaceIdentity): void {
  assertIdentifier(input.taskId, "taskId");
  assertIdentifier(input.stepId, "stepId");
  if (!STEP_STATUSES.includes(input.status)) throw new InputError("status is not supported.");
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
    throw new InputError("expectedRevision must be a positive integer.");
  }
  if (input.summary !== undefined) {
    assertString(input.summary, "summary", 1000);
    assertNoWorkspacePath(input.summary, workspace, "summary");
  }
  if (input.status === "blocked") {
    assertString(input.blockedReason, "blockedReason", 1000);
    assertNoWorkspacePath(input.blockedReason, workspace, "blockedReason");
  } else if (input.blockedReason !== undefined) {
    throw new InputError("blockedReason is only allowed when status is blocked.");
  }
  if (input.evidenceRefs !== undefined) {
    if (!Array.isArray(input.evidenceRefs) || input.evidenceRefs.length > 20) {
      throw new InputError("evidenceRefs must contain no more than 20 entries.");
    }
    for (const [index, reference] of input.evidenceRefs.entries()) {
      assertString(reference, `evidenceRefs[${index}]`, 240);
      const normalized = reference.replaceAll("\\", "/");
      if (isAbsolute(reference) || win32.isAbsolute(reference) || reference.includes(workspace.root) || /(?:bearer\s+|password\s*=|token\s*=)/i.test(reference)) {
        throw new InputError(`evidenceRefs[${index}] must be a safe relative path or command label.`);
      }
      const normalizedRelative = relative(workspace.root, resolve(workspace.root, normalized));
      if (
        normalizedRelative === ".." ||
        normalizedRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
        isAbsolute(normalizedRelative)
      ) {
        throw new InputError(`evidenceRefs[${index}] must not escape the workspace.`);
      }
    }
  }
}

function isTaskProgressStep(value: unknown): value is TaskProgressStep {
  if (!value || typeof value !== "object") return false;
  const step = value as Record<string, unknown>;
  return (
    typeof step.id === "string" &&
    typeof step.title === "string" &&
    typeof step.role === "string" &&
    STEP_ROLES.includes(step.role as StepRole) &&
    typeof step.status === "string" &&
    STEP_STATUSES.includes(step.status as StepStatus) &&
    Array.isArray(step.dependsOn) &&
    step.dependsOn.every((dependency) => typeof dependency === "string") &&
    (step.owner === undefined || typeof step.owner === "string") &&
    (step.summary === undefined || typeof step.summary === "string") &&
    (step.blockedReason === undefined || typeof step.blockedReason === "string") &&
    (step.startedAt === undefined || typeof step.startedAt === "string") &&
    (step.completedAt === undefined || typeof step.completedAt === "string")
  );
}

function isTaskProgressEvent(value: unknown): value is TaskProgressEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.id === "string" &&
    typeof event.kind === "string" &&
    EVENT_KINDS.has(event.kind as TaskProgressEvent["kind"]) &&
    typeof event.at === "string" &&
    typeof event.summary === "string" &&
    (event.stepId === undefined || typeof event.stepId === "string") &&
    Array.isArray(event.evidenceRefs) &&
    event.evidenceRefs.every((reference) => typeof reference === "string")
  );
}

function parseStoredState(contents: string, workspace: WorkspaceIdentity): StoredWorkspaceState {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new StorageError("The task state file is damaged and was preserved for recovery.");
  }
  if (!value || typeof value !== "object") {
    throw new StorageError("The task state file has an invalid structure and was preserved for recovery.");
  }
  const state = value as Record<string, unknown>;
  const tasks = state.tasks;
  const idempotency = state.idempotency;
  if (
    state.schemaVersion !== 1 ||
    (state.workspaceKey !== workspace.key && state.workspaceKey !== workspace.legacyKey) ||
    typeof state.workspaceLabel !== "string" ||
    !Array.isArray(tasks) ||
    !idempotency ||
    typeof idempotency !== "object" ||
    Array.isArray(idempotency)
  ) {
    throw new StorageError("The task state file has an invalid structure and was preserved for recovery.");
  }
  const validTasks = tasks.every((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const task = entry as Record<string, unknown>;
    return (
      typeof task.id === "string" &&
      typeof task.title === "string" &&
      (task.specPath === undefined || typeof task.specPath === "string") &&
      Number.isSafeInteger(task.revision) && Number(task.revision) >= 1 &&
      typeof task.createdAt === "string" &&
      Number.isFinite(Date.parse(task.createdAt)) &&
      typeof task.updatedAt === "string" &&
      Number.isFinite(Date.parse(task.updatedAt)) &&
      Array.isArray(task.steps) &&
      task.steps.every(isTaskProgressStep) &&
      Array.isArray(task.events) &&
      task.events.every(isTaskProgressEvent)
    );
  });
  const validIdempotency = Object.values(idempotency).every((taskId) => typeof taskId === "string");
  const taskIds = new Set(
    validTasks ? (tasks as StoredTask[]).map((task) => task.id) : [],
  );
  const indexesResolve = validIdempotency && Object.values(idempotency).every((taskId) => taskIds.has(taskId as string));
  if (!validTasks || !validIdempotency || taskIds.size !== tasks.length || !indexesResolve) {
    throw new StorageError("The task state file has an invalid structure and was preserved for recovery.");
  }
  const parsed = value as StoredWorkspaceState;
  return parsed.workspaceKey === workspace.key
    ? parsed
    : { ...parsed, workspaceKey: workspace.key, workspaceLabel: workspace.label };
}

function emptyState(workspace: WorkspaceIdentity): StoredWorkspaceState {
  return {
    schemaVersion: 1,
    workspaceKey: workspace.key,
    workspaceLabel: workspace.label,
    tasks: [],
    idempotency: {},
  };
}

async function readState(stateDirectory: string, workspace: WorkspaceIdentity): Promise<StoredWorkspaceState> {
  const statePath = resolve(stateDirectory, workspace.key, "state.json");
  try {
    return parseStoredState(await readFile(statePath, "utf8"), workspace);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && workspace.legacyKey !== undefined) {
      const legacyStatePath = resolve(stateDirectory, workspace.legacyKey, "state.json");
      try {
        return parseStoredState(await readFile(legacyStatePath, "utf8"), workspace);
      } catch (legacyError) {
        if ((legacyError as NodeJS.ErrnoException).code === "ENOENT") return emptyState(workspace);
        if (legacyError instanceof StorageError) throw legacyError;
        throw new StorageError("The task state file could not be read. Check its permissions and try again.");
      }
    }
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState(workspace);
    if (error instanceof StorageError) throw error;
    throw new StorageError("The task state file could not be read. Check its permissions and try again.");
  }
}

async function writeState(
  stateDirectory: string,
  workspace: WorkspaceIdentity,
  state: StoredWorkspaceState,
): Promise<void> {
  const directory = resolve(stateDirectory, workspace.key);
  const destination = resolve(directory, "state.json");
  const temporary = resolve(directory, `.state-${process.pid}-${randomUUID()}.tmp`);
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, destination);
    try {
      const directoryHandle = await open(directory, "r");
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch {
      // Some platforms do not support fsync on a directory. The file itself was
      // flushed before the atomic rename, which remains the required guarantee.
    }
  } catch {
    await unlink(temporary).catch(() => undefined);
    throw new StorageError("The task state file could not be saved. Existing state was not intentionally replaced.");
  }
}

function copyStep(step: TaskProgressStep): TaskProgressStep {
  return {
    id: step.id,
    title: step.title,
    role: step.role,
    status: step.status,
    dependsOn: [...step.dependsOn],
    ...(step.owner === undefined ? {} : { owner: step.owner }),
    ...(step.summary === undefined ? {} : { summary: step.summary }),
    ...(step.blockedReason === undefined ? {} : { blockedReason: step.blockedReason }),
    ...(step.startedAt === undefined ? {} : { startedAt: step.startedAt }),
    ...(step.completedAt === undefined ? {} : { completedAt: step.completedAt }),
  };
}

function deriveSnapshot(
  workspace: WorkspaceIdentity,
  task: StoredTask,
  now: Date,
): TaskProgressSnapshot {
  const steps = task.steps.map(copyStep);
  const actionable = steps.filter((step) => step.status !== "skipped");
  const completedSteps = actionable.filter((step) => step.status === "completed").length;
  const actionableSteps = actionable.length;
  const percent = actionableSteps === 0 ? null : Math.round((completedSteps / actionableSteps) * 100);
  const terminalIds = new Set(
    steps.filter((step) => step.status === "completed" || step.status === "skipped").map((step) => step.id),
  );
  const nextRunnableStep =
    steps.find((step) => step.status === "in_progress") ??
    steps.find(
      (step) => step.status === "pending" && step.dependsOn.every((dependency) => terminalIds.has(dependency)),
    ) ??
    null;

  let status: TaskStatus;
  if (actionable.every((step) => step.status === "completed")) {
    status = "completed";
  } else if (nextRunnableStep === null && steps.some((step) => step.status === "blocked")) {
    status = "blocked";
  } else if (steps.some((step) => step.status !== "pending")) {
    status = "in_progress";
  } else {
    status = "pending";
  }

  const taskView: TaskProgressSnapshot["task"] = {
    id: task.id,
    title: task.title,
    status,
    revision: task.revision,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...(task.specPath === undefined ? {} : { specPath: task.specPath }),
  };
  return {
    schemaVersion: 1,
    workspaceKey: workspace.key,
    workspaceLabel: workspace.label,
    task: taskView,
    progress: {
      completedSteps,
      actionableSteps,
      percent,
      label: actionableSteps === 0
        ? "No actionable steps"
        : `${completedSteps} / ${actionableSteps} actionable steps`,
    },
    steps,
    events: task.events.map((event) => ({
      ...event,
      evidenceRefs: [...event.evidenceRefs],
    })),
    nextRunnableStep: nextRunnableStep === null ? null : copyStep(nextRunnableStep),
    isStale: now.getTime() - Date.parse(task.updatedAt) > STALE_AFTER_MS,
  };
}

function success(workspace: WorkspaceIdentity, task: StoredTask, now: Date): TaskProgressSuccess {
  const snapshot = deriveSnapshot(workspace, task, now);
  return { ok: true, task: snapshot.task, revision: task.revision, snapshot };
}

function eventForUpdate(
  step: TaskProgressStep,
  previousStatus: StepStatus,
  input: UpdateTaskStepInput,
  at: string,
): TaskProgressEvent {
  const kind: TaskProgressEvent["kind"] =
    input.status === "blocked"
      ? "step_blocked"
      : input.status === "completed"
        ? "step_completed"
        : input.status === "skipped"
          ? "step_skipped"
          : previousStatus === "blocked"
            ? "step_resumed"
            : "step_started";
  const defaultSummary =
    input.status === "blocked"
      ? input.blockedReason!
      : `${step.title} ${input.status.replace("_", " ")}.`;
  return {
    id: `event-${randomUUID()}`,
    stepId: step.id,
    kind,
    at,
    summary: input.summary?.trim() ?? defaultSummary,
    evidenceRefs: input.evidenceRefs?.map((reference) => reference.trim()) ?? [],
  };
}

export async function createTaskProgressService(
  options: TaskProgressServiceOptions = {},
): Promise<TaskProgressService> {
  const stateDirectory = resolve(options.stateDirectory ?? defaultTaskProgressStateDirectory());
  const now = options.now ?? (() => new Date());
  if (options.initializeStateDirectory !== false) {
    await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  }

  let writerQueue: Promise<void> = Promise.resolve();
  const enqueueWrite = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = writerQueue.then(operation, operation);
    writerQueue = result.then(() => undefined, () => undefined);
    return result;
  };

  return {
    async createTask(input) {
      let workspace: WorkspaceIdentity;
      try {
        workspace = await identifyWorkspace(input.workspaceRoot);
      } catch (error) {
        return failure("invalid_input", error instanceof Error ? error.message : "workspaceRoot is invalid.");
      }
      return enqueueWrite(async () => {
        try {
          const validated = validateCreateInput(input, workspace);
          const state = await readState(stateDirectory, workspace);
          const idempotencyDigest = createHash("sha256")
            .update(validated.idempotencyKey)
            .digest("hex");
          const existingId = state.idempotency[idempotencyDigest];
          if (existingId !== undefined) {
            const existing = state.tasks.find((task) => task.id === existingId);
            if (!existing) throw new StorageError("The task state idempotency index is inconsistent and was preserved.");
            return success(workspace, existing, now());
          }

          const at = now().toISOString();
          const task: StoredTask = {
            id: `task-${randomUUID()}`,
            title: validated.title,
            revision: 1,
            createdAt: at,
            updatedAt: at,
            steps: validated.steps,
            events: [{
              id: `event-${randomUUID()}`,
              kind: "task_created",
              at,
              summary: `Created task: ${validated.title}`,
              evidenceRefs: [],
            }],
            ...(validated.specPath === undefined ? {} : { specPath: validated.specPath }),
          };
          state.tasks.push(task);
          state.idempotency[idempotencyDigest] = task.id;
          await writeState(stateDirectory, workspace, state);
          return success(workspace, task, now());
        } catch (error) {
          if (error instanceof InputError) return failure("invalid_input", error.message);
          return failure(
            "storage_error",
            error instanceof StorageError ? error.message : "Task state could not be created.",
          );
        }
      });
    },

    async updateTaskStep(input) {
      let workspace: WorkspaceIdentity;
      try {
        workspace = await identifyWorkspace(input.workspaceRoot);
        validateUpdateInput(input, workspace);
      } catch (error) {
        return failure("invalid_input", error instanceof Error ? error.message : "The update is invalid.");
      }
      return enqueueWrite(async () => {
        try {
          const state = await readState(stateDirectory, workspace);
          const task = state.tasks.find((candidate) => candidate.id === input.taskId);
          if (!task) return failure("not_found", "The task was not found in this workspace.");
          if (task.revision !== input.expectedRevision) {
            return failure(
              "revision_conflict",
              "The task changed after it was read. Read the latest snapshot before retrying.",
              task.revision,
            );
          }
          const step = task.steps.find((candidate) => candidate.id === input.stepId);
          if (!step) return failure("not_found", "The step was not found in this task.");
          if (!TRANSITIONS[step.status].has(input.status)) {
            return failure(
              "invalid_transition",
              `A step cannot transition from ${step.status} to ${input.status}.`,
            );
          }

          const at = now().toISOString();
          const previousStatus = step.status;
          step.status = input.status;
          if (input.summary !== undefined) step.summary = input.summary.trim();
          if (input.status === "blocked") step.blockedReason = input.blockedReason!.trim();
          else delete step.blockedReason;
          if (input.status === "in_progress" && step.startedAt === undefined) step.startedAt = at;
          if (input.status === "completed" || input.status === "skipped") step.completedAt = at;

          task.revision += 1;
          task.updatedAt = at;
          task.events.push(eventForUpdate(step, previousStatus, input, at));
          if (task.events.length > MAX_EVENTS) task.events.splice(0, task.events.length - MAX_EVENTS);
          await writeState(stateDirectory, workspace, state);
          return success(workspace, task, now());
        } catch (error) {
          return failure(
            "storage_error",
            error instanceof StorageError ? error.message : "Task state could not be updated.",
          );
        }
      });
    },

    async getTaskProgress(input) {
      let workspace: WorkspaceIdentity;
      try {
        workspace = await identifyWorkspace(input.workspaceRoot);
        if (input.taskId !== undefined) assertIdentifier(input.taskId, "taskId");
      } catch (error) {
        return failure("invalid_input", error instanceof Error ? error.message : "The query is invalid.");
      }
      await writerQueue;
      try {
        const state = await readState(stateDirectory, workspace);
        let task = input.taskId === undefined
          ? [...state.tasks]
              .reverse()
              .find((candidate) => deriveSnapshot(workspace, candidate, now()).task.status !== "completed")
            ?? state.tasks.at(-1)
          : state.tasks.find((candidate) => candidate.id === input.taskId);
        if (!task) return failure("not_found", "No task progress was found in this workspace.");
        return success(workspace, task, now());
      } catch (error) {
        return failure(
          "storage_error",
          error instanceof StorageError ? error.message : "Task state could not be read.",
        );
      }
    },
  };
}
