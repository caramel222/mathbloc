import {
  Operation,
  OperationState,
  SessionResult,
  DIFFICULTY_BOUNDS,
  PROMOTE_STREAK,
  DEMOTE_STREAK,
  WEAK_WINDOW,
  WEAK_THRESHOLD,
  WEAK_CLEAR_STREAK,
  HINT_THRESHOLD,
} from "./types";

export function makeOperationState(operation: Operation): OperationState {
  return {
    level: DIFFICULTY_BOUNDS[operation].min,
    recentResults: [],
    isWeak: false,
    consecutiveCorrect: 0,
    consecutiveWrong: 0,
  };
}

/**
 * Pure function: given the current state for one operation and a new result
 * for that same operation, returns the next state.
 * Results from other operations are never passed here, so cross-topic
 * contamination is structurally impossible.
 */
export function applyResult(
  state: OperationState,
  result: SessionResult
): OperationState {
  const bounds = DIFFICULTY_BOUNDS[result.operation];

  const consecutiveCorrect = result.correct ? state.consecutiveCorrect + 1 : 0;
  const consecutiveWrong   = result.correct ? 0 : state.consecutiveWrong + 1;

  // Keep only the last WEAK_WINDOW results for this operation.
  const recentResults = [
    ...state.recentResults.slice(-(WEAK_WINDOW - 1)),
    result,
  ];

  // Promote or demote level within topic-specific bounds.
  let level = state.level;
  if (consecutiveCorrect >= PROMOTE_STREAK) {
    level = Math.min(level + 1, bounds.max);
  } else if (consecutiveWrong >= DEMOTE_STREAK) {
    level = Math.max(level - 1, bounds.min);
  }

  // Weak-area: flag when accuracy in the window drops below threshold.
  // Clear only when WEAK_CLEAR_STREAK consecutive correct answers in THIS operation.
  const windowCorrect = recentResults.filter((r) => r.correct).length;
  const accuracy = recentResults.length > 0 ? windowCorrect / recentResults.length : 1;

  let isWeak = state.isWeak;
  if (accuracy < WEAK_THRESHOLD && recentResults.length >= WEAK_WINDOW) {
    isWeak = true;
  }
  if (isWeak && consecutiveCorrect >= WEAK_CLEAR_STREAK) {
    isWeak = false;
  }

  return { level, recentResults, isWeak, consecutiveCorrect, consecutiveWrong };
}

/** Returns true when the learner should receive a hint for this operation. */
export function shouldShowHint(state: OperationState): boolean {
  return state.consecutiveWrong >= HINT_THRESHOLD;
}

/** Human-readable summary of the current state — used by the parent dashboard. */
export interface OperationSummary {
  operation: Operation;
  level: number;
  maxLevel: number;
  isWeak: boolean;
  recentAccuracy: number;
  hintActive: boolean;
}

export function summarise(
  operation: Operation,
  state: OperationState
): OperationSummary {
  const { recentResults } = state;
  const correct = recentResults.filter((r) => r.correct).length;
  const recentAccuracy =
    recentResults.length > 0 ? correct / recentResults.length : 1;

  return {
    operation,
    level: state.level,
    maxLevel: DIFFICULTY_BOUNDS[operation].max,
    isWeak: state.isWeak,
    recentAccuracy: Math.round(recentAccuracy * 100) / 100,
    hintActive: shouldShowHint(state),
  };
}
