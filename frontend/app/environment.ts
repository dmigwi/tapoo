// What an exported log records about where it ran: the page the build was served from, and the
// browser that ran it. Both are read once into the export envelope (see tapooDownloadLogs), never
// onto individual entries - neither changes within a session.
//
// Both are reducers, not readers: they take the raw value and return the trimmed form that is safe
// to publish. A downloaded log is shared - to a gist, to an analysis tool - so what they drop is as
// much the point as what they keep.

// fetchDeviceInfo reduces a user-agent string to the pair a reader needs to reproduce a
// run: the browser with its version, and the operating system family.
//
// The raw string is not logged. It also carries the OS version, CPU architecture, device model and
// engine build tokens, and this entry is exported - published to a gist, handed to an analysis tool -
// so those travel with it. None of them change how an agent plays a maze, and together they make a
// log far more identifying than the profile it exists to support. "Chrome/141.0.0.0 on macOS" is
// what replication needs; "10_15_7; Intel" is not. The version is kept as the agent spells it: on
// Chromium the digits after the major are frozen zeros and say nothing, and Safari's Version/ token
// is the one that tracks its OS release - a weaker signal than the OS version dropped above, but
// not nothing.
//
// Order is the whole correctness argument below. Browsers impersonate each other in this string by
// design, for historical compatibility: every Chrome UA contains "Safari", every Edge UA contains
// both "Chrome" and "Safari", and every Android UA contains "Linux". Matching the most specific
// claim first is what keeps Edge from reporting itself as Chrome.

type UserAgentRule = {
  name: string
  pattern: RegExp
}

/**
 * Most specific first: Edge and Opera both claim Chrome, and Chrome claims Safari.
 */
const BROWSER_RULES: readonly UserAgentRule[] = [
  { name: "Edge", pattern: /\b(?:Edg|EdgA|EdgiOS)\/(\d+[\d.]*)/ },
  { name: "Opera", pattern: /\b(?:OPR|OPiOS)\/(\d+[\d.]*)/ },
  { name: "Samsung Internet", pattern: /\bSamsungBrowser\/(\d+[\d.]*)/ },
  { name: "Firefox", pattern: /\b(?:Firefox|FxiOS)\/(\d+[\d.]*)/ },
  { name: "Chrome", pattern: /\b(?:Chrome|CriOS)\/(\d+[\d.]*)/ },
  // Safari alone puts its own version in Version/, and is the only one left that still says Safari.
  { name: "Safari", pattern: /\bVersion\/(\d+[\d.]*)\s+(?:Mobile\/\S+\s+)?Safari\// },
]

/**
 * Android before Linux (an Android UA says "Linux"), and the iOS devices before macOS.
 */
const OS_RULES: readonly UserAgentRule[] = [
  { name: "Windows", pattern: /Windows NT/ },
  { name: "Android", pattern: /\bAndroid\b/ },
  { name: "iOS", pattern: /\b(?:iPhone|iPad|iPod)\b/ },
  { name: "ChromeOS", pattern: /\bCrOS\b/ },
  { name: "macOS", pattern: /Mac OS X|Macintosh/ },
  { name: "Linux", pattern: /\bLinux\b/ },
]

/**
 * UNKNOWN_BROWSER is recorded rather than an empty string or the raw agent: a log that cannot name
 * the browser should say so, not leave a reader guessing whether the field was never written.
 */
const UNKNOWN_BROWSER = "Unknown browser"

export function fetchDeviceInfo(userAgent: string): string {
  const agent = String(userAgent ?? "").trim()
  const browserRule = BROWSER_RULES.find((rule) => rule.pattern.test(agent))
  const browserVersion = browserRule?.pattern.exec(agent)?.[1]
  const browser = browserRule
    ? `${browserRule.name}${browserVersion ? `/${browserVersion}` : ""}`
    : UNKNOWN_BROWSER
  const operatingSystem = OS_RULES.find((rule) => rule.pattern.test(agent))?.name

  return operatingSystem ? `${browser} on ${operatingSystem}` : browser
}

/**
 * fetchPlatformInfo names the page the build was served from: origin and pathname, never href.
 * A query string or fragment is no part of the address a reader needs to find the build, and this
 * value lands in a file that gets published, so anything incidental a link carried into the session
 * would travel with it.
 */
export function fetchPlatformInfo(location: Pick<Location, "origin" | "pathname">): string {
  return `${location.origin}${location.pathname}`
}
