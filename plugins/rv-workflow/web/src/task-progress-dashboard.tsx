import { useEffect, useMemo, useState, type KeyboardEvent } from "react";

export type TaskRole = "planner" | "test-writer" | "backend" | "frontend" | "document" | "qa";
export type StepStatus = "pending" | "in_progress" | "blocked" | "completed" | "skipped";
export type TaskStatus = "pending" | "in_progress" | "blocked" | "completed";

export interface TaskProgressStep {
  id: string;
  title: string;
  role: TaskRole;
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
  kind: string;
  at: string;
  summary: string;
  evidenceRefs: string[];
}

export interface TaskProgressSnapshot {
  schemaVersion?: number | string;
  workspaceKey?: string;
  workspaceLabel: string;
  task: {
    id: string;
    title: string;
    status: TaskStatus;
    revision: number;
    specPath?: string;
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
  nextRunnableStep?: TaskProgressStep | null;
  isStale?: boolean;
}

export interface TaskProgressDashboardProps {
  snapshot?: TaskProgressSnapshot | undefined;
  getTaskProgress: (input: { taskId?: string }) => Promise<TaskProgressSnapshot>;
  initialError?: string | undefined;
  refreshAvailable?: boolean | undefined;
}

const ROLE_ORDER: TaskRole[] = ["planner", "test-writer", "backend", "frontend", "document", "qa"];

const TASK_STATUS: Record<TaskStatus, { icon: string; label: string }> = {
  pending: { icon: "○", label: "Pending" },
  in_progress: { icon: "◐", label: "In progress" },
  blocked: { icon: "!", label: "Needs attention" },
  completed: { icon: "✓", label: "All work done" },
};

const STEP_STATUS: Record<StepStatus, { icon: string; label: string }> = {
  pending: { icon: "○", label: "Queued" },
  in_progress: { icon: "◐", label: "Active" },
  blocked: { icon: "!", label: "Waiting" },
  completed: { icon: "✓", label: "Done" },
  skipped: { icon: "—", label: "Skipped" },
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Unknown time";
  const locale = typeof document === "undefined" ? undefined : document.documentElement.lang || undefined;
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Task progress could not be refreshed.";
}

function StatusMark({ status }: { status: StepStatus }) {
  const presentation = STEP_STATUS[status];
  return (
    <span
      className={`tp-step-status tp-step-status--${status}`}
      aria-label={`Step status: ${presentation.label}`}
    >
      <span aria-hidden="true" className="tp-status-icon">{presentation.icon}</span>
      {presentation.label}
    </span>
  );
}

export function TaskProgressDashboard({
  snapshot,
  getTaskProgress,
  initialError,
  refreshAvailable = true,
}: TaskProgressDashboardProps) {
  const [current, setCurrent] = useState(snapshot);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [announcement, setAnnouncement] = useState(snapshot ? "Task progress ready." : "Waiting for a tracked task.");
  const [error, setError] = useState<string | undefined>(initialError);

  useEffect(() => {
    setCurrent(snapshot);
    if (snapshot) {
      setError(undefined);
      setAnnouncement(`Task progress updated to revision ${snapshot.task.revision}.`);
    }
  }, [snapshot]);

  useEffect(() => {
    if (initialError) setError(initialError);
  }, [initialError]);

  const lanes = useMemo(() => {
    if (!current) return [];
    return ROLE_ORDER.flatMap((role) => {
      const steps = current.steps.filter((step) => step.role === role);
      return steps.length > 0 ? [{ role, steps }] : [];
    });
  }, [current]);

  async function refresh() {
    if (isRefreshing) return;
    if (!refreshAvailable) {
      setError("Refresh is unavailable because this host cannot call server tools.");
      setAnnouncement("Refresh unavailable.");
      return;
    }

    setIsRefreshing(true);
    setError(undefined);
    setAnnouncement("Refreshing task progress…");
    try {
      const next = await getTaskProgress(current ? { taskId: current.task.id } : {});
      setCurrent(next);
      setAnnouncement(`Task progress updated to revision ${next.task.revision}.`);
    } catch (cause) {
      setError(errorMessage(cause));
      setAnnouncement("Task progress refresh failed.");
    } finally {
      setIsRefreshing(false);
    }
  }

  function handleRefreshKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void refresh();
    }
  }

  if (!current) {
    return (
      <article className="tp-card tp-card--empty" aria-labelledby="task-progress-empty-title">
        <style>{DASHBOARD_STYLES}</style>
        <div className="tp-empty-icon" aria-hidden="true">○</div>
        <h1 id="task-progress-empty-title">No task progress</h1>
        <p>A tracked task has not been provided yet.</p>
        {error ? <p className="tp-alert" role="alert">{error}</p> : null}
        <button
          className="tp-refresh"
          type="button"
          onClick={() => void refresh()}
          onKeyDown={handleRefreshKeyDown}
          disabled={isRefreshing}
          aria-label="Refresh task progress"
        >
          <span aria-hidden="true">↻</span> {isRefreshing ? "Refreshing…" : "Refresh"}
        </button>
        <p className="tp-live" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
      </article>
    );
  }

  const taskPresentation = TASK_STATUS[current.task.status];
  const activeSteps = current.steps.filter((step) => step.status === "in_progress");
  const waitingSteps = current.steps.filter((step) => step.status === "blocked");
  const recentEvents = current.events.slice(-5).reverse();

  return (
    <article className={`tp-card tp-card--${current.task.status}`} aria-labelledby="task-progress-title">
      <style>{DASHBOARD_STYLES}</style>
      <header className="tp-header">
        <div className="tp-heading-group">
          <p className="tp-eyebrow">{current.workspaceLabel}</p>
          <h1 id="task-progress-title">{current.task.title}</h1>
        </div>
        <button
          className="tp-refresh"
          type="button"
          onClick={() => void refresh()}
          onKeyDown={handleRefreshKeyDown}
          disabled={isRefreshing}
          aria-label="Refresh task progress"
        >
          <span aria-hidden="true">↻</span> {isRefreshing ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {current.isStale ? (
        <p className="tp-stale"><span aria-hidden="true">◷</span> This progress may be out of date. Refresh to check the latest revision.</p>
      ) : null}
      {error ? <p className="tp-alert" role="alert"><strong>Could not refresh.</strong> {error}</p> : null}

      <section className="tp-summary" aria-labelledby="task-summary-title">
        <h2 className="tp-visually-hidden" id="task-summary-title">Task summary</h2>
        <div className={`tp-task-state tp-task-state--${current.task.status}`} aria-label={`Task status: ${taskPresentation.label}`}>
          <span aria-hidden="true" className="tp-status-icon">{taskPresentation.icon}</span>
          <span>{taskPresentation.label}</span>
        </div>
        <div className="tp-progress-copy">
          <strong>{current.progress.label}</strong>
          <span>Revision {current.task.revision}</span>
        </div>
        {current.progress.percent === null ? (
          <div className="tp-progress-track tp-progress-track--empty" aria-label="Task progress: no actionable steps" />
        ) : (
          <div
            className="tp-progress-track"
            role="progressbar"
            aria-label="Task progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={current.progress.percent}
          >
            <span style={{ width: `${Math.max(0, Math.min(100, current.progress.percent))}%` }} />
          </div>
        )}
      </section>

      <section className="tp-section" aria-labelledby="role-lanes-title">
        <div className="tp-section-heading">
          <h2 id="role-lanes-title">Role lanes</h2>
          <span>{current.steps.length} {current.steps.length === 1 ? "step" : "steps"}</span>
        </div>
        <div className="tp-lanes">
          {lanes.map(({ role, steps }) => (
            <section className="tp-lane" aria-labelledby={`lane-${role}`} key={role}>
              <h3 id={`lane-${role}`}>{role}</h3>
              <ul>
                {steps.map((step) => (
                  <li className={`tp-step tp-step--${step.status}`} key={step.id}>
                    <div className="tp-step-line">
                      <strong>{step.title}</strong>
                      <StatusMark status={step.status} />
                    </div>
                    {step.owner ? <p className="tp-owner">Owner: <strong>{step.owner}</strong></p> : null}
                    {step.summary ? <p>{step.summary}</p> : null}
                    {step.blockedReason ? <p className="tp-blocker"><span aria-hidden="true">↳</span> {step.blockedReason}</p> : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </section>

      <div className="tp-detail-grid">
        <section className="tp-section tp-now" aria-labelledby="current-work-title">
          <h2 id="current-work-title">Current and next</h2>
          {activeSteps.length > 0 ? (
            <ul>
              {activeSteps.map((step) => (
                <li key={step.id}>
                  <span>Now</span>
                  <strong>{step.title}</strong>
                  <small>{step.role}{step.owner ? ` · ${step.owner}` : ""}</small>
                </li>
              ))}
            </ul>
          ) : <p className="tp-muted">No step is currently active.</p>}
          {current.nextRunnableStep && !activeSteps.some((step) => step.id === current.nextRunnableStep?.id) ? (
            <p className="tp-next"><span>Next</span><strong>{current.nextRunnableStep.title}</strong><small>{current.nextRunnableStep.role}</small></p>
          ) : null}
          {waitingSteps.length > 0 ? (
            <div className="tp-waiting">
              <h3>Needs attention</h3>
              <ul>{waitingSteps.map((step) => <li key={step.id}><strong>{step.title}</strong></li>)}</ul>
            </div>
          ) : null}
        </section>

        <section className="tp-section tp-events" aria-labelledby="recent-events-title">
          <h2 id="recent-events-title">Recent events</h2>
          {recentEvents.length > 0 ? (
            <ol>
              {recentEvents.map((event) => (
                <li key={event.id}>
                  <div><strong>{event.summary}</strong><time dateTime={event.at}>{formatDate(event.at)}</time></div>
                  {event.evidenceRefs.length > 0 ? <ul aria-label={`Evidence for ${event.summary}`}>{event.evidenceRefs.map((reference) => <li key={reference}><code>{reference}</code></li>)}</ul> : null}
                </li>
              ))}
            </ol>
          ) : <p className="tp-muted">No recent events.</p>}
        </section>
      </div>

      <footer className="tp-footer">
        <span>Last updated <time dateTime={current.task.updatedAt}>{formatDate(current.task.updatedAt)}</time></span>
        <span className="tp-live" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
      </footer>
    </article>
  );
}

const DASHBOARD_STYLES = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; }
  .tp-card {
    --tp-bg: var(--color-background-primary, #f7f6f2);
    --tp-surface: var(--color-background-secondary, #ffffff);
    --tp-text: var(--color-text-primary, #17201d);
    --tp-muted: var(--color-text-secondary, #62706a);
    --tp-border: var(--color-border-secondary, #d9dfdb);
    --tp-accent: #19705c;
    --tp-warning: #9a5a13;
    --tp-danger: #a13b34;
    color: var(--tp-text); background: var(--tp-bg); border: 1px solid var(--tp-border);
    border-radius: 18px; padding: clamp(16px, 4vw, 28px); font: 14px/1.45 var(--font-sans, ui-sans-serif, system-ui, sans-serif);
    box-shadow: var(--shadow-sm, 0 8px 24px rgb(23 32 29 / 8%)); overflow-wrap: anywhere;
  }
  .tp-header { display: flex; gap: 16px; align-items: flex-start; justify-content: space-between; }
  .tp-heading-group { min-width: 0; }
  .tp-eyebrow { color: var(--tp-accent); font-size: 12px; font-weight: 700; letter-spacing: .08em; margin: 0 0 5px; text-transform: uppercase; }
  h1, h2, h3, p { margin-top: 0; }
  h1 { font-size: clamp(20px, 5vw, 28px); line-height: 1.15; margin-bottom: 0; }
  h2 { font-size: 15px; line-height: 1.25; margin-bottom: 12px; }
  h3 { font-size: 12px; letter-spacing: .06em; text-transform: uppercase; }
  .tp-refresh { align-items: center; background: var(--tp-surface); border: 1px solid var(--tp-border); border-radius: 999px; color: var(--tp-text); cursor: pointer; display: inline-flex; flex: 0 0 auto; gap: 7px; min-height: 40px; padding: 7px 13px; font: inherit; font-weight: 700; }
  .tp-refresh:hover { border-color: var(--tp-accent); }
  .tp-refresh:focus-visible { outline: 3px solid var(--color-ring-primary, #65bda8); outline-offset: 3px; }
  .tp-refresh:disabled { cursor: wait; opacity: .65; }
  .tp-stale, .tp-alert { border-radius: 10px; margin: 16px 0 0; padding: 10px 12px; }
  .tp-stale { background: color-mix(in srgb, var(--tp-warning) 12%, transparent); color: var(--tp-warning); }
  .tp-alert { background: color-mix(in srgb, var(--tp-danger) 11%, transparent); color: var(--tp-danger); }
  .tp-summary { display: grid; grid-template-columns: auto minmax(150px, 1fr); gap: 12px 20px; margin-top: 24px; padding: 16px; background: var(--tp-surface); border: 1px solid var(--tp-border); border-radius: 14px; }
  .tp-task-state, .tp-step-status { align-items: center; border: 1px solid color-mix(in srgb, currentColor 24%, transparent); border-radius: 999px; display: inline-flex; gap: 7px; font-weight: 750; }
  .tp-task-state { background: color-mix(in srgb, var(--tp-muted) 9%, transparent); color: var(--tp-muted); padding: 6px 10px 6px 7px; width: fit-content; }
  .tp-task-state--in_progress { background: color-mix(in srgb, var(--tp-accent) 10%, transparent); color: var(--tp-accent); }
  .tp-task-state--blocked { background: color-mix(in srgb, var(--tp-danger) 10%, transparent); color: var(--tp-danger); }
  .tp-task-state--completed { background: color-mix(in srgb, var(--tp-accent) 10%, transparent); color: var(--tp-accent); }
  .tp-status-icon { align-items: center; border: 1px solid currentColor; border-radius: 50%; display: inline-flex; height: 22px; justify-content: center; width: 22px; }
  .tp-progress-copy { display: flex; justify-content: space-between; gap: 12px; color: var(--tp-muted); }
  .tp-progress-copy strong { color: var(--tp-text); }
  .tp-progress-track { background: color-mix(in srgb, var(--tp-accent) 12%, var(--tp-border)); border-radius: 999px; grid-column: 1 / -1; height: 7px; overflow: hidden; }
  .tp-progress-track > span { background: var(--tp-accent); display: block; height: 100%; transition: width 180ms ease-out; }
  .tp-progress-track--empty { background: repeating-linear-gradient(135deg, transparent 0 5px, var(--tp-border) 5px 9px); }
  .tp-section { margin-top: 24px; }
  .tp-section-heading { display: flex; justify-content: space-between; color: var(--tp-muted); }
  .tp-section-heading h2 { color: var(--tp-text); }
  .tp-lanes { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(min(210px, 100%), 1fr)); }
  .tp-lane { background: var(--tp-surface); border: 1px solid var(--tp-border); border-radius: 13px; min-width: 0; padding: 13px; }
  .tp-lane h3 { color: var(--tp-muted); margin-bottom: 10px; }
  .tp-lane ul, .tp-now ul, .tp-waiting ul, .tp-events ol, .tp-events ul { list-style: none; margin: 0; padding: 0; }
  .tp-step + .tp-step { border-top: 1px solid var(--tp-border); margin-top: 11px; padding-top: 11px; }
  .tp-step-line { align-items: flex-start; display: flex; gap: 10px; justify-content: space-between; }
  .tp-step-line strong { min-width: 0; }
  .tp-step-status { background: color-mix(in srgb, var(--tp-muted) 8%, transparent); color: var(--tp-muted); flex: 0 0 auto; font-size: 11px; padding: 3px 7px 3px 4px; }
  .tp-step-status .tp-status-icon { height: 17px; width: 17px; }
  .tp-step-status--in_progress { background: color-mix(in srgb, var(--tp-accent) 10%, transparent); color: var(--tp-accent); }
  .tp-step-status--blocked { background: color-mix(in srgb, var(--tp-danger) 10%, transparent); color: var(--tp-danger); }
  .tp-step-status--completed { background: color-mix(in srgb, var(--tp-accent) 10%, transparent); color: var(--tp-accent); }
  .tp-step p { color: var(--tp-muted); font-size: 12px; margin: 8px 0 0; }
  .tp-step .tp-owner { margin-top: 6px; }
  .tp-step .tp-owner strong { color: var(--tp-text); font-weight: 700; }
  .tp-step .tp-blocker { color: var(--tp-danger); }
  .tp-detail-grid { display: grid; gap: 24px; grid-template-columns: minmax(0, .85fr) minmax(0, 1.15fr); }
  .tp-now > ul li, .tp-next { display: grid; grid-template-columns: 42px 1fr; gap: 2px 8px; margin: 0 0 10px; }
  .tp-now li span, .tp-next span { color: var(--tp-accent); font-size: 11px; font-weight: 800; grid-row: 1 / span 2; text-transform: uppercase; }
  .tp-now small, .tp-next small { color: var(--tp-muted); }
  .tp-waiting { border-left: 3px solid var(--tp-danger); margin-top: 16px; padding-left: 12px; }
  .tp-waiting h3 { color: var(--tp-danger); margin-bottom: 7px; }
  .tp-waiting li + li { margin-top: 6px; }
  .tp-events > ol > li { border-left: 1px solid var(--tp-border); padding: 0 0 14px 14px; position: relative; }
  .tp-events > ol > li::before { background: var(--tp-accent); border: 3px solid var(--tp-bg); border-radius: 50%; content: ''; height: 9px; left: -5px; position: absolute; top: 5px; width: 9px; }
  .tp-events > ol > li > div { display: flex; gap: 12px; justify-content: space-between; }
  .tp-events time { color: var(--tp-muted); flex: 0 0 auto; font-size: 11px; }
  .tp-events ul { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
  .tp-events code { background: var(--tp-surface); border: 1px solid var(--tp-border); border-radius: 5px; color: var(--tp-muted); font: 11px/1.4 var(--font-mono, ui-monospace, monospace); padding: 2px 5px; }
  .tp-footer { border-top: 1px solid var(--tp-border); color: var(--tp-muted); display: flex; font-size: 11px; gap: 12px; justify-content: space-between; margin-top: 12px; padding-top: 12px; }
  .tp-live:empty { display: none; }
  .tp-muted { color: var(--tp-muted); }
  .tp-visually-hidden { clip: rect(0 0 0 0); clip-path: inset(50%); height: 1px; overflow: hidden; position: absolute; white-space: nowrap; width: 1px; }
  .tp-card--empty { text-align: center; }
  .tp-card--empty .tp-empty-icon { border: 1px solid var(--tp-border); border-radius: 50%; color: var(--tp-muted); display: grid; font-size: 24px; height: 52px; margin: 0 auto 12px; place-items: center; width: 52px; }
  .tp-card--empty h1 { margin-bottom: 7px; }
  .tp-card--empty > p:not(.tp-alert) { color: var(--tp-muted); }
  @media (max-width: 540px) {
    .tp-header, .tp-progress-copy, .tp-footer, .tp-events > ol > li > div { align-items: flex-start; flex-direction: column; }
    .tp-refresh { width: 100%; justify-content: center; }
    .tp-summary, .tp-detail-grid { grid-template-columns: 1fr; }
    .tp-progress-track { grid-column: 1; }
    .tp-detail-grid { gap: 0; }
    .tp-events time { flex: auto; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
  }
`;
