function initTopMenus(): void {
  const menus = Array.from(document.querySelectorAll<HTMLDetailsElement>("details.top-menu"))

  if (menus.length === 0) {
    return
  }

  function closeMenu(menu: HTMLDetailsElement): void {
    menu.open = false
  }

  function closeOtherMenus(activeMenu: HTMLDetailsElement): void {
    for (const menu of menus) {
      if (menu !== activeMenu) {
        closeMenu(menu)
      }
    }
  }

  for (const menu of menus) {
    menu.addEventListener("toggle", () => {
      if (menu.open) {
        closeOtherMenus(menu)
      }
    })
  }

  document.addEventListener("click", (event: MouseEvent) => {
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
    if (event.key !== "Escape") {
      return
    }

    for (const menu of menus) {
      closeMenu(menu)
    }
  })
}

initTopMenus()
