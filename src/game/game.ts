import { Fog, Group, Scene, Vector3, WebGLRenderer } from 'three';
import { Loop } from '../core/loop';
import { Input } from '../core/input';
import { Rng } from '../core/rng';
import { Time } from '../core/time';
import { createRenderer, fitToWindow } from '../render/renderer';
import { CameraRig } from '../render/camera';
import { Lighting } from '../render/lighting';
import { createFloor } from '../render/floor';
import { createReticle } from '../render/reticle';
import { PALETTE } from '../render/palette';
import { buildTestArena, type BuiltMap } from '../world/arena';
import { Player } from '../entities/player';
import { DebugOverlay } from '../ui/debug';

export interface GameOptions {
  /** Mission seed — derived from the commit message once the git spine lands. */
  seed?: string | number;
}

/**
 * Orchestration only.
 *
 * `Game` owns the scene graph, the loop and the order systems run in. It does
 * not contain gameplay rules — no collision maths, no damage, no crate
 * lifecycle. That separation is the whole reason for this rebuild; the
 * previous incarnation was a 1400-line `game.ts` that owned everything.
 */
export class Game {
  private readonly scene = new Scene();
  private readonly renderer: WebGLRenderer;
  private readonly rig: CameraRig;
  private readonly lighting: Lighting;
  private readonly input: Input;
  private readonly loop: Loop;
  private readonly debug: DebugOverlay;
  private readonly rng: Rng;

  private readonly map: BuiltMap;
  private readonly player: Player;
  private readonly reticle: Group;
  private readonly floor;

  private readonly aim = new Vector3();
  private readonly renderPos = new Vector3();
  private disposeResize: () => void;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement, options: GameOptions = {}) {
    this.rng = new Rng(options.seed ?? 'sandbox');

    this.renderer = createRenderer(canvas);
    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    this.disposeResize = fitToWindow(this.renderer, (w, h) => this.rig.resize(w, h));

    this.scene.fog = new Fog(PALETTE.fog, 28, 82);
    this.lighting = new Lighting(this.scene);

    this.map = buildTestArena(this.rng);
    this.scene.add(this.map.group);

    this.floor = createFloor(this.map.grid.width, this.map.grid.depth);
    this.scene.add(this.floor);

    this.player = new Player(this.map.grid);
    this.player.setPosition(this.map.spawn.x, this.map.spawn.z);
    this.scene.add(this.player.object!);

    this.reticle = createReticle();
    this.scene.add(this.reticle);

    this.input = new Input(canvas);
    this.debug = new DebugOverlay(uiRoot);

    this.rig.warpTo(this.player.x, this.player.z);
    this.aim.set(this.player.x + 6, 0, this.player.z);

    this.loop = new Loop(this.step, this.render);
  }

  start(): void {
    this.loop.start();
  }

  stop(): void {
    this.loop.stop();
    this.input.dispose();
    this.disposeResize();
    this.lighting.dispose();
    this.renderer.dispose();
  }

  /** One fixed simulation step. Order matters; keep it explicit. */
  private step = (dt: number): void => {
    this.input.sample();
    const intent = this.input.intent;

    this.updateAim(intent.usingGamepad, intent.stickAimX, intent.stickAimZ, intent.pointerX, intent.pointerY);

    this.player.savePrevious();
    this.player.intent = intent;
    this.player.aimX = this.aim.x;
    this.player.aimZ = this.aim.z;
    this.player.tick(dt);

    this.input.consumeEdges();
  };

  private updateAim(usingGamepad: boolean, stickX: number, stickZ: number, ndcX: number, ndcY: number): void {
    if (usingGamepad && (stickX !== 0 || stickZ !== 0)) {
      const len = Math.hypot(stickX, stickZ) || 1;
      this.aim.set(this.player.x + (stickX / len) * 9, 0, this.player.z + (stickZ / len) * 9);
      return;
    }
    this.rig.screenToGround(ndcX, ndcY, this.aim);
  }

  private render = (alpha: number, realDt: number): void => {
    this.player.syncObject(alpha);
    this.renderPos.copy(this.player.object!.position);

    // The camera runs on real time, not simulation time — it must keep moving
    // smoothly through hitstop.
    this.rig.update(realDt, this.renderPos.x, this.renderPos.z, this.aim.x, this.aim.z);

    this.reticle.position.set(this.aim.x, 0.05, this.aim.z);
    this.lighting.follow(this.renderPos.x, this.renderPos.z);

    this.renderer.render(this.scene, this.rig.camera);

    this.debug.update(realDt, () => this.debugText());
  };

  private debugText(): string {
    const p = this.player;
    return [
      `fps      ${this.loop.fps.toFixed(0)}`,
      `sim      ${Time.elapsed.toFixed(1)}s  x${Time.scale}`,
      `pos      ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`,
      `speed    ${p.speed.toFixed(1)} u/s`,
      `state    ${p.isRolling ? 'ROLL' : p.invulnerable ? 'IFRAME' : 'ok'}`,
      `carrying ${p.carrying}${p.canSprint ? '' : ' (no sprint)'}`,
      `draws    ${this.renderer.info.render.calls}`,
      '',
      'WASD move · mouse aim · space dodge · shift sprint',
    ].join('\n');
  }
}
