import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  STEP_ROLES,
  STEP_STATUSES,
  createTaskProgressService,
  type CreateTaskInput,
  type GetTaskProgressInput,
  type TaskProgressResult,
  type TaskProgressService,
  type UpdateTaskStepInput,
} from "./task-progress-service.js";

export const TASK_PROGRESS_RESOURCE_URI = "ui://rv-workflow/task-progress/v1.html";

const pluginRoot = fileURLToPath(new URL("../../", import.meta.url));

const stepSchema = z.object({
  id: z.string(),
  title: z.string(),
  role: z.enum(STEP_ROLES),
  status: z.enum(STEP_STATUSES),
  dependsOn: z.array(z.string()),
  owner: z.string().optional(),
  summary: z.string().optional(),
  blockedReason: z.string().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
});

const eventSchema = z.object({
  id: z.string(),
  stepId: z.string().optional(),
  kind: z.enum([
    "task_created",
    "step_started",
    "step_resumed",
    "step_blocked",
    "step_completed",
    "step_skipped",
  ]),
  at: z.string(),
  summary: z.string(),
  evidenceRefs: z.array(z.string()),
});

const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  specPath: z.string().optional(),
  status: z.enum(["pending", "in_progress", "blocked", "completed"]),
  revision: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const snapshotSchema = z.object({
  schemaVersion: z.literal(1),
  workspaceKey: z.string(),
  workspaceLabel: z.string(),
  task: taskSchema,
  progress: z.object({
    completedSteps: z.number().int().nonnegative(),
    actionableSteps: z.number().int().nonnegative(),
    percent: z.number().min(0).max(100).nullable(),
    label: z.string(),
  }),
  steps: z.array(stepSchema),
  events: z.array(eventSchema),
  nextRunnableStep: stepSchema.nullable(),
  isStale: z.boolean(),
});

const errorSchema = z.object({
  code: z.enum([
    "invalid_input",
    "not_found",
    "revision_conflict",
    "invalid_transition",
    "storage_error",
  ]),
  message: z.string(),
  latestRevision: z.number().int().positive().optional(),
});

const resultOutputSchema = {
  ok: z.boolean(),
  task: taskSchema.optional(),
  revision: z.number().int().positive().optional(),
  snapshot: snapshotSchema.optional(),
  error: errorSchema.optional(),
};

const createInputSchema = {
  workspaceRoot: z.string().min(1).max(4096),
  title: z.string().min(1).max(200),
  specPath: z.string().min(1).max(512).optional(),
  steps: z.array(z.object({
    id: z.string().min(1).max(64),
    title: z.string().min(1).max(200),
    role: z.enum(STEP_ROLES),
    dependsOn: z.array(z.string().min(1).max(64)).max(100),
    owner: z.string().min(1).max(100).optional(),
  })).min(1).max(100),
  idempotencyKey: z.string().min(1).max(200),
};

const updateInputSchema = {
  workspaceRoot: z.string().min(1).max(4096),
  taskId: z.string().min(1).max(64),
  stepId: z.string().min(1).max(64),
  status: z.enum(STEP_STATUSES),
  summary: z.string().min(1).max(1000).optional(),
  blockedReason: z.string().min(1).max(1000).optional(),
  evidenceRefs: z.array(z.string().min(1).max(240)).max(20).optional(),
  expectedRevision: z.number().int().positive(),
};

const getInputSchema = {
  workspaceRoot: z.string().min(1).max(4096).optional(),
  taskId: z.string().min(1).max(64).optional(),
};

const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
} as const;

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const;

function toolResult(result: TaskProgressResult) {
  const text = result.ok
    ? `${result.snapshot.workspaceLabel}: ${result.task.title} — ${result.task.status}; ${result.snapshot.progress.label}. Revision ${result.revision}.${
        result.snapshot.nextRunnableStep === null
          ? " No runnable step."
          : ` Next runnable step: ${result.snapshot.nextRunnableStep.title} (${result.snapshot.nextRunnableStep.role}).`
      }`
    : `${result.error.code}: ${result.error.message}`;
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: { ...result },
    ...(result.ok ? {} : { isError: true }),
  };
}

