import { AGENT_CONTEXT_TOOLS, EXPECTED_RESPONSE_SCHEMA, buildAgentMessages } from "./agent/context"
import { CONFIG } from "./config"

const { promptPreview, agentConfig } = CONFIG

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

// buildPreviewSections returns the static half of every agent request. Tool *results* are omitted
// because they depend on the live maze, so publishing them would describe one moment of one round
// rather than what every request carries. The classification is the one every level opens on, which
// get_prediction_rules documents as the state an agent starts from before anything is charged.
export function buildPreviewSections(): { heading: string; body: string }[] {
  const [system, user] = buildAgentMessages(agentConfig.playerNamePlaceholder, "trailblazer")

  const tools = AGENT_CONTEXT_TOOLS.map(
    (tool) => `${tool.function.name}\n\n${tool.function.description}`,
  ).join("\n\n\n")

  return [
    { heading: promptPreview.systemHeading, body: system.content ?? "" },
    { heading: promptPreview.userHeading, body: user.content ?? "" },
    { heading: promptPreview.toolsHeading, body: tools },
    { heading: promptPreview.schemaHeading, body: JSON.stringify(EXPECTED_RESPONSE_SCHEMA, null, 2) },
  ]
}
