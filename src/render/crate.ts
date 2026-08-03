import {
  BoxGeometry,
  CanvasTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';
import { PALETTE } from './palette';

/**
 * The file crate — the object the whole game is about.
 *
 * It carries the real filename, rendered to a canvas texture and laid flat on
 * top so it reads from the top-down camera. That is the point: the thing you
 * are protecting has a name, and you should be able to see which one you just
 * dropped without looking at the HUD.
 */

const SIZE = 0.62;
const labelCache = new Map<string, CanvasTexture>();

export interface CrateVisual {
  group: Group;
  setDecay(t: number): void;
  setTint(hex: number): void;
}

export function createCrateVisual(filename: string, weight: number): CrateVisual {
  const group = new Group();
  // Bigger diffs are bigger crates — you can see which file is the heavy one.
  const scale = 0.85 + Math.min(weight, 1) * 0.55;

  const shell = new Mesh(
    new BoxGeometry(SIZE * scale, SIZE * scale * 0.75, SIZE * scale),
    new MeshStandardMaterial({
      color: PALETTE.crate,
      emissive: PALETTE.crate,
      emissiveIntensity: 0.22,
      roughness: 0.42,
      metalness: 0.15,
      transparent: true,
      opacity: 0.62,
      flatShading: true,
    }),
  );
  shell.castShadow = true;

  // Inner core — the part that pulses faster as the crate decays.
  const core = new Mesh(
    new BoxGeometry(SIZE * scale * 0.45, SIZE * scale * 0.5, SIZE * scale * 0.45),
    new MeshBasicMaterial({ color: PALETTE.crate }),
  );

  const label = new Mesh(
    new PlaneGeometry(SIZE * 2.5, SIZE * 0.62),
    new MeshBasicMaterial({
      map: labelTexture(filename),
      transparent: true,
      depthWrite: false,
      opacity: 0.95,
    }),
  );
  label.rotation.x = -Math.PI / 2;
  label.position.y = SIZE * scale * 0.42;

  group.add(shell, core, label);

  const shellMat = shell.material as MeshStandardMaterial;
  const coreMat = core.material as MeshBasicMaterial;

  return {
    group,
    /** @param t 0 = fresh, 1 = about to be lost. */
    setDecay(t: number) {
      const urgency = Math.max(0, Math.min(1, t));
      // Pulse rate climbs with urgency — a crate about to expire is visibly frantic.
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.001 * (3 + urgency * 22));
      coreMat.color.setHex(urgency > 0 ? PALETTE.crateDecay : PALETTE.crate);
      coreMat.opacity = 1;
      shellMat.emissiveIntensity = 0.2 + pulse * urgency * 0.9;
      shellMat.color.setHex(urgency > 0.55 ? PALETTE.crateDecay : PALETTE.crate);
    },
    setTint(hex: number) {
      shellMat.color.setHex(hex);
      shellMat.emissive.setHex(hex);
      coreMat.color.setHex(hex);
    },
  };
}

/**
 * Filenames are drawn at runtime rather than baked into art, so the label is
 * always the user's actual file and adding one costs nothing.
 */
function labelTexture(filename: string): CanvasTexture {
  const cached = labelCache.get(filename);
  if (cached) return cached;

  const short = filename.slice(filename.lastIndexOf('/') + 1);
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = 'bold 30px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Fit long names rather than clipping them.
  let text = short;
  while (ctx.measureText(text).width > canvas.width - 16 && text.length > 4) {
    text = `${text.slice(0, text.length - 5)}…`;
  }

  ctx.shadowColor = 'rgba(0,0,0,.9)';
  ctx.shadowBlur = 8;
  ctx.fillStyle = '#eaf6ff';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  labelCache.set(filename, texture);
  return texture;
}
