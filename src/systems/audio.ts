import { Rng } from '../core/rng';
import { SOUND_BANKS, type SoundBank } from '../assets/manifest';
import { MusicPlayer } from './music';
import type { WeaponId } from './weapons';

/**
 * Everything the game can be heard doing.
 *
 * Cues are named for the event, never for the file — `Game` says what just
 * happened and this system decides what that sounds like. That line is the
 * whole point of the module: no mixing decision, distance curve or bit of
 * pitch variance is allowed to leak into `game.ts`.
 */
export type Cue =
  | 'deploy'
  | 'shot-pistol'
  | 'shot-smg'
  | 'shot-shotgun'
  | 'shot-enemy'
  | 'enemy-hit'
  | 'enemy-killed'
  | 'player-hit'
  | 'dodge'
  | 'out-of-ammo'
  | 'cargo-secured'
  | 'cargo-dropped'
  | 'cargo-lost'
  | 'cargo-stashed'
  | 'pickup-weapon'
  | 'pickup-ammo'
  | 'pickup-refused'
  | 'bomb-thrown'
  | 'bomb-detonate'
  | 'invite-opened'
  | 'invite-declined'
  | 'invite-accepted'
  | 'meeting-attended'
  | 'meeting-missed'
  | 'event-info'
  | 'event-warn'
  | 'event-bad'
  | 'extraction-enter'
  | 'extraction-beat'
  | 'extracted'
  | 'failed';

interface CueSpec {
  bank: SoundBank;
  /** Peak gain before distance falls off, 0..1. */
  gain: number;
  /** Playback-rate range — the same take with a different throat. */
  rate?: [number, number];
  /** Mixed by distance and side. A cue with no position is always centred. */
  spatial?: boolean;
  /** Seconds this cue must wait before it can retrigger. */
  gap?: number;
  /** Simultaneous voices allowed for this cue alone. */
  voices?: number;
  /** How far the music dips while this plays, 0..1. */
  duck?: number;
  /** Who wins when voices run out. Ambient chatter is 0. */
  priority?: number;
}

/**
 * The mix, in one table.
 *
 * Read it as the game's sound design: the machine gun is quiet and thin
 * because it plays thirteen times a second, the shotgun is slow and heavy
 * enough to duck the music, and anything that costs you a file is loud,
 * high-priority and cannot be drowned out by the fight it happened during.
 */
