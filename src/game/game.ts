import { Fog, Group, Scene, Vector3, WebGLRenderer } from 'three';
import { Loop } from '../core/loop';
import { Input } from '../core/input';
import { Rng } from '../core/rng';
import { Time, hitstop } from '../core/time';
import { createRenderer, fitToWindow } from '../render/renderer';
import { CameraRig } from '../render/camera';
import { Lighting } from '../render/lighting';
import { createFloor } from '../render/floor';
import { createReticle } from '../render/reticle';
import { Beacon } from '../render/pad';
import { PALETTE } from '../render/palette';
import { buildTestArena, findOpenSpots, type BuiltMap, type Spot } from '../world/arena';
import { Player } from '../entities/player';
import { Extraction } from '../systems/extraction';
import { CargoLedger } from '../systems/cargo-ledger';
import { CarrySystem } from '../systems/carry';
import { DebugOverlay } from '../ui/debug';
import { Hud } from '../ui/hud';
import { showBriefing } from '../ui/briefing';
import { showDebrief } from '../ui/debrief';
import { basename, type Mission } from './mission';
import type { GitContext, Outcome } from '../net/protocol';

type State = 'briefing' | 'playing' | 'debrief';

const PAD_RADIUS = 3.2;
/** Health-rule only: how many hits before the run is lost outright. */
const MAX_HP = 4;
const HIT_INVULN = 1.1;

