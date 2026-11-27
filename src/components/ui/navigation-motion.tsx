"use client";

import { useEffect, useLayoutEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export function NavigationMotion() {
  const path = usePathname();
  const query = useSearchParams().toString();

  useLayoutEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const target = document.querySelector("[data-route-content]") ?? document.querySelector("main");
    const entry = target?.animate(
      [{ opacity: 0.55, translate: "0 6px" }, { opacity: 1, translate: "0 0" }],
      { duration: 240, easing: "cubic-bezier(.2,.75,.3,1)" },
    );
    return () => entry?.cancel();
  }, [path, query]);

  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    function press(event: MouseEvent) {
      if (reduced.matches || !(event.target instanceof Element)) return;
      const control = event.target.closest("button, a[href], summary, [role=button], [role=tab], [role=menuitem]");
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