const CUES: Record<Cue, CueSpec> = {
  deploy: { bank: 'select', gain: 0.45, priority: 4 },

  'shot-pistol': { bank: 'shootLight', gain: 0.3, rate: [0.94, 1.02], spatial: true, voices: 3 },
  // Thin, quiet and pitched up, because thirteen a second of anything heavier
  // is a chainsaw. The gap is a floor under the fire rate, not a limiter.
  'shot-smg': {
    bank: 'shootFast',
    gain: 0.15,
    rate: [1.08, 1.2],
    spatial: true,
    voices: 4,
    gap: 0.05,
  },
  'shot-shotgun': {
    bank: 'shootHeavy',
    gain: 0.42,
    rate: [0.76, 0.86],
    spatial: true,
    voices: 2,
    duck: 0.15,
    priority: 1,
  },
  'shot-enemy': {
    bank: 'shootEnemy',
    gain: 0.24,
    rate: [0.95, 1.08],
    spatial: true,
    voices: 4,
    gap: 0.04,
    priority: 1,
  },

  'enemy-hit': {
    bank: 'impact',
    gain: 0.2,
    rate: [1.35, 1.6],
    spatial: true,
    voices: 3,
    gap: 0.045,
  },
  'enemy-killed': {
    bank: 'thud',
    gain: 0.34,
    rate: [0.82, 0.96],
    spatial: true,
    voices: 3,
    gap: 0.06,
    priority: 1,
  },
  // Not spatial: it happened to you, so it is always dead centre and loud
  // enough to cut through whatever else is going on.
  'player-hit': { bank: 'hurt', gain: 0.7, rate: [0.95, 1.05], gap: 0.2, duck: 0.35, priority: 3 },
  dodge: { bank: 'jump', gain: 0.22, rate: [0.92, 1.08], gap: 0.15 },
  'out-of-ammo': { bank: 'error', gain: 0.4, rate: [0.88, 0.94], priority: 2 },

  // Cargo is the whole game, so cargo is the loudest thing in it.
  'cargo-secured': { bank: 'coin', gain: 0.45, rate: [1, 1.08], priority: 2 },
  'cargo-dropped': { bank: 'fall', gain: 0.5, rate: [0.9, 1], duck: 0.25, priority: 3 },
  'cargo-lost': { bank: 'alarm', gain: 0.6, duck: 0.5, priority: 4 },
  'cargo-stashed': { bank: 'select', gain: 0.4, rate: [0.84, 0.9], priority: 2 },

  'pickup-weapon': { bank: 'coin', gain: 0.5, rate: [0.7, 0.78], priority: 2 },
  'pickup-ammo': { bank: 'coin', gain: 0.38, rate: [1.15, 1.25], priority: 2 },
  'pickup-refused': { bank: 'error', gain: 0.24, rate: [1.2, 1.32], gap: 0.6 },

  'bomb-thrown': { bank: 'jump', gain: 0.3, rate: [0.58, 0.68], spatial: true, priority: 2 },
  'bomb-detonate': {
    bank: 'explosion',
    gain: 0.85,
    rate: [0.85, 1],
    spatial: true,
    duck: 0.5,
    priority: 3,
  },
  'invite-opened': { bank: 'error', gain: 0.5, rate: [0.78, 0.86], priority: 3 },
  'invite-declined': { bank: 'select', gain: 0.45, rate: [1.08, 1.16], priority: 2 },
  'invite-accepted': { bank: 'alarm', gain: 0.4, rate: [0.94, 1], priority: 2 },

  'meeting-attended': { bank: 'coin', gain: 0.5, rate: [0.84, 0.9], priority: 3 },
  'meeting-missed': { bank: 'alarm', gain: 0.5, duck: 0.4, priority: 3 },

  'event-info': { bank: 'select', gain: 0.4, rate: [0.88, 0.94], priority: 3 },
  'event-warn': { bank: 'error', gain: 0.5, rate: [0.84, 0.9], duck: 0.4, priority: 4 },
  'event-bad': { bank: 'stinger', gain: 0.55, duck: 0.6, priority: 4 },

  'extraction-enter': { bank: 'select', gain: 0.5, rate: [0.68, 0.74], priority: 4 },
  'extraction-beat': { bank: 'impact', gain: 0.28, rate: [0.88, 0.92], priority: 2 },
  extracted: { bank: 'coin', gain: 0.7, rate: [0.6, 0.62], priority: 5 },
  failed: { bank: 'stinger', gain: 0.7, rate: [0.86, 0.92], priority: 5 },
};

/** Which cue a weapon fires with. A sound-design decision, so it lives here. */
const SHOT_CUES: Record<WeaponId, Cue> = {
  pistol: 'shot-pistol',
  smg: 'shot-smg',
  shotgun: 'shot-shotgun',
};

export function shotCue(weapon: WeaponId): Cue {
  return SHOT_CUES[weapon];
}

/** How loudly an arriving event announces itself, by how bad it is. */
const EVENT_CUES: Record<'info' | 'warn' | 'bad', Cue> = {
  info: 'event-info',
  warn: 'event-warn',
  bad: 'event-bad',
};

export function eventCue(kind: 'info' | 'warn' | 'bad'): Cue {
  return EVENT_CUES[kind];
}

const MASTER_GAIN = 0.9;
const SFX_GAIN = 0.85;
/** Everything at once is noise. Past this, the quiet and the old give way. */
const MAX_VOICES = 20;
/** Distance at which a sound is at half gain. Tuned against the camera's reach. */
const REFERENCE_DISTANCE = 11;
/** Past this, don't bother spawning a voice at all. */
const MAX_AUDIBLE = 55;
/** World units from the player to a hard-left or hard-right mix. */
const PAN_REACH = 20;
/** Never fully one-sided — a sound with nothing in the other ear is disorienting. */
const MAX_PAN = 0.85;
/** How quiet the world goes behind the pause menu. */
const PAUSED_GAIN = 0.2;
/** Seconds the music takes to climb back after a duck. */
const DUCK_RELEASE = 1.1;

