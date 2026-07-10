import { beforeEach, describe, expect, it, vi } from "vitest"

describe("tapoo entrypoint", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("boots the game on import", async () => {
    const bootstrapGame = vi.fn()

    vi.doMock("./app/game", () => ({ bootstrapGame }))

    await import("./tapoo")

    expect(bootstrapGame).toHaveBeenCalledTimes(1)
  })
})
