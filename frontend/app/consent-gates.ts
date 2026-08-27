import { INFO_GATE_NOTICES } from "./config"
import { showInfoGate } from "./info-gate"
import { clearStaleStorageVersions, staleStorageSummary } from "./storage"
import type { InfoGateContent } from "./info-gate"
import type { StaleStorageSummary } from "./storage"
import type { Elements } from "./types"

// Every consent gate Tapoo can raise lives here - one module for all of them, not one per gate.
//
// It is the layer where three deliberately unaware modules meet: info-gate.ts renders an overlay
// and holds no copy and no storage, storage.ts holds no UI, and config.ts holds only words. A gate
// is the policy joining them: whether consent is needed, what the user is told, and what proceeding
// does. Keeping that policy out of info-gate.ts is what lets the overlay stay reusable instead of
// becoming whichever dialog was written first; keeping it out of the entry point is what stops
// tapoo.ts accumulating behaviour it only meant to wire.
//
// A second gate is another pair of functions in this file, not another module.

// staleDataGateContent turns the key census into the words the gate shows. Only counts and version
// numbers are used: no stored value is read, because this build cannot interpret a schema an older
// version wrote, and reading one just to describe it would reintroduce exactly that hazard.
function staleDataGateContent(summary: StaleStorageSummary): InfoGateContent {
  const notice = INFO_GATE_NOTICES.staleStorage
  // Both counts carry their own noun into the template, since the template cannot know whether
  // either is plural.
  const items = `${summary.itemCount} ${summary.itemCount === 1 ? "entry" : "entries"}`
  const versionLabel = summary.versions.length === 1 ? "version" : "versions"
  const versions = `${versionLabel} (${summary.versions.join(", ")})`

  return {
    title: notice.title,
    message: notice.acknowledgement,
    detail: notice.detailTemplate
      .replace("{items}", items)
      .replace("{versions}", versions),
    proceedLabel: notice.proceedLabel,
  }
}

// requireStaleDataAcknowledgement runs onProceed once it is safe to carry on: immediately when an
// older schema version left nothing behind, or after the user has agreed to its removal.
//
// The no-stale path is synchronous on purpose. An ordinary start must be indistinguishable from
// before this gate existed - no deferred callback, and no frame in which the overlay could show.
//
// Nothing is deleted until the user has been shown what will go. clearStaleStorageVersions
// swallows its own storage failures, so the only way onProceed is skipped is the user never
// proceeding.
export function requireStaleDataAcknowledgement(
  elements: Elements,
  onProceed: () => void,
): void {
  const summary = staleStorageSummary()
  if (summary.itemCount === 0) {
    onProceed()
    return
  }

  showInfoGate(elements, staleDataGateContent(summary), () => {
    clearStaleStorageVersions()
    onProceed()
  })
}
