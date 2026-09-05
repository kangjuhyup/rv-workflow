import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  TaskProgressDashboard,
  type TaskProgressSnapshot,
} from "../src/task-progress-dashboard.js";

function snapshot(overrides: Partial<TaskProgressSnapshot> = {}): TaskProgressSnapshot {
  return {
    workspaceLabel: "rv-workflow",
    task: {
      id: "task-1",
      title: "Deliver the workflow plugin",
      status: "in_progress",
      revision: 3,
      createdAt: "2026-09-04T01:00:00.000Z",
      updatedAt: "2026-09-04T02:00:00.000Z",
    },
    progress: { completedSteps: 1, actionableSteps: 2, percent: 50, label: "1 / 2 actionable steps" },
    steps: [
      { id: "plan", title: "Approve the plan", role: "planner", status: "completed", dependsOn: [] },
      {
        id: "backend",
        title: "Build the task service",
        role: "backend",
        status: "blocked",
        dependsOn: ["plan"],
        blockedReason: "Waiting for the service credential",
      },
      { id: "frontend", title: "Build the dashboard", role: "frontend", status: "in_progress", dependsOn: ["plan"] },
    ],
    events: [{ id: "event-1", kind: "step_blocked", at: "2026-09-04T02:00:00.000Z", summary: "Credential requested", evidenceRefs: ["tests: credential check"] }],
    nextRunnableStep: { id: "frontend", title: "Build the dashboard", role: "frontend", status: "in_progress", dependsOn: ["plan"] },
    ...overrides,
  };
}

describe("The inline dashboard makes task progress understandable without colour alone", () => {
  it("renders the workspace, task, calculated progress, role lanes and a specific blocker with semantic controls", () => {
    render(<TaskProgressDashboard snapshot={snapshot()} getTaskProgress={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Deliver the workflow plugin" })).toBeInTheDocument();
    expect(screen.getByText("rv-workflow")).toBeInTheDocument();
    expect(screen.getByText(/in progress/i)).toBeInTheDocument();
    expect(screen.getByText("1 / 2 actionable steps")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: /task progress/i })).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByText("planner", { selector: "h3" })).toBeInTheDocument();
    expect(screen.getByText("backend", { selector: "h3" })).toBeInTheDocument();
    expect(screen.getByText("Waiting for the service credential")).toBeInTheDocument();
    expect(screen.getByLabelText("Task status: In progress")).toHaveClass("tp-task-state--in_progress");
    expect(screen.getByLabelText("Step status: Waiting")).toHaveClass("tp-step-status--blocked");
    expect(screen.getByLabelText("Step status: Active")).toHaveClass("tp-step-status--in_progress");
    expect(screen.getByRole("button", { name: /refresh task progress/i })).toBeVisible();
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("uses the keyboard-accessible refresh control to obtain and announce the newest task revision", async () => {
    const refreshed = snapshot({
      task: { ...snapshot().task, revision: 4, status: "completed", updatedAt: "2026-09-04T03:00:00.000Z" },
      progress: { completedSteps: 2, actionableSteps: 2, percent: 100, label: "2 / 2 actionable steps" },
    });
    const getTaskProgress = vi.fn().mockResolvedValue(refreshed);
    render(<TaskProgressDashboard snapshot={snapshot()} getTaskProgress={getTaskProgress} />);

    fireEvent.keyDown(screen.getByRole("button", { name: /refresh task progress/i }), { key: "Enter" });

    await waitFor(() => expect(getTaskProgress).toHaveBeenCalledWith({ taskId: "task-1" }));
    expect(await screen.findByText("2 / 2 actionable steps")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/updated/i);
  });

  it("shows loading and a recoverable error rather than leaving the user with stale assumptions", async () => {
    let resolveRefresh: (value: TaskProgressSnapshot) => void = () => undefined;
    const getTaskProgress = vi.fn(() => new Promise<TaskProgressSnapshot>((resolve) => { resolveRefresh = resolve; }));
    render(<TaskProgressDashboard snapshot={snapshot()} getTaskProgress={getTaskProgress} />);

    fireEvent.click(screen.getByRole("button", { name: /refresh task progress/i }));
    expect(screen.getByRole("status")).toHaveTextContent(/refreshing/i);

    resolveRefresh(snapshot());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/updated/i));

    getTaskProgress.mockRejectedValueOnce(new Error("storage_error: state file cannot be read"));
    fireEvent.click(screen.getByRole("button", { name: /refresh task progress/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/state file cannot be read/i);
  });

  it("renders no-actionable, blocked, completed, stale and empty states as named user-facing states", () => {
    function States() {
      const [shown, setShown] = useState<"empty" | "no-actionable" | "blocked" | "completed" | "stale">("empty");
      const values: Record<typeof shown, TaskProgressSnapshot | undefined> = {
        empty: undefined,
        "no-actionable": snapshot({ progress: { completedSteps: 0, actionableSteps: 0, percent: null, label: "No actionable steps" } }),
        blocked: snapshot({ task: { ...snapshot().task, status: "blocked" } }),
        completed: snapshot({ task: { ...snapshot().task, status: "completed" }, progress: { completedSteps: 2, actionableSteps: 2, percent: 100, label: "2 / 2 actionable steps" } }),
        stale: snapshot({ isStale: true }),
      };
      return <><button onClick={() => setShown("no-actionable")}>no actionable</button><button onClick={() => setShown("blocked")}>blocked</button><button onClick={() => setShown("completed")}>completed</button><button onClick={() => setShown("stale")}>stale</button><TaskProgressDashboard snapshot={values[shown]} getTaskProgress={vi.fn()} /></>;
    }

    render(<States />);
    expect(screen.getByText(/no task progress/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "no actionable" }));
    expect(screen.getByText("No actionable steps")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "blocked" }));
    expect(screen.getByText(/blocked/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "completed" }));
    expect(screen.getByText(/completed/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "stale" }));
    expect(screen.getByText(/may be out of date/i)).toBeInTheDocument();
  });

  it("shows each concurrently active step owner in both its role lane and the Current section", () => {
    const concurrent = snapshot({
      steps: [
        { id: "plan", title: "Approve the plan", role: "planner", status: "completed", dependsOn: [], owner: "coordinator" },
        { id: "api", title: "Build the API", role: "backend", status: "in_progress", dependsOn: ["plan"], owner: "backend-agent" },
        { id: "ui", title: "Build the interface", role: "frontend", status: "in_progress", dependsOn: ["plan"], owner: "frontend-agent" },
      ],
      nextRunnableStep: null,
    });
    render(<TaskProgressDashboard snapshot={concurrent} getTaskProgress={vi.fn()} />);

    const backendLane = screen.getByRole("heading", { name: "backend" }).closest(".tp-lane");
    const frontendLane = screen.getByRole("heading", { name: "frontend" }).closest(".tp-lane");
    const currentSection = screen.getByRole("heading", { name: "Current and next" }).closest(".tp-now");
    if (!backendLane || !frontendLane || !currentSection) throw new Error("Expected dashboard role and Current sections.");

    expect(backendLane).toHaveTextContent("backend-agent");
    expect(frontendLane).toHaveTextContent("frontend-agent");
    expect(currentSection).toHaveTextContent("backend-agent");
    expect(currentSection).toHaveTextContent("frontend-agent");
  });
});
