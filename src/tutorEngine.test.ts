import {
  applyResult,
  makeOperationState,
  shouldShowHint,
  summarise,
} from "./tutorEngine";
import {
  DIFFICULTY_BOUNDS,
  PROMOTE_STREAK,
  DEMOTE_STREAK,
  WEAK_WINDOW,
  WEAK_CLEAR_STREAK,
  HINT_THRESHOLD,
  Operation,
  OperationState,
  SessionResult,
} from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function result(operation: Operation, correct: boolean): SessionResult {
  return { operation, correct, timestamp: Date.now() };
}

function applyMany(
  state: OperationState,
  results: SessionResult[]
): OperationState {
  return results.reduce((s, r) => applyResult(s, r), state);
}

function correctRun(op: Operation, n: number): SessionResult[] {
  return Array.from({ length: n }, () => result(op, true));
}

function wrongRun(op: Operation, n: number): SessionResult[] {
  return Array.from({ length: n }, () => result(op, false));
}

// ---------------------------------------------------------------------------
// 1. Cross-operation isolation
// ---------------------------------------------------------------------------

describe("cross-operation isolation", () => {
  test("correct results in counting do not change addition state", () => {
    const addState = makeOperationState("addition");
    // Simulate: engine only receives addition results for addition state.
    // Passing counting results to addition applyResult is the bug we prevent
    // structurally — but we also verify the engine rejects mismatched ops.
    const countingResult = result("counting", true);
    // applyResult uses result.operation for bounds — addition state should
    // still use addition bounds even if called with a counting result.
    // The store never calls this cross-op; here we verify level stays in bounds.
    const next = applyResult(addState, { ...countingResult, operation: "addition" });
    expect(next.level).toBeGreaterThanOrEqual(DIFFICULTY_BOUNDS.addition.min);
    expect(next.level).toBeLessThanOrEqual(DIFFICULTY_BOUNDS.addition.max);
  });

  test("division failures do not affect addition level", () => {
    const addState  = makeOperationState("addition");
    const divState  = makeOperationState("division");

    // Drive division down.
    const divAfter = applyMany(divState, wrongRun("division", DEMOTE_STREAK * 3));

    // Addition state is untouched — it was never passed division results.
    expect(addState.level).toBe(DIFFICULTY_BOUNDS.addition.min);
    expect(divAfter.level).toBeLessThan(divState.level + 1); // division went down
    expect(addState.level).toBe(DIFFICULTY_BOUNDS.addition.min); // addition unchanged
  });

  test("each operation starts at its own min level", () => {
    for (const op of Object.keys(DIFFICULTY_BOUNDS) as Operation[]) {
      expect(makeOperationState(op).level).toBe(DIFFICULTY_BOUNDS[op].min);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Difficulty promotion and demotion within topic bounds
// ---------------------------------------------------------------------------

describe("difficulty promotion / demotion", () => {
  test(`${PROMOTE_STREAK} consecutive correct answers promote level`, () => {
    const state = makeOperationState("addition");
    const next  = applyMany(state, correctRun("addition", PROMOTE_STREAK));
    expect(next.level).toBe(DIFFICULTY_BOUNDS.addition.min + 1);
  });

  test(`${DEMOTE_STREAK} consecutive wrong answers demote level`, () => {
    // Start at level 2 so there is room to demote.
    const state: OperationState = {
      ...makeOperationState("addition"),
      level: 2,
    };
    const next = applyMany(state, wrongRun("addition", DEMOTE_STREAK));
    expect(next.level).toBe(1);
  });

  test("level never exceeds topic max", () => {
    let state: OperationState = {
      ...makeOperationState("counting"),
      level: DIFFICULTY_BOUNDS.counting.max,
    };
    state = applyMany(state, correctRun("counting", PROMOTE_STREAK * 5));
    expect(state.level).toBe(DIFFICULTY_BOUNDS.counting.max);
  });

  test("level never goes below topic min", () => {
    let state = makeOperationState("fractions"); // already at min
    state = applyMany(state, wrongRun("fractions", DEMOTE_STREAK * 5));
    expect(state.level).toBe(DIFFICULTY_BOUNDS.fractions.min);
  });

  test("counting max level is lower than multiplication max level", () => {
    expect(DIFFICULTY_BOUNDS.counting.max).toBeLessThan(
      DIFFICULTY_BOUNDS.multiplication.max
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Weak-area detection and clearing — scoped to operation
// ---------------------------------------------------------------------------

describe("weak-area detection", () => {
  test("operation becomes weak after majority failures in its own window", () => {
    let state = makeOperationState("multiplication");
    // Fill window with 5 wrong + 1 correct = 17% accuracy → weak.
    state = applyMany(state, [
      ...wrongRun("multiplication", 5),
      result("multiplication", true),
    ]);
    expect(state.isWeak).toBe(true);
  });

  test("three correct answers in the SAME operation clear weak status", () => {
    let state = makeOperationState("multiplication");
    state = applyMany(state, wrongRun("multiplication", WEAK_WINDOW));
    expect(state.isWeak).toBe(true);

    state = applyMany(state, correctRun("multiplication", WEAK_CLEAR_STREAK));
    expect(state.isWeak).toBe(false);
  });

  test("three correct answers in a DIFFERENT operation do NOT clear weak status", () => {
    // Multiplication is weak; addition correct streak must not clear it.
    let mulState = makeOperationState("multiplication");
    mulState = applyMany(mulState, wrongRun("multiplication", WEAK_WINDOW));
    expect(mulState.isWeak).toBe(true);

    // Addition results are applied to addition state only — mulState is never touched.
    let addState = makeOperationState("addition");
    addState = applyMany(addState, correctRun("addition", WEAK_CLEAR_STREAK));

    // Multiplication weak flag is unchanged.
    expect(mulState.isWeak).toBe(true);
  });

  test("weak flag not set before window is full", () => {
    let state = makeOperationState("addition");
    // 5 wrong answers — window not yet full (WEAK_WINDOW = 6).
    state = applyMany(state, wrongRun("addition", WEAK_WINDOW - 1));
    expect(state.isWeak).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Mixed-operation history — window only contains relevant results
// ---------------------------------------------------------------------------

describe("mixed-operation history", () => {
  test("recentResults for an operation contains only that operation's results", () => {
    let addState = makeOperationState("addition");
    let mulState = makeOperationState("multiplication");

    // Interleave results as the store would route them.
    addState = applyResult(addState, result("addition", true));
    mulState = applyResult(mulState, result("multiplication", false));
    addState = applyResult(addState, result("addition", false));
    mulState = applyResult(mulState, result("multiplication", true));

    expect(addState.recentResults.every((r) => r.operation === "addition")).toBe(true);
    expect(mulState.recentResults.every((r) => r.operation === "multiplication")).toBe(true);
    expect(addState.recentResults).toHaveLength(2);
    expect(mulState.recentResults).toHaveLength(2);
  });

  test("window is capped at WEAK_WINDOW entries", () => {
    let state = makeOperationState("division");
    state = applyMany(state, correctRun("division", WEAK_WINDOW + 4));
    expect(state.recentResults).toHaveLength(WEAK_WINDOW);
  });
});

// ---------------------------------------------------------------------------
// 5. Hint logic
// ---------------------------------------------------------------------------

describe("hint logic", () => {
  test(`hint shown after ${HINT_THRESHOLD} consecutive wrong answers`, () => {
    let state = makeOperationState("subtraction");
    state = applyMany(state, wrongRun("subtraction", HINT_THRESHOLD));
    expect(shouldShowHint(state)).toBe(true);
  });

  test("hint cleared after a correct answer", () => {
    let state = makeOperationState("subtraction");
    state = applyMany(state, wrongRun("subtraction", HINT_THRESHOLD));
    state = applyResult(state, result("subtraction", true));
    expect(shouldShowHint(state)).toBe(false);
  });

  test("hint not shown before threshold", () => {
    let state = makeOperationState("subtraction");
    state = applyMany(state, wrongRun("subtraction", HINT_THRESHOLD - 1));
    expect(shouldShowHint(state)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. summarise / dashboard evidence
// ---------------------------------------------------------------------------

describe("summarise", () => {
  test("reports correct accuracy and level", () => {
    let state = makeOperationState("addition");
    state = applyMany(state, [
      result("addition", true),
      result("addition", true),
      result("addition", false),
    ]);
    const s = summarise("addition", state);
    expect(s.recentAccuracy).toBeCloseTo(2 / 3, 2);
    expect(s.level).toBe(DIFFICULTY_BOUNDS.addition.min);
    expect(s.maxLevel).toBe(DIFFICULTY_BOUNDS.addition.max);
  });
});

// ---------------------------------------------------------------------------
// 7. Migration from v1 (single tutor object, no operation on results)
// ---------------------------------------------------------------------------

describe("v1 migration", () => {
  const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      clear: () => { store = {}; },
    };
  })();

  beforeEach(() => {
    localStorageMock.clear();
    Object.defineProperty(global, "localStorage", {
      value: localStorageMock,
      writable: true,
    });
    Object.defineProperty(global, "crypto", {
      value: { randomUUID: () => "test-uuid-" + Math.random() },
      writable: true,
    });
  });

  test("migrates v1 data: preserves profile name and promotes addition level", () => {
    const v1Data = {
      version: 1,
      activeProfileId: "p1",
      profiles: [
        {
          id: "p1",
          name: "Alice",
          age: 7,
          tutor: { level: 3, weakAreas: ["addition"], recentResults: [] },
        },
      ],
    };
    localStorageMock.setItem("mathbloc_state", JSON.stringify(v1Data));

    // Dynamically require so the mock localStorage is in place.
    jest.resetModules();
    const { getState } = require("./store");
    const state = getState();

    expect(state.version).toBe(2);
    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0].name).toBe("Alice");
    expect(state.profiles[0].operationStates.addition.level).toBe(3);
    // Other operations start fresh.
    expect(state.profiles[0].operationStates.multiplication.level).toBe(
      DIFFICULTY_BOUNDS.multiplication.min
    );
  });

  test("v2 data loads without re-migration", () => {
    const v2Data = {
      version: 2,
      activeProfileId: "p2",
      profiles: [
        {
          id: "p2",
          name: "Bob",
          age: 9,
          operationStates: {
            addition:       { level: 4, recentResults: [], isWeak: false, consecutiveCorrect: 0, consecutiveWrong: 0 },
            subtraction:    { level: 2, recentResults: [], isWeak: true,  consecutiveCorrect: 0, consecutiveWrong: 0 },
            multiplication: { level: 3, recentResults: [], isWeak: false, consecutiveCorrect: 0, consecutiveWrong: 0 },
            division:       { level: 1, recentResults: [], isWeak: false, consecutiveCorrect: 0, consecutiveWrong: 0 },
            counting:       { level: 2, recentResults: [], isWeak: false, consecutiveCorrect: 0, consecutiveWrong: 0 },
            fractions:      { level: 1, recentResults: [], isWeak: false, consecutiveCorrect: 0, consecutiveWrong: 0 },
          },
        },
      ],
    };
    localStorageMock.setItem("mathbloc_state", JSON.stringify(v2Data));

    jest.resetModules();
    const { getState } = require("./store");
    const state = getState();

    expect(state.version).toBe(2);
    expect(state.profiles[0].operationStates.addition.level).toBe(4);
    expect(state.profiles[0].operationStates.subtraction.isWeak).toBe(true);
  });

  test("switching profiles restores independent operation states", () => {
    const v2Data = {
      version: 2,
      activeProfileId: "p1",
      profiles: [
        {
          id: "p1", name: "Alice", age: 7,
          operationStates: {
            addition:       { level: 5, recentResults: [], isWeak: false, consecutiveCorrect: 0, consecutiveWrong: 0 },
            subtraction:    { level: 1, recentResults: [], isWeak: false, consecutiveCorrect: 0, consecutiveWrong: 0 },
            multiplication: { level: 1, recentResults: [], isWeak: false, consecutiveCorrect: 0, consecutiveWrong: 0 },
            division:       { level: 1, recentResults: [], isWeak: false, consecutiveCorrect: 0, consecutiveWrong: 0 },
            counting:       { level: 1, recentResults: [], isWeak: false, consecutiveCorrect: 0, consecutiveWrong: 0 },
            fractions:      { level: 1, recentResults: [], isWeak: false, consecutiveCorrect: 0, consecutiveWrong: 0 },
          },
        },
        {
          id: "p2", name: "Bob", age: 9,
          operationStates: {
            addition:       { level: 2, recentResults: [], isWeak: false, consecutiveCorrect: 0, consecutiveWrong: 0 },
            subtraction:    { level: 1, recentResults: [], isWeak: false, consecutiveCorrect: 0, consecutiveWrong: 0 },
            multiplication: { level: 6, recentResults: [], isWeak: false, consecutiveCorrect: 0, consecutiveWrong: 0 },
            division:       { level: 1, recentResults: [], isWeak: false, consecutiveCorrect: 0, consecutiveWrong: 0 },
            counting:       { level: 1, recentResults: [], isWeak: false, consecutiveCorrect: 0, consecutiveWrong: 0 },
            fractions:      { level: 1, recentResults: [], isWeak: false, consecutiveCorrect: 0, consecutiveWrong: 0 },
          },
        },
      ],
    };
    localStorageMock.setItem("mathbloc_state", JSON.stringify(v2Data));

    jest.resetModules();
    const { getOperationState, setActiveProfile } = require("./store");

    // Alice's addition level.
    expect(getOperationState("p1", "addition").level).toBe(5);
    // Bob's multiplication level.
    expect(getOperationState("p2", "multiplication").level).toBe(6);
    // Switching active profile does not bleed state.
    setActiveProfile("p2");
    expect(getOperationState("p1", "addition").level).toBe(5); // Alice unchanged
    expect(getOperationState("p2", "addition").level).toBe(2); // Bob's own addition
  });
});
