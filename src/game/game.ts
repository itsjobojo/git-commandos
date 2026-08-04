import { Fog, Group, Scene, Vector3, WebGLRenderer } from 'three';
import { Loop } from '../core/loop';
import { Input } from '../core/input';
import { Rng, hashString } from '../core/rng';
import { Time, hitstop } from '../core/time';
import { createRenderer, fitToWindow } from '../render/renderer';
import { PostChain } from '../render/post';
import { CameraRig } from '../render/camera';
import { Lighting } from '../render/lighting';
import { createFloor } from '../render/floor';
import { createReticle } from '../render/reticle';
import { AimIndicator } from '../render/aim-indicator';
import { VisionCones } from '../render/vision-cones';
import { AlertMarks } from '../render/alert-marks';
import { FLASH, HitFlashes } from '../render/hit-flash';
import { Beacon } from '../render/pad';
import { PALETTE } from '../render/palette';
import { buildRoute, type BuiltMap } from '../world/arena';
import { Player } from '../entities/player';
import { Extraction } from '../systems/extraction';
import { CargoLedger } from '../systems/cargo-ledger';
import { CarrySystem } from '../systems/carry';
import { CombatSystem } from '../systems/combat';
import { NoiseBus } from '../systems/noise';
import { Faction } from '../systems/projectiles';
import { MEETING_SLOW, SHELTER_GRACE, MeetingSystem } from '../systems/meetings';
import { BLAST_RADIUS, BombSystem } from '../systems/bombs';
import { PickupSystem, type PickupOffer } from '../systems/pickups';
import { AudioSystem, eventCue, shotCue } from '../systems/audio';
import { Loadout, WEAPONS, WEAPON_ORDER } from '../systems/weapons';
import { showInvite } from '../ui/invite-modal';
import { Director } from './director';
import { AiBro } from '../entities/enemies/ai-bro';
import { InviteStorm } from '../entities/enemies/invite-storm';
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
import { MAX_HP, basename, type Mission } from './mission';
import type { GitContext, Outcome } from '../net/protocol';

type State = 'briefing' | 'playing' | 'paused' | 'debrief';

