import { CONFIG } from "../config"
import type { AgentApiConfig, AgentSeat } from "../types"

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

// agentSeatAddLabel describes the action available from an empty roster seat.
export function agentSeatAddLabel(id: number): string {
  return seatTemplate(agentConfig.addSeatLabelTemplate, id)
}

// agentSeatManageLabel describes the non-destructive edit dialog opened from an occupied seat.
export function agentSeatManageLabel(agent: AgentApiConfig): string {
  return seatTemplate(agentConfig.manageSeatLabelTemplate, agent)
}

// activeAgentSeatLabel identifies the currently selected agent without implying it can be edited.
export function activeAgentSeatLabel(agent: AgentApiConfig): string {
  return seatTemplate(agentConfig.activeSeatLabelTemplate, agent)
}

// seatTemplate applies the shared seat placeholders while keeping user-facing copy in CONFIG.
function seatTemplate(template: string, seat: AgentApiConfig | number): string {
  const seatId = typeof seat === "number" ? seat : seat.id
  const agentName = typeof seat === "number" ? "" : seat.playerName

  return template
    .replace("{agent}", agentName)
    .replace("{seat}", agentSeatLabel(seatId))
}

// buildAgentSeats returns fixed slots; occupied seats carry an agent, empty seats carry null.
export function buildAgentSeats(agents: AgentApiConfig[]): AgentSeat[] {
  const configsBySeat = new Map(agents.map((agent) => [agent.id, agent]))

  return agentSeatIds().map((id) => ({
    id,
    agent: configsBySeat.get(id) ?? null,
  }))
}

// renderAgentSeatRoster owns the seat DOM shape so agent mode only coordinates behavior.
export function renderAgentSeatRoster(
  roster: HTMLElement | undefined,
  agents: AgentApiConfig[],
  activeAgentId: number | null,
): void {
  if (!roster) {
    return
  }

  roster.replaceChildren()
  roster.hidden = false
  buildAgentSeats(agents).forEach(({ id, agent }) => {
    const seat = document.createElement("button")
    seat.className = agent ? "agent-seat agent-seat--occupied" : "agent-seat agent-seat--empty"
    seat.dataset.agentSeatId = agentSeatDatasetValue(id)
    seat.type = "button"

    if (!agent) {
      seat.setAttribute("aria-label", agentSeatAddLabel(id))
      seat.dataset.agentSeatAdd = agentSeatDatasetValue(id)
      seat.textContent = emptyAgentSeatLabel
      roster.append(seat)
      return
    }

    seat.classList.toggle("agent-seat--disabled", !agent.enabled)
    seat.classList.toggle("agent-seat--active", agent.id === activeAgentId)
    seat.title = agent.playerName
    seat.setAttribute("aria-label", agentSeatManageLabel(agent))

    if (agent.id === activeAgentId) {
      seat.disabled = true
      seat.setAttribute("aria-label", activeAgentSeatLabel(agent))
    } else {
      seat.dataset.agentSeatDelete = agentSeatDatasetValue(agent.id)
    }

    seat.textContent = agentSeatLabel(id)
    roster.append(seat)
  })
}
