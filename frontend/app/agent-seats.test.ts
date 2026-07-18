import { describe, expect, it } from "vitest"

import {
  agentSeatDatasetValue,
  agentSeatDeleteMessage,
  agentSeatIdFromDataset,
  agentSeatIds,
  agentSeatLabel,
  buildAgentSeats,
  emptyAgentSeatLabel,
  isAgentSeatId,
} from "./agent-seats"
import { CONFIG } from "./config"
import type { AgentApiConfig } from "./types"

function agent(id: number, playerName: string): AgentApiConfig {
  return {
    id,
    playerName,
    model: "llama3.2",
    endpoint: "https://example.test/move",
    enabled: true,
  }
}

// Agent-seat tests keep display labels, dataset ids, and fixed roster slots centralized.
describe("agent seats", () => {
  it("lists configured seat ids in stable display order", () => {
    expect(agentSeatIds()).toEqual([1, 2, 3, 4, 5])
    expect(agentSeatIds()).toHaveLength(CONFIG.agentConfig.maxSeats)
  })

  it("accepts only configured positive integer seat ids", () => {
    expect(isAgentSeatId(1)).toBe(true)
    expect(isAgentSeatId(CONFIG.agentConfig.maxSeats)).toBe(true)
    expect(isAgentSeatId(0)).toBe(false)
    expect(isAgentSeatId(1.5)).toBe(false)
    expect(isAgentSeatId(CONFIG.agentConfig.maxSeats + 1)).toBe(false)
  })

  it("round-trips seat ids through DOM dataset strings", () => {
    expect(agentSeatDatasetValue(3)).toBe("3")
    expect(agentSeatIdFromDataset("3")).toBe(3)
    expect(agentSeatIdFromDataset("03")).toBeNull()
    expect(agentSeatIdFromDataset("invalid")).toBeNull()
    expect(agentSeatIdFromDataset(undefined)).toBeNull()
  })

  it("formats occupied and empty seats consistently", () => {
    expect(emptyAgentSeatLabel).toBe("+")
    expect(agentSeatLabel(1)).toBe("01")
    expect(agentSeatLabel(12)).toBe("12")
  })

  it("uses the visible seat label in delete confirmation copy", () => {
    expect(agentSeatDeleteMessage(agent(2, "Kora"))).toBe(
      "Delete Kora from seat 02 now?",
    )
  })

  it("builds fixed slots without persisting empty seats", () => {
    expect(buildAgentSeats([agent(2, "Kora")])).toEqual([
      { id: 1, agent: null },
      { id: 2, agent: agent(2, "Kora") },
      { id: 3, agent: null },
      { id: 4, agent: null },
      { id: 5, agent: null },
    ])
  })
})
