/**
 * Shared DOM chrome. The HUD is DOM, not canvas — text stays crisp at any DPI,
 * filenames wrap and ellipsise for free, and none of it costs a draw call.
 */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  css: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.style.cssText = css;
  if (text !== undefined) node.textContent = text;
  return node;
}

export const CSS = {
  fullscreen: `
    position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
    background:radial-gradient(ellipse at 50% 40%, rgba(12,20,26,.82), rgba(3,5,8,.96));
    backdrop-filter:blur(3px);
  `,
  panel: `
    min-width:min(560px, 90vw); max-width:760px; padding:26px 30px;
    border:1px solid #24343f; border-radius:3px; background:rgba(8,12,17,.94);
    box-shadow:0 24px 80px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.03);
    font:13px/1.65 var(--font-mono);
  `,
  label: `color:#5c7180; font-size:11px; letter-spacing:.14em; text-transform:uppercase;`,
  rule: `height:1px; background:#1c2a34; margin:16px 0;`,
  key: `
    display:inline-block; padding:1px 7px; margin:0 2px; border:1px solid #2f4351;
    border-radius:2px; color:#9fb4c0; font-size:11px;
  `,
} as const;

/** Fade a node in on the next frame. */
export function fadeIn(node: HTMLElement, ms = 220): void {
  node.style.opacity = '0';
  node.style.transition = `opacity ${ms}ms ease`;
  requestAnimationFrame(() => {
    node.style.opacity = '1';
  });
}

/**
 * Resolve when the user presses one of `codes` or clicks `clickTarget`.
 *
 * `minDelayMs` swallows input for a moment after the screen appears. A screen
 * that gates real file loss must not be dismissable by a click that was
 * already in flight when it opened — and the click target is a specific
 * button, never the whole backdrop, for the same reason.
 *
 * `enabled` gates the same thing for as long as the caller needs: a screen that
 * has opened a sub-panel over itself is still listening, and without this the
 * Enter that was meant to close the sub-panel deploys the run behind it.
 */
export function waitForKey(
  codes: string[],
  clickTarget?: HTMLElement,
  minDelayMs = 300,
  enabled: () => boolean = () => true,
): Promise<void> {
  return new Promise((resolve) => {
    const readyAt = performance.now() + minDelayMs;

    const done = (): void => {
      window.removeEventListener('keydown', onKey);
      clickTarget?.removeEventListener('click', onClick);
      resolve();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (performance.now() < readyAt || !enabled()) return;
      if (codes.includes(e.code)) {
        e.preventDefault();
        done();
      }
    };
    const onClick = (): void => {
      if (performance.now() < readyAt || !enabled()) return;
      done();
    };

    window.addEventListener('keydown', onKey);
    clickTarget?.addEventListener('click', onClick);
  });
}
