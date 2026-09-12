import { describe, expect, it } from "vitest"

import { fetchDeviceInfo, fetchPlatformInfo } from "./environment"

// Real strings, not invented ones: the impersonation this parser has to see through is a historical
// accident, and a hand-written sample tends to omit exactly the token that makes it hard.
const AGENTS: readonly { agent: string; expected: string; note: string }[] = [
  {
    note: "Chrome says Safari",
    agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    expected: "Chrome/141.0.0.0 on macOS",
  },
  {
    note: "Edge says both Chrome and Safari",
    agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
    expected: "Edge/141.0.0.0 on Windows",
  },
  {
    note: "Opera says Chrome",
    agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/126.0.0.0",
    expected: "Opera/126.0.0.0 on Windows",
  },
  {
    note: "Samsung Internet says Chrome, on an Android that says Linux",
    agent: "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36",
    expected: "Samsung Internet/27.0 on Android",
  },
  {
    note: "Android says Linux",
    agent: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
    expected: "Chrome/141.0.0.0 on Android",
  },
  {
    note: "iOS says Mac OS X",
    agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1",
    expected: "Safari/18.3 on iOS",
  },
  {
    note: "Chrome on iOS is CriOS, and still says Safari",
    agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1",
    expected: "Chrome/141.0.0.0 on iOS",
  },
  {
    note: "Safari puts its own version in Version/, not after Safari/",
    agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15",
    expected: "Safari/18.3 on macOS",
  },
  {
    note: "desktop Linux",
    agent: "Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0",
    expected: "Firefox/143.0 on Linux",
  },
  {
    note: "ChromeOS",
    agent: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    expected: "Chrome/141.0.0.0 on ChromeOS",
  },
]

describe("fetchDeviceInfo", () => {
  it.each(AGENTS)("reads $expected ($note)", ({ agent, expected }) => {
    expect(fetchDeviceInfo(agent)).toBe(expected)
  })

  it("publishes nothing beyond the browser, its major version, and the OS family", () => {
    // The point of reducing the agent at all: a shared log must not carry the tokens that identify
    // a particular machine. Asserting the output's shape catches a rule that accidentally captures
    // more than it should, which asserting equality case by case does not. The version keeps the
    // spelling the browser publishes, so build digits inside it are expected; the device model,
    // engine build and CPU tokens beside it are the ones that must never appear.
    for (const { agent } of AGENTS) {
      const described = fetchDeviceInfo(agent)
      expect(described).toMatch(/^[A-Za-z][A-Za-z ]*(?:\/[\d.]+)?(?: on [A-Za-z]+)?$/)
      for (const leaked of ["AppleWebKit", "10_15_7", "SM-S918B", "Pixel", "rv:", "x86_64", "Win64", "15E148"]) {
        expect(described).not.toContain(leaked)
      }
    }
  })

  it("says so rather than guessing when the agent names no browser it knows", () => {
    // A log that cannot name the browser should say that, not leave an empty field a reader could
    // read as "not recorded" - and never fall back to dumping the raw string.
    expect(fetchDeviceInfo("curl/8.4.0")).toBe("Unknown browser")
    expect(fetchDeviceInfo("")).toBe("Unknown browser")
    expect(fetchDeviceInfo("Mozilla/5.0 (Windows NT 10.0; Win64; x64) wget/1.21")).toBe(
      "Unknown browser on Windows",
    )
  })
})

describe("fetchPlatformInfo", () => {
  it("names the page without the query or fragment the visit happened to carry", () => {
    // Tested directly on a location-shaped value rather than only through jsdom's history, so the
    // rule this function exists for is stated where the function is.
    expect(fetchPlatformInfo({ origin: "https://dmigwi.github.io", pathname: "/tapoo/" })).toBe(
      "https://dmigwi.github.io/tapoo/",
    )
    const shared = fetchPlatformInfo({
      origin: "https://dmigwi.github.io",
      pathname: "/tapoo/agents.html",
    })
    expect(shared).toBe("https://dmigwi.github.io/tapoo/agents.html")
    expect(shared).not.toContain("?")
    expect(shared).not.toContain("#")
  })
})
