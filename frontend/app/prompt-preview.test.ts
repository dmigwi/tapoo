import { describe, expect, it } from "vitest"

import { AGENT_CONTEXT_TOOLS, buildAgentMessages } from "./agent/context"
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

    // The prompt separately states that "Self" appears first in traversalHistory and marks the
    // start cell. Previewing the agent under that same name would read as one player rather than
    // two roles, so both names must appear and they must differ.
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

    expect(sections).toHaveLength(4)
    for (const section of sections) {
      expect(section.heading.length).toBeGreaterThan(0)
      expect(section.body.length).toBeGreaterThan(0)
    }
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
