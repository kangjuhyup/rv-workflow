import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createTaskProgressService,
  type TaskProgressService,
  type TaskProgressSnapshot,
} from "../src/task-progress-service.js";

/**
 * Public business contract for the task-progress service.
 *
 * Each tool operation returns either an object containing its snapshot or an
 * error with a stable code.  The tests deliberately do not rely on a storage
 * class, MCP transport, or generated task identifiers.
 */

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createFixture(): Promise<{
  service: TaskProgressService;
  stateDirectory: string;
  workspaceRoot: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "rv-workflow-policy-"));
  temporaryDirectories.push(root);

  const workspaceRoot = join(root, "product-workspace");
  const stateDirectory = join(root, "state");
  await mkdir(workspaceRoot, { recursive: true });

  return {
    service: await createTaskProgressService({ stateDirectory }),
    stateDirectory,
    workspaceRoot,
  };
}

function steps() {
  return [
    {
      id: "plan",
      title: "Approve the implementation plan",
      role: "planner" as const,
      dependsOn: [],
    },
    {
      id: "build-api",
      title: "Build the task service",
      role: "backend" as const,
      dependsOn: ["plan"],
    },
    {
      id: "build-dashboard",
      title: "Build the progress dashboard",
      role: "frontend" as const,
      dependsOn: ["plan"],
    },
  ];
}

