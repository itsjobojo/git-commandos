import { AmbientLight, DirectionalLight, HemisphereLight, Scene, Vector3 } from 'three';
import { PALETTE } from './palette';

/**
 * One shadow-casting directional light with a tight ortho frustum that follows
 * the player, plus flat fill. No CSM, no shadow-casting point lights — the
 * budget goes to bloom and emissives instead.
 */
export class Lighting {
  readonly sun: DirectionalLight;
  private readonly hemi: HemisphereLight;
  private readonly ambient: AmbientLight;
  /** Sun direction, from target toward the light. */
  private readonly offset = new Vector3(-18, 34, 14);

  constructor(scene: Scene, shadowRadius = 34) {
    this.sun = new DirectionalLight(0xdfeaff, 2.4);
    this.sun.position.copy(this.offset);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);

    const cam = this.sun.shadow.camera;
    cam.near = 1;
    cam.far = 110;
    cam.left = -shadowRadius;
    cam.right = shadowRadius;
    cam.top = shadowRadius;
    cam.bottom = -shadowRadius;
    cam.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0012;
    this.sun.shadow.normalBias = 0.03;

    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new HemisphereLight(0x9fc4ff, PALETTE.floor, 0.9);
    scene.add(this.hemi);

    this.ambient = new AmbientLight(0x8ea6c0, 0.5);
    scene.add(this.ambient);
  }

  /** Keep the shadow frustum centred on the action. */
  follow(x: number, z: number): void {
    this.sun.target.position.set(x, 0, z);
    this.sun.target.updateMatrixWorld();
    this.sun.position.set(x + this.offset.x, this.offset.y, z + this.offset.z);
  }

  dispose(): void {
    this.sun.dispose();
    this.hemi.dispose();
    this.ambient.dispose();
  }
}
