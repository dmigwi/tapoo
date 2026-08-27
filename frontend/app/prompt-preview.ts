import {
  AGENT_CONTEXT_TOOLS,
  EXPECTED_RESPONSE_SCHEMA,
  buildAgentMessages,
  buildAgentPersonaPrompt,
  buildDuplicateToolCallMessage,
  buildTokenLimitExhaustionPrompt,
} from "./agent/context"
import { capitalize } from "./agent/efficiency"
import type { BatchEfficiencyClass } from "./agent/efficiency"
import { CONFIG } from "./config"

const { promptPreview, agentConfig, runtime } = CONFIG

// SAMPLE_DUPLICATE_TOOL_CALL stands in for whichever call(s) a model actually repeated - the real
// warning names the live duplicate(s) instead. get_maze_structure is the first tool a turn calls,
// making it the most representative example of one already answered before a repeat arrives.
const SAMPLE_DUPLICATE_TOOL_CALL = {
  id: "call_1",
  function: { name: AGENT_CONTEXT_TOOLS[0].function.name },
}

// This module holds no DOM code on purpose: scripts/build-html.mjs imports it under Node and bakes
// the result into prompts.html, so the page ships as static markup with no bundle. Sourcing the
// content from the same builders the agent runtime calls is what keeps the published page from
// drifting away from what is actually sent.

// previewPlayerNote names the agent the prompt was rendered for. The config form's placeholder is
// used rather than the interactive marker: the prompt separately states that "Self" appears first in
// traversalHistory and marks the start cell, so rendering the agent under that same name would
// collide two distinct roles in one preview.
export function previewPlayerNote(): string {
  return promptPreview.playerNoteTemplate.replace("{player}", agentConfig.playerNamePlaceholder)
}

// buildPreviewSections returns the static half of every agent request, plus the two corrective
// warnings a turn can receive mid-request - each rendered from a sample input standing in for the
// live mistake that would normally trigger it, using the same builders the request loop calls, so
// neither warning's wording can drift from what an agent is actually shown. Tool *results* are
// omitted because they depend on the live maze, so publishing them would describe one moment of one
// round rather than what every request carries. The classification is the one every level opens on:
// trailblazer with nothing charged, which renders the "no turn charged yet" wording an agent
// actually sees on its first turn rather than the measured-trailblazer wording it does not.
// MEASURED_PERSONA_CLASSES lists the classifications an agent can be shown once its own turns have
// been measured, ordered by rate from the top down. The default opening is rendered separately: it
// is not a fourth classification but the same trailblazer label handed out before any measurement,
// which is exactly why its wording differs.
const MEASURED_PERSONA_CLASSES: BatchEfficiencyClass[] = ["trailblazer", "navigator", "backtracker"]

// buildPersonaVariants renders every form the system message can open with, each under the label a
// reader needs to tell them apart. Built from buildAgentPersonaPrompt rather than transcribed, so a
// reworded branch changes the published page in the same edit.
function buildPersonaVariants(): string {
  const player = agentConfig.playerNamePlaceholder
  const variants = [
    `${promptPreview.personaDefaultLabel}\n\n${buildAgentPersonaPrompt(player, "trailblazer", true)}`,
    ...MEASURED_PERSONA_CLASSES.map(
      (speedClass) =>
        `${capitalize(speedClass)}\n\n${buildAgentPersonaPrompt(player, speedClass, false)}`,
    ),
  ]

  return variants.join("\n\n")
}

export function buildPreviewSections(): { heading: string; body: string }[] {
  const [system, user] = buildAgentMessages(agentConfig.playerNamePlaceholder, "trailblazer", true)

  const tools = AGENT_CONTEXT_TOOLS.map(
    (tool) => `${tool.function.name}\n\n${tool.function.description}`,
  ).join("\n\n\n")

  const duplicateToolCallWarning = buildDuplicateToolCallMessage([SAMPLE_DUPLICATE_TOOL_CALL])
  const tokenLimitExhaustionWarning = buildTokenLimitExhaustionPrompt(runtime.modelConfig.maxTokens)

  return [
    { heading: promptPreview.personaHeading, body: buildPersonaVariants() },
    { heading: promptPreview.systemHeading, body: system.content ?? "" },
    { heading: promptPreview.userHeading, body: user.content ?? "" },
    { heading: promptPreview.toolsHeading, body: tools },
    { heading: promptPreview.schemaHeading, body: JSON.stringify(EXPECTED_RESPONSE_SCHEMA, null, 2) },
    { heading: promptPreview.duplicateToolCallHeading, body: duplicateToolCallWarning.content ?? "" },
    { heading: promptPreview.tokenLimitExhaustionHeading, body: tokenLimitExhaustionWarning.content ?? "" },
  ]
}