async function createTask(
  service: TaskProgressService,
  workspaceRoot: string,
  overrides: Partial<{
    title: string;
    idempotencyKey: string;
    steps: ReturnType<typeof steps>;
  }> = {},
) {
  const result = await service.createTask({
    workspaceRoot,
    title: "Deliver project workflow",
    idempotencyKey: "delivery-2026-09-04",
    steps: steps(),
    ...overrides,
  });

  expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

function expectSuccess<T extends { ok: true } | { ok: false; error: { message: string } }>(result: T) {
  expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result as Extract<T, { ok: true }>;
}

function expectError(
  result: { ok: boolean; error?: { code: string; message: string; latestRevision?: number } },
  code: string,
) {
  expect(result.ok).toBe(false);
  if (result.ok || !result.error) throw new Error("Expected a task-progress error");
  expect(result.error.code).toBe(code);
  return result.error;
}

function snapshotJson(snapshot: TaskProgressSnapshot): string {
  return JSON.stringify(snapshot);
}

describe("Task creation is safely repeatable for an agent retry", () => {
  it("returns the original task and revision when the same workspace retries its idempotency key", async () => {
    const { service, workspaceRoot } = await createFixture();

    const first = await createTask(service, workspaceRoot);
    const retry = await createTask(service, workspaceRoot, {
      title: "A retry must not create another task",
    });

    expect(retry.task.id).toBe(first.task.id);
    expect(retry.revision).toBe(first.revision);
    expect(retry.snapshot.steps).toHaveLength(first.snapshot.steps.length);
  });
});

describe("A step follows the published workflow lifecycle", () => {
  it.each([
    ["pending", "in_progress"],
    ["pending", "blocked"],
    ["pending", "skipped"],
    ["in_progress", "blocked"],
    ["in_progress", "completed"],
    ["blocked", "in_progress"],
    ["blocked", "skipped"],
  ] as const)("allows %s to become %s", async (from, to) => {
    const { service, workspaceRoot } = await createFixture();
    const created = await createTask(service, workspaceRoot, { steps: [steps()[0]!] });
    let revision = created.revision;

    if (from !== "pending") {
      const beforeTarget = from === "in_progress" ? "in_progress" : "blocked";
      const prepared = expectSuccess(
        await service.updateTaskStep({
          workspaceRoot,
          taskId: created.task.id,
          stepId: "plan",
          status: beforeTarget,
          expectedRevision: revision,
          ...(beforeTarget === "blocked" ? { blockedReason: "Waiting for approval" } : {}),
        }),
      );
      revision = prepared.revision;
    }

    const updated = expectSuccess(
      await service.updateTaskStep({
        workspaceRoot,
        taskId: created.task.id,
        stepId: "plan",
        status: to,
        expectedRevision: revision,
        ...(to === "blocked" ? { blockedReason: "Waiting for approval" } : {}),
      }),
    );

    expect(updated.snapshot.steps[0]?.status).toBe(to);
  });

  it.each([
    ["pending", "completed"],
    ["in_progress", "skipped"],
    ["completed", "in_progress"],
    ["skipped", "in_progress"],
  ] as const)("rejects the forbidden transition from %s to %s without changing the step", async (from, to) => {
    const { service, workspaceRoot } = await createFixture();
    const created = await createTask(service, workspaceRoot, { steps: [steps()[0]!] });
    let revision = created.revision;

    if (from !== "pending") {
      const preparation =
        from === "in_progress" || from === "completed"
          ? "in_progress"
          : "skipped";
      const prepared = expectSuccess(
        await service.updateTaskStep({
          workspaceRoot,
          taskId: created.task.id,
          stepId: "plan",
          status: preparation,
          expectedRevision: revision,
        }),
      );
      revision = prepared.revision;
      if (from === "completed") {
        revision = expectSuccess(
          await service.updateTaskStep({
            workspaceRoot,
            taskId: created.task.id,
            stepId: "plan",
            status: "completed",
            expectedRevision: revision,
          }),
        ).revision;
      }
    }

    const rejected = await service.updateTaskStep({
      workspaceRoot,
      taskId: created.task.id,
      stepId: "plan",
      status: to,
      expectedRevision: revision,
    });

    expectError(rejected, "invalid_transition");
    const current = expectSuccess(await service.getTaskProgress({ workspaceRoot, taskId: created.task.id }));
    expect(current.snapshot.steps[0]?.status).toBe(from);
    expect(current.revision).toBe(revision);
  });
});

describe("Progress is calculated from actionable steps, never supplied by an agent", () => {
  it("excludes skipped steps and reports completed/actionable counts", async () => {
    const { service, workspaceRoot } = await createFixture();
    const created = await createTask(service, workspaceRoot);
    let revision = created.revision;

    revision = expectSuccess(await service.updateTaskStep({
      workspaceRoot, taskId: created.task.id, stepId: "plan", status: "in_progress", expectedRevision: revision,
    })).revision;
    revision = expectSuccess(await service.updateTaskStep({
      workspaceRoot, taskId: created.task.id, stepId: "plan", status: "completed", expectedRevision: revision,
    })).revision;
    revision = expectSuccess(await service.updateTaskStep({
      workspaceRoot, taskId: created.task.id, stepId: "build-api", status: "skipped", expectedRevision: revision,
    })).revision;
    const updated = expectSuccess(await service.updateTaskStep({
      workspaceRoot, taskId: created.task.id, stepId: "build-dashboard", status: "in_progress", expectedRevision: revision,
    }));

    expect(updated.snapshot.progress).toMatchObject({ completedSteps: 1, actionableSteps: 2, percent: 50 });
  });

  it("reports no actionable steps instead of an invented 0% when every step is skipped", async () => {
    const { service, workspaceRoot } = await createFixture();
    const created = await createTask(service, workspaceRoot, { steps: [steps()[0]!] });
    const updated = expectSuccess(await service.updateTaskStep({
      workspaceRoot, taskId: created.task.id, stepId: "plan", status: "skipped", expectedRevision: created.revision,
    }));

    expect(updated.snapshot.progress).toMatchObject({ completedSteps: 0, actionableSteps: 0, percent: null, label: "No actionable steps" });
  });
});

describe("Task status reflects whether work can still proceed", () => {
  it("does not mark a task blocked while a parallel runnable step remains", async () => {
    const { service, workspaceRoot } = await createFixture();
    const created = await createTask(service, workspaceRoot);
    let revision = created.revision;

    revision = expectSuccess(await service.updateTaskStep({
      workspaceRoot, taskId: created.task.id, stepId: "plan", status: "in_progress", expectedRevision: revision,
    })).revision;
    revision = expectSuccess(await service.updateTaskStep({
      workspaceRoot, taskId: created.task.id, stepId: "plan", status: "completed", expectedRevision: revision,
    })).revision;
    const blocked = expectSuccess(await service.updateTaskStep({
      workspaceRoot,
      taskId: created.task.id,
      stepId: "build-api",
      status: "blocked",
      blockedReason: "Waiting for the API credential",
      expectedRevision: revision,
    }));

    expect(blocked.snapshot.task.status).not.toBe("blocked");
    expect(blocked.snapshot.nextRunnableStep?.id).toBe("build-dashboard");
  });

  it("derives blocked only when blocked work remains and no step can run", async () => {
    const { service, workspaceRoot } = await createFixture();
    const created = await createTask(service, workspaceRoot, { steps: [steps()[0]!] });
    const blocked = expectSuccess(await service.updateTaskStep({
      workspaceRoot,
      taskId: created.task.id,
      stepId: "plan",
      status: "blocked",
      blockedReason: "Awaiting product approval",
      expectedRevision: created.revision,
    }));

    expect(blocked.snapshot.task.status).toBe("blocked");
    expect(blocked.snapshot.nextRunnableStep).toBeNull();
  });
});

describe("Concurrent agents cannot overwrite a newer task revision", () => {
  it("accepts one compare-and-swap update and gives the other agent the current revision", async () => {
    const { service, workspaceRoot } = await createFixture();
    const created = await createTask(service, workspaceRoot);

    const first = await service.updateTaskStep({
      workspaceRoot, taskId: created.task.id, stepId: "plan", status: "in_progress", expectedRevision: created.revision,
    });
    const stale = await service.updateTaskStep({
      workspaceRoot, taskId: created.task.id, stepId: "build-api", status: "blocked", blockedReason: "A stale update", expectedRevision: created.revision,
    });

    const winner = expectSuccess(first);
    const conflict = expectError(stale, "revision_conflict");
    expect(conflict.latestRevision).toBe(winner.revision);
    expect((await expectSuccess(await service.getTaskProgress({ workspaceRoot, taskId: created.task.id }))).snapshot.steps
      .find((step: { id: string; status: string }) => step.id === "build-api")?.status).toBe("pending");
  });

  it("retains two independently owned role steps when each agent retries its stale compare-and-swap update", async () => {
    const { service, workspaceRoot } = await createFixture();
    const created = expectSuccess(await service.createTask({
      workspaceRoot,
      title: "Deliver parallel implementation work",
      idempotencyKey: "parallel-owners",
      steps: [
        { id: "plan", title: "Approve the plan", role: "planner", owner: "coordinator", dependsOn: [] },
        { id: "api", title: "Build the API", role: "backend", owner: "backend-agent", dependsOn: ["plan"] },
        { id: "ui", title: "Build the interface", role: "frontend", owner: "frontend-agent", dependsOn: ["plan"] },
      ],
    }));

    let revision = expectSuccess(await service.updateTaskStep({
      workspaceRoot, taskId: created.task.id, stepId: "plan", status: "in_progress", expectedRevision: created.revision,
    })).revision;
    revision = expectSuccess(await service.updateTaskStep({
      workspaceRoot, taskId: created.task.id, stepId: "plan", status: "completed", expectedRevision: revision,
    })).revision;

    const backendStarted = expectSuccess(await service.updateTaskStep({
      workspaceRoot, taskId: created.task.id, stepId: "api", status: "in_progress", expectedRevision: revision,
    }));
    const frontendStale = await service.updateTaskStep({
      workspaceRoot, taskId: created.task.id, stepId: "ui", status: "in_progress", expectedRevision: revision,
    });
    const conflict = expectError(frontendStale, "revision_conflict");
    const frontendStarted = expectSuccess(await service.updateTaskStep({
      workspaceRoot,
      taskId: created.task.id,
      stepId: "ui",
      status: "in_progress",
      expectedRevision: conflict.latestRevision ?? backendStarted.revision,
    }));

    expect(frontendStarted.snapshot.steps.filter((step) => step.status === "in_progress")).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "api", role: "backend", owner: "backend-agent" }),
      expect.objectContaining({ id: "ui", role: "frontend", owner: "frontend-agent" }),
    ]));
  });
});

