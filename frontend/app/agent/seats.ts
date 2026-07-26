import { CONFIG } from "../config"
import { resolveBatchEfficiencyRank } from "./efficiency"
import type { AgentApiConfig, AgentSeat, TraversalHistoryEntry } from "../types"

const { agentConfig } = CONFIG
const middleTrimMarker = "..."
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
export function agentSeatManageLabel(
  agent: AgentApiConfig,
  traversalHistory: TraversalHistoryEntry[] = [],
): string {
  return seatTemplate(agentConfig.manageSeatLabelTemplate, agent, traversalHistory)
}

// activeAgentSeatLabel identifies the currently selected agent without implying it can be edited.
export function activeAgentSeatLabel(
  agent: AgentApiConfig,
  traversalHistory: TraversalHistoryEntry[] = [],
): string {
  return seatTemplate(agentConfig.activeSeatLabelTemplate, agent, traversalHistory)
}

// seatTemplate applies the shared seat placeholders while keeping user-facing copy in CONFIG.
function seatTemplate(
  template: string,
  seat: AgentApiConfig | number,
  traversalHistory: TraversalHistoryEntry[] = [],
): string {
  const seatId = typeof seat === "number" ? seat : seat.id
  const agentName = typeof seat === "number" ? "" : agentDisplayName(seat, traversalHistory)
  const agentModel = typeof seat === "number" ? "" : compactAgentModelLabel(seat.model)

  return template
    .replace("{agent}", agentName)
    .replace("{model}", agentModel)
    .replace("{seat}", agentSeatLabel(seatId))
}

// agentDisplayName names the agent after its current efficiency rank everywhere the UI shows it
// — tooltips, dialog titles — so the identity the model is defending stays visible to a human
// observer too, e.g. "Kora the Trailblazer". An agent with no tracked requests yet defaults to
// Trailblazer, matching the rank stated in its very first prompt.
function agentDisplayName(agent: AgentApiConfig, traversalHistory: TraversalHistoryEntry[]): string {
  const rank = resolveBatchEfficiencyRank(traversalHistory, agent)
  return `${agent.playerName} the ${capitalize(rank)}`
}

// capitalize renders lowercase rank identifiers (kept lowercase for model-facing JSON/prose)
// as UI-facing title case.
function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

// compactAgentModelLabel keeps long model names readable in tight dialog titles.
function compactAgentModelLabel(model: string): string {
  if (model.length <= agentConfig.maxModelDisplayLength) {
    return model
  }

  const availableCharacters = agentConfig.maxModelDisplayLength - middleTrimMarker.length
  const leadingCharacters = Math.floor(availableCharacters / 2)
  const trailingCharacters = availableCharacters - leadingCharacters

  return `${model.slice(0, leadingCharacters)}${middleTrimMarker}${model.slice(-trailingCharacters)}`
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
  traversalHistory: TraversalHistoryEntry[] = [],
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
    seat.title = agentDisplayName(agent, traversalHistory)
    seat.setAttribute("aria-label", agentSeatManageLabel(agent, traversalHistory))

    if (agent.id === activeAgentId) {
      seat.disabled = true
      seat.setAttribute("aria-label", activeAgentSeatLabel(agent, traversalHistory))
    } else {
      seat.dataset.agentSeatDelete = agentSeatDatasetValue(agent.id)
    }

    seat.textContent = agentSeatLabel(id)
    roster.append(seat)
  })
}
