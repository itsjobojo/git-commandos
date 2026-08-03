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
import { Beacon } from '../render/pad';
import { PALETTE } from '../render/palette';
import { buildTestArena, type BuiltMap } from '../world/arena';
import { Player } from '../entities/player';
import { Extraction } from '../systems/extraction';
import { DebugOverlay } from '../ui/debug';
import { Hud } from '../ui/hud';
import { showBriefing } from '../ui/briefing';
import { showDebrief } from '../ui/debrief';
import type { Mission } from './mission';
import type { GitContext, Outcome } from '../net/protocol';

type State = 'briefing' | 'playing' | 'debrief';

const PAD_RADIUS = 3.2;

/**
 * Orchestration only.
 *
 * `Game` owns the scene graph, the loop, and the order systems run in. It does
 * not contain gameplay rules — no collision maths, no damage, no crate
 * lifecycle. That separation is the point of the rebuild; the previous
 * incarnation was a 1400-line `game.ts` that owned everything.
 */
export class Game {
  private readonly scene = new Scene();
  private readonly renderer: WebGLRenderer;
  private readonly rig: CameraRig;
  private readonly lighting: Lighting;
  private readonly input: Input;
  private readonly loop: Loop;
  private readonly debug: DebugOverlay;
  private readonly hud: Hud;
  private readonly rng: Rng;

  private readonly map: BuiltMap;
  private readonly player: Player;
  private readonly reticle: Group;
  private readonly beacon: Beacon;
  private readonly extraction: Extraction;

  private state: State = 'briefing';
  private readonly aim = new Vector3();
  private readonly renderPos = new Vector3();
  private readonly disposeResize: () => void;

  /** Files still safe. M4 turns this into the real drop-on-hit ledger. */
  private safe: string[];
  private lost: string[] = [];

  constructor(
    canvas: HTMLCanvasElement,
    private readonly uiRoot: HTMLElement,
    private readonly mission: Mission,
    private readonly git: GitContext | null,
  ) {
    this.rng = new Rng(mission.seed);
    this.safe = mission.files.map((f) => f.name);

    this.renderer = createRenderer(canvas);
    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    this.disposeResize = fitToWindow(this.renderer, (w, h) => this.rig.resize(w, h));

    this.scene.fog = new Fog(PALETTE.fog, 28, 82);
    this.lighting = new Lighting(this.scene);

    this.map = buildTestArena(this.rng, mission.arenaCells, mission.arenaCells);
    this.scene.add(this.map.group);
    this.scene.add(createFloor(this.map.grid.width, this.map.grid.depth));

    this.player = new Player(this.map.grid);
    this.player.setPosition(this.map.spawn.x, this.map.spawn.z);
    this.scene.add(this.player.object!);

    this.beacon = new Beacon(PAD_RADIUS);
    this.beacon.setPosition(this.map.extraction.x, this.map.extraction.z);
    this.scene.add(this.beacon.group);

    this.extraction = new Extraction(
      this.map.extraction.x,
      this.map.extraction.z,
      PAD_RADIUS,
      mission.holdSeconds,
    );

    this.reticle = createReticle();
    this.scene.add(this.reticle);

    this.input = new Input(canvas);
    this.debug = new DebugOverlay(uiRoot);
    this.hud = new Hud(uiRoot);
    this.hud.setMission(mission);

    this.rig.warpTo(this.player.x, this.player.z);
    this.aim.set(this.player.x + 6, 0, this.player.z);

    this.loop = new Loop(this.step, this.render);
  }

  /** Briefing → play. Resolves when the run is over. */
  async run(): Promise<void> {
    this.loop.start();
    await showBriefing(this.uiRoot, this.mission);
    this.state = 'playing';
  }

  stop(): void {
    this.loop.stop();
    this.input.dispose();
    this.disposeResize();
    this.lighting.dispose();
    this.hud.dispose();
    this.renderer.dispose();
  }

  /** One fixed simulation step. Order matters; keep it explicit. */
  private step = (dt: number): void => {
    this.input.sample();
    const intent = this.input.intent;

    if (this.state !== 'playing') {
      // Still sample so held keys don't stick across the briefing, but freeze
      // the world.
      this.input.consumeEdges();
      return;
    }

    this.updateAim(intent.usingGamepad, intent.stickAimX, intent.stickAimZ, intent.pointerX, intent.pointerY);

    this.player.savePrevious();
    this.player.intent = intent;
    this.player.aimX = this.aim.x;
    this.player.aimZ = this.aim.z;
    this.player.tick(dt);

    if (this.extraction.update(dt, this.player.x, this.player.z)) {
      this.finish('win');
    }

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

  /**
   * The only place a result reaches the CLI. `sendResult` is idempotent on the
   * protocol side too — belt and braces, because a double send could act on
   * stale state.
   */
  private finish(outcome: Outcome): void {
    if (this.state === 'debrief') return;
    this.state = 'debrief';

    this.git?.sendResult(outcome, this.safe, this.lost);
    showDebrief(this.uiRoot, {
      outcome,
      mission: this.mission,
      surviving: this.safe,
      lost: this.lost,
    });
  }

  private render = (alpha: number, realDt: number): void => {
    this.player.syncObject(alpha);
    this.renderPos.copy(this.player.object!.position);

    // The camera runs on real time, not simulation time — it must keep moving
    // smoothly through hitstop.
    this.rig.update(realDt, this.renderPos.x, this.renderPos.z, this.aim.x, this.aim.z);

    this.reticle.position.set(this.aim.x, 0.05, this.aim.z);
    this.reticle.visible = this.state === 'playing';
    this.lighting.follow(this.renderPos.x, this.renderPos.z);
    this.beacon.update(this.extraction.progress, this.extraction.inside, Time.real);

    this.renderer.render(this.scene, this.rig.camera);

    this.hud.update({
      progress: this.extraction.progress,
      inside: this.extraction.inside,
      secondsRemaining: this.extraction.secondsRemaining,
      safe: this.safe,
      lost: this.lost,
      distanceToPad: Math.hypot(
        this.extraction.x - this.player.x,
        this.extraction.z - this.player.z,
      ),
    });
    this.debug.update(realDt, () => this.debugText());
  };

  private debugText(): string {
    const p = this.player;
    return [
      `fps      ${this.loop.fps.toFixed(0)}`,
      `state    ${this.state}`,
      `sim      ${Time.elapsed.toFixed(1)}s  x${Time.scale}`,
      `pos      ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`,
      `speed    ${p.speed.toFixed(1)} u/s`,
      `player   ${p.isRolling ? 'ROLL' : p.invulnerable ? 'IFRAME' : 'ok'}`,
      `hold     ${(this.extraction.progress * 100).toFixed(0)}%`,
      `draws    ${this.renderer.info.render.calls}`,
      `mission  ${this.mission.sandbox ? 'sandbox' : this.mission.command} · ${this.mission.files.length} files`,
      '',
      'WASD move · mouse aim · space dodge · shift sprint',
    ].join('\n');
  }
}