const PAD_RADIUS = 3.2;
/** Enemy fire is quieter than yours — they are not trying to stay hidden. */
const ENEMY_SHOT_NOISE = 16;
/** A detonation is heard across most of the map, and pulls attention off you. */
const BOMB_NOISE = 30;
/** Roughly head height across the cast, so the ?/! clears the tallest rig. */
const MARK_HEIGHT = 2.1;
/** Chest height — where a bloom reads as "this body was hit". */
const BODY_HEIGHT = 1;
/** Where a round visually strikes, a little below centre mass. */
const IMPACT_HEIGHT = 0.85;
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
  private readonly aimIndicator: AimIndicator;
  private readonly visionCones: VisionCones;
  private readonly alertMarks: AlertMarks;
  private readonly hitFlashes = new HitFlashes();
  private readonly beacon: Beacon;
  private readonly extraction: Extraction;
  private readonly ledger: CargoLedger;
  private readonly carry: CarrySystem;
  private readonly combat: CombatSystem;
  private readonly meetings: MeetingSystem;
  private readonly bombs: BombSystem;
  private readonly pickups: PickupSystem;
  private readonly loadout = new Loadout();
  private readonly noise = new NoiseBus();
  private readonly director: Director;
  private readonly audio: AudioSystem;
  /** Dismisses an open invite, if one is up. */
  private closeInvite: (() => void) | null = null;

  private state: State = 'briefing';
  private hp = MAX_HP;
  /**
   * Run tally, reported to the CLI so a commit can carry how it was earned.
   *
   * Counters only — nothing here is ever read back by gameplay, and nothing
   * here decides what happens to a file. Keep it that way: the moment a stat
   * feeds a rule, `CargoLedger` stops being the single answer to "which files
   * survived".
   */
  private readonly tally = { seconds: 0, hitsTaken: 0, kills: 0, recovered: 0 };
  /** 0..1, kicked on each trigger pull, decayed in render. */
  private shotFlash = 0;
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

    // Its own stream, forked off the mission seed. The same commit still gets
    // the same map, but the generator draws a seed-dependent number of times —
    // it retries a leg that would have merged into the route beside it — so
    // sharing the mission stream would make every tweak to level generation
    // silently re-roll enemy pacing and loot as well.
    this.map = buildRoute(new Rng(hashString(mission.seed) ^ 0x3a17), {
      cols: mission.arenaCells,
      rows: mission.arenaCells,
      files: mission.files.length,
    });
    this.scene.add(this.map.group);
    this.scene.add(createFloor(this.map.grid.width, this.map.grid.depth, this.map.parks));

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
        onPickup: (record, recovered) => {
          this.hud.flash(`SECURED ${basename(record.name)}`, 'good');
          this.audio.play('cargo-secured');
          if (recovered) this.tally.recovered += 1;
        },
        onStash: (record) => {
          this.hud.flash(`STASHED ${basename(record.name)}`, 'info');
          this.audio.play('cargo-stashed');
        },
      },
    );

    // A private stream for scatter. Seeded, so a replay of the same commit
    // fires identically — but forked off the mission seed rather than shared
    // with it, so firing can never perturb map generation or spawn pacing.
    const combatRng = new Rng(hashString(mission.seed) ^ 0x5ee1);
    this.combat = new CombatSystem(this.scene, this.map.grid, this.loadout, combatRng, this.noise, {
      onEnemyKilled: (enemy) => this.onEnemyKilled(enemy),
      onPlayerShot: (weapon, x, z) => {
        this.audio.play(shotCue(weapon), x, z);
        this.shotFlash = 1;
      },
      onEnemyHit: (enemy, x, z) => {
        this.audio.play('enemy-hit', x, z);
        // Two beats: a small spark where the round struck, and a bloom over
        // the body so you can tell *which* of a pack you actually hit.
        this.hitFlashes.spawn(x, IMPACT_HEIGHT, z, 1, FLASH.spark, 0.14);
        this.hitFlashes.spawn(
          enemy.x,
          BODY_HEIGHT,
          enemy.z,
          2.1 + enemy.radius * 2,
          FLASH.hit,
          0.22,
        );
      },
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
    this.aimIndicator = new AimIndicator();
    this.scene.add(this.aimIndicator.group);
    this.visionCones = new VisionCones();
    this.scene.add(this.visionCones.group);
    this.scene.add(this.hitFlashes.group);
    this.alertMarks = new AlertMarks();
    this.scene.add(this.alertMarks.group);

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

    // Simulated time, so hitstop and slow-motion don't inflate the clock and a
    // paused run doesn't tick at all.
    this.tally.seconds += dt;

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

    // Checked right after the carry system, because that is the only thing that
    // can move a crate into `lost`. Once everything has decayed there is
    // nothing left to extract, so the run is already over — walking the rest of
    // the route would end in a "win" that commits nothing.
    if (this.ledger.allLost) {
      this.finish('loss', 'wiped');
      return;
    }

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

  /**
   * How hard the player is to miss, 0..1.
   *
   * REBUILD.md asked for this from the start — "more carried = enemies aggro
   * from further away" — and it went unbuilt for the whole rebuild. It is what
   * stops "carry everything" being the default rather than a decision.
   */
  private conspicuous(): number {
    const total = this.mission.files.length;
    return total === 0 ? 0 : this.ledger.carriedCount / total;
  }

  private enemyContext(): EnemyContext {
    return {
      bodyX: this.player.x,
      bodyZ: this.player.z,
      playerCarrying: this.ledger.carriedCount,
      conspicuous: this.conspicuous(),
      grid: this.map.grid,
      rng: this.rng,
      time: Time.real,
      extracting: this.extraction.progress > 0,
      padX: this.map.extraction.x,
      padZ: this.map.extraction.z,
      noise: (x, z, radius) => this.noise.emit(x, z, radius),
      fire: (opts) => {
        this.combat.projectiles.spawn({ ...opts, faction: Faction.Enemy });
        this.audio.play('shot-enemy', opts.x, opts.z);
        // Enemy fire is a noise too, or the player learns that only their own
        // gun gives them away.
        this.noise.emit(opts.x, opts.z, ENEMY_SHOT_NOISE);
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
    this.tally.kills += 1;
    // Bigger, slower and a different colour from a hit, so "it died" and "it
    // took one" are never the same read.
    this.hitFlashes.spawn(
      enemy.x,
      BODY_HEIGHT,
      enemy.z,
      3.4 + enemy.radius * 2,
      FLASH.kill,
      0.38,
    );
    this.rollDrop(enemy);

    // Killing one bro makes the rest speed up. "He's just early."
    if (enemy instanceof AiBro) {
      for (const other of this.combat.enemies) {
        if (other instanceof AiBro && !other.dying) other.rally();
      }
      return;
    }
    if (enemy instanceof InviteStorm) this.hud.flash('INVITE SERIES CANCELLED', 'good');
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
    // Chokepoints, not the trunk at large: a weapon placed at a fixed fraction
    // along the route can land inside a stretch an alternate skips, and the
    // player who took the other way never sees it. The two ways round are meant
    // to be equivalent, so what is on them has to be too.
    const route = this.map.chokepoints.length >= 3 ? this.map.chokepoints : this.map.waypoints;
    if (route.length < 3) return;
    const early = route[Math.max(1, Math.floor(route.length * 0.3))];
    const late = route[Math.min(route.length - 2, Math.floor(route.length * 0.7))];
    this.pickups.place({ kind: 'weapon', id: 'smg' }, early, true);
    this.pickups.place({ kind: 'weapon', id: 'shotgun' }, late, true);
  }

  /**
   * @returns false to leave the pickup on the ground.
   *
   * Ammo no longer requires already holding the gun. Refusing it meant walking
   * past shells you could see and could not use, which reads as a bug rather
   * than as an incentive — and `Loadout.addAmmo` already does the sensible
   * thing, handing you that weapon with a partial load. The cost is that
   * collecting ammo for something else swaps what you're holding, since the
   * loadout carries exactly one weapon.
   */
  private onPickup(offer: PickupOffer, firstTouch: boolean): boolean {
    if (offer.kind === 'health') {
      // Nothing to give under a rule with no health to give.
      if (this.mission.rules.death !== 'health' || this.hp >= MAX_HP) {
        if (firstTouch) {
          this.hud.flash(this.hp >= MAX_HP ? 'HEALTH FULL' : 'NO USE FOR IT', 'info');
          this.audio.play('pickup-refused');
        }
        return false;
      }
      this.hp = Math.min(MAX_HP, this.hp + offer.amount);
      this.hud.flash(`+${offer.amount} HP`, 'good');
      this.audio.play('meeting-attended');
      return true;
    }

    if (offer.kind === 'weapon') {
      this.loadout.equip(offer.id);
      this.player.setWeapon(offer.id);
      const spec = WEAPONS[offer.id];
      this.hud.announce(spec.name.toUpperCase(), `${spec.ammo ?? '∞'} rounds`, 'good');
      this.audio.play('pickup-weapon');
      return true;
    }

    // Only refuse a top-up you genuinely cannot use: the gun you're already
    // holding, already full.
    if (this.loadout.id === offer.id && this.loadout.ammo !== null) {
      if (this.loadout.ammo >= (this.loadout.maxAmmo ?? 0)) {
        if (firstTouch) {
          this.hud.flash('AMMO FULL', 'info');
          this.audio.play('pickup-refused');
        }
        return false;
      }
    }

    const swapping = this.loadout.id !== offer.id;
    this.loadout.addAmmo(offer.id, offer.rounds);
    this.player.setWeapon(offer.id);
    const name = WEAPONS[offer.id].name.toUpperCase();
    this.hud.flash(swapping ? `${name} ×${offer.rounds}` : `+${offer.rounds} ${name}`, 'good');
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
    // The stampede pays out, but rarely and never a weapon. Two dozen bodies at
    // the old 30% would carpet the route in guns; at 8%, ammo or a medkit, a
    // herd is worth two or three pickups. That is the difference between the
    // stampede being purely something to run from and something you might
    // choose to stand and thin out — which matters more now that it arrives
    // during the extraction hold, when running is not an option.
    if (enemy instanceof AiBro) {
      if (this.rng.next() > 0.08) return;
      const offer: PickupOffer =
        this.rng.next() < 0.45
          ? { kind: 'health', amount: 1 }
          : { kind: 'ammo', id: 'smg', rounds: 40 };
      this.pickups.place(offer, { x: enemy.x, z: enemy.z });
      return;
    }

    let chance = 0.3;
    if (enemy instanceof InviteStorm) chance = 1;
    if (this.rng.next() > chance) return;

    const roll = this.rng.next();
    let offer: PickupOffer;
    if (enemy instanceof InviteStorm) {
      // The boss always pays out properly.
      offer = { kind: 'weapon', id: 'shotgun' };
    } else if (roll < 0.24) {
      offer = { kind: 'health', amount: 1 };
    } else if (roll < 0.68) {
      const id = this.rng.next() < 0.6 ? 'smg' : 'shotgun';
      offer = { kind: 'ammo', id, rounds: id === 'smg' ? 55 : 9 };
    } else if (roll < 0.9) {
      offer = { kind: 'weapon', id: 'smg' };
    } else {
      offer = { kind: 'weapon', id: 'shotgun' };
    }

    this.pickups.place(offer, { x: enemy.x, z: enemy.z });
  }

  private onBombDetonated(x: number, z: number): void {
    if (this.state !== 'playing') return;
    this.audio.play('bomb-detonate', x, z);
    // Not your noise, and a gift: it drags attention to the crater rather than
    // to you. Worth stepping out of a blast you could have tanked.
    this.noise.emit(x, z, BOMB_NOISE);

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
    this.tally.hitsTaken += 1;
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
  private finish(outcome: Outcome, cause?: DebriefReason): void {
    if (this.state === 'debrief') return;
    this.state = 'debrief';

    // Reaching the pad with nothing on your back is not a win. Reporting it as
    // one made the CLI print a success banner and then exit 1, which is
    // incoherent — and it would have committed nothing either way.
    const empty = outcome === 'win' && this.ledger.result(outcome).surviving.length === 0;
    const finalOutcome: Outcome = empty ? 'loss' : outcome;
    const reason: DebriefReason = empty
      ? 'empty-handed'
      : outcome === 'win'
        ? 'extracted'
        : (cause ?? 'down');

    this.audio.play(finalOutcome === 'win' ? 'extracted' : 'failed');
    this.audio.fadeMusicOut();

    const result = this.ledger.result(finalOutcome);
    this.git?.sendResult(finalOutcome, {
      ...result,
      stats: {
        seconds: this.tally.seconds,
        hitsTaken: this.tally.hitsTaken,
        hpRemaining: Math.max(0, this.hp),
        hpMax: MAX_HP,
        kills: this.tally.kills,
        recovered: this.tally.recovered,
      },
    });
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
    // Decays on real time so the kick reads the same through hitstop.
    this.shotFlash = Math.max(0, this.shotFlash - realDt * 6);
    this.aimIndicator.update(
      this.combat.aimEnvelope(this.player),
      this.state === 'playing' && !this.player.isRolling,
      this.shotFlash,
    );
    this.updateVisionCones(realDt);
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
   * exercised before enemies exist (M3). F4 cycles the loadout — the three
   * weapons are otherwise gated behind pickups a third and two thirds of the
   * way along the route, which is a long walk to check a spread change.
   */
  private bindDebugKeys(): () => void {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'F1') {
        e.preventDefault();
        this.takeHit();
      } else if (e.code === 'F2') {
        e.preventDefault();
        this.finish('loss');
      } else if (e.code === 'F5') {
        // Drop one of each loot kind at your feet. Kill-drops are rare by
        // design, which makes the pickup paths — and especially the medkit,
        // which only exists under the health rule — otherwise very tedious to
        // exercise by hand.
        e.preventDefault();
        this.pickups.place({ kind: 'health', amount: 1 }, { x: this.player.x + 2, z: this.player.z });
        this.pickups.place(
          { kind: 'ammo', id: 'shotgun', rounds: 9 },
          { x: this.player.x - 2, z: this.player.z },
        );
        this.hud.flash('DEV — LOOT', 'info');
      } else if (e.code === 'F4') {
        e.preventDefault();
        const next =
          WEAPON_ORDER[(WEAPON_ORDER.indexOf(this.loadout.id) + 1) % WEAPON_ORDER.length];
        this.loadout.equip(next);
        this.player.setWeapon(next);
        this.hud.flash(`DEV — ${WEAPONS[next].name}`, 'info');
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
   * bro jogs, the boss hovers. Dispatching on type here keeps that animation
   * code next to the behaviour it belongs to.
   */
  private syncEnemies(alpha: number): void {
    for (const enemy of this.combat.enemies) {
      if (enemy instanceof AiBro) enemy.syncBro(alpha);
      else if (enemy instanceof InviteStorm) enemy.syncStorm(alpha);
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

  /**
   * Draw the nearest few vision cones.
   *
   * Uses the simulation position rather than the interpolated one: the cone
   * describes what the enemy can see *now*, and a cone that lags the body it
   * belongs to reads as a rendering fault rather than a smoothing choice.
   */
  private updateVisionCones(realDt: number): void {
    this.visionCones.begin(this.player.x, this.player.z);
    this.alertMarks.begin();
    if (this.state === 'playing') {
      for (const enemy of this.combat.enemies) {
        if (enemy.dying) continue;
        this.visionCones.add(enemy.x, enemy.z, enemy.sense);
        this.alertMarks.add(enemy.x, MARK_HEIGHT, enemy.z, enemy.sense);
      }
    }
    this.visionCones.end(Time.real);
    this.alertMarks.end();
    // Real time, so a kill keeps blooming through its own hitstop.
    this.hitFlashes.update(realDt);
  }

  /** Unaware / suspicious / alerted, so the stealth layer is inspectable. */
  private senseCounts(): string {
    let unaware = 0;
    let suspicious = 0;
    let alerted = 0;
    for (const enemy of this.combat.enemies) {
      if (enemy.dying) continue;
      if (enemy.sense.state === 'alerted') alerted++;
      else if (enemy.sense.state === 'suspicious') suspicious++;
      else unaware++;
    }
    return `U:${unaware} S:${suspicious} A:${alerted}`;
  }

  private debugText(): string {
    const p = this.player;
    const r = this.mission.rules;
    const e = this.combat.aimEnvelope(p);
    return [
      `fps      ${this.loop.fps.toFixed(0)}`,
      `state    ${this.state}`,
      `pos      ${p.x.toFixed(1)}, ${p.z.toFixed(1)}  ${p.speed.toFixed(1)} u/s`,
      `player   ${p.isRolling ? 'ROLL' : p.invulnerable ? 'IFRAME' : 'ok'}`,
      `rules    loss=${r.loss} death=${r.death} stash=${r.stash}`,
      `hp       ${r.death === 'health' ? `${this.hp}/${MAX_HP}` : 'n/a'}`,
      `weapon   ${this.loadout.weapon.name} ${this.loadout.ammo ?? '∞'}`,
      `aim      c${e.centre.toFixed(1)} l${e.left.toFixed(1)} r${e.right.toFixed(1)} · spread ${e.halfAngle.toFixed(3)}`,
      `cargo    ${this.ledger.carriedCount} carried · ${this.ledger.dropped.length} dropped · ${this.ledger.stashed.length} stashed · ${this.ledger.lost.length} lost`,
      `hold     ${(this.extraction.progress * 100).toFixed(0)}%`,
      `enemies  ${this.combat.liveEnemies} · ${this.combat.projectiles.activeCount} shots · ${this.meetings.meetings.length} meetings`,
      `sense    ${this.senseCounts()} · ${this.visionCones.drawn} cones · conspicuous ${this.conspicuous().toFixed(2)}`,
      `flash    ${this.hitFlashes.live} live · ${this.hitFlashes.spawned} total`,
      `draws    ${this.renderer.info.render.calls}`,
      '',
      'WASD move · LMB fire · space dodge · Q drop · E stash · F1 hit · F2 fail · F4 weapon · F5 loot',
    ].join('\n');
  }
}
