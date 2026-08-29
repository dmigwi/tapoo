import { INFO_GATE_NOTICES } from "./config"
import { showInfoGate } from "./info-gate"
import { clearStaleTapooLogDatabases } from "./storage-logs"
import {
  clearStaleStorageVersions,
  privacyPolicyAcknowledged,
  savePrivacyPolicyAcknowledgement,
  staleStorageSummary,
} from "./storage"

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

// requireAcknowledgement is the single entry point the page boot calls: it runs onProceed once every
// gate that applies has been answered, and never before. Callers ask "may the game start" and get
// one answer, rather than having to know which gates exist or how many there are - adding a third
// gate is an edit here, not at every call site.
//
// The order is deliberate. The privacy policy gate is acknowledged first because the
// stale-data gate deletes data, and deleting is itself something done with a user's data: doing it
// before they have accepted the policy that governs it would be acting first and asking afterwards.
// Consent, then the operation it covers. Running them in sequence rather than together also keeps
// each question answerable on its own - the overlay shows one gate at a time, and two stacked
// acknowledgements read as one prompt with two buttons.
//
// Both gates are pass-through when they do not apply, so an ordinary start with acknowledged
// storage and no stale keys reaches onProceed synchronously, with no overlay frame in between.
//
// Each gate answers "is this already satisfied": true means carry on, false means it has put an
// overlay up and this pass stops there. Answering one re-enters here from the top rather than
// continuing where it left off, so the gates are re-evaluated in order every time and a gate can
// never be skipped because an earlier one happened to run first. The recursion terminates because
// every pass either satisfies a gate for good or stops at the one it showed.
export function requireAcknowledgement(
  elements: Elements,
  onProceed: () => void,
): void {
  // Restarts this function rather than resuming after the gate that called it, so answering one
  // question re-asks every question in order and no gate can be passed over just incase new
  // changes were introduced in the midist of resolving the gates.
  const recheck = (): void => requireAcknowledgement(elements, onProceed)

  if (!requirePrivacyPolicyAcknowledgement(elements, recheck)) {
    return
  }

  if (!requireStaleDataAcknowledgement(elements, recheck)) {
    return
  }

  onProceed()
}

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
function requireStaleDataAcknowledgement(
  elements: Elements,
  onAcknowledged: () => void,
): boolean {
  const summary = staleStorageSummary()
  if (summary.itemCount === 0) {
    return true
  }

  showInfoGate(elements, staleDataGateContent(summary), () => {
    clearStaleStorageVersions()
    // Not awaited, and deliberately after the synchronous clear: the Tapoo Logs database an older
    // version wrote is removed on the same confirmation, but a delete that another tab is blocking
    // must not hold the game behind a tab the user may never close. Its own failures resolve rather
    // than reject, so nothing here can leave the gate unanswered.
    void clearStaleTapooLogDatabases(summary.versions)
    onAcknowledged()
  })
  // False, because the answer is not in yet: returning true here would let the caller start the
  // game behind an overlay the user has not answered.
  return false
}

// privacyPolicyGateContent adapts the privacy notice to the reusable info-gate shape.
function privacyPolicyGateContent(): InfoGateContent {
  const notice = INFO_GATE_NOTICES.privacyPolicy
  return {
    title: notice.title,
    message: notice.acknowledgement,
    detail: notice.detail,
    link: notice.link,
    proceedLabel: notice.proceedLabel,
  }
}

// requirePrivacyPolicyAcknowledgement holds gameplay until the player has acknowledged, once per
// browser profile, that Tapoo keeps data on their device. It covers everything Tapoo stores rather
// than one mechanism: the gate was raised when logs moved to IndexedDB, but progress and agent
// configuration were already being kept, and the answer does not change if a backend does.
function requirePrivacyPolicyAcknowledgement(
  elements: Elements,
  onAcknowledged: () => void,
): boolean {
  if (privacyPolicyAcknowledged()) {
    return true
  }

  showInfoGate(elements, privacyPolicyGateContent(), () => {
    savePrivacyPolicyAcknowledgement()
    onAcknowledged()
  })
  return false
}
