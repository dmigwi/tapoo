import { describe, expect, it } from "vitest"

import {
  AGENT_CONTEXT_TOOLS,
  buildAgentMessages,
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
    const [system] = buildAgentMessages(agentConfig.playerNamePlaceholder, "trailblazer")

    // Comparing against the builder's own output is what guarantees the published page cannot
    // drift: any prompt edit changes both sides together, or this fails.
    expect(bodyOf(promptPreview.systemHeading)).toBe(system.content)
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

    expect(sections).toHaveLength(6)
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

    expect(warning).toBe(buildTokenLimitExhaustionPrompt(runtime.modelConfig.numPredict).content)
    expect(warning).toContain(String(runtime.modelConfig.numPredict))
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