/**
 * Makeup gain on the rumble bed. Filtered noise comes out at a fraction of the
 * amplitude it went in with, so this is measured, not chosen: it puts a herd
 * at full weight around a quarter of full scale — felt under the mix on a
 * laptop speaker, still well clear of anything else.
 */
const RUMBLE_GAIN = 6;
/** The extraction beat, slowest at the start of the hold and fastest at the end. */
const BEAT_SLOW = 0.95;
const BEAT_FAST = 0.34;

interface Voice {
  source: AudioBufferSourceNode;
  priority: number;
  cue: Cue;
  startedAt: number;
}

/**
 * The game's ears.
 *
 * One AudioContext, three buses (sfx, music, and a synthesised ground rumble),
 * and a pool of one-shot voices. `Game` calls `play(cue, x, z)` and nothing
 * else: how loud, how panned, how many at once, what gets dropped when the
 * fight is loud and what the music does underneath it are all decided here.
 *
 * Nothing exists until `unlock()`. Browsers refuse to start an AudioContext
 * before the user has interacted with the page, and a context created early
 * just sits suspended and warns — so the samples are fetched at construction
 * and the audio graph is built by the Deploy button.
 */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private rumbleGain: GainNode | null = null;
  private rumbleDepth: GainNode | null = null;
  private music: MusicPlayer | null = null;

  /** Raw file bytes, fetched before we are allowed a context to decode them. */
  private readonly encoded = new Map<string, Promise<ArrayBuffer | null>>();
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly voices: Voice[] = [];
  private readonly lastPlayed = new Map<Cue, number>();

  private listenerX = 0;
  private listenerZ = 0;
  private rumble = 0;
  private duckUntil = 0;
  private duckDepth = 0;
  /** Once the track has been faded out, nothing is allowed to bring it back. */
  private musicFaded = false;
  private nextBeat = 0;
  private started = false;

  /**
   * Its own Rng, deliberately not the mission's. Drawing take and pitch from
   * the shared stream would make the map depend on how many shots you fired.
   */
  private readonly rng: Rng;

  constructor(private readonly options: { music: boolean; seed: string }) {
    this.rng = new Rng(`${options.seed}:audio`);
    for (const paths of Object.values(SOUND_BANKS)) {
      for (const path of paths) this.prefetch(path);
    }
  }

  /**
   * Turn the sound on. Must be called from a user gesture — the briefing's
   * Deploy button is the only one the game is guaranteed to get.
   *
   * Fire and forget: nothing here is allowed to hold up the start of a run.
   */
  unlock(): void {
    if (this.started) return;
    this.started = true;

    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
    } catch {
      return; // No audio on this machine. The game is still perfectly playable.
    }
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = MASTER_GAIN;
    this.master.connect(ctx.destination);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = SFX_GAIN;
    this.sfx.connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 1;
    this.musicBus.connect(this.master);

    this.buildRumble(ctx, this.master);

    void ctx.resume();
    void this.decodeAll().then(() => this.play('deploy'));

    if (this.options.music) {
      this.music = new MusicPlayer(ctx, this.musicBus);
      void this.music.start();
    }
  }

  /**
   * Where the player is. Everything positional is mixed relative to them
   * rather than to the camera — the camera leans toward the reticle, and a
   * mix that swings when you look around is seasickness.
   */
  setListener(x: number, z: number): void {
    this.listenerX = x;
    this.listenerZ = z;
  }

  play(cue: Cue, x?: number, z?: number): void {
    const ctx = this.ctx;
    const sfx = this.sfx;
    if (!ctx || !sfx) return;

    const spec = CUES[cue];
    const now = ctx.currentTime;

    const last = this.lastPlayed.get(cue) ?? -Infinity;
    if (spec.gap && now - last < spec.gap) return;

    let attenuation = 1;
    let pan = 0;
    if (spec.spatial && x !== undefined && z !== undefined) {
      const dx = x - this.listenerX;
      const dz = z - this.listenerZ;
      const distance = Math.hypot(dx, dz);
      if (distance > MAX_AUDIBLE) return;
      // Inverse-square-ish, which is what a real room does and what stops a
      // firefight two streets away from sitting on top of you.
      attenuation = 1 / (1 + (distance / REFERENCE_DISTANCE) ** 2);
      pan = clamp(dx / PAN_REACH, -1, 1) * MAX_PAN;
    }

    const buffer = this.pick(spec.bank);
    if (!buffer) return; // Still decoding — better silent than late.

    const priority = spec.priority ?? 0;
    if (!this.claimVoice(cue, spec, priority)) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = spec.rate
      ? this.rng.range(spec.rate[0], spec.rate[1])
      : this.rng.range(0.97, 1.03);

    const gain = ctx.createGain();
    gain.gain.value = spec.gain * attenuation;

    if (pan !== 0) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      source.connect(panner).connect(gain).connect(sfx);
    } else {
      source.connect(gain).connect(sfx);
    }

    const voice: Voice = { source, priority, cue, startedAt: now };
    source.onended = () => {
      const i = this.voices.indexOf(voice);
      if (i !== -1) this.voices.splice(i, 1);
      source.disconnect();
      gain.disconnect();
    };
    source.start();

    this.voices.push(voice);
    this.lastPlayed.set(cue, now);
    if (spec.duck) this.duck(spec.duck);
  }

  /**
   * The stampede, felt rather than heard: filtered noise pulsing at roughly
   * the herd's footfall. 0..1, set every frame — the same number the camera
   * shakes to, so what you feel and what you hear are the same event.
   */
  setRumble(level: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.rumbleGain || !this.rumbleDepth) return;
    const target = clamp(level, 0, 1);
    // Called sixty times a second; only bother the graph when it moved.
    if (Math.abs(target - this.rumble) < 0.01) return;
    this.rumble = target;

    // Squared: a distant herd should be barely there, and the last few metres
    // of closing should be most of what you feel.
    const amplitude = target * target * 0.5 * RUMBLE_GAIN;
    this.rumbleGain.gain.setTargetAtTime(amplitude, ctx.currentTime, 0.15);
    this.rumbleDepth.gain.setTargetAtTime(amplitude, ctx.currentTime, 0.15);
  }

  /**
   * Drive the extraction beat. The pad ticks while you hold it, faster as the
   * commit gets closer — the pacing is a sound-design call, so the caller only
   * has to say whether the hold is running and how far along it is.
   */
  setExtraction(holding: boolean, progress: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!holding) {
      this.nextBeat = 0;
      return;
    }
    const now = ctx.currentTime;
    if (now < this.nextBeat) return;
    this.nextBeat = now + BEAT_SLOW + (BEAT_FAST - BEAT_SLOW) * clamp(progress, 0, 1);
    this.play('extraction-beat');
  }

  /** Pull the whole world down behind a menu, without stopping the music. */
  setPaused(paused: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setTargetAtTime(paused ? PAUSED_GAIN : MASTER_GAIN, ctx.currentTime, 0.08);
  }

  /** End of the run: take the track away and leave the debrief in silence. */
  fadeMusicOut(seconds = 1.6): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) return;
    // Set before the ramp, not after: a duck landing on the same frame as the
    // last cue of a run would otherwise schedule the track straight back up
    // underneath the debrief.
    this.musicFaded = true;
    const now = ctx.currentTime;
    this.musicBus.gain.cancelScheduledValues(now);
    this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, now);
    this.musicBus.gain.linearRampToValueAtTime(0.0001, now + seconds);
  }

  dispose(): void {
    this.music?.stop();
    for (const voice of this.voices.splice(0)) {
      voice.source.onended = null;
      try {
        voice.source.stop();
      } catch {
        // Already finished.
      }
    }
    void this.ctx?.close();
    this.ctx = null;
  }

  /**
   * Make room for a new voice.
   *
   * Two limits, because they solve different problems: a per-cue cap stops
   * twenty-five bros dying at once from becoming one long roar, and the global
   * cap stops the mix clipping. Both steal from the oldest, quietest thing
   * playing rather than refusing the new sound — the most recent event is
   * almost always the one the player needs to hear.
   */
  private claimVoice(cue: Cue, spec: CueSpec, priority: number): boolean {
    if (spec.voices) {
      const sameCue = this.voices.filter((v) => v.cue === cue);
      if (sameCue.length >= spec.voices) stopOldest(sameCue);
    }
    if (this.voices.length < MAX_VOICES) return true;

    const evictable = this.voices.filter((v) => v.priority <= priority);
    if (evictable.length === 0) return false;
    // The stolen voice's `onended` fires asynchronously, so it is briefly
    // still in the list. Harmless: it is already silent, and it tidies itself.
    stopOldest(evictable);
    return true;
  }

  private pick(bank: SoundBank): AudioBuffer | null {
    const paths = SOUND_BANKS[bank];
    const loaded = paths.filter((p) => this.buffers.has(p));
    if (loaded.length === 0) return null;
    return this.buffers.get(this.rng.pick(loaded))!;
  }

  /**
   * Dip the music so the thing that just happened can be heard over it, then
   * bring it back. A deeper duck always wins; a shallower one during a deep
   * duck is ignored rather than cutting it short.
   */
  private duck(amount: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus || this.musicFaded) return;
    const now = ctx.currentTime;
    if (now < this.duckUntil && amount <= this.duckDepth) return;

    this.duckDepth = amount;
    this.duckUntil = now + DUCK_RELEASE;
    const gain = this.musicBus.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(1 - amount, now + 0.04);
    gain.linearRampToValueAtTime(1, now + DUCK_RELEASE);
  }

  /**
   * A low, filtered noise bed with a slow pulse on it. Synthesised rather than
   * sampled because none of the one-shots in the pack loop, and because a herd
   * closing in has to build continuously rather than retrigger.
   */
  private buildRumble(ctx: AudioContext, out: GainNode): void {
    const seconds = 2;
    const noise = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = noise.getChannelData(0);
    // Brown-ish noise: integrated white, which puts the energy at the bottom
    // where a stampede lives instead of hissing.
    let value = 0;
    for (let i = 0; i < data.length; i++) {
      value = (value + this.rng.range(-0.06, 0.06)) * 0.985;
      data[i] = value * 3;
    }

    const source = ctx.createBufferSource();
    source.buffer = noise;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    // Low enough to sit under the guns, high enough that a laptop speaker can
    // still reproduce it — below ~150Hz most of them simply don't.
    filter.frequency.value = 240;
    filter.Q.value = 0.9;

    const output = ctx.createGain();
    output.gain.value = 0;

    // Footfall. The herd is a rhythm, not a drone.
    const pulse = ctx.createOscillator();
    pulse.frequency.value = 6.5;
    const depth = ctx.createGain();
    depth.gain.value = 0;
    pulse.connect(depth).connect(output.gain);

    source.connect(filter).connect(output).connect(out);
    source.start();
    pulse.start();

    this.rumbleGain = output;
    this.rumbleDepth = depth;
  }

  private prefetch(path: string): void {
    if (this.encoded.has(path)) return;
    this.encoded.set(
      path,
      fetch(path)
        .then((response) => (response.ok ? response.arrayBuffer() : null))
        .catch(() => null),
    );
  }

  private async decodeAll(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    await Promise.all(
      [...this.encoded].map(async ([path, pending]) => {
        const bytes = await pending;
        if (!bytes) return;
        try {
          this.buffers.set(path, await ctx.decodeAudioData(bytes));
        } catch {
          // One unreadable file should cost that one sound, nothing more.
        }
      }),
    );
  }
}

function stopOldest(voices: Voice[]): void {
  let oldest = voices[0];
  for (const voice of voices) {
    if (voice.priority < oldest.priority) oldest = voice;
    else if (voice.priority === oldest.priority && voice.startedAt < oldest.startedAt) oldest = voice;
  }
  try {
    oldest.source.stop();
  } catch {
    // Already finished; `onended` will tidy up.
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
