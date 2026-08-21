import { useEffect } from "react";

/**
 * Keeps the `--vvh` CSS custom property in sync with `window.visualViewport`.
 *
 * iOS Safari doesn't shrink the layout viewport when the on-screen keyboard
 * opens — only `visualViewport` shrinks. Anything sized off `height: 100%`
 * (which resolves against the layout viewport) sits partly behind the
 * keyboard. Consumers use `height: var(--vvh, 100%)` so they track the
 * actually-visible area instead.
 */
export function useVisualViewportHeight() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const set = () => {
      document.documentElement.style.setProperty("--vvh", `${vv.height}px`);
    };
    set();
    vv.addEventListener("resize", set);
    vv.addEventListener("scroll", set);
    return () => {
      vv.removeEventListener("resize", set);
      vv.removeEventListener("scroll", set);
    };
  }, []);
}
