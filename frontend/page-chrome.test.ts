import { beforeEach, describe, expect, it, vi } from "vitest"

import { CONFIG } from "./app/config"

// page-chrome.ts hydrates the page as a side effect of being imported, so every test resets the
// module registry and rebuilds the DOM it reads from, then imports fresh — the same pattern
// tapoo.test.ts uses for its own import-time entrypoint.
describe("page chrome data-config-value hydration", () => {
  beforeEach(() => {
    vi.resetModules()
    document.body.innerHTML = ""
  })

  it("pre-fills an input's value from the resolved config text, not only its placeholder", async () => {
    const input = document.createElement("input")
    // A two-level dotted path (agentConfig.endpointPlaceholders.ollama) exercises the same reduce
    // walker as a one-level one; nothing in configValue special-cases depth.
    input.dataset.configPlaceholder = "agentConfig.endpointPlaceholders.ollama"
    input.dataset.configValue = "agentConfig.endpointPlaceholders.ollama"
    document.body.append(input)

    await import("./page-chrome")

    expect(input.placeholder).toBe(CONFIG.agentConfig.endpointPlaceholders.ollama)
    expect(input.value).toBe(CONFIG.agentConfig.endpointPlaceholders.ollama)
    expect(input.defaultValue).toBe(CONFIG.agentConfig.endpointPlaceholders.ollama)
  })

  it("leaves inputs without data-config-value untouched", async () => {
    const input = document.createElement("input")
    input.dataset.configPlaceholder = "agentConfig.endpointPlaceholders.ollama"
    input.value = "https://agent.example/move"
    document.body.append(input)

    await import("./page-chrome")

    expect(input.placeholder).toBe(CONFIG.agentConfig.endpointPlaceholders.ollama)
    expect(input.value).toBe("https://agent.example/move")
  })

  it("hydrates both data-tooltip and aria-label from a data-config-title element", async () => {
    const badge = document.createElement("span")
    badge.dataset.configTitle = ""
    badge.dataset.configKey = "agentConfig.credentialRotationTooltip"
    document.body.append(badge)

    await import("./page-chrome")

    expect(badge.getAttribute("data-tooltip")).toBe(CONFIG.agentConfig.credentialRotationTooltip)
    expect(badge.getAttribute("aria-label")).toBe(CONFIG.agentConfig.credentialRotationTooltip)
  })
})
