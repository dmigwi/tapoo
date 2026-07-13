import { describe, expect, it } from "vitest"

import {
  APP_VERSION,
  VERSION_MAJOR,
  VERSION_MINOR,
  VERSION_PATCH,
} from "./version"

// These tests guard the SPA semantic version that appears in page metadata and the footer.
describe("APP_VERSION", () => {
  it("uses semantic versioning", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it("matches the version parts", () => {
    expect(APP_VERSION).toBe(
      `${VERSION_MAJOR}.${VERSION_MINOR}.${VERSION_PATCH}`,
    )
  })
})
