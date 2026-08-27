import { cloneTraversalHistory } from "../traversal"
import type { GameStatus, MazeDimensions, RenderGridPoint, State, TraversalHistoryEntry } from "../types"

// AgentStateSnapshot is the minified, frozen view of State an agent turn reads from - the agent
// context tools (buildAgentToolHandlers, agent/context.ts) and the turn's log-context stamping
// (setTapooLogContext, logs.ts) alike, so nothing lower in the call chain ever needs the raw,
// mutable State object once this exists. Only the fields actually read by agent context/tools are
// included; larger diagnostic-only fields such as the raw maze grid stay outside this snapshot.
// Every field is readonly so nothing downstream can mutate the snapshot in place instead of
// touching live state - a caller that wants to track a real change reaches for __readState()
// (or an equivalent live read), never for editing this. traversalHistory is readonly as an array
// too (not just as a property), since a plain Readonly<T> would still allow .push/.sort/etc. on it.
export type AgentStateSnapshot = {
  readonly level: number
  readonly status: GameStatus
  readonly score: number
  readonly turnCount: number
  readonly cumulativeRoundCount: number
  readonly mazeDimensions: MazeDimensions | null
  readonly startPosition: RenderGridPoint | null
  readonly playerPosition: RenderGridPoint | null
  readonly finalPosition: RenderGridPoint | null
  readonly traversalHistory: readonly TraversalHistoryEntry[]
}

// snapshotAgentState freezes the fields above once. State only actually changes once per turn -
// after the predict-mode request resolves with a move (valid or invalid), committed once the
// turn's whole request/retry sequence settles - so the only moment within a turn that needs a fresh
// read is its very start; everything after that (every provider request, every tool-call round, and
// a connection-error retry after its own real backoff delay) is safe to reuse it. Called exactly
// once per turn, at the top of requestNextAgentTurn (control/agent-api.ts) - the earliest point in
// the call chain that knows a new turn is starting - and threaded down from there rather than
// letting anything lower in the chain decide for itself when to (re)read live state.
// traversalHistory is the only field that needs an actual clone: it's the one the live game mutates
// in place (state.traversalHistory.push, see game.ts) rather than reassigning - every other field
// here is always replaced wholesale when it changes, so capturing the reference once already gives
// an independent, stable view for the rest of the turn.
export function snapshotAgentState(state: State): AgentStateSnapshot {
  return {
    level: state.level,
    status: state.status,
    score: state.score,
    turnCount: state.turnCount,
    cumulativeRoundCount: state.cumulativeRoundCount,
    mazeDimensions: state.mazeDimensions,
    startPosition: state.startPosition,
    playerPosition: state.playerPosition,
    finalPosition: state.finalPosition,
    traversalHistory: cloneTraversalHistory(state.traversalHistory),
  }
}
