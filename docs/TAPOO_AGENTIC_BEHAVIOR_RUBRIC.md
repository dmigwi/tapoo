# Tapoo Agentic Behavior Rubric

This rubric evaluates what an agent demonstrably did in a Tapoo `agent-api`
gameplay log. It deliberately avoids guessing intent: every capability and
violation is answered from logged facts.

## Rules

- A **turn** is one agent prediction cycle. Every request and response logged
  during it carries the same `turn` field, so entries group by turn directly.
- A **prediction** is the final `moves` array submitted at the end of a turn.
- Every question answers strictly **YES** or **NO**. There is no undefined,
  empty, or not-applicable answer.
- A question quantified over an **empty set answers NO**, never vacuously yes.
  Nothing was demonstrated, so nothing is confirmed.
- A **capability** is confirmed if all its questions are YES.
- A **violation** is confirmed if any one of its questions is YES.
- Answer per round. The session answer is YES if any sampled round is YES.
- A NO never means incapable or immune. It only means **not observed in this
  sample**.

## Capability Groups

```text
C1. RESPONSE CONTRACT ADHERENCE
    scope: responses a moves array was extracted from

    Q1. Are all prediction responses bare JSON, with no fences or prose?
    Q2. Does every prediction JSON object have exactly one top-level key,
        "moves"?
    Q3. Are all move commands one of MoveUp / MoveDown / MoveLeft / MoveRight?
```

```text
C2. BASIC MOVEMENT COMPETENCE
    Q1. Did the agent produce at least one successfully applied move?
```

```text
C3. CONTEXT ACQUISITION
    one question per context tool

    Q1. Did the agent extract the maze structure on every turn?
        Required facts: level, currentCell, destinationCell, nearby
        filteredTraversalHistory, each included cell's openMoves.

    Q2. Did the agent extract the prediction rules on every turn?
        Required facts: suggestedMovesPerTurn, mazeDimensions,
        traversal-speed inputs, batchEfficiencyClass, expected response schema.

    Q3. Did the agent extract the last prediction outcome on every turn?
        Required facts: status, score, lastMoveStatus, chargedMovesCount, and
        prior submitted/applied move details.
```

```text
C4. POSITION AWARENESS
    Q1. On every turn where the currentCell appeared in filteredTraversalHistory,
        was the first submitted move one of that cell's confirmed openMoves?
```

```text
C5. EXPLORATION EFFICIENCY
    Q1. At round end, was traversal speed at least 1.0?
        Formula: non-Self unique cells visited / total decay units charged.
```

```text
C6. BATCHING BOLDNESS
    Q1. Did the agent submit any 2+ move prediction?
```

```text
C7. BATCHING ACCURACY
    Q1. Did the agent submit any 2+ move prediction where every move applied?
```

```text
C8. CORRIDOR COMPRESSION
    Q1. Did the agent submit a 2+ move prediction through a confirmed branchless
        corridor where every move applied?
```

```text
C9. PLANNING DEPTH
    Q1. Did the agent submit a prediction of at least the prediction rules'
        maximum suggested moves per turn where every move applied?
```

```text
C10. SELF-CORRECTION
    Q1. After a failed turn, did the following turn's prediction have its first
        two consecutive moves applied?
```

```text
C11. OBJECTIVE COMPLETION
    Q1. Did the agent win by reaching the destination in any sampled round?
```

```text
C12. DECISIVE COMPLETION
    Q1. Did the agent win any sampled round with traversal speed above 1.0?
        Formula: non-Self unique cells visited / total decay units charged.
```

## Violation Groups

```text
V1. TOOL HALLUCINATION
    Q1. Did the agent call any tool outside the declared tools set?
```

```text
V2. MALFORMED PREDICTION
    Q1. Did any final response fail to produce an extractable prediction?
        Includes unparseable content, invalid final content, or second
        token-limit exhaustion after a warning.

    Q2. Did any final response contain valid JSON with an empty "moves" array?
```

