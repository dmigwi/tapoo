import { LEVEL_STORAGE_KEY, ROUND_STORAGE_KEY, ROUND_STORAGE_VERSION, WALL_WEIGHT_STORAGE_KEY } from "./config";
import type { PersistedRound, State, WallWeight } from "./types";

export function clearRoundSnapshot(): void {
  try {
    window.sessionStorage.removeItem(ROUND_STORAGE_KEY);
  } catch {
    // Ignore storage failures so the SPA can keep running without persistence.
  }
}

export function saveWallWeightPreference(weight: WallWeight): void {
  try {
    window.localStorage.setItem(WALL_WEIGHT_STORAGE_KEY, String(weight));
  } catch {
    // Ignore storage failures so preference persistence stays best-effort only.
  }
}

export function saveLevelPreference(level: number): void {
  try {
    window.localStorage.setItem(LEVEL_STORAGE_KEY, String(level));
  } catch {
    // Ignore storage failures so the SPA can still run without durable level persistence.
  }
}

export function loadWallWeightPreference(
  defaultWeight: WallWeight,
  isWallWeight: (value: number) => value is WallWeight,
): WallWeight {
  try {
    const storedValue = window.localStorage.getItem(WALL_WEIGHT_STORAGE_KEY);
    if (storedValue === null) {
      return defaultWeight;
    }

    const parsedValue = Number(storedValue);
    return isWallWeight(parsedValue) ? parsedValue : defaultWeight;
  } catch {
    return defaultWeight;
  }
}

export function loadLevelPreference(defaultLevel: number): number {
  try {
    const storedValue = window.localStorage.getItem(LEVEL_STORAGE_KEY);
    if (storedValue === null) {
      return defaultLevel;
    }

    const parsedValue = Number(storedValue);
    if (!Number.isInteger(parsedValue) || parsedValue < 1) {
      return defaultLevel;
    }

    return parsedValue;
  } catch {
    return defaultLevel;
  }
}

export function buildRoundSnapshot(state: State): PersistedRound | null {
  if (
    !state.dims ||
    !state.maze ||
    !state.playerPosition ||
    !state.finalPosition ||
    (state.status !== "running" && state.status !== "paused" && state.status !== "won" && state.status !== "lost")
  ) {
    return null;
  }

  const totalCells = state.dims.length * state.dims.width;
  const remainingMs = state.clock ? state.clock.remaining() : totalCells * 1000;

  return {
    version: ROUND_STORAGE_VERSION,
    level: state.level,
    dims: { length: state.dims.length, width: state.dims.width },
    maze: state.maze.map((row) => [...row]),
    playerPosition: [state.playerPosition[0], state.playerPosition[1]],
    finalPosition: [state.finalPosition[0], state.finalPosition[1]],
    wallWeight: state.wallWeight,
    status: state.status,
    score: state.score,
    lastRoundScore: state.lastRoundScore,
    remainingMs,
  };
}

export function saveRoundSnapshot(snapshot: PersistedRound | null): void {
  if (!snapshot) {
    return;
  }

  try {
    window.sessionStorage.setItem(ROUND_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore storage failures so the active game can continue even without session persistence.
  }
}

export function loadRoundSnapshot(): PersistedRound | null {
  let rawSnapshot: string | null;

  try {
    rawSnapshot = window.sessionStorage.getItem(ROUND_STORAGE_KEY);
  } catch {
    return null;
  }

  if (!rawSnapshot) {
    return null;
  }

  try {
    return JSON.parse(rawSnapshot) as PersistedRound;
  } catch {
    clearRoundSnapshot();
    return null;
  }
}
