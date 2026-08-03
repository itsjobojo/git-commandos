import {
  CanvasTexture,
  CylinderGeometry,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  SRGBColorSpace,
  Scene,
  Sprite,
  SpriteMaterial,
} from 'three';
import { createWeaponModel } from '../render/weapon-models';
import { WEAPONS, type WeaponId } from './weapons';
import type { Spot } from '../world/arena';

const PICKUP_RADIUS = 1.6;

interface WeaponPickup {
  id: WeaponId;
  x: number;
  z: number;
  group: Group;
  model: Group;
  taken: boolean;
  fade: number;
}

/**
 * Weapons lying on the route.
 *
 * Placed at waypoints rather than hidden, because the route is the game — an
 * upgrade should be something you see ahead and walk to, not something you go
 * looking for. Each sits on a lit pad with its name floating above so you know
 * what you're about to swap to before you commit.
 */
export class PickupSystem {
  private readonly pickups: WeaponPickup[] = [];

  constructor(
    private readonly scene: Scene,
    private readonly onCollect: (id: WeaponId) => void,
  ) {}

  place(id: WeaponId, spot: Spot): void {
    const spec = WEAPONS[id];
    const group = new Group();

    const pad = new Mesh(
      new CylinderGeometry(PICKUP_RADIUS, PICKUP_RADIUS, 0.08, 28),
      new MeshBasicMaterial({ color: spec.tint, transparent: true, opacity: 0.16 }),
    );
    pad.position.y = 0.05;

    const ring = new Mesh(
      new CylinderGeometry(PICKUP_RADIUS, PICKUP_RADIUS * 0.92, 0.5, 28, 1, true),
      new MeshBasicMaterial({ color: spec.tint, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    ring.position.y = 0.28;

    const model = createWeaponModel(id);
    model.position.y = 1.1;
    model.scale.setScalar(1.15);

    const label = new Sprite(
      new SpriteMaterial({ map: labelTexture(spec.name), transparent: true, depthTest: false }),
    );
    label.scale.set(3.2, 0.8, 1);
    label.position.y = 2.2;
    label.center.set(0.5, 0);

    group.add(pad, ring, model, label);
    group.position.set(spot.x, 0, spot.z);
    this.scene.add(group);

    this.pickups.push({ id, x: spot.x, z: spot.z, group, model, taken: false, fade: 1 });
  }

  update(dt: number, time: number, playerX: number, playerZ: number): void {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pickup = this.pickups[i];

      if (pickup.taken) {
        // Rise and fade out, so collecting one is visibly acknowledged.
        pickup.fade -= dt * 2.4;
        pickup.group.position.y += dt * 3;
        pickup.group.scale.setScalar(Math.max(0.01, pickup.fade));
        if (pickup.fade <= 0) {
          this.scene.remove(pickup.group);
          this.pickups.splice(i, 1);
        }
        continue;
      }

      pickup.model.rotation.y = time * 1.2;
      pickup.model.position.y = 1.1 + Math.sin(time * 2 + pickup.x) * 0.12;

      if (Math.hypot(playerX - pickup.x, playerZ - pickup.z) <= PICKUP_RADIUS) {
        pickup.taken = true;
        this.onCollect(pickup.id);
      }
    }
  }
}

function labelTexture(name: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 80;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 30px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,.95)';
  ctx.shadowBlur = 10;
  ctx.fillStyle = '#eaf6ff';
  ctx.fillText(name.toUpperCase(), canvas.width / 2, canvas.height / 2);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  return texture;
}
