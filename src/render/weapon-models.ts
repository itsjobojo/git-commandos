import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { WEAPONS, type WeaponId } from '../systems/weapons';

/**
 * Low-poly weapon models, built to read from directly overhead.
 *
 * The camera only ever sees these from above, so the whole job is silhouette
 * *length and width* — a pistol stub, a long boxy SMG with a magazine hanging
 * off it, a fat double-barrel. Detail below the top face is wasted, but the
 * accent block on each one carries the colour that also tints its tracers, so
 * you can tell what you're holding without reading the HUD.
 */
export function createWeaponModel(id: WeaponId): Group {
  const group = new Group();
  const metal = new MeshStandardMaterial({
    color: 0x151a20,
    roughness: 0.55,
    metalness: 0.35,
    flatShading: true,
  });
  const accent = new MeshStandardMaterial({
    color: WEAPONS[id].tint,
    emissive: WEAPONS[id].tint,
    emissiveIntensity: 0.45,
    roughness: 0.5,
    flatShading: true,
  });

  switch (id) {
    case 'pistol': {
      const body = new Mesh(new BoxGeometry(0.62, 0.15, 0.12), metal);
      body.position.x = 0.2;
      const slide = new Mesh(new BoxGeometry(0.3, 0.08, 0.1), accent);
      slide.position.set(0.08, 0.1, 0);
      const grip = new Mesh(new BoxGeometry(0.14, 0.26, 0.11), metal);
      grip.position.set(-0.05, -0.16, 0);
      grip.rotation.z = 0.22;
      group.add(body, slide, grip);
      break;
    }
    case 'smg': {
      const body = new Mesh(new BoxGeometry(1.05, 0.16, 0.13), metal);
      body.position.x = 0.36;
      const barrel = new Mesh(new CylinderGeometry(0.05, 0.05, 0.34, 8), metal);
      barrel.rotation.z = Math.PI / 2;
      barrel.position.set(0.98, 0, 0);
      // The magazine is the tell — a long box hanging under the receiver.
      const mag = new Mesh(new BoxGeometry(0.16, 0.34, 0.1), accent);
      mag.position.set(0.12, -0.22, 0);
      const stock = new Mesh(new BoxGeometry(0.3, 0.13, 0.1), metal);
      stock.position.set(-0.2, -0.02, 0);
      const rail = new Mesh(new BoxGeometry(0.5, 0.05, 0.08), accent);
      rail.position.set(0.42, 0.1, 0);
      group.add(body, barrel, mag, stock, rail);
      break;
    }
    case 'shotgun': {
      const body = new Mesh(new BoxGeometry(1.25, 0.18, 0.2), metal);
      body.position.x = 0.42;
      // Double barrel: two cylinders side by side, which is the silhouette
      // that reads instantly from above.
      for (const offset of [-0.07, 0.07]) {
        const barrel = new Mesh(new CylinderGeometry(0.062, 0.062, 0.62, 8), metal);
        barrel.rotation.z = Math.PI / 2;
        barrel.position.set(1.02, 0.02, offset);
        group.add(barrel);
      }
      const pump = new Mesh(new BoxGeometry(0.28, 0.13, 0.22), accent);
      pump.position.set(0.68, -0.08, 0);
      const stock = new Mesh(new BoxGeometry(0.36, 0.2, 0.14), metal);
      stock.position.set(-0.18, -0.06, 0);
      stock.rotation.z = -0.12;
      group.add(body, pump, stock);
      break;
    }
  }

  group.traverse((node) => {
    if (node instanceof Mesh) node.castShadow = true;
  });
  return group;
}
