import { describe, expect, it } from "vitest"

import {
  activeAgentSeatLabel,
  agentSeatAddLabel,
  agentSeatDatasetValue,
  agentSeatIdFromDataset,
  agentSeatIds,
  agentSeatLabel,
  agentSeatManageLabel,
  buildAgentSeats,
  emptyAgentSeatLabel,
  isAgentSeatId,
  renderAgentSeatRoster,
} from "./seats"
import { CONFIG } from "../config"
import type { AgentApiConfig } from "../types"

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

  it("uses behavior-specific accessible labels for roster seats", () => {
    expect(agentSeatAddLabel(1)).toBe("Add agent to seat 01")
    expect(agentSeatManageLabel(agent(2, "Kora"))).toBe(
      "Manage player Kora in seat 02",
    )
    expect(activeAgentSeatLabel(agent(3, "Mika"))).toBe(
      "Player Mika is playing in seat 03",
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

  it("renders empty, occupied, disabled, and active seats with stable labels", () => {
    const roster = document.createElement("div")
    const disabledAgent = { ...agent(3, "Grey"), enabled: false }

    renderAgentSeatRoster(roster, [agent(2, "Kora"), disabledAgent], 2)

    const seats = Array.from(roster.querySelectorAll<HTMLButtonElement>(".agent-seat"))

    expect(seats).toHaveLength(CONFIG.agentConfig.maxSeats)
    expect(seats[0].textContent).toBe(emptyAgentSeatLabel)
    expect(seats[0].dataset.agentSeatAdd).toBe("1")
    expect(seats[0].getAttribute("aria-label")).toBe("Add agent to seat 01")
    expect(seats[1].textContent).toBe("02")
    expect(seats[1].disabled).toBe(true)
    expect(seats[1].classList.contains("agent-seat--active")).toBe(true)
    expect(seats[1].getAttribute("aria-label")).toBe(
      "Player Kora is playing in seat 02",
    )
    expect(seats[2].textContent).toBe("03")
    expect(seats[2].dataset.agentSeatDelete).toBe("3")
    expect(seats[2].classList.contains("agent-seat--disabled")).toBe(true)
    expect(roster.hidden).toBe(false)
  })
})
