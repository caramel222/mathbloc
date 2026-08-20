import { Operation, Profile } from "./types";
import { summarise, OperationSummary } from "./tutorEngine";
import { getState } from "./store";

const ALL_OPERATIONS: Operation[] = [
  "addition",
  "subtraction",
  "multiplication",
  "division",
  "counting",
  "fractions",
];

export interface DashboardData {
  profileName: string;
  age: number;
  operations: OperationSummary[];
}

/** Returns a full explainability snapshot for the active profile. */
export function getDashboardData(): DashboardData | null {
  const state = getState();
  if (!state.activeProfileId) return null;

  const profile: Profile | undefined = state.profiles.find(
    (p) => p.id === state.activeProfileId
  );
  if (!profile) return null;

  return {
    profileName: profile.name,
    age: profile.age,
    operations: ALL_OPERATIONS.map((op) =>
      summarise(op, profile.operationStates[op])
    ),
  };
}

/** Renders a plain-text dashboard to any writable stream (e.g. console). */
export function printDashboard(
  data: DashboardData,
  log: (line: string) => void = console.log
): void {
  log(`=== Dashboard: ${data.profileName} (age ${data.age}) ===`);
  for (const s of data.operations) {
    const weak    = s.isWeak    ? " ⚠ WEAK"   : "";
    const hint    = s.hintActive ? " 💡 HINT"  : "";
    const acc     = `${Math.round(s.recentAccuracy * 100)}%`;
    log(
      `  ${s.operation.padEnd(14)} level ${s.level}/${s.maxLevel}  acc ${acc}${weak}${hint}`
    );
  }
}