describe("Each workspace has a private, redacted task view", () => {
  it("does not leak one workspace task or either absolute workspace path", async () => {
    const fixture = await createFixture();
    const otherWorkspace = join(resolve(fixture.workspaceRoot, ".."), "another-product-workspace");
    await mkdir(otherWorkspace, { recursive: true });

    const first = await createTask(fixture.service, fixture.workspaceRoot);
    const second = await createTask(fixture.service, otherWorkspace, { idempotencyKey: "delivery-2026-09-04" });
    const firstView = expectSuccess(await fixture.service.getTaskProgress({ workspaceRoot: fixture.workspaceRoot, taskId: first.task.id }));
    const missingFromOtherWorkspace = await fixture.service.getTaskProgress({ workspaceRoot: otherWorkspace, taskId: first.task.id });

    expect(second.task.id).not.toBe(first.task.id);
    expectError(missingFromOtherWorkspace, "not_found");
    expect(firstView.snapshot.workspaceLabel).toBe("product-workspace");
    expect(snapshotJson(firstView.snapshot)).not.toContain(fixture.workspaceRoot);
    expect(snapshotJson(firstView.snapshot)).not.toContain(otherWorkspace);
  });

  it("treats symbolic-link aliases of one workspace as the same task state", async () => {
    const { service, workspaceRoot } = await createFixture();
    const workspaceAlias = join(resolve(workspaceRoot, ".."), "workspace-alias");
    await symlink(workspaceRoot, workspaceAlias, "dir");

    const created = await createTask(service, workspaceRoot);
    const viewedThroughAlias = expectSuccess(
      await service.getTaskProgress({ workspaceRoot: workspaceAlias, taskId: created.task.id }),
    );

    expect(viewedThroughAlias.snapshot.workspaceKey).toBe(created.snapshot.workspaceKey);
    expect(viewedThroughAlias.task.id).toBe(created.task.id);
  });
});

