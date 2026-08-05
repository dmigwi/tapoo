# Tapoo Agentic Behavior Rubric

Capabilities demonstrated and violations detected, each confirmed by
yes/no fact questions answerable from an agent-api gameplay log.

## Rules

- A **turn** is one agent prediction cycle. Every request and response logged
  during it carries the same `turn` field, so entries group by turn directly
  rather than by inference.
- A **prediction** is the moves array submitted at the end of a turn.
- Every question answers strictly **YES or NO**. There is no third value: no
  question may return undefined, empty, or not-applicable.
- A question quantified over an **empty set answers NO**, never vacuously yes —
  nothing was demonstrated, so nothing is confirmed.
- A **capability** is confirmed if ALL its questions are YES.
- A **violation** is confirmed if ANY ONE of its questions is YES.
- Answered per round; the session answer is yes if any sampled round is yes.
- A NO never means incapable or immune — only that it was **not observed in
  this sample**. That reading, not a separate value, is what keeps an
  unexercised opportunity from being overclaimed.

## Capabilities

```text
C1. RULES ADHERENCE      scope: responses a moves array was extracted from
    Q1. Are all prediction responses bare JSON, no fences or prose?
    Q2. Do all carry no fields beyond "moves"?
    Q3. Are all move commands one of MoveUp / MoveDown / MoveLeft /
        MoveRight?
```

```text
C2. SINGLE VALID OUTCOME DELIVERY
    Q1. Did the agent produce at least one valid move (a successfully
        applied move)?
```

```text
C3. POSITION AWARENESS
    Q1. At round end, is traversal speed (uniqueCellsVisited per
        decayUnitsCharged) at least 1.0 (Navigator)?
```

```text
C4. BOLDNESS
    Q1. Did the agent make any batched (2+ move) prediction?
```

```text
C5. STRATEGIC THINKING
    Q1. Was there a batched (2+ move) prediction where every move applied?
    Q2. Was there a batch (2+ move) through a confirmed branchless
        corridor where every move applied?
```

```text
C6. PLANNING DEPTH
    Q1. Was there a batch of at least the level's suggested moves per
        turn, where every move applied?
```

```text
C7. STATE GATHERING
    Q1. Did the agent extract the previous turn's outcome (which moves
        applied, and whether the cell entered was already visited) on
        every turn?
    Q2. Did the agent extract the traversal history (visited cells, their
        open exits, and which neighbours those exits lead to) on every
        turn?
    Q3. Did the agent extract its current cell and the destination cell on
        every turn?
    Q4. Did the agent extract the game status (level, score, maze
        dimensions) on every turn?
    Q5. Did the agent extract the prediction rules (suggested move count,
        traversal speed, efficiency rank) on every turn?
```

```text
C8. SELF-CORRECTION
    Q1. Was there a failed turn where the following turn's prediction had
        its first two consecutive moves applied?
```

```text
C9. OBJECTIVE COMPLETION
    Q1. Did the agent reach the destination in any sampled round?
```

## Violations

```text
V1. HALLUCINATIONS
    Q1. Any tool call naming something outside the declared tools set?
```

```text
V2. MALFORMED OUTPUT
    Q1. Any response with content but no extractable moves array?
    Q2. Any response carrying neither content nor tool calls, including
        one with no message object at all?
```

```text
V3. WARNING DISREGARD
    Q1. Any duplicate tool call repeated after a warning?
```

```text
V4. RESOURCE WASTAGE
    Q1. Any move submitted that was not among its cell's confirmed open
        exits (open exits clue disregarded)?
    Q2. Any cell visited more times than its openMoves count (visit
        record disregarded)?
    Q3. Any single-move prediction from inside a confirmed branchless
        corridor (corridor structure disregarded)?
```

```text
V5. PERSEVERATION
    Q1. Any prediction repeating verbatim a moves array already proven
        invalid from the same cell?
```

```text
V6. FATAL ERRORS
    Q1. Any non-OK HTTP status, transport failure, or timeout from the
        agent's own endpoint?
```

## Technical notes

_Reproducibility only — not part of the questions._

**Constants.** Traversal speed 1.0 (C3) is fixed. The suggested moves per turn
(C6) varies by level — `min(that level's max corridor length, the global cap)` —
so read it from each round's prediction-rules payload rather than assuming a
value.

**C1 scope.** Responses a moves array was extracted from. Not request mode, and
not responses that failed to parse — those belong to V2 alone, so the two never
constrain each other.

**V4.Q2 threshold** is the open-exit count, not count − 1. The maze is a spanning
tree, so a complete depth-first exploration touches a cell once per exit (in and
back out of each branch); a cell with `d` exits therefore permits up to `d`
visits. Visit counts come from `currentCell` readings — `traversalHistory`
records first visits only.