/**
 * Orchestration only.
 *
 * `Game` owns the scene graph, the loop, and the order systems run in. It does
 * not contain gameplay rules — no collision maths, and above all no decisions
 * about which files survive. That belongs to `CargoLedger`, which is the sole
 * authority on the user's work.
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
  private readonly ledger: CargoLedger;
  private readonly carry: CarrySystem;

  private state: State = 'briefing';
  private hp = MAX_HP;
  private readonly aim = new Vector3();
  private readonly renderPos = new Vector3();
  private readonly disposeResize: () => void;
  private readonly disposeDebugKeys: () => void;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly uiRoot: HTMLElement,
    private readonly mission: Mission,
    private readonly git: GitContext | null,
  ) {
    this.rng = new Rng(mission.seed);

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

    this.ledger = new CargoLedger(mission.files, { rules: mission.rules });
    this.carry = new CarrySystem(
      this.scene,
      this.ledger,
      this.map.grid,
      this.cargoSpots(),
      mission.rules.stash,
      this.stashSpot(),
      {
        onDecayed: (record) => this.hud.flash(`LOST ${basename(record.name)}`, 'bad'),
        onDrop: (record) => this.hud.flash(`DROPPED ${basename(record.name)}`, 'warn'),
        onPickup: (record) => this.hud.flash(`SECURED ${basename(record.name)}`, 'good'),
        onStash: (record) => this.hud.flash(`STASHED ${basename(record.name)}`, 'info'),
      },
    );

    this.reticle = createReticle();
    this.scene.add(this.reticle);

    this.input = new Input(canvas);
    this.debug = new DebugOverlay(uiRoot);
    this.hud = new Hud(uiRoot);
    this.hud.setMission(mission);
    this.disposeDebugKeys = this.bindDebugKeys();

    this.rig.warpTo(this.player.x, this.player.z);
    this.aim.set(this.player.x + 6, 0, this.player.z);

    this.loop = new Loop(this.step, this.render);
  }

  /**
   * Cargo placement: biggest diff goes to the farthest spot from extraction.
   * A 200-line file should be a trek; a one-line tweak should be on your way
   * out.
   */
  private cargoSpots(): Spot[] {
    const nearestFirst = findOpenSpots(
      this.map.grid,
      this.rng,
      this.mission.files.length,
      this.map.extraction,
      10,
    ).filter((s) => Math.hypot(s.x - this.map.spawn.x, s.z - this.map.spawn.z) > 6);
    const byWeight = this.mission.files
      .map((f, i) => ({ i, added: f.added }))
      .sort((a, b) => a.added - b.added);

    const spots: Spot[] = new Array(this.mission.files.length);
    byWeight.forEach((entry, rank) => {
      spots[entry.i] = nearestFirst[rank] ?? nearestFirst[nearestFirst.length - 1] ?? this.map.spawn;
    });
    return spots;
  }

  /** Deliberately off the direct route — the stash has to cost you a detour. */
  private stashSpot(): Spot | null {
    if (this.mission.rules.stash === 'off') return null;
    const mid = {
      x: (this.map.spawn.x + this.map.extraction.x) / 2,
      z: (this.map.spawn.z + this.map.extraction.z) / 2,
    };
    const candidates = findOpenSpots(this.map.grid, this.rng, 6, mid, 14);
    return candidates[candidates.length - 1] ?? null;
  }

  /** Briefing → play. */
  async run(): Promise<void> {
    this.loop.start();
    await showBriefing(this.uiRoot, this.mission);
    this.state = 'playing';
  }

  stop(): void {
    this.loop.stop();
    this.input.dispose();
    this.disposeResize();
    this.disposeDebugKeys();
    this.lighting.dispose();
    this.hud.dispose();
    this.renderer.dispose();
  }

  /** One fixed simulation step. Order matters; keep it explicit. */
  private step = (dt: number): void => {
    this.input.sample();
    const intent = this.input.intent;

    if (this.state !== 'playing') {
      this.input.consumeEdges();
      return;
    }

    this.updateAim(intent.usingGamepad, intent.stickAimX, intent.stickAimZ, intent.pointerX, intent.pointerY);

    this.player.savePrevious();
    this.player.intent = intent;
    this.player.aimX = this.aim.x;
    this.player.aimZ = this.aim.z;
    this.player.tick(dt);

    this.carry.update(dt, this.player, intent);

    if (this.extraction.update(dt, this.player.x, this.player.z)) {
      this.finish('win');
    }

    this.input.consumeEdges();
  };

  /**
   * A hit landing. The death rule decides whether losing cargo is the only
   * consequence, or whether the run can end here.
   *
   * M3 calls this from enemy fire; until then it's on a debug key.
   */
  takeHit(): void {
    if (this.state !== 'playing' || this.player.invulnerable) return;

    const dropped = this.carry.knockLoose(this.player);
    this.player.invulnTimer = HIT_INVULN;
    this.rig.addTrauma(dropped ? 0.55 : 0.3);
    hitstop(dropped ? 0.09 : 0.05);

    switch (this.mission.rules.death) {
      case 'health':
        this.hp -= 1;
        if (this.hp <= 0) this.finish('loss');
        break;
      case 'fragile':
        // Stripping down to sprint everywhere should carry a real risk.
        if (!dropped) this.finish('loss');
        break;
      case 'cargo':
        // Cargo is the only currency. Empty-handed, nothing can happen to you.
        break;
    }
  }

  private updateAim(usingGamepad: boolean, stickX: number, stickZ: number, ndcX: number, ndcY: number): void {
    if (usingGamepad && (stickX !== 0 || stickZ !== 0)) {
      const len = Math.hypot(stickX, stickZ) || 1;
      this.aim.set(this.player.x + (stickX / len) * 9, 0, this.player.z + (stickZ / len) * 9);
      return;
    }
    this.rig.screenToGround(ndcX, ndcY, this.aim);
  }

  /**
   * The only place a result reaches the CLI, and the only caller of
   * `ledger.result()`. `sendResult` is idempotent on the protocol side too —
   * belt and braces, because a double send could act on stale state.
   */
  private finish(outcome: Outcome): void {
    if (this.state === 'debrief') return;
    this.state = 'debrief';

    const result = this.ledger.result(outcome);
    this.git?.sendResult(outcome, result);
    showDebrief(this.uiRoot, {
      outcome,
      mission: this.mission,
      surviving: result.surviving,
      lost: result.lost,
      stashed: result.stashed,
    });
  }

  private render = (alpha: number, realDt: number): void => {
    this.player.syncObject(alpha);
    this.carry.syncVisuals(alpha);
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
      crates: this.ledger.crates,
      decaySeconds: this.ledger.decaySeconds,
      progress: this.extraction.progress,
      inside: this.extraction.inside,
      secondsRemaining: this.extraction.secondsRemaining,
      carrying: this.ledger.carriedCount,
      hp: this.mission.rules.death === 'health' ? this.hp : null,
      maxHp: MAX_HP,
      distanceToPad: Math.hypot(
        this.extraction.x - this.player.x,
        this.extraction.z - this.player.z,
      ),
    });
    this.debug.update(realDt, () => this.debugText());
  };

  /**
   * F1 simulates a hit and F2 ends the run, so the whole cargo loop can be
   * exercised before enemies exist (M3).
   */
  private bindDebugKeys(): () => void {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'F1') {
        e.preventDefault();
        this.takeHit();
      } else if (e.code === 'F2') {
        e.preventDefault();
        this.finish('loss');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }

  private debugText(): string {
    const p = this.player;
    const r = this.mission.rules;
    return [
      `fps      ${this.loop.fps.toFixed(0)}`,
      `state    ${this.state}`,
      `pos      ${p.x.toFixed(1)}, ${p.z.toFixed(1)}  ${p.speed.toFixed(1)} u/s`,
      `player   ${p.isRolling ? 'ROLL' : p.invulnerable ? 'IFRAME' : 'ok'}`,
      `rules    loss=${r.loss} death=${r.death} stash=${r.stash}`,
      `hp       ${r.death === 'health' ? `${this.hp}/${MAX_HP}` : 'n/a'}`,
      `cargo    ${this.ledger.carriedCount} carried · ${this.ledger.dropped.length} dropped · ${this.ledger.stashed.length} stashed · ${this.ledger.lost.length} lost`,
      `hold     ${(this.extraction.progress * 100).toFixed(0)}%`,
      `draws    ${this.renderer.info.render.calls}`,
      '',
      'WASD move · space dodge · Q drop · E stash · F1 take a hit · F2 fail',
    ].join('\n');
  }
}