describe("Evidence references stay inside the workspace without rejecting useful proof", () => {
  it("rejects a nested traversal that escapes through an apparently workspace-relative evidence path", async () => {
    const { service, workspaceRoot } = await createFixture();
    const created = await createTask(service, workspaceRoot, { steps: [steps()[0]!] });

    const rejected = await service.updateTaskStep({
      workspaceRoot,
      taskId: created.task.id,
      stepId: "plan",
      status: "in_progress",
      expectedRevision: created.revision,
      evidenceRefs: ["reports/../../outside"],
    });

    expectError(rejected, "invalid_input");
    const unchanged = expectSuccess(
      await service.getTaskProgress({ workspaceRoot, taskId: created.task.id }),
    );
    expect(unchanged.revision).toBe(created.revision);
    expect(unchanged.snapshot.events.at(-1)?.evidenceRefs).toEqual([]);
  });

  it("keeps workspace-relative evidence files and command labels as valid proof", async () => {
    const { service, workspaceRoot } = await createFixture();
    const created = await createTask(service, workspaceRoot, { steps: [steps()[0]!] });

    const updated = expectSuccess(await service.updateTaskStep({
      workspaceRoot,
      taskId: created.task.id,
      stepId: "plan",
      status: "in_progress",
      expectedRevision: created.revision,
      evidenceRefs: ["reports/typecheck.log", "npm run typecheck"],
    }));

    expect(updated.snapshot.events.at(-1)?.evidenceRefs).toEqual([
      "reports/typecheck.log",
      "npm run typecheck",
    ]);
  });
});

describe("Storage damage is visible and never silently replaced", () => {
  it("preserves corrupt state and returns a recoverable storage error", async () => {
    const { service, stateDirectory, workspaceRoot } = await createFixture();
    const workspaceKey = createHash("sha256").update(resolve(workspaceRoot)).digest("hex");
    const statePath = join(stateDirectory, workspaceKey, "state.json");
    const corruptContents = "{ this is not valid json";
    await mkdir(join(stateDirectory, workspaceKey), { recursive: true });
    await writeFile(statePath, corruptContents, "utf8");

    const result = await service.createTask({
      workspaceRoot,
      title: "Do not replace damaged history",
      idempotencyKey: "protect-corruption",
      steps: steps(),
    });

    expectError(result, "storage_error");
    expect(await readFile(statePath, "utf8")).toBe(corruptContents);
  });
});
