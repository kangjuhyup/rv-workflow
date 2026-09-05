import type {
  StepStatus,
  TaskProgressSnapshot,
  TaskProgressStep,
} from "./task-progress-service.js";

export type TerminalInputMode = "normal" | "search" | "command" | "confirm";
export type TerminalStatusFilter = StepStatus | "all";
export type TerminalNoticeTone = "info" | "success" | "error";

export interface TerminalViewState {
  mode: TerminalInputMode;
  selectedStepId: string | undefined;
  expandedStepIds: readonly string[];
  searchQuery: string;
  statusFilter: TerminalStatusFilter;
  inputBuffer: string;
  helpVisible: boolean;
  confirmation: string | undefined;
  notice: string | undefined;
  noticeTone: TerminalNoticeTone;
}

export function defaultTerminalViewState(snapshot: TaskProgressSnapshot): TerminalViewState {
  return {
    mode: "normal",
    selectedStepId: snapshot.steps[0]?.id,
    expandedStepIds: [],
    searchQuery: "",
    statusFilter: "all",
    inputBuffer: "",
    helpVisible: false,
    confirmation: undefined,
    notice: undefined,
    noticeTone: "info",
  };
}

export function visibleTerminalSteps(
  snapshot: TaskProgressSnapshot,
  view: Pick<TerminalViewState, "searchQuery" | "statusFilter">,
): TaskProgressStep[] {
  const query = view.searchQuery.trim().toLocaleLowerCase();
  return snapshot.steps.filter((step) => {
    if (view.statusFilter !== "all" && step.status !== view.statusFilter) return false;
    if (query === "") return true;
    return [
      step.id,
      step.title,
      step.role,
      step.status,
      step.owner,
      step.summary,
      step.blockedReason,
    ].some((value) => value?.toLocaleLowerCase().includes(query));
  });
}
