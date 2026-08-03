import { CircleGeometry, Group, Mesh, MeshBasicMaterial, RingGeometry } from 'three';
import { PALETTE } from './palette';

/**
 * Ground-projected aim reticle. On a top-down camera the mouse cursor lies —
 * it's in screen space, the shot is in world space. Drawing the actual ground
 * point removes the ambiguity.
 */
export function createReticle(): Group {
  const group = new Group();
  group.name = 'reticle';

  const ringMaterial = new MeshBasicMaterial({
    color: PALETTE.player,
    transparent: true,
    opacity: 0.75,
    depthTest: false,
  });
  const ring = new Mesh(new RingGeometry(0.44, 0.56, 28), ringMaterial);
  ring.rotation.x = -Math.PI / 2;

  const dot = new Mesh(
    new CircleGeometry(0.1, 12),
    new MeshBasicMaterial({ color: PALETTE.muzzle, depthTest: false, transparent: true, opacity: 0.9 }),
  );
  dot.rotation.x = -Math.PI / 2;

  group.add(ring, dot);
  group.position.y = 0.05;
  group.renderOrder = 999;
  return group;
}
