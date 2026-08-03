/**
 * Directional hit feedback.
 *
 * A hit knocks a file loose, which is the most expensive thing that happens in
 * this game, and the only signal it used to give was a camera kick and a line
 * of text. Since most of what shoots you is off screen, "something hit me" left
 * you turning on the spot looking for it. This says which way.
 *
 * The camera never yaws — `CameraRig` parks it directly along +Z from the
 * player at a fixed pitch — so a world bearing maps to a screen bearing with no
 * projection at all: world +X is screen right, world +Z is screen down.
 */

const ARC_COUNT = 3;
const ARC_MS = 700;
const FLASH_MS = 320;

export class DamageOverlay {
  private readonly root: HTMLDivElement;
  private readonly flash: HTMLDivElement;
  private readonly arcs: HTMLDivElement[] = [];
  private next = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:absolute; inset:0; pointer-events:none; overflow:hidden;';

    // Undirected red vignette — reads instantly in peripheral vision, and it is
    // what carries the message when the hit came from directly on top of you.
    this.flash = document.createElement('div');
    this.flash.style.cssText = `position:absolute; inset:0; opacity:0;
       background:radial-gradient(ellipse at 50% 50%, transparent 42%, rgba(248,113,113,.42) 100%);
       transition:opacity ${FLASH_MS}ms ease-out;`;
    this.root.appendChild(this.flash);

    // Pooled: overlapping hits should stack rather than cut each other off.
    for (let i = 0; i < ARC_COUNT; i++) {
      const arc = document.createElement('div');
      arc.style.cssText = `position:absolute; left:50%; top:50%; width:220vmax; height:220vmax;
         margin:-110vmax 0 0 -110vmax; opacity:0; will-change:opacity, transform;
         background:conic-gradient(from -26deg, rgba(248,113,113,.72) 0deg,
                                   rgba(248,113,113,.28) 30deg, transparent 52deg);
         -webkit-mask-image:radial-gradient(closest-side, transparent 62%, #000 92%);
         mask-image:radial-gradient(closest-side, transparent 62%, #000 92%);`;
      this.root.appendChild(arc);
      this.arcs.push(arc);
    }

    parent.appendChild(this.root);
  }

  /**
   * @param dirX/dirZ world direction from the player toward whatever hit them.
   * Zero-length (a hit with no locatable source) still flashes, just without
   * an arc — better than pointing somewhere arbitrary.
   */
  hit(dirX: number, dirZ: number): void {
    this.flash.style.transition = 'none';
    this.flash.style.opacity = '1';
    requestAnimationFrame(() => {
      this.flash.style.transition = `opacity ${FLASH_MS}ms ease-out`;
      this.flash.style.opacity = '0';
    });

    if (dirX === 0 && dirZ === 0) return;
    const angle = (Math.atan2(dirZ, dirX) * 180) / Math.PI;

    const arc = this.arcs[this.next];
    this.next = (this.next + 1) % ARC_COUNT;
    arc.style.transition = 'none';
    arc.style.transform = `rotate(${angle.toFixed(1)}deg)`;
    arc.style.opacity = '1';
    requestAnimationFrame(() => {
      arc.style.transition = `opacity ${ARC_MS}ms ease-out`;
      arc.style.opacity = '0';
    });
  }

  dispose(): void {
    this.root.remove();
  }
}
