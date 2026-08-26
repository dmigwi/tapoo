import { describe, expect, it } from "vitest"

import {
  AGENT_CONTEXT_TOOLS,
  buildAgentMessages,
  buildAgentPersonaPrompt,
  buildDuplicateToolCallMessage,
  buildTokenLimitExhaustionPrompt,
} from "./agent/context"
import { CONFIG } from "./config"
import { buildPreviewSections, previewPlayerNote } from "./prompt-preview"

const { promptPreview, agentConfig, runtime } = CONFIG

const bodyOf = (heading: string): string =>
  buildPreviewSections().find((section) => section.heading === heading)?.body ?? ""

describe("prompt preview content", () => {
  it("publishes the real system prompt rather than a transcribed copy", () => {
    const [system] = buildAgentMessages(agentConfig.playerNamePlaceholder, "trailblazer", true)

    // Comparing against the builder's own output is what guarantees the published page cannot
    // drift: any prompt edit changes both sides together, or this fails.
    expect(bodyOf(promptPreview.systemHeading)).toBe(system.content)
  })

  // The section exists so a reader can see that the system message's opening paragraph is one of
  // several, and which one is attached above. Rendering from buildAgentPersonaPrompt rather than a
  // transcript is what keeps a reworded branch from silently leaving a stale copy on the page.
  it("publishes every persona the system message can open with", () => {
    const personas = bodyOf(promptPreview.personaHeading)
    const player = agentConfig.playerNamePlaceholder

    expect(personas).toContain(promptPreview.personaDefaultLabel)
    expect(personas).toContain(buildAgentPersonaPrompt(player, "trailblazer", true))
    for (const speedClass of ["trailblazer", "navigator", "backtracker"] as const) {
      expect(personas).toContain(buildAgentPersonaPrompt(player, speedClass, false))
    }
  })

  // The claim the heading makes about the system message has to hold: the default persona is not
  // merely listed alongside it, it is the paragraph the published system message opens with.
  it("attaches the default persona to the published system message", () => {
    const system = bodyOf(promptPreview.systemHeading)
    const defaultPersona = buildAgentPersonaPrompt(agentConfig.playerNamePlaceholder, "trailblazer", true)

    expect(system.startsWith(defaultPersona)).toBe(true)
    // The measured trailblazer wording claims a history a first turn does not have, so it must not
    // be what a reader sees attached above.
    expect(system).not.toContain(
      buildAgentPersonaPrompt(agentConfig.playerNamePlaceholder, "trailblazer", false),
    )
  })

  it("keeps the previewed agent name distinct from the traversal-history marker", () => {
    const system = bodyOf(promptPreview.systemHeading)

    // The prompt uses "Self" for the shared start marker when that filtered record is visible.
    // Previewing the agent under that same name would read as one player rather than two roles,
    // so both names must appear and they must differ.
    expect(agentConfig.playerNamePlaceholder).not.toBe(runtime.interactivePlayerName)
    expect(system).toContain(runtime.interactivePlayerName)
    expect(system).toContain(agentConfig.playerNamePlaceholder)
  })

  it("documents every tool the agent is actually offered", () => {
    const tools = bodyOf(promptPreview.toolsHeading)

    for (const tool of AGENT_CONTEXT_TOOLS) {
      expect(tools).toContain(tool.function.name)
      expect(tools).toContain(tool.function.description)
    }
  })

  it("publishes the response format the parser enforces", () => {
    const schema = bodyOf(promptPreview.schemaHeading)

    for (const move of ["MoveUp", "MoveDown", "MoveLeft", "MoveRight"]) {
      expect(schema).toContain(move)
    }
  })

  it("gives every section a heading and a body", () => {
    const sections = buildPreviewSections()

    expect(sections).toHaveLength(7)
    for (const section of sections) {
      expect(section.heading.length).toBeGreaterThan(0)
      expect(section.body.length).toBeGreaterThan(0)
    }
  })

  it("publishes the duplicate tool call warning rendered from a sample repeated call", () => {
    const warning = bodyOf(promptPreview.duplicateToolCallHeading)

    // Comparing against the builder's own output (not a transcribed copy) is what guarantees this
    // can't drift from the real mid-turn warning — same as the system-prompt test above.
    expect(warning).toBe(
      buildDuplicateToolCallMessage([
        { id: "call_1", function: { name: AGENT_CONTEXT_TOOLS[0].function.name } },
      ]).content,
    )
    expect(warning).toContain(AGENT_CONTEXT_TOOLS[0].function.name)
  })

  it("publishes the token limit exhaustion warning rendered at the real configured token cap", () => {
    const warning = bodyOf(promptPreview.tokenLimitExhaustionHeading)

    expect(warning).toBe(buildTokenLimitExhaustionPrompt(runtime.modelConfig.maxTokens).content)
    expect(warning).toContain(String(runtime.modelConfig.maxTokens))
  })

  it("names the agent the prompt was rendered for", () => {
    expect(previewPlayerNote()).toBe(
      promptPreview.playerNoteTemplate.replace("{player}", agentConfig.playerNamePlaceholder),
    )
  })

  // scripts/build-html.mjs imports this module under Node to bake the page, so a DOM reference
  // here would break the build rather than merely fail a test.
  it("stays free of DOM access so the build can run it", () => {
    const source = [buildPreviewSections.toString(), previewPlayerNote.toString()].join("\n")

    expect(source).not.toMatch(/\bdocument\b|\bwindow\b/)
  })
})