```text
V3. WARNING DISREGARD
    Q1. Did the agent repeat a duplicate tool call after receiving a duplicate
        tool-call warning?
    Q2. Did the agent hit the completion-token cap for a second time after the
        corrective token-limit warning?
```

```text
V4. OPEN-MOVE DISREGARD
    Q1. Did the agent submit any move that was not among the current cell's
        confirmed openMoves?
```

```text
V5. REVISIT WASTE
    Q1. Did the agent enter any cell more times than that cell's openMoves
        count permits?
```

```text
V6. INVALID-PATH PERSEVERATION
    Q1. Did the agent repeat, from the same currentCell, a moves array already
        proven invalid from that same cell?
```

```text
V7. AGENT ENDPOINT FAILURE
    Q1. Did the agent's own endpoint produce a non-OK HTTP status, transport
        failure, timeout, or response missing its message object?
```

```text
V8. TOKEN EXHAUSTION
    Q1. Did any response reach the configured completion-token cap?
```

## Metric Definitions

**Traversal speed.** Use the round-level scoring metric:

```text
traversalSpeed = playerUniqueCellsVisited / totalDecayUnitsCharged
```

Do not use the live per-agent `uniqueCellsVisited / decayUnitsCharged` pair for
round-level questions. That live pair is for in-game model context and seat
classification. The rubric's round-level metric evaluates the actual sampled
round outcome.

**Non-Self unique cells.** Count traversal-history entries whose `playerName`
is not `Self`. The seeded `Self` start cell is not agent progress and must not
inflate the numerator.

**Total decay units charged.** Count every decay unit charged by Tapoo during
that round, including valid-turn charges and malformed/invalid prediction
charges. Exclude caller-initiated aborts and endpoint failures that Tapoo
classifies as no-score network failures.

**Suggested moves per turn.** Read `suggestedMovesPerTurn.max` from that round's
`get_prediction_rules` result. The current default range is configuration, not
a rubric constant.

**Token cap.** Completion tokens only:

```text
Ollama:    eval_count
OpenAI:    usage.completion_tokens
Anthropic: usage.output_tokens
```

Compare against `CONFIG.runtime.modelConfig.maxTokens`, the same completion cap
sent with the request.

## How To Answer Questions

**C1 scope.** C1 only scores responses where Tapoo extracted a `moves` array.
Responses that fail parsing belong to V2 instead, so C1 and V2 do not constrain
each other.

**C3 scope.** "Every turn" means every turn where the agent had a chance to
call tools before final prediction. If a turn ends by endpoint failure before
the model produces tool calls or content, score that under V7 rather than C3.

**C4 position checks.** C4 measures whether the agent uses its current-cell
context, not whether Tapoo's movement engine works. Only score C4.Q1 from turns
where the currentCell itself appears in filteredTraversalHistory and therefore
has logged openMoves.

**C8 corridor checks.** A confirmed branchless corridor means a cell sequence
where every intermediate cell has exactly two open exits. Do not infer corridor
structure from Manhattan distance alone.

**V5 revisit threshold.** The threshold is the open-exit count, not count minus
one. The maze is a spanning tree, so complete depth-first exploration can touch
a cell once per exit. Visit counts come from `currentCell` readings and
`visitedBefore`; `traversalHistory` records first visits only.

**V7 scope.** V7 is endpoint conduct only. It excludes Tapoo tool-handler
failures and caller-initiated aborts. Tool-handler failures may disable the
agent operationally, but they are not evidence that the external agent endpoint
failed.

## Evidence Channels

Use all available channels before answering NO. A NO should reflect the agent,
not an unread part of the log.

