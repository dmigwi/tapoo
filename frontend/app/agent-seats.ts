import { CONFIG } from "./config"
import type { AgentApiConfig, AgentSeat } from "./types"

const { agentConfig } = CONFIG
export const emptyAgentSeatLabel = "+"

// agentSeatIds lists every fixed numeric seat id in display order.
export function agentSeatIds(): number[] {
  return Array.from({ length: agentConfig.maxSeats }, (_, index) => index + 1)
}

// isAgentSeatId accepts only integer seat ids inside the configured seat range.
export function isAgentSeatId(id: number): boolean {
  return Number.isInteger(id) && id >= 1 && id <= agentConfig.maxSeats
}

// agentSeatIdFromDataset parses DOM string values back into internal numeric seat ids.
export function agentSeatIdFromDataset(value: string | undefined): number | null {
  if (!value) {
    return null
  }

  const seatId = Number(value)
  return isAgentSeatId(seatId) && String(seatId) === value ? seatId : null
}

// agentSeatDatasetValue serializes a valid seat id for DOM data attributes.
export function agentSeatDatasetValue(id: number): string {
  return String(id)
}

// agentSeatLabel formats occupied seats as stable two-character display tokens.
export function agentSeatLabel(id: number): string {
  if (id > 9) {
    return String(id)
  }
  return `0${id}`
}

// agentSeatDeleteMessage ties destructive copy to the same visible seat label.
export function agentSeatDeleteMessage(agent: AgentApiConfig): string {
  return agentConfig.deleteMessageTemplate
    .replace("{agent}", agent.playerName)
    .replace("{seat}", agentSeatLabel(agent.id))
}

// buildAgentSeats returns fixed slots; occupied seats carry an agent, empty seats carry null.
export function buildAgentSeats(agents: AgentApiConfig[]): AgentSeat[] {
  const configsBySeat = new Map(agents.map((agent) => [agent.id, agent]))

  return agentSeatIds().map((id) => ({
    id,
    agent: configsBySeat.get(id) ?? null,
  }))
}
