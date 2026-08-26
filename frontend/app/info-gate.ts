import type { Elements } from "./types"

// InfoGateContent is every word the gate displays. Copy arrives from the caller rather than from
// CONFIG so this module stays usable for any future consent case — the moment it reaches into
// CONFIG for one caller's strings, it stops being a gate and becomes that caller's dialog.
export type InfoGateContent = {
  title: string
  message: string
  // detail is optional supporting text, shown only when the caller has something concrete to add
  // (a count, a list of what is affected). An acknowledgement that names what it covers is worth
  // more than one that does not, but not every gate has something to name.
  detail?: string
  proceedLabel: string
}

// showInfoGate presents a blocking acknowledgement and runs onProceed once the user accepts.
//
// The gate cannot be dismissed, and that is the contract rather than an implementation detail:
// there is no close control, no backdrop-click handler, and no Escape binding, because the only
// outcomes are proceeding or leaving the page. A caller that wants a dismissable dialog wants a
// different component — do not add a cancel path here, since every existing caller relies on
// onProceed being reachable only through deliberate consent.
//
// Callers own what proceeding means. This module performs no side effect of its own beyond showing
// and hiding the overlay, which is what keeps it reusable.
export function showInfoGate(
  elements: Elements,
  content: InfoGateContent,
  onProceed: () => void,
): void {
  elements.infoGateTitle.textContent = content.title
  elements.infoGateMessage.textContent = content.message
  elements.infoGateDetail.textContent = content.detail ?? ""
  elements.infoGateDetail.hidden = !content.detail
  elements.infoGateProceed.textContent = content.proceedLabel

  const onClick = (): void => {
    // Unbound before onProceed runs, not after: a callback that throws would otherwise leave the
    // handler attached, and a second click would re-enter a continuation that already failed.
    elements.infoGateProceed.removeEventListener("click", onClick)
    elements.infoGate.hidden = true
    onProceed()
  }

  elements.infoGateProceed.addEventListener("click", onClick)
  elements.infoGate.hidden = false
  elements.infoGateProceed.focus()
}

