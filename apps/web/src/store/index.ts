// Facade: external consumers import from here.
// Internal store modules import siblings directly (never through this file).

export { type AppState, initialState } from "./appState";
export { type AppStore, useStore } from "./createStore";
export { applyOrchestrationEvent, applyOrchestrationEvents } from "./eventReducer";
export { syncServerReadModel, setError, setThreadBranch } from "./actions";
export {
  selectProjectById,
  selectThreadById,
  selectSidebarThreadSummaryById,
  selectThreadIdsByProjectId,
} from "./selectors";
