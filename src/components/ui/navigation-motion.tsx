"use client";

import { useEffect } from "react";

export function NavigationMotion() {
  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    function press(event: MouseEvent) {
      if (reduced.matches || !(event.target instanceof Element)) return;
      const control = event.target.closest("button, .df-press, summary, [role=button], [role=tab], [role=menuitem]");
      if (!control || control.matches(":disabled, [aria-disabled=true]")) return;
      control.animate(
        [{ opacity: 0.68, scale: "0.98" }, { opacity: 1, scale: "1" }],
        { duration: 180, easing: "ease-out" },
      );
    }
    document.addEventListener("click", press, true);
    return () => document.removeEventListener("click", press, true);
  }, []);

  return null;
}
