import { beforeEach, describe, expect, it } from "vitest"

import { CONFIG } from "./app/config"
import { applyPageText } from "./page-chrome"

// Page-chrome tests call the focused hydration functions directly; tapoo.ts owns runtime startup.
describe("page chrome data-config-value hydration", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
  })

  it("pre-fills an input's value from the resolved config text, not only its placeholder", () => {
    const input = document.createElement("input")
    // A two-level dotted path (agentConfig.endpointPlaceholders.ollama) exercises the same reduce
    // walker as a one-level one; nothing in configValue special-cases depth.
    input.dataset.configPlaceholder = "agentConfig.endpointPlaceholders.ollama"
    input.dataset.configValue = "agentConfig.endpointPlaceholders.ollama"
    document.body.append(input)

    applyPageText()

    expect(input.placeholder).toBe(CONFIG.agentConfig.endpointPlaceholders.ollama)
    expect(input.value).toBe(CONFIG.agentConfig.endpointPlaceholders.ollama)
    expect(input.defaultValue).toBe(CONFIG.agentConfig.endpointPlaceholders.ollama)
  })

  it("leaves inputs without data-config-value untouched", () => {
    const input = document.createElement("input")
    input.dataset.configPlaceholder = "agentConfig.endpointPlaceholders.ollama"
    input.value = "https://agent.example/move"
    document.body.append(input)

    applyPageText()

    expect(input.placeholder).toBe(CONFIG.agentConfig.endpointPlaceholders.ollama)
    expect(input.value).toBe("https://agent.example/move")
  })

  it("pre-fills a numeric input value from config", () => {
    const input = document.createElement("input")
    input.type = "number"
    input.dataset.configValue = "timing.defaultAgentApiRequestIntervalSeconds"
    document.body.append(input)

    applyPageText()

    const expectedValue = String(CONFIG.timing.defaultAgentApiRequestIntervalSeconds)
    expect(input.value).toBe(expectedValue)
    expect(input.defaultValue).toBe(expectedValue)
  })

  it("hydrates both data-tooltip and aria-label from a data-config-title element", () => {
    const badge = document.createElement("span")
    badge.dataset.configTitle = ""
    badge.dataset.configKey = "agentConfig.credentialRotationTooltip"
    document.body.append(badge)

    applyPageText()

    expect(badge.getAttribute("data-tooltip")).toBe(CONFIG.agentConfig.credentialRotationTooltip)
    expect(badge.getAttribute("aria-label")).toBe(CONFIG.agentConfig.credentialRotationTooltip)
  })

  it("formats a numeric data-config-text value for display", () => {
    const outputCap = document.createElement("span")
    outputCap.dataset.configText = ""
    outputCap.dataset.configKey = "runtime.modelConfig.maxTokens"
    document.body.append(outputCap)

    applyPageText()

    expect(outputCap.textContent).toBe(CONFIG.runtime.modelConfig.maxTokens.toLocaleString("en-US"))
  })
})
