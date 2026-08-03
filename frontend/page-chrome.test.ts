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
    input.dataset.configPlaceholder = "agentConfig.endpointPlaceholder"
    input.dataset.configValue = "agentConfig.endpointPlaceholder"
    document.body.append(input)

    await import("./page-chrome")

    expect(input.placeholder).toBe(CONFIG.agentConfig.endpointPlaceholder)
    expect(input.value).toBe(CONFIG.agentConfig.endpointPlaceholder)
    expect(input.defaultValue).toBe(CONFIG.agentConfig.endpointPlaceholder)
  })

  it("leaves inputs without data-config-value untouched", async () => {
    const input = document.createElement("input")
    input.dataset.configPlaceholder = "agentConfig.endpointPlaceholder"
    input.value = "https://agent.example/move"
    document.body.append(input)

    await import("./page-chrome")

    expect(input.placeholder).toBe(CONFIG.agentConfig.endpointPlaceholder)
    expect(input.value).toBe("https://agent.example/move")
  })
})
