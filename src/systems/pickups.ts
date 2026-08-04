import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  Scene,
  Sprite,
  SpriteMaterial,
} from 'three';
import { createWeaponModel } from '../render/weapon-models';
import { PALETTE } from '../render/palette';
import { WEAPONS, type WeaponId } from './weapons';
import type { Spot } from '../world/arena';

const PICKUP_RADIUS = 1.6;
/** Dropped loot clears itself up; placed route weapons never expire. */
const DROP_LIFETIME = 30;

export type PickupKind = 'weapon' | 'ammo' | 'health';

/**
 * A union rather than one shape with optional fields: a medkit has no weapon
 * id and a weapon has no round count, and letting the type say so is what stops
 * `rounds: 0` being passed around as a placeholder nobody reads.
 */
export type PickupOffer =
  | { readonly kind: 'weapon'; readonly id: WeaponId }
  | { readonly kind: 'ammo'; readonly id: WeaponId; readonly rounds: number }
  | { readonly kind: 'health'; readonly amount: number };

interface Pickup {
  offer: PickupOffer;
  x: number;
  z: number;
  group: Group;
  model: Group;
  label: Sprite;
  taken: boolean;
  fade: number;
  /** Infinity for route weapons. */
  life: number;
  wasInside: boolean;
}

/** Medkits are the one pickup that isn't about a gun, so they get their own colour. */
const HEALTH_TINT = PALETTE.player;

function tintOf(offer: PickupOffer): number {
  return offer.kind === 'health' ? HEALTH_TINT : WEAPONS[offer.id].tint;
}

function labelOf(offer: PickupOffer): string {
  if (offer.kind === 'health') return `medkit +${offer.amount}`;
  if (offer.kind === 'weapon') return WEAPONS[offer.id].name;
  return `${WEAPONS[offer.id].name} ×${offer.rounds}`;
}

/**
 * Weapons and ammo on the ground.
 *
 * Route weapons are placed at waypoints — an upgrade should be something you
 * see ahead and walk to. Loot dropped by the dead lands where they fell and
 * expires, so the map doesn't slowly silt up with old boxes.
 */
export class PickupSystem {
  private readonly pickups: Pickup[] = [];

  constructor(
    private readonly scene: Scene,
    /**
     * Return false to refuse the pickup — it stays on the ground. That's how
     * ammo for a weapon you don't own is handled: you can see the shells, you
     * just can't do anything with them yet.
     */
    private readonly onCollect: (offer: PickupOffer, firstTouch: boolean) => boolean,
  ) {}

  place(offer: PickupOffer, spot: Spot, permanent = false): void {
    const tint = tintOf(offer);
    const group = new Group();

    const pad = new Mesh(
      new CylinderGeometry(PICKUP_RADIUS, PICKUP_RADIUS, 0.08, 28),
      new MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.16 }),
    );
    pad.position.y = 0.05;

    const ring = new Mesh(
      new CylinderGeometry(PICKUP_RADIUS, PICKUP_RADIUS * 0.92, 0.5, 28, 1, true),
      new MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    ring.position.y = 0.28;

    // Three silhouettes, so what a pickup is reads before the label does: the
    // gun itself, a stubby crate of shells, or a cross.
    const model =
      offer.kind === 'weapon'
        ? createWeaponModel(offer.id)
        : offer.kind === 'ammo'
          ? createAmmoModel(tint)
          : createHealthModel(tint);
    const height = MODEL_HEIGHT[offer.kind];
    model.position.y = height;
    model.scale.setScalar(offer.kind === 'weapon' ? 1.15 : 1);

    const label = new Sprite(
      new SpriteMaterial({
        map: labelTexture(labelOf(offer), offer.kind),
        transparent: true,
        depthTest: false,
      }),
    );
    label.scale.set(3.4, 0.85, 1);
    label.position.y = offer.kind === 'weapon' ? 2.2 : 1.8;
    label.center.set(0.5, 0);

    group.add(pad, ring, model, label);
    group.position.set(spot.x, 0, spot.z);
    this.scene.add(group);

    this.pickups.push({
      offer,
      x: spot.x,
      z: spot.z,
      group,
      model,
      label,
      taken: false,
      fade: 1,
      life: permanent ? Infinity : DROP_LIFETIME,
      wasInside: false,
    });
  }

  update(dt: number, time: number, playerX: number, playerZ: number): void {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pickup = this.pickups[i];

      if (pickup.taken) {
        // Rise and fade, so collecting one is visibly acknowledged.
        pickup.fade -= dt * 2.4;
        pickup.group.position.y += dt * 3;
        pickup.group.scale.setScalar(Math.max(0.01, pickup.fade));
        if (pickup.fade <= 0) this.remove(i);
        continue;
      }

      pickup.life -= dt;
      if (pickup.life <= 0) {
        this.remove(i);
        continue;
      }
      // Blink out the last few seconds so its disappearing isn't a surprise.
      if (pickup.life < 5) {
        pickup.group.visible = Math.sin(time * 14) > -0.35;
      }

      pickup.model.rotation.y = time * 1.2;
      pickup.model.position.y =
        MODEL_HEIGHT[pickup.offer.kind] + Math.sin(time * 2 + pickup.x) * 0.12;

      const inside = Math.hypot(playerX - pickup.x, playerZ - pickup.z) <= PICKUP_RADIUS;
      if (inside && this.onCollect(pickup.offer, !pickup.wasInside)) {
        pickup.taken = true;
      }
      pickup.wasInside = inside;
    }
  }

  private remove(index: number): void {
    this.scene.remove(this.pickups[index].group);
    this.pickups.splice(index, 1);
  }
}

