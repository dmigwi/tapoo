import { beforeEach, describe, expect, it, vi } from "vitest"

import type * as PageConfig from "./app/config"

import { CONFIG, PAGE_COPYRIGHT_TEXT, PAGE_UPDATED_AT, PAGE_UPDATED_TEMPLATE } from "./app/config"
import { applyPageText, applyPageVersion, relativeAge } from "./page-chrome"

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

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// age is how relativeAge reads for a build that went out `elapsedMs` ago.
function age(elapsedMs: number): string {
  const now = Date.parse("2026-08-25T12:00:00Z")
  return relativeAge(now - elapsedMs, now)
}

describe("relativeAge", () => {
  // The rule the footer's width is sized around: a unit only starts at 2, so "1 min" and "1 mon"
  // never appear and the unit below has to carry the value up to 119.
  it("never names a unit until its count reaches two", () => {
    expect(age(59 * SECOND)).toBe("59 secs")
    expect(age(60 * SECOND)).toBe("60 secs")
    expect(age(119 * SECOND)).toBe("119 secs")
    expect(age(120 * SECOND)).toBe("2 mins")

    expect(age(119 * MINUTE)).toBe("119 mins")
    expect(age(120 * MINUTE)).toBe("2 hrs")

    expect(age(47 * HOUR)).toBe("47 hrs")
    expect(age(48 * HOUR)).toBe("2 days")

    expect(age(59 * DAY)).toBe("59 days")
    expect(age(60 * DAY)).toBe("2 mons")

    expect(age(729 * DAY)).toBe("24 mons")
    expect(age(730 * DAY)).toBe("2 yrs")
  })

  it("keeps the singular only where a count of one can still occur", () => {
    expect(age(0)).toBe("0 secs")
    expect(age(SECOND)).toBe("1 sec")
    expect(age(2 * SECOND)).toBe("2 secs")
  })

  // Every consumer treats the build stamp as a real instant. A non-finite one must not reach the
  // footer as "NaN secs" — config.ts rejects an unparseable define, and this is the second line of
  // defence for any other caller of the exported helper.
  it("reads zero rather than NaN when handed a non-instant", () => {
    const now = Date.parse("2026-08-25T12:00:00Z")
    expect(relativeAge(Date.parse("not-a-date"), now)).toBe("0 secs")
    expect(relativeAge(now, Number.NaN)).toBe("0 secs")
  })

  // A machine whose clock trails the build would otherwise show a negative age.
  it("reads zero rather than negative when the reader's clock is behind", () => {
    const now = Date.parse("2026-08-25T12:00:00Z")
    expect(relativeAge(now + DAY, now)).toBe("0 secs")
  })
})

describe("applyPageVersion updated segment", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
  })

  // The <time> element publishes a real datetime. Rendering it around a template that no longer
  // asks for the age would claim a timestamp the visible text never shows.
  // The module snapshots PAGE_UPDATED_TEMPLATE at import time, so the template has to be replaced
  // before page-chrome loads — mutating CONFIG afterwards cannot reach the captured constant.
  it("omits the time element when the template has no {updated} slot", async () => {
    const host = document.createElement("small")
    host.setAttribute("data-page-version", "")
    document.body.append(host)

    vi.resetModules()
    vi.doMock("./app/config", async () => {
      const actual = await vi.importActual<typeof PageConfig>("./app/config")
      return { ...actual, PAGE_UPDATED_TEMPLATE: "(no slot here)" }
    })

    try {
      const { applyPageVersion: applyWithoutSlot } = await import("./page-chrome")
      applyWithoutSlot()
    } finally {
      vi.doUnmock("./app/config")
      vi.resetModules()
    }

    expect(host.querySelector("time")).toBeNull()
    expect(host.textContent).toBe(PAGE_COPYRIGHT_TEXT)
  })
})

describe("footer width budget", () => {
  // The footer must hold one line at 375px: 343px of room at ~9.2px per character leaves 37. This
  // asserts the character budget rather than pixels, which jsdom cannot measure — but it is the
  // thing that actually regressed twice, by adding words the line had no room for.
  const MAX_FOOTER_CHARACTERS = 37

  it("stays inside one 375px line at every age it can report", () => {
    const now = Date.parse("2026-08-25T12:00:00Z")
    // One sample per unit, each the widest that unit can produce under the "starts at 2" rule.
    const widestAges = [119 * SECOND, 119 * MINUTE, 47 * HOUR, 59 * DAY, 24 * 30 * DAY, 999 * DAY]

    for (const elapsed of widestAges) {
      const updated = PAGE_UPDATED_TEMPLATE.replace("{updated}", relativeAge(now - elapsed, now))
      const footer = `${PAGE_COPYRIGHT_TEXT} ${updated}`
      expect(footer.length, footer).toBeLessThanOrEqual(MAX_FOOTER_CHARACTERS)
    }
  })
})

describe("applyPageVersion", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
  })

  it("renders the age as a <time> carrying the exact instant it approximates", () => {
    const host = document.createElement("small")
    host.setAttribute("data-page-version", "")
    document.body.append(host)

    applyPageVersion()

    const time = host.querySelector("time")
    expect(time).not.toBeNull()
    // The visible text is an approximation; these two are what keep the real instant reachable.
    expect(time?.getAttribute("datetime")).toBe(PAGE_UPDATED_AT)
    expect(time?.getAttribute("aria-label")).toMatch(/^Last updated /)
    expect(host.textContent).toContain(PAGE_COPYRIGHT_TEXT)
    expect(host.textContent?.trim().endsWith("ago)")).toBe(true)
  })

  // Each run is separately unbreakable, so a wrap can only land between them.
  it("splits the line into runs that each stay whole", () => {
    const host = document.createElement("small")
    host.setAttribute("data-page-version", "")
    document.body.append(host)

    applyPageVersion()

    const runs = [...host.querySelectorAll(".page-footer__part")].map((run) => run.textContent)
    expect(runs).toHaveLength(2)
    expect(runs[0]).toBe(PAGE_COPYRIGHT_TEXT)
  })
})