function appHtml(componentSource: string): string {
  const safeSource = componentSource.replace(/<\/script/giu, "<\\/script");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Task progress</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module">${safeSource}</script>
  </body>
</html>`;
}

export interface ProjectWorkflowServerOptions {
  stateDirectory?: string;
  uiBundlePath?: string;
  service?: TaskProgressService;
}

export async function createProjectWorkflowServer(
  options: ProjectWorkflowServerOptions = {},
): Promise<McpServer> {
  const service = options.service ?? await createTaskProgressService(
    options.stateDirectory === undefined ? {} : { stateDirectory: options.stateDirectory },
  );
  const uiBundlePath = resolve(options.uiBundlePath ?? resolve(pluginRoot, "web", "dist", "component.js"));
  const knownWorkspaces = new Map<string, string>();

  const rememberWorkspace = (workspaceRoot: string, result: TaskProgressResult): void => {
    if (result.ok) knownWorkspaces.set(result.task.id, workspaceRoot);
  };
  const resolveGetInput = (input: {
    workspaceRoot?: string | undefined;
    taskId?: string | undefined;
  }): GetTaskProgressInput | null => {
    const workspaceRoot = input.workspaceRoot ?? (input.taskId === undefined ? undefined : knownWorkspaces.get(input.taskId));
    if (workspaceRoot === undefined) return null;
    return {
      workspaceRoot,
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
    };
  };

  const server = new McpServer({ name: "rv-workflow-progress", version: "0.1.0" });

  server.registerTool(
    "create_task",
    {
      title: "Create task progress",
      description: "Create a dependency-ordered task progress record for a workspace. Safe to retry with the same idempotency key.",
      inputSchema: createInputSchema,
      outputSchema: resultOutputSchema,
      annotations: { ...writeAnnotations, idempotentHint: true },
    },
    async (input) => {
      const request: CreateTaskInput = {
        workspaceRoot: input.workspaceRoot,
        title: input.title,
        steps: input.steps.map((step) => ({
          id: step.id,
          title: step.title,
          role: step.role,
          dependsOn: step.dependsOn,
          ...(step.owner === undefined ? {} : { owner: step.owner }),
        })),
        idempotencyKey: input.idempotencyKey,
        ...(input.specPath === undefined ? {} : { specPath: input.specPath }),
      };
      const result = await service.createTask(request);
      rememberWorkspace(input.workspaceRoot, result);
      return toolResult(result);
    },
  );

  server.registerTool(
    "update_task_step",
    {
      title: "Update task step",
      description: "Record a valid task-step lifecycle transition using compare-and-swap revision protection.",
      inputSchema: updateInputSchema,
      outputSchema: resultOutputSchema,
      annotations: { ...writeAnnotations, idempotentHint: false },
    },
    async (input) => {
      const request: UpdateTaskStepInput = {
        workspaceRoot: input.workspaceRoot,
        taskId: input.taskId,
        stepId: input.stepId,
        status: input.status,
        expectedRevision: input.expectedRevision,
        ...(input.summary === undefined ? {} : { summary: input.summary }),
        ...(input.blockedReason === undefined ? {} : { blockedReason: input.blockedReason }),
        ...(input.evidenceRefs === undefined ? {} : { evidenceRefs: input.evidenceRefs }),
      };
      const result = await service.updateTaskStep(request);
      rememberWorkspace(input.workspaceRoot, result);
      return toolResult(result);
    },
  );

  server.registerTool(
    "get_task_progress",
    {
      title: "Get task progress",
      description: "Read a complete, path-redacted task progress snapshot without requiring a UI.",
      inputSchema: getInputSchema,
      outputSchema: resultOutputSchema,
      annotations: readAnnotations,
    },
    async (input) => {
      const request = resolveGetInput(input);
      if (request === null) {
        return toolResult({
          ok: false,
          error: {
            code: "invalid_input",
            message: "workspaceRoot is required unless taskId was previously opened in this server session.",
          },
        });
      }
      const result = await service.getTaskProgress(request);
      rememberWorkspace(request.workspaceRoot, result);
      return toolResult(result);
    },
  );

  registerAppTool(
    server,
    "render_task_progress",
    {
      title: "Render task progress",
      description: "Read task progress and display the read-only inline progress dashboard.",
      inputSchema: getInputSchema,
      outputSchema: resultOutputSchema,
      annotations: readAnnotations,
      _meta: { ui: { resourceUri: TASK_PROGRESS_RESOURCE_URI } },
    },
    async (input) => {
      const request = resolveGetInput(input);
      if (request === null) {
        return toolResult({
          ok: false,
          error: {
            code: "invalid_input",
            message: "workspaceRoot is required unless taskId was previously opened in this server session.",
          },
        });
      }
      const result = await service.getTaskProgress(request);
      rememberWorkspace(request.workspaceRoot, result);
      return toolResult(result);
    },
  );

  registerAppResource(
    server,
    "RV workflow task progress",
    TASK_PROGRESS_RESOURCE_URI,
    {
      description: "Read-only inline dashboard for project workflow task progress.",
      _meta: {
        ui: {
          csp: { connectDomains: [], resourceDomains: [] },
        },
      },
    },
    async () => ({
      contents: [{
        uri: TASK_PROGRESS_RESOURCE_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: appHtml(await readFile(uiBundlePath, "utf8")),
        _meta: {
          ui: {
            csp: { connectDomains: [], resourceDomains: [] },
          },
        },
      }],
    }),
  );

  return server;
}

export async function startMcpServer(options: ProjectWorkflowServerOptions = {}): Promise<void> {
  const server = await createProjectWorkflowServer(options);
  await server.connect(new StdioServerTransport());
}
