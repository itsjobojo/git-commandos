import {
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  RingGeometry,
  Scene,
} from 'three';
import { PALETTE } from '../render/palette';

const FUSE_SECONDS = 2.2;
const ARC_HEIGHT = 7;
/**
 * Blast radius — and exactly what the ground marker draws.
 *
 * The ring has to be the truth about who gets hit. It previously showed one
 * size while detonation ignored distance entirely and opened an invite
 * wherever you were standing, which made the telegraph a lie.
 */
export const BLAST_RADIUS = 4.2;

interface Bomb {
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  t: number;
  flight: number;
  fuse: number;
  landed: boolean;
  group: Group;
  shell: Mesh;
  marker: Mesh;
}

/**
 * Invite bombs.
 *
 * The invite swarm lobs these at your feet. They arc, land, and telegraph on a
 * fuse with a ground marker, and when one goes off it opens a meeting invite
 * over the whole screen. The arc and the fuse exist so it's dodgeable in
 * principle and always your fault in practice.
 */
export class BombSystem {
  private readonly bombs: Bomb[] = [];

  constructor(
    private readonly scene: Scene,
    /** Fired when a bomb detonates, at its landing point. */
    private readonly onDetonate: (x: number, z: number) => void,
  ) {}

  get liveCount(): number {
    return this.bombs.length;
  }

  throwAt(fromX: number, fromZ: number, toX: number, toZ: number): void {
    const group = new Group();

    const shell = new Mesh(
      new OctahedronGeometry(0.55, 0),
      new MeshStandardMaterial({
        color: PALETTE.invite,
        emissive: PALETTE.invite,
        emissiveIntensity: 0.6,
        flatShading: true,
      }),
    );
    shell.castShadow = true;

    // Ground marker so the landing spot is readable before it gets there.
    const marker = new Mesh(
      new RingGeometry(BLAST_RADIUS - 0.35, BLAST_RADIUS, 40),
      new MeshBasicMaterial({ color: PALETTE.invite, transparent: true, opacity: 0.6 }),
    );
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(toX, 0.06, toZ);

    group.add(shell);
    this.scene.add(group, marker);

    const distance = Math.hypot(toX - fromX, toZ - fromZ);
    this.bombs.push({
      fromX,
      fromZ,
      toX,
      toZ,
      t: 0,
      // Longer throws hang longer, so the arc reads as a real lob.
      flight: Math.max(0.5, Math.min(1.6, distance / 14)),
      fuse: FUSE_SECONDS,
      landed: false,
      group,
      shell,
      marker,
    });
  }

  update(dt: number, time: number): void {
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const bomb = this.bombs[i];

      if (!bomb.landed) {
        bomb.t += dt / bomb.flight;
        const t = Math.min(1, bomb.t);
        const x = bomb.fromX + (bomb.toX - bomb.fromX) * t;
        const z = bomb.fromZ + (bomb.toZ - bomb.fromZ) * t;
        // Simple parabola — peaks at the midpoint of the throw.
        const y = 1 + Math.sin(t * Math.PI) * ARC_HEIGHT;
        bomb.group.position.set(x, y, z);
        bomb.shell.rotation.set(time * 4, time * 5, 0);
        if (t >= 1) bomb.landed = true;
        continue;
      }

      bomb.fuse -= dt;
      const urgency = 1 - Math.max(0, bomb.fuse) / FUSE_SECONDS;
      // Pulse faster and swell as the fuse runs down.
      const pulse = 0.5 + 0.5 * Math.sin(time * (8 + urgency * 40));
      bomb.group.position.set(bomb.toX, 0.6 + pulse * 0.12, bomb.toZ);
      bomb.shell.scale.setScalar(1 + urgency * 0.5 + pulse * 0.18);
      (bomb.marker.material as MeshBasicMaterial).opacity = 0.35 + pulse * 0.5;
      // Shrinks toward the true blast edge rather than past it.
      bomb.marker.scale.setScalar(1 - urgency * 0.12);

      if (bomb.fuse <= 0) {
        this.onDetonate(bomb.toX, bomb.toZ);
        this.remove(i);
      }
    }
  }

  private remove(index: number): void {
    const bomb = this.bombs[index];
    this.scene.remove(bomb.group, bomb.marker);
    this.bombs.splice(index, 1);
  }

  clear(): void {
    for (let i = this.bombs.length - 1; i >= 0; i--) this.remove(i);
  }
}
