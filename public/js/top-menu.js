"use strict";

(function initTopMenus() {
  const menus = Array.from(document.querySelectorAll("details.top-menu"));

  if (menus.length === 0) {
    return;
  }

  function closeOtherMenus(activeMenu) {
    menus.forEach((menu) => {
      if (menu !== activeMenu) {
        menu.removeAttribute("open");
      }
    });
  }

  menus.forEach((menu) => {
    menu.addEventListener("toggle", () => {
      if (menu.open) {
        closeOtherMenus(menu);
      }
    });
  });

  document.addEventListener("click", (event) => {
    const target = event.target;

    if (!(target instanceof Node)) {
      return;
    }

    menus.forEach((menu) => {
      if (menu.open && !menu.contains(target)) {
        menu.removeAttribute("open");
      }
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    menus.forEach((menu) => {
      menu.removeAttribute("open");
    });
  });
})();
