export type Operation =
  | "addition"
  | "subtraction"
  | "multiplication"
  | "division"
  | "counting"
  | "fractions";

/** Every recorded attempt carries its operation so windows are always scoped. */
export interface SessionResult {
  operation: Operation;
  correct: boolean;
  timestamp: number;
}

/** Difficulty bounds are topic-specific so counting never reaches division ceilings. */
export interface DifficultyBounds {
  min: number;
  max: number;
}

export const DIFFICULTY_BOUNDS: Record<Operation, DifficultyBounds> = {
  counting:       { min: 1, max: 3 },
  addition:       { min: 1, max: 5 },
  subtraction:    { min: 1, max: 5 },
  multiplication: { min: 1, max: 6 },
  division:       { min: 1, max: 6 },
  fractions:      { min: 1, max: 4 },
};

/** Promotion: 3 consecutive correct → level up. Demotion: 2 consecutive wrong → level down. */
export const PROMOTE_STREAK = 3;
export const DEMOTE_STREAK  = 2;
/** Window size used for weak-area detection per operation. */
export const WEAK_WINDOW    = 6;
/** Ratio of correct answers below which an operation is considered weak. */
export const WEAK_THRESHOLD = 0.5;
/** Consecutive correct answers needed to clear a weak area. */
export const WEAK_CLEAR_STREAK = 3;
/** Consecutive wrong answers before a hint is offered. */
export const HINT_THRESHOLD = 2;

/** Independent tutor state for one (profile, operation) pair. */
export interface OperationState {
  level: number;
  /** Last N results for this operation only. */
  recentResults: SessionResult[];
  isWeak: boolean;
  consecutiveCorrect: number;
  consecutiveWrong: number;
}

export interface Profile {
  id: string;
  name: string;
  age: number;
  /** Keyed by Operation — fully independent per topic. */
  operationStates: Record<Operation, OperationState>;
}

export interface AppState {
  version: number;
  profiles: Profile[];
  activeProfileId: string | null;
}
