import type { ChiptuneJsPlayer } from 'chiptune3';
import { CHIPTUNE_WORKLET, MUSIC_FALLBACK, MUSIC_TRACK } from '../assets/manifest';

/** Formats only libopenmpt can play. Everything else goes to the browser. */
const TRACKER_FORMATS = /\.(xm|it|mod|s3m|mptm|mtm|umx)$/i;

/**
 * How long to wait for libopenmpt to compile before giving up on it. The
 * worklet is 1.5MB of JS and wasm; on a cold cache and a slow machine it is
 * genuinely a couple of seconds, so this is deliberately generous.
 */
const WORKLET_TIMEOUT_MS = 10_000;
/**
 * Track-level trim, so the bus gain is free for ducking.
 *
 * Per-track, and measured rather than guessed: the current mp3 peaks at 0.82
 * in the file where the chiptune peaked at 0.45, so it needs roughly half the
 * trim to land in the same place under the guns. Re-measure when the track in
 * `MUSIC_TRACK` changes — a hotter master here just buries the SFX.
 */
const TRACK_VOLUME = 0.32;

/**
 * The soundtrack.
 *
 * Two engines, chosen off the file extension: a tracker module goes through
 * libopenmpt in an AudioWorklet, and anything else is decoded by the browser
 * and looped. The worklet route is a lot of moving parts for background music,
 * so every one of them is allowed to fail — worst case the game is quiet.
 * Music must never be able to stop a run from starting.
 *
 * Everything here renders into the gain node it is handed; volume, ducking and
 * muting are the audio bus's business, not this file's.
 */
export class MusicPlayer {
  private player: ChiptuneJsPlayer | null = null;
  private fallback: AudioBufferSourceNode | null = null;
  private stopped = false;

  constructor(
    private readonly ctx: AudioContext,
    private readonly out: GainNode,
  ) {}

  /** Resolves once something is playing, or once we've stopped trying. */
  async start(): Promise<void> {
    if (!TRACKER_FORMATS.test(MUSIC_TRACK)) {
      try {
        await this.startDecoded(MUSIC_TRACK);
      } catch (error) {
        console.warn('music: disabled', error);
      }
      return;
    }

    try {
      await this.startModule();
      return;
    } catch (error) {
      console.warn('music: tracker playback unavailable, falling back', error);
    }
    if (!MUSIC_FALLBACK) return;
    try {
      await this.startDecoded(MUSIC_FALLBACK);
    } catch (error) {
      console.warn('music: disabled', error);
    }
  }

  stop(): void {
    this.stopped = true;
    this.player?.stop();
    try {
      this.fallback?.stop();
    } catch {
      // Already stopped, or never started.
    }
    this.fallback = null;
  }

  private async startModule(): Promise<void> {
    const { ChiptuneJsPlayer } = await import('chiptune3');

    // chiptune3 loads its worklet from `new URL('./chiptune3.worklet.js',
    // import.meta.url)`, which points into node_modules in dev and at a hashed
    // bundle asset in a build — neither of which can find the libopenmpt module
    // it imports next to itself. The copy that *does* work is the one
    // postinstall puts in public/audio, so redirect the one call that matters.
    // Patched around the constructor alone: it calls addModule synchronously,
    // and a permanently monkey-patched context would be a trap for anything
    // else that ever wants a worklet.
    const audioWorklet = this.ctx.audioWorklet;
    const original = audioWorklet.addModule.bind(audioWorklet);
    audioWorklet.addModule = (url, options) => {
      const href = url instanceof URL ? url.href : String(url);
      return original(href.includes('chiptune3.worklet') ? CHIPTUNE_WORKLET : href, options);
    };
    let player: ChiptuneJsPlayer;
    try {
      player = new ChiptuneJsPlayer({ context: this.ctx, repeatCount: -1 });
    } finally {
      audioWorklet.addModule = original;
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('chiptune3 worklet timed out')), WORKLET_TIMEOUT_MS);
      player.onError((error) => {
        clearTimeout(timer);
        reject(new Error(`chiptune3: ${error.type}`));
      });
      player.onInitialized(() => {
        clearTimeout(timer);
        resolve();
      });
    });

    if (this.stopped) {
      player.stop();
      return;
    }

    // chiptune3 only wires its gain to a destination when it owns the context.
    // Given ours, it leaves the last hop to us — which is what we want anyway,
    // because that hop is the music bus.
    player.gain.connect(this.out);
    player.setVol(TRACK_VOLUME);
    player.load(MUSIC_TRACK);
    this.player = player;
  }

  /**
   * Anything the browser can decode: mp3, ogg, wav. Costs a bigger download
   * than a module and needs no wasm, but the loop is only as seamless as the
   * file — an mp3 in particular carries encoder padding at both ends.
   */
  private async startDecoded(path: string): Promise<void> {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`music: ${response.status}`);
    const buffer = await this.ctx.decodeAudioData(await response.arrayBuffer());
    if (this.stopped) return;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const trim = this.ctx.createGain();
    trim.gain.value = TRACK_VOLUME;
    source.connect(trim).connect(this.out);
    source.start();
    this.fallback = source;
  }
}
