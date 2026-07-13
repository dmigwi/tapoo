// initTopMenus keeps the shared top-bar menus expanded on desktop and collapsible on compact screens.
function initTopMenus(): void {
  const menus = Array.from(document.querySelectorAll<HTMLDetailsElement>("details.top-menu"))
  const compactViewport = window.matchMedia("(max-width: 900px)")

  if (menus.length === 0) {
    return
  }

  // isCompactMode centralizes the breakpoint used by the menu behavior.
  function isCompactMode(): boolean {
    return compactViewport.matches
  }

  // closeMenu hides one details menu without duplicating attribute writes.
  function closeMenu(menu: HTMLDetailsElement): void {
    menu.open = false
  }

  // syncMenuMode expands menus on wide screens and collapses them on compact ones.
  function syncMenuMode(): void {
    for (const menu of menus) {
      menu.open = !isCompactMode()
    }
  }

  // closeOtherMenus preserves a single open menu in compact mode.
  function closeOtherMenus(activeMenu: HTMLDetailsElement): void {
    for (const menu of menus) {
      if (menu !== activeMenu) {
        closeMenu(menu)
      }
    }
  }

  for (const menu of menus) {
    menu.addEventListener("toggle", () => {
      if (isCompactMode() && menu.open) {
        closeOtherMenus(menu)
      }
    })
  }

  document.addEventListener("click", (event: MouseEvent) => {
    if (!isCompactMode()) {
      return
    }

    const target = event.target
    if (!(target instanceof Node)) {
      return
    }

    for (const menu of menus) {
      if (menu.open && !menu.contains(target)) {
        closeMenu(menu)
      }
    }
  })

  document.addEventListener("keydown", (event: KeyboardEvent) => {
    if (!isCompactMode()) {
      return
    }

    if (event.key !== "Escape") {
      return
    }

    for (const menu of menus) {
      closeMenu(menu)
    }
  })

  compactViewport.addEventListener("change", syncMenuMode)
  syncMenuMode()
}

initTopMenus()
