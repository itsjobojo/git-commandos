/**
 * Corner readout. Exists so M1 can be judged on numbers as well as feel —
 * frame time, speed, and whether the fixed step is keeping up.
 */
export class DebugOverlay {
  private readonly el: HTMLDivElement;
  private visible = true;
  private accum = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.style.cssText = [
      'position:absolute',
      'top:12px',
      'left:14px',
      'font:11px/1.55 var(--font-mono)',
      'color:var(--dim)',
      'white-space:pre',
      'text-shadow:0 1px 0 #000',
      'pointer-events:none',
    ].join(';');
    parent.appendChild(this.el);

    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3' || (e.code === 'Backquote' && !e.repeat)) {
        this.visible = !this.visible;
        this.el.style.display = this.visible ? 'block' : 'none';
      }
    });
  }

  update(realDt: number, lines: () => string): void {
    if (!this.visible) return;
    // Throttle DOM writes — this is a debug readout, not a HUD.
    this.accum += realDt;
    if (this.accum < 0.1) return;
    this.accum = 0;
    this.el.textContent = lines();
  }
}
