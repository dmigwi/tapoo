import { APP_VERSION } from "./app/version"

declare const __TAPOO_BUILD_YEAR__: number

// applyPageVersion keeps shared page chrome in sync with the semantic version injected at build time.
function applyPageVersion(): void {
  const versionCopies = document.querySelectorAll<HTMLElement>("[data-page-version]")
  for (const element of versionCopies) {
    element.textContent = `v${APP_VERSION} © ${__TAPOO_BUILD_YEAR__} Tapoo`
  }
}

applyPageVersion()