| Question | Evidence |
|---|---|
| C1.Q1 | Parse logged final assistant content; reject prose, markdown fences, or explanation text around JSON. |
| C1.Q2 | Re-parse logged final assistant content; extra keys do not fail runtime parsing, so this must be checked directly. |
| C3 | Tool-call log entries grouped by turn. |
| C4 | `currentCell`, filteredTraversalHistory openMoves for that cell, and submitted first move. |
| C5/C12 | Round completion log plus reconstructed non-Self traversal-history count and total decay charged. |
| C7-C9 | Submitted prediction length, replay result, currentCell/openMoves structure, and position triangulation. |
| C10 | Failed-turn replay result followed by the next turn's replay prefix. |
| V2.Q2 | Re-parse final content; runtime reports empty arrays under the same malformed bucket as other invalid shapes. |
| V4 | `lastMoveStatus: "invalid-move"` is direct proof. Position triangulation covers turns where no outcome tool was fetched. |
| V5 | Union of `currentCell` arrival counts and `visitedBefore: true`. |
| V8 | Provider completion-token field compared to configured cap. |

## Dependency Ladders

Some questions are strictly stronger forms of others. A stronger YES forces the
weaker YES, but not the reverse.

```text
C9.Q1 -> C7.Q1 -> C6.Q1              full-depth landed batch -> landed batch ->
                                     any batch
C8.Q1 -> C7.Q1 -> C6.Q1              corridor compression -> landed batch ->
                                     any batch
C10.Q1 -> C6.Q1                      two-move recovery needs a 2+ prediction
C12.Q1 -> C11.Q1                     decisive completion is still completion
C12.Q1 -> C5.Q1 -> C2.Q1             trailblazer win -> efficient traversal ->
                                     applied movement
C4.Q1, C5.Q1, C7.Q1, C8.Q1,
C10.Q1, C11.Q1 -> C2.Q1              all require at least one applied move
V6.Q1 -> V4.Q1                       repeated invalid path contains an
                                     out-of-openMoves move
V2.Q1 token-cap clause -> V8.Q1      second token-limit failure reached the cap
V2.Q2 -> V2.Q1                       empty moves is one invalid prediction shape
```

These are ladders, not complements. Both ends can be YES. The informative case
is often the weaker YES with the stronger NO, for example batching frequently
but never landing a full batch.

## Duplicate Event Notes

**V3.Q2 and V2.Q1's token-cap clause are the same second-occurrence event.**
They stay separate deliberately: V2 reports output failure, while V3 reports
ignored correction.

**Malformed-response penalty wording belongs in V2 and in the last-outcome
evidence, not as a separate violation.** A malformed prediction is already the
violation; its score impact is evidence used to verify the event.

## Rejected Candidates

Recorded so they are not re-proposed. Each failed the decisiveness bar,
duplicated another question, or measured the harness rather than the agent.

- **Topology reasoning, broad form.** "Retreat only when exits are exhausted" is
  too universal. A retreat can be a reasoned move toward a better frontier. The
  provable positive signal survives as C8.
- **Direction inversion.** Choosing a distance-increasing exit over an
  unexplored distance-reducing exit is not provably wrong. The prompt states the
  only valid path may require moving away from the target first.
- **Premature retreat.** Backtracking while an unexplored exit remains may be
  correct. Its provable waste form is caught by V5.
- **Dead-end non-recognition.** Subsumed by V4 once V4 covers any move outside
  confirmed openMoves.
- **Mode disregard.** The harness strips already-called tools; predict mode is
  the state where that list empties. That is request-construction behavior, not
  agent conduct.
- **Blind submission.** One-directional with C3. C3 is stricter because it
  demands every context payload every turn.
- **Collaboration / foreign-data use.** `Self` contributes only the start cell
  in every run; using it and guessing correctly produce identical logs.
- **Malformed tool arguments.** Zero useful discrimination so far; entangled
  with V1.
- **Truncation as a standalone violation.** The actionable version is V8 token
  exhaustion.
- **Post-completion action.** Rounds share one log stream, so attribution to the
  finished round is not always decisive.
- **Tool-consultation aggregate.** If every sampled model calls all tools, the
  aggregate has no discriminating power. Keep the per-tool C3 questions.
- **Latency, token cost, context growth.** Continuous, hosting-dependent, and
  lacking a non-arbitrary pass/fail threshold.
- **Batch-size adaptation after failure.** Risk posture is a style axis, not a
  capability or defect.
- **Budget-aware batching.** Shrinking or growing batch size as budget falls is
  the same risk-posture style axis, not a capability or defect.
