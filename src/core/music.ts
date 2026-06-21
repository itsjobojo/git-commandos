import { ChiptuneJsPlayer } from 'chiptune3';

let player: InstanceType<typeof ChiptuneJsPlayer> | null = null;
let audioCtx: AudioContext | null = null;
let initPromise: Promise<void> | null = null;
let pendingPath: string | null = null;
let currentVolume = 0.25;

export function initMusicPlayer(): Promise<void> {
  if (initPromise) return initPromise;

  initPromise = new Promise<void>((resolve) => {
    audioCtx = new AudioContext();

    // Remap chiptune3's internal worklet URL to our public/audio/ copy.
    // chiptune3 calls addModule(new URL('./chiptune3.worklet.js', import.meta.url))
    // which resolves incorrectly in a Vite bundle — intercept it on this context only.
    const orig = audioCtx.audioWorklet.addModule.bind(audioCtx.audioWorklet);
    (audioCtx.audioWorklet as AudioWorklet).addModule = (
      url: string | URL,
      options?: WorkletOptions
    ): Promise<void> => {
      const s = url instanceof URL ? url.href : url;
      const remapped = s.includes('chiptune3.worklet') ? './audio/chiptune3.worklet.js' : s;
      return orig(remapped, options);
    };

    player = new ChiptuneJsPlayer({ context: audioCtx });

    // chiptune3 skips connecting gain→destination when a custom context is passed
    player.onInitialized(() => {
      player!.gain.connect(audioCtx!.destination);
      player!.setVol(currentVolume);
      if (pendingPath) {
        audioCtx!.resume().then(() => player!.load(pendingPath!));
        pendingPath = null;
      }
      resolve();
    });
  });

  return initPromise;
}

export function playMusic(path = './music/chiptune.xm', volume = 0.25): void {
  currentVolume = volume;
  if (!player || !audioCtx) {
    pendingPath = path;
    return;
  }
  player.stop();
  player.setVol(volume);
  audioCtx.resume().then(() => player!.load(path));
}

export function stopMusic(): void {
  player?.stop();
}

export function setMusicVolume(volume: number): void {
  currentVolume = volume;
  player?.setVol(volume);
}