/** How high above the pad each silhouette floats. */
const MODEL_HEIGHT: Record<PickupKind, number> = { weapon: 1.1, ammo: 0.85, health: 0.9 };

/** A cross on a dark case — the one pickup that has nothing to do with guns. */
function createHealthModel(tint: number): Group {
  const group = new Group();
  const material = new MeshStandardMaterial({
    color: tint,
    emissive: tint,
    emissiveIntensity: 0.55,
    flatShading: true,
  });
  const bar = new BoxGeometry(0.52, 0.16, 0.16);
  const stem = new BoxGeometry(0.16, 0.16, 0.52);
  const across = new Mesh(bar, material);
  const down = new Mesh(stem, material);

  const shell = new Mesh(
    new BoxGeometry(0.62, 0.34, 0.62),
    new MeshStandardMaterial({ color: 0x121a21, roughness: 0.75, flatShading: true }),
  );
  shell.position.y = -0.12;
  shell.castShadow = true;

  group.add(shell, across, down);
  return group;
}

function createAmmoModel(tint: number): Group {
  const group = new Group();
  const crate = new Mesh(
    new BoxGeometry(0.55, 0.3, 0.4),
    new MeshStandardMaterial({ color: 0x1a2129, roughness: 0.7, flatShading: true }),
  );
  const band = new Mesh(
    new BoxGeometry(0.58, 0.09, 0.43),
    new MeshStandardMaterial({
      color: tint,
      emissive: tint,
      emissiveIntensity: 0.5,
      flatShading: true,
    }),
  );
  band.position.y = 0.06;
  // A couple of shells poking out of the top.
  for (const offset of [-0.12, 0.12]) {
    const shell = new Mesh(
      new CylinderGeometry(0.05, 0.05, 0.22, 6),
      new MeshStandardMaterial({ color: tint, emissive: tint, emissiveIntensity: 0.35 }),
    );
    shell.position.set(offset, 0.22, 0);
    group.add(shell);
  }
  crate.castShadow = true;
  group.add(crate, band);
  return group;
}

function labelTexture(text: string, kind: PickupKind): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 340;
  canvas.height = 80;
  const ctx = canvas.getContext('2d')!;
  ctx.font = `bold ${kind === 'weapon' ? 30 : 24}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,.95)';
  ctx.shadowBlur = 10;
  ctx.fillStyle = kind === 'weapon' ? '#eaf6ff' : kind === 'health' ? '#b6f5cd' : '#c3d3d0';
  ctx.fillText(text.toUpperCase(), canvas.width / 2, canvas.height / 2);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  return texture;
}
