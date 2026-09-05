import { App, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { TaskProgressDashboard, type TaskProgressSnapshot } from "./task-progress-dashboard.js";

type SnapshotListener = (snapshot: TaskProgressSnapshot | undefined, error?: string) => void;

let latestSnapshot: TaskProgressSnapshot | undefined;
let bridgeError: string | undefined;
let canRefresh = false;
const listeners = new Set<SnapshotListener>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const roles = new Set(["planner", "test-writer", "backend", "frontend", "document", "qa"]);
const stepStatuses = new Set(["pending", "in_progress", "blocked", "completed", "skipped"]);
const taskStatuses = new Set(["pending", "in_progress", "blocked", "completed"]);

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStep(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.title === "string"
    && typeof value.role === "string"
    && roles.has(value.role)
    && typeof value.status === "string"
    && stepStatuses.has(value.status)
    && isStringArray(value.dependsOn)
    && (value.blockedReason === undefined || typeof value.blockedReason === "string")
    && (value.summary === undefined || typeof value.summary === "string");
}

function isEvent(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.kind === "string"
    && typeof value.at === "string"
    && typeof value.summary === "string"
    && isStringArray(value.evidenceRefs);
}

function isSnapshot(value: unknown): value is TaskProgressSnapshot {
  if (!isRecord(value) || !isRecord(value.task) || !isRecord(value.progress)) return false;
  return typeof value.workspaceLabel === "string"
    && typeof value.task.id === "string"
    && typeof value.task.title === "string"
    && typeof value.task.status === "string"
    && taskStatuses.has(value.task.status)
    && typeof value.task.revision === "number"
    && typeof value.task.createdAt === "string"
    && typeof value.task.updatedAt === "string"
    && typeof value.progress.completedSteps === "number"
    && typeof value.progress.actionableSteps === "number"
    && (typeof value.progress.percent === "number" || value.progress.percent === null)
    && typeof value.progress.label === "string"
    && Array.isArray(value.steps)
    && value.steps.every(isStep)
    && Array.isArray(value.events)
    && value.events.every(isEvent)
    && (value.nextRunnableStep === undefined || value.nextRunnableStep === null || isStep(value.nextRunnableStep));
}

function readSnapshot(value: unknown): TaskProgressSnapshot | undefined {
  if (isSnapshot(value)) return value;
  if (isRecord(value) && isSnapshot(value.snapshot)) return value.snapshot;
  return undefined;
}

function publish(snapshot: TaskProgressSnapshot | undefined, error?: string) {
  latestSnapshot = snapshot;
  bridgeError = error;
  for (const listener of listeners) listener(snapshot, error);
}

function toolErrorText(content: unknown): string {
  if (!Array.isArray(content)) return "The task progress tool returned an error.";
  const text = content.find((item) => isRecord(item) && item.type === "text" && typeof item.text === "string");
  return isRecord(text) && typeof text.text === "string" ? text.text : "The task progress tool returned an error.";
}

const app = new App({ name: "rv-workflow-task-progress", version: "1.0.0" }, {}, { autoResize: true });

app.ontoolresult = (result) => {
  if (result.isError) {
    publish(latestSnapshot, toolErrorText(result.content));
    return;
  }
  const snapshot = readSnapshot(result.structuredContent);
  if (snapshot) publish(snapshot);
  else publish(latestSnapshot, "The host returned task progress in an unsupported format.");
};

app.onhostcontextchanged = (context) => {
  if (context.theme) applyDocumentTheme(context.theme);
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context.locale) {
    document.documentElement.lang = context.locale;
    publish(latestSnapshot, bridgeError);
  }
};

async function getTaskProgress(input: { taskId?: string }): Promise<TaskProgressSnapshot> {
  if (!canRefresh) throw new Error("Refresh is unavailable because this host cannot call server tools.");
  const result = await app.callServerTool({ name: "get_task_progress", arguments: input });
  if (result.isError) throw new Error(toolErrorText(result.content));
  const snapshot = readSnapshot(result.structuredContent);
  if (!snapshot) throw new Error("The server returned task progress in an unsupported format.");
  publish(snapshot);
  return snapshot;
}

function DashboardApp() {
  const [state, setState] = useState({ snapshot: latestSnapshot, error: bridgeError, refreshAvailable: canRefresh });

  useEffect(() => {
    const listener: SnapshotListener = (snapshot, error) => setState({ snapshot, error, refreshAvailable: canRefresh });
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  return (
    <TaskProgressDashboard
      snapshot={state.snapshot}
      getTaskProgress={getTaskProgress}
      initialError={state.error}
      refreshAvailable={state.refreshAvailable}
    />
  );
}

let mount = document.getElementById("app") ?? document.getElementById("root");
if (!mount) {
  mount = document.createElement("div");
  mount.id = "app";
  document.body.append(mount);
}

createRoot(mount).render(<StrictMode><DashboardApp /></StrictMode>);

void app.connect().then(() => {
  const context = app.getHostContext();
  if (context?.theme) applyDocumentTheme(context.theme);
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context?.locale && !document.documentElement.lang) document.documentElement.lang = context.locale;
  canRefresh = Boolean(app.getHostCapabilities()?.serverTools);
  publish(latestSnapshot, canRefresh ? undefined : "Refresh is unavailable in this host.");
}).catch((cause: unknown) => {
  publish(latestSnapshot, cause instanceof Error ? `Could not connect to the MCP host: ${cause.message}` : "Could not connect to the MCP host.");
});
