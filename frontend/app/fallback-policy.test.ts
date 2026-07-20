import { afterEach, describe, expect, it, vi } from "vitest"

import { showPlaceholderArt, showTerminalApp } from "./fallback-policy"

// These tests lock down the fallback behavior and its console diagnostics.
describe("fallback policy", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("shows the placeholder art only for Error failures", () => {
    document.body.innerHTML = `
      <section id="terminal-app"></section>
      <section id="placeholder-art" hidden aria-hidden="true"></section>
    `

    const terminalApp = document.getElementById("terminal-app")
    const placeholder = document.getElementById("placeholder-art")
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    showPlaceholderArt("handled status")

    expect(terminalApp).toHaveProperty("hidden", false)
    expect(placeholder).toHaveProperty("hidden", true)

    showPlaceholderArt(new Error("network timeout"))

    expect(terminalApp).toHaveProperty("hidden", false)
    expect(terminalApp?.getAttribute("aria-hidden")).toBe("true")
    expect(placeholder).toHaveProperty("hidden", false)
    expect(placeholder?.getAttribute("aria-hidden")).toBe("false")
    expect(consoleError).toHaveBeenCalledOnce()
    expect(consoleError).toHaveBeenCalledWith(
      "[Tapoo] An unexpected runtime Error reached the page shell; showing fallback placeholder.",
      expect.any(Error),
    )
  })

  it("shows the terminal app and hides the default placeholder after successful checks", () => {
    document.body.innerHTML = `
      <section id="terminal-app" aria-hidden="true"></section>
      <section id="placeholder-art" aria-hidden="false"></section>
    `

    const terminalApp = document.getElementById("terminal-app")
    const placeholder = document.getElementById("placeholder-art")

    showTerminalApp()

    expect(terminalApp).toHaveProperty("hidden", false)
    expect(terminalApp?.getAttribute("aria-hidden")).toBe("false")
    expect(placeholder).toHaveProperty("hidden", true)
    expect(placeholder?.getAttribute("aria-hidden")).toBe("true")
  })

  it("logs the specific policy reason for known fallback failures", () => {
    document.body.innerHTML = `
      <section id="terminal-app"></section>
      <section id="placeholder-art" hidden aria-hidden="true"></section>
    `

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    showPlaceholderArt(new Error("missing required element: terminal-body"))

    expect(consoleError).toHaveBeenCalledOnce()
    expect(consoleError).toHaveBeenCalledWith(
      "[Tapoo] The terminal template was removed, corrupted, or manipulated after load.",
      expect.any(Error),
    )
  })
})
