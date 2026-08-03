import { Fog, Group, Scene, Vector3, WebGLRenderer } from 'three';
import { Loop } from '../core/loop';
import { Input } from '../core/input';
import { Rng } from '../core/rng';
import { Time, hitstop } from '../core/time';
import { createRenderer, fitToWindow } from '../render/renderer';
import { PostChain } from '../render/post';
import { CameraRig } from '../render/camera';
import { Lighting } from '../render/lighting';
import { createFloor } from '../render/floor';
import { createReticle } from '../render/reticle';
import { Beacon } from '../render/pad';
import { PALETTE } from '../render/palette';
import { buildRoute, type BuiltMap } from '../world/arena';
import { Player } from '../entities/player';
import { Extraction } from '../systems/extraction';
import { CargoLedger } from '../systems/cargo-ledger';
import { CarrySystem } from '../systems/carry';
import { CombatSystem } from '../systems/combat';
import { Faction } from '../systems/projectiles';
import { MEETING_SLOW, SHELTER_GRACE, MeetingSystem } from '../systems/meetings';
import { BLAST_RADIUS, BombSystem } from '../systems/bombs';
import { PickupSystem, type PickupOffer } from '../systems/pickups';
import { AudioSystem, eventCue, shotCue } from '../systems/audio';
import { Loadout, WEAPONS } from '../systems/weapons';
import { showInvite } from '../ui/invite-modal';
import { Director } from './director';
import { AiBro } from '../entities/enemies/ai-bro';
import { MeetingOrganizer } from '../entities/enemies/meeting-organizer';
import { InviteSwarm } from '../entities/enemies/invite-swarm';
import { Recruiter } from '../entities/enemies/recruiter';
import { Intern } from '../entities/enemies/intern';
import type { Enemy, EnemyContext } from '../entities/enemies/enemy';
import { DebugOverlay } from '../ui/debug';
import { Hud } from '../ui/hud';
import { EdgeMarkers } from '../ui/markers';
import { DamageOverlay } from '../ui/damage';
import { showBriefing } from '../ui/briefing';
import { showAborted, showDebrief, type DebriefReason } from '../ui/debrief';
import { showPause } from '../ui/pause';
import { basename, type Mission } from './mission';
import type { GitContext, Outcome } from '../net/protocol';

