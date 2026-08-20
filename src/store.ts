import {
  AppState,
  Profile,
  Operation,
  OperationState,
  SessionResult,
} from "./types";
import { applyResult, makeOperationState } from "./tutorEngine";

const STORAGE_KEY = "mathbloc_state";
const CURRENT_VERSION = 2;

const ALL_OPERATIONS: Operation[] = [
  "addition",
  "subtraction",
  "multiplication",
  "division",
  "counting",
  "fractions",
];

function makeDefaultOperationStates(): Record<Operation, OperationState> {
  return Object.fromEntries(
    ALL_OPERATIONS.map((op) => [op, makeOperationState(op)])
  ) as Record<Operation, OperationState>;
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/**
 * v1 stored a single `tutor` object on each profile with `level`, `weakAreas`,
 * and `recentResults` (no operation field on results).
 * We promote that into the `addition` slot (safest default) and initialise
 * all other operations fresh.
 */
function migrateV1(raw: Record<string, unknown>): AppState {
  const legacyProfiles = (raw.profiles as Record<string, unknown>[]) ?? [];

  const profiles: Profile[] = legacyProfiles.map((lp) => {
    const legacyTutor = (lp.tutor ?? {}) as Record<string, unknown>;
    const operationStates = makeDefaultOperationStates();

    // Preserve whatever level was recorded under addition.
    if (typeof legacyTutor.level === "number") {
      operationStates.addition.level = legacyTutor.level;
    }

    return {
      id: String(lp.id ?? crypto.randomUUID()),
      name: String(lp.name ?? ""),
      age: Number(lp.age ?? 0),
      operationStates,
    };
  });

  return {
    version: CURRENT_VERSION,
    profiles,
    activeProfileId: (raw.activeProfileId as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Load / Save
// ---------------------------------------------------------------------------

function load(): AppState {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!raw) return empty();

    if (!raw.version || raw.version < 2) return migrateV1(raw);

    return raw as AppState;
  } catch {
    return empty();
  }
}

function empty(): AppState {
  return { version: CURRENT_VERSION, profiles: [], activeProfileId: null };
}

function save(state: AppState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getState(): AppState {
  return load();
}

export function createProfile(name: string, age: number): Profile {
  const state = load();
  const profile: Profile = {
    id: crypto.randomUUID(),
    name,
    age,
    operationStates: makeDefaultOperationStates(),
  };
  state.profiles.push(profile);
  if (!state.activeProfileId) state.activeProfileId = profile.id;
  save(state);
  return profile;
}

export function setActiveProfile(profileId: string): void {
  const state = load();
  if (!state.profiles.find((p) => p.id === profileId)) {
    throw new Error(`Profile ${profileId} not found`);
  }
  state.activeProfileId = profileId;
  save(state);
}

export function getOperationState(
  profileId: string,
  operation: Operation
): OperationState {
  const state = load();
  const profile = state.profiles.find((p) => p.id === profileId);
  if (!profile) throw new Error(`Profile ${profileId} not found`);
  return profile.operationStates[operation];
}

/**
 * Records a result and updates ONLY the matching operation's state.
 * No other operation is touched.
 */
export function recordResult(profileId: string, result: SessionResult): void {
  const state = load();
  const profile = state.profiles.find((p) => p.id === profileId);
  if (!profile) throw new Error(`Profile ${profileId} not found`);

  profile.operationStates[result.operation] = applyResult(
    profile.operationStates[result.operation],
    result
  );
  save(state);
}