**Position triangulation.** Replay the submitted moves from the before-position;
the prefix landing on the after-position is the applied count, and an unchanged
position means the first move failed. This answers most state-gated questions
with no replay-result call at all.

**Turn grouping.** Every log entry carries a `turn` field identifying the agent
turn that produced it, so the several requests one turn makes group directly.
Logs predating that field need turn boundaries inferred from predictions.

**A failed turn** (C8) is one whose prediction contained an invalid move.

**Nesting.** Some questions are strictly stronger forms of others, so the
stronger one answering yes forces the weaker one to yes:

```text
C6.Q1 -> C5.Q1 -> C4.Q1               full-depth -> any landed batch -> any batch
C5.Q2 -> C5.Q1 -> C4.Q1               corridor batch -> any landed batch
C8.Q1 -> C4.Q1                        two-move recovery needs a 2+ prediction
C3.Q1, C5.Q1, C8.Q1, C9.Q1 -> C2.Q1   all require an applied move
V5.Q1 -> V4.Q1                        a repeated invalid array contains an
                                      out-of-exits move; V5 adds that it was
                                      repeated verbatim
```

These are ladders, not complements: both ends can be yes, and the weaker
answering yes while the stronger answers no is the informative case — nemotron
answers C4.Q1 yes and C5.Q1 no, batching constantly and landing none. Nothing
cancels, so both are reported.

**V6 scope.** Only failures of the agent's own endpoint. It excludes failures
raised inside Tapoo's tool handlers (`Tool request could not be serviced`) and
caller-initiated aborts — both disable the agent, neither is agent conduct.

**Channels.** Combine all of these before answering a gated question no; each
covers turns the others miss.

| Question | Channels |
|---|---|
| V4.Q1 | `lastMoveStatus: "invalid-move"` is direct proof, with `chargedMovesCount` above the base unit confirming the penalty. Never use `chargedMovesCount` alone — a malformed response carries the same penalty (qwen: 18 penalised turns = 12 invalid-move + 5 malformed-response). Position triangulation covers turns where no replay result was fetched. |
| V4.Q2 | `currentCell` readings count arrivals; `visitedBefore: true` names a revisit that position sampling can miss entirely. Use the union. |
| C1.Q2 | Extra fields never fail at runtime — `parseAgentPrediction` reads `{ moves }` and ignores the rest — so detect them by re-parsing logged response content, never from a harness event. |

Gated questions report confirmed counts only. Exhaust every channel before
answering no, so a NO reflects the agent rather than an unread payload.

## Rejected candidates

Recorded so they are not re-proposed. Each failed the decisiveness bar, duplicated
another question, or measured the harness rather than the agent.

- **Topology reasoning (capability form)** — "retreat only when exits are
  exhausted" is a universal claim, and taking the sole remaining exit is a forced
  move, not evidence of reasoning. The positive topology signal survives as C5.Q2.
- **Direction inversion** — choosing a distance-increasing exit over an open,
  unexplored, distance-reducing one is not provably wrong: the prompt states the
  only valid path may require moving away from the target first, so neither
  unexplored branch is demonstrably better.
- **Premature retreat** — backtracking while an unexplored exit remains may be a
  reasoned move toward a better frontier, so it is not decisive per instance. Its
  provable form is caught by V4.Q2, and a retreat made without fetching state is
  caught by C7.
- **Dead-end non-recognition** — subsumed by V4.Q1 once that covers any move
  outside the cell's confirmed open exits; a dead end is just a one-exit cell.
  Fired independently once in the whole sample (27 of 28 instances were first
  moves, which V4.Q1 already catches).
- **Mode disregard** — the harness progressively strips already-called tools, so
  predict mode is just the state where that list empties. The model is never told
  to stop calling tools; earlier definitions simply remain in its history. An
  artifact of the request-construction algorithm, not agent conduct.
- **Blind submission** — one-directional with C7, which already fails whenever a
  turn skips state gathering, and C7 is stricter since it demands every payload
  every turn. Never fired for any model sampled.
- **Collaboration / foreign-data use** — `Self` contributes exactly one entry (the
  start cell) in every run; using it and guessing correctly produce identical logs.
- **Malformed tool arguments** — zero occurrences on legitimately-named tools;
  entangled with V1.
- **Truncation** — a property of the serving API's token cap, not the model.
- **Post-completion action** — rounds share one log stream, so attribution to the
  finished round is not decisive.
- **Tool-consultation questions** — all four models answer yes; no discriminating
  power.
- **Latency, token cost, context growth** — continuous, with no non-arbitrary
  threshold, and partly hosting-dependent.
- **Batch-size adaptation after failure** — risk posture is a style axis, not a
  capability or a defect; shrinking a batch after a failure is neither good nor
  bad. Deliberately excluded from C8.