type State = 'briefing' | 'playing' | 'paused' | 'debrief';

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
  private readonly post: PostChain;
  private readonly rig: CameraRig;
  private readonly lighting: Lighting;
  private readonly input: Input;
  private readonly loop: Loop;
  private readonly debug: DebugOverlay;
  private readonly hud: Hud;
  private readonly markers: EdgeMarkers;
  private readonly damage: DamageOverlay;
  private readonly rng: Rng;

  private readonly map: BuiltMap;
  private readonly player: Player;
  private readonly reticle: Group;
  private readonly beacon: Beacon;
  private readonly extraction: Extraction;
  private readonly ledger: CargoLedger;
  private readonly carry: CarrySystem;
  private readonly combat: CombatSystem;
  private readonly meetings: MeetingSystem;
  private readonly bombs: BombSystem;
  private readonly pickups: PickupSystem;
  private readonly loadout = new Loadout();
  private readonly director: Director;
  private readonly audio: AudioSystem;
  /** Dismisses an open invite, if one is up. */
  private closeInvite: (() => void) | null = null;

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
    // Starts fetching its samples now; the audio graph itself has to wait for
    // the Deploy gesture, because browsers will not start one without.
    this.audio = new AudioSystem({ music: mission.music, seed: mission.seed });

    this.renderer = createRenderer(canvas);
    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    this.post = new PostChain(
      this.renderer,
      this.scene,
      this.rig.camera,
      window.innerWidth,
      window.innerHeight,
    );
    this.disposeResize = fitToWindow(this.renderer, (w, h) => {
      this.rig.resize(w, h);
      this.post.setSize(w, h);
    });

    // Fog range is measured from the camera, not the player, so it has to clear
    // the camera's own 26-unit standoff. Starting at 28 put the near haze
    // essentially on top of the player and greyed out the whole playfield.
    this.scene.fog = new Fog(PALETTE.fog, 38, 104);
    this.lighting = new Lighting(this.scene);

    this.map = buildRoute(this.rng, mission.arenaCells, mission.arenaCells);
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

    // You land with the whole commit on your back. The run is getting it out,
    // not finding it — a courier under fire, not a scavenger hunt.
    this.ledger = new CargoLedger(mission.files, {
      rules: mission.rules,
      startCarrying: mission.files.length,
    });
    this.carry = new CarrySystem(
      this.scene,
      this.ledger,
      this.map.grid,
      mission.files.map(() => this.map.spawn),
      mission.rules.stash,
      mission.rules.stash === 'off' ? null : this.map.stash,
      {
        onDecayed: (record) => {
          this.hud.flash(`LOST ${basename(record.name)}`, 'bad');
          this.audio.play('cargo-lost');
        },
        onDrop: (record) => {
          this.hud.flash(`DROPPED ${basename(record.name)}`, 'warn');
          this.audio.play('cargo-dropped');
        },
        onPickup: (record) => {
          this.hud.flash(`SECURED ${basename(record.name)}`, 'good');
          this.audio.play('cargo-secured');
        },
        onStash: (record) => {
          this.hud.flash(`STASHED ${basename(record.name)}`, 'info');
          this.audio.play('cargo-stashed');
        },
      },
    );

    this.combat = new CombatSystem(this.scene, this.map.grid, this.loadout, {
      onEnemyKilled: (enemy) => this.onEnemyKilled(enemy),
      onPlayerShot: (weapon, x, z) => this.audio.play(shotCue(weapon), x, z),
      onEnemyHit: (x, z) => this.audio.play('enemy-hit', x, z),
      onPlayerHit: (sourceX, sourceZ) => {
        this.takeHit(sourceX, sourceZ);
        return true;
      },
      shake: (amount) => this.rig.addTrauma(amount),
      onOutOfAmmo: () => {
        this.player.setWeapon('pistol');
        this.hud.flash('OUT OF AMMO — SIDEARM', 'warn');
        this.audio.play('out-of-ammo');
      },
    });
    this.pickups = new PickupSystem(this.scene, (offer, first) => this.onPickup(offer, first));
    this.placeWeapons();
    this.meetings = new MeetingSystem(this.scene);
    this.bombs = new BombSystem(this.scene, (x, z) => this.onBombDetonated(x, z));
    this.extraction.onFirstEntry = () => this.audio.play('extraction-enter');
    this.director = new Director(
      this.scene,
      this.combat,
      this.meetings,
      this.map.grid,
      this.rng,
      this.map.waypoints,
      // A bigger diff is a busier map, on top of being a longer one.
      Math.min(1, mission.linesAdded / 400),
      {
        onEvent: (title, subtitle, kind) => {
          this.hud.announce(title, subtitle, kind);
          this.audio.play(eventCue(kind));
        },
      },
    );

    this.reticle = createReticle();
    this.scene.add(this.reticle);

    this.input = new Input(canvas);
    this.debug = new DebugOverlay(uiRoot);
    this.markers = new EdgeMarkers(uiRoot);
    this.damage = new DamageOverlay(uiRoot);
    this.hud = new Hud(uiRoot);
    this.hud.setMission(mission);
    this.disposeDebugKeys = this.bindDebugKeys();

    this.rig.warpTo(this.player.x, this.player.z);
    this.aim.set(this.player.x + 6, 0, this.player.z);

    this.loop = new Loop(this.step, this.render);
  }

  /** Briefing → play. */
  async run(): Promise<void> {
    this.loop.start();
    await showBriefing(this.uiRoot, this.mission);
    // Deploy is the gesture the browser wants before it will let us make a
    // sound, and the only one the game is guaranteed to get.
    this.audio.unlock();
    this.state = 'playing';
  }

  stop(): void {
    this.loop.stop();
    this.audio.dispose();
    this.input.dispose();
    this.disposeResize();
    this.disposeDebugKeys();
    this.lighting.dispose();
    this.hud.dispose();
    this.markers.dispose();
    this.damage.dispose();
    this.post.dispose();
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

    if (intent.pause) {
      this.input.consumeEdges();
      void this.pause();
      return;
    }

    this.updateAim(intent.usingGamepad, intent.stickAimX, intent.stickAimZ, intent.pointerX, intent.pointerY);

    // Mandatory meetings shelter you from fire; avoid blobs bog you down.
    // Neither does damage — they cost you time, which during an extraction is
    // the more expensive currency anyway.
    const standingIn = this.meetings.current(this.player.x, this.player.z);
    const inAvoid = standingIn?.kind === 'avoid';
    const inShelter = standingIn?.kind === 'mandatory';
    this.player.externalSlow = inAvoid ? MEETING_SLOW : 1;
    if (inShelter) this.player.shelterTimer = Math.max(this.player.shelterTimer, 0.2);

    this.player.savePrevious();
    this.player.intent = intent;
    this.player.aimX = this.aim.x;
    this.player.aimZ = this.aim.z;
    const wasRolling = this.player.isRolling;
    this.player.tick(dt);
    // The dodge is owned by the player, and whether one actually started is
    // only visible from the outside as this edge — pressing the key isn't it.
    if (!wasRolling && this.player.isRolling) this.audio.play('dodge');

    // You can still work inside a shelter — it's the avoid blob that pins you.
    if (!inAvoid) this.carry.update(dt, this.player, intent);

    this.combat.update(dt, this.player, this.enemyContext(), intent.fire, this.scene);
    this.bombs.update(dt, Time.real);
    this.pickups.update(dt, Time.real, this.player.x, this.player.z);
    this.meetings.update(dt, this.player.x, this.player.z, Time.real, {
      onAttended: (m) => this.onAttendedMeeting(m.title),
      onMissed: (m) => this.onMissedMeeting(m.title),
    });
    this.director.update(dt, {
      playerX: this.player.x,
      playerZ: this.player.z,
      extractionProgress: this.extraction.progress,
      extracting: this.extraction.progress > 0,
      carrying: this.ledger.carriedCount,
    });

    const extracted = this.extraction.update(dt, this.player.x, this.player.z);
    // The pad ticks while you hold it, but not over the top of the win itself.
    this.audio.setExtraction(this.extraction.inside && !extracted, this.extraction.progress);
    if (extracted) this.finish('win');

    this.input.consumeEdges();
  };

  private enemyContext(): EnemyContext {
    return {
      playerX: this.player.x,
      playerZ: this.player.z,
      playerCarrying: this.ledger.carriedCount,
      grid: this.map.grid,
      rng: this.rng,
      time: Time.real,
      extracting: this.extraction.progress > 0,
      fire: (opts) => {
        this.combat.projectiles.spawn({ ...opts, faction: Faction.Enemy });
        this.audio.play('shot-enemy', opts.x, opts.z);
      },
      hitPlayer: (sourceX, sourceZ) => {
        if (this.player.invulnerable) return false;
        this.takeHit(sourceX, sourceZ);
        return true;
      },
      shake: (amount) => this.rig.addTrauma(amount),
      throwBomb: (fx, fz, tx, tz) => {
        this.bombs.throwAt(fx, fz, tx, tz);
        this.audio.play('bomb-thrown', fx, fz);
      },
    };
  }

  private onEnemyKilled(enemy: Enemy): void {
    this.audio.play('enemy-killed', enemy.x, enemy.z);
    this.rollDrop(enemy);

    // Killing one bro makes the rest speed up. "He's just early."
    if (enemy instanceof AiBro) {
      for (const other of this.combat.enemies) {
        if (other instanceof AiBro && !other.dying) other.rally();
      }
      return;
    }
    if (enemy instanceof InviteSwarm) this.hud.flash('INVITE SERIES CANCELLED', 'good');
    if (enemy instanceof MeetingOrganizer) this.hud.flash('NO FURTHER MEETINGS SCHEDULED', 'good');
  }

  /**
   * Sitting through a mandatory meeting is the one thing in the game that
   * gives something back: a grace shield on the way out, and a point of health
   * when the death rule has any to give.
   */
  private onAttendedMeeting(title: string): void {
    this.player.shelterTimer = Math.max(this.player.shelterTimer, SHELTER_GRACE);
    this.audio.play('meeting-attended');
    if (this.mission.rules.death === 'health' && this.hp < MAX_HP) {
      this.hp += 1;
      this.hud.flash(`ATTENDED ${title} — +1 HP, ${SHELTER_GRACE}s COVER`, 'good');
      return;
    }
    this.hud.flash(`ATTENDED ${title} — ${SHELTER_GRACE}s COVER`, 'good');
  }

  /**
   * A bomb went off: an invite lands on top of everything.
   *
   * The game does not pause underneath it. That's the entire joke — a modal
   * demanding a decision about a meeting, while you are being shot at, and it
   * accepts itself if you ignore it. Accepting drops a mandatory meeting on
   * your position, so saying yes to the invite genuinely obliges you to go and
   * stand in it.
   */
  /**
   * Upgrades sit on the route, not hidden off it — an upgrade should be
   * something you see ahead and walk to. The machine gun lands early so the
   * slow sidearm is a starting point rather than the whole game; the shotgun
   * sits later, nearer the beacon, where the fights get close.
   */
  private placeWeapons(): void {
    const route = this.map.waypoints;
    if (route.length < 3) return;
    const early = route[Math.max(1, Math.floor(route.length * 0.3))];
    const late = route[Math.min(route.length - 2, Math.floor(route.length * 0.7))];
    this.pickups.place({ kind: 'weapon', id: 'smg', rounds: 0 }, early, true);
    this.pickups.place({ kind: 'weapon', id: 'shotgun', rounds: 0 }, late, true);
  }

  /**
   * @returns false to leave the pickup on the ground.
   *
   * Ammo is only collectible if you're actually holding that weapon. Picking
   * up shotgun shells with no shotgun made no sense — you can see them, you
   * just can't do anything with them yet, which is its own small incentive to
   * go and find the gun.
   */
  private onPickup(offer: PickupOffer, firstTouch: boolean): boolean {
    if (offer.kind === 'weapon') {
      this.loadout.equip(offer.id);
      this.player.setWeapon(offer.id);
      const spec = WEAPONS[offer.id];
      this.hud.announce(spec.name.toUpperCase(), `${spec.ammo ?? '∞'} rounds`, 'good');
      this.audio.play('pickup-weapon');
      return true;
    }

    if (this.loadout.id !== offer.id) {
      if (firstTouch) {
        this.hud.flash(`NEED THE ${WEAPONS[offer.id].name.toUpperCase()}`, 'warn');
        this.audio.play('pickup-refused');
      }
      return false;
    }
    if (this.loadout.ammo !== null && this.loadout.ammo >= (this.loadout.maxAmmo ?? 0)) {
      if (firstTouch) {
        this.hud.flash('AMMO FULL', 'info');
        this.audio.play('pickup-refused');
      }
      return false;
    }

    this.loadout.addAmmo(offer.id, offer.rounds);
    this.player.setWeapon(offer.id);
    this.hud.flash(`+${offer.rounds} ${WEAPONS[offer.id].name.toUpperCase()}`, 'good');
    this.audio.play('pickup-ammo');
    return true;
  }

  /**
   * What the dead leave behind.
   *
   * Deliberately not everyone: loot from every kill turns the floor into a
   * shop and kills the tension of running dry. Ammo is the common case, a
   * whole weapon is a treat, and the stampede drops nothing at all — two dozen
   * drops in one wave would carpet the route.
   */
  private rollDrop(enemy: Enemy): void {
    if (enemy instanceof AiBro) return;

    let chance = 0.3;
    if (enemy instanceof MeetingOrganizer) chance = 0.6;
    if (enemy instanceof InviteSwarm) chance = 1;
    if (this.rng.next() > chance) return;

    const roll = this.rng.next();
    let offer: PickupOffer;
    if (enemy instanceof InviteSwarm) {
      // The boss always pays out properly.
      offer = { kind: 'weapon', id: 'shotgun', rounds: 0 };
    } else if (roll < 0.62) {
      const id = this.rng.next() < 0.6 ? 'smg' : 'shotgun';
      offer = { kind: 'ammo', id, rounds: id === 'smg' ? 55 : 9 };
    } else if (roll < 0.88) {
      offer = { kind: 'weapon', id: 'smg', rounds: 0 };
    } else {
      offer = { kind: 'weapon', id: 'shotgun', rounds: 0 };
    }

    this.pickups.place(offer, { x: enemy.x, z: enemy.z });
  }

  private onBombDetonated(x: number, z: number): void {
    if (this.state !== 'playing') return;
    this.audio.play('bomb-detonate', x, z);

    const distance = Math.hypot(this.player.x - x, this.player.z - z);
    // Felt from further away than it reaches, but only a hit inside the ring.
    this.rig.addTrauma(Math.max(0, 0.55 * (1 - distance / (BLAST_RADIUS * 3))));

    if (distance > BLAST_RADIUS) return;
    hitstop(0.06);

    // Only one invite at a time; a stack of modals is a crash, not a joke.
    if (this.closeInvite) return;

    this.audio.play('invite-opened');
    this.closeInvite = showInvite(this.uiRoot, this.rng, (choice) => {
      this.closeInvite = null;
      if (choice === 'decline') {
        this.hud.flash('DECLINED', 'good');
        this.audio.play('invite-declined');
        return;
      }
      this.audio.play('invite-accepted');
      const meeting = this.meetings.schedule(this.rng, 'mandatory', x, z);
      this.hud.announce(
        'MEETING ACCEPTED',
        meeting ? `${meeting.title} — attend it` : 'your calendar is full',
        'warn',
      );
    });
  }

  /** Missing a mandatory meeting costs you a crate. */
  private onMissedMeeting(title: string): void {
    this.hud.flash(`MISSED ${title}`, 'bad');
    this.audio.play('meeting-missed');
    const dropped = this.carry.knockLoose(this.player);
    if (!dropped) this.rig.addTrauma(0.2);
  }

  /**
   * A hit landing. The death rule decides whether losing cargo is the only
   * consequence, or whether the run can end here.
   *
   * M3 calls this from enemy fire; until then it's on a debug key.
   */
  takeHit(sourceX?: number, sourceZ?: number): void {
    if (this.state !== 'playing' || this.player.invulnerable) return;

    // Point the player at whatever just cost them a file. A hit with no
    // locatable source (the debug key) still flashes, just without a bearing.
    this.damage.hit(
      sourceX === undefined ? 0 : sourceX - this.player.x,
      sourceZ === undefined ? 0 : sourceZ - this.player.z,
    );

    this.audio.play('player-hit');
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

  private async pause(): Promise<void> {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.audio.setPaused(true);
    const choice = await showPause(this.uiRoot, this.mission);
    this.audio.setPaused(false);
    if (choice === 'resume') {
      // The very keypress that dismissed the menu also latched a fresh pause
      // edge on the input. Without clearing it, the next step re-pauses and
      // Escape appears to do nothing.
      this.input.consumeEdges();
      this.state = 'playing';
      return;
    }
    this.state = 'debrief';
    this.audio.fadeMusicOut(0.8);
    this.git?.abort();
    showAborted(this.uiRoot, this.mission);
  }

  /**
   * The only place a result reaches the CLI, and the only caller of
   * `ledger.result()`. `sendResult` is idempotent on the protocol side too —
   * belt and braces, because a double send could act on stale state.
   */
  private finish(outcome: Outcome): void {
    if (this.state === 'debrief') return;
    this.state = 'debrief';

    // Reaching the pad with nothing on your back is not a win. Reporting it as
    // one made the CLI print a success banner and then exit 1, which is
    // incoherent — and it would have committed nothing either way.
    const empty = outcome === 'win' && this.ledger.result(outcome).surviving.length === 0;
    const finalOutcome: Outcome = empty ? 'loss' : outcome;
    const reason: DebriefReason = empty ? 'empty-handed' : outcome === 'win' ? 'extracted' : 'down';

    this.audio.play(finalOutcome === 'win' ? 'extracted' : 'failed');
    this.audio.fadeMusicOut();

    const result = this.ledger.result(finalOutcome);
    this.git?.sendResult(finalOutcome, result);
    showDebrief(this.uiRoot, {
      outcome: finalOutcome,
      reason,
      mission: this.mission,
      surviving: result.surviving,
      lost: result.lost,
      stashed: result.stashed,
    });
  }

  private render = (alpha: number, realDt: number): void => {
    this.renderer.info.reset();
    this.player.syncObject(alpha);
    this.carry.syncVisuals(alpha);
    this.syncEnemies(alpha);
    this.combat.projectiles.sync();
    this.renderPos.copy(this.player.object!.position);

    // Dissolve whatever is standing between the camera and the player. Uses the
    // interpolated render position, not the simulation one, or the hole lags a
    // frame behind the thing it is supposed to be revealing.
    this.map.setFocus(this.renderPos.x, 0.9, this.renderPos.z);

    // What you feel and what you hear are the same herd, off the same number.
    const rumble = this.stampedeRumble();
    this.rig.setRumble(rumble);
    this.audio.setRumble(rumble);
    this.audio.setListener(this.player.x, this.player.z);
    // The camera runs on real time, not simulation time — it must keep moving
    // smoothly through hitstop.
    this.rig.update(realDt, this.renderPos.x, this.renderPos.z, this.aim.x, this.aim.z);

    this.reticle.position.set(this.aim.x, 0.05, this.aim.z);
    this.reticle.visible = this.state === 'playing';
    this.lighting.follow(this.renderPos.x, this.renderPos.z);
    this.beacon.update(this.extraction.progress, this.extraction.inside, Time.real);

    this.post.render(Time.real);
    this.updateMarkers();

    this.hud.update({
      crates: this.ledger.crates,
      decaySeconds: this.ledger.decaySeconds,
      progress: this.extraction.progress,
      inside: this.extraction.inside,
      secondsRemaining: this.extraction.secondsRemaining,
      carrying: this.ledger.carriedCount,
      loadFactor: this.player.loadFactor,
      weapon: this.loadout.weapon.name,
      ammo: this.loadout.ammo,
      hp: this.mission.rules.death === 'health' ? this.hp : null,
      maxHp: MAX_HP,
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

  /**
   * Decide what deserves an arrow at the edge of the screen.
   *
   * `EdgeMarkers` does the projection and the clamping; choosing what is worth
   * pointing at is a game decision, so it lives here. The ordering below is the
   * priority order: the user's files first, then where they have to take them,
   * then what is trying to stop them.
   */
  private updateMarkers(): void {
    const camera = this.rig.camera;
    this.markers.begin();

    if (this.state === 'playing') {
      // A bleeding-out file, with its countdown on the arrow. This is the only
      // marker carrying a number that is still moving, because it is the only
      // one where being a second late is the difference between a commit and
      // an unstage.
      for (const crate of this.carry.crates) {
        const record = crate.record;
        if (record.state !== 'dropped') continue;
        this.markers.add(camera, crate.x, crate.z, 'cargo', `${record.decay.toFixed(1)}s`);
      }

      this.markers.add(
        camera,
        this.extraction.x,
        this.extraction.z,
        'objective',
        `${Math.hypot(this.extraction.x - this.player.x, this.extraction.z - this.player.z).toFixed(0)}m`,
      );

      // The herd collapses to a single arrow. Twenty-five individual markers
      // for a stampede is a solid bar of orange that tells you nothing; one
      // arrow at the herd's centre of mass tells you the lane to leave.
      let broX = 0;
      let broZ = 0;
      let broCount = 0;
      for (const enemy of this.combat.enemies) {
        if (enemy.dying) continue;
        if (enemy instanceof AiBro) {
          broX += enemy.x;
          broZ += enemy.z;
          broCount++;
          continue;
        }
        this.markers.add(camera, enemy.x, enemy.z, 'hostile');
      }
      if (broCount > 0) {
        this.markers.add(camera, broX / broCount, broZ / broCount, 'herd', `×${broCount}`);
      }
    }

    this.markers.end(window.innerWidth, window.innerHeight);
  }

  /**
   * Each archetype has its own sync because each animates differently — the
   * bro jogs, the boss hovers, the organizer spins its calendar. Dispatching
   * on type here keeps that animation code next to the behaviour it belongs to.
   */
  private syncEnemies(alpha: number): void {
    for (const enemy of this.combat.enemies) {
      if (enemy instanceof AiBro) enemy.syncBro(alpha);
      else if (enemy instanceof InviteSwarm) enemy.syncSwarm(alpha);
      else if (enemy instanceof MeetingOrganizer) enemy.syncOrganizer(alpha);
      else if (enemy instanceof Recruiter) enemy.syncRecruiter(alpha);
      else if (enemy instanceof Intern) enemy.syncIntern(alpha);
      else enemy.syncObject(alpha, 0);

      // The death animation owns the scale while dying; don't fight it.
      if (!enemy.dying && enemy.hitFlash > 0) {
        enemy.group.scale.setScalar(enemy.hitScale);
      } else if (!enemy.dying) {
        enemy.group.scale.setScalar(1);
      }
    }
  }

  /**
   * How hard the ground shakes, from how much herd is nearby and how close.
   * Builds as they bear down on you and fades as they pass — you should feel a
   * stampede coming before you can do anything about it.
   */
  private stampedeRumble(): number {
    const REACH = 34;
    let weight = 0;
    for (const enemy of this.combat.enemies) {
      if (!(enemy instanceof AiBro) || enemy.dying) continue;
      const distance = Math.hypot(enemy.x - this.player.x, enemy.z - this.player.z);
      if (distance > REACH) continue;
      const closeness = 1 - distance / REACH;
      weight += closeness * closeness;
    }
    return Math.min(1, weight / 7);
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
      `weapon   ${this.loadout.weapon.name} ${this.loadout.ammo ?? '∞'}`,
      `cargo    ${this.ledger.carriedCount} carried · ${this.ledger.dropped.length} dropped · ${this.ledger.stashed.length} stashed · ${this.ledger.lost.length} lost`,
      `hold     ${(this.extraction.progress * 100).toFixed(0)}%`,
      `enemies  ${this.combat.liveEnemies} · ${this.combat.projectiles.activeCount} shots · ${this.meetings.meetings.length} meetings`,
      `draws    ${this.renderer.info.render.calls}`,
      '',
      'WASD move · LMB fire · space dodge · Q drop · E stash · F1 hit · F2 fail',
    ].join('\n');
  }
}
