/**
 * chiptune3 ships no types. Only the surface `systems/music.ts` uses is
 * declared here — if you reach for more of the library, add it here first.
 * Upstream: https://github.com/DrSnuggles/chiptune
 */
declare module 'chiptune3' {
  export interface ChiptuneConfig {
    /** -1 loops forever, 0 plays once. */
    repeatCount?: number;
    /** Percent. */
    stereoSeparation?: number;
    interpolationFilter?: number;
    /** Supply a context and the player renders into it instead of making its own. */
    context?: AudioContext;
  }

  export class ChiptuneJsPlayer {
    constructor(config?: ChiptuneConfig);
    /** Left unconnected when a context is supplied — the caller must route it. */
    readonly gain: GainNode;
    load(url: string): void;
    play(data: ArrayBuffer): void;
    stop(): void;
    pause(): void;
    unpause(): void;
    setVol(volume: number): void;
    setRepeatCount(count: number): void;
    onInitialized(handler: () => void): void;
    onEnded(handler: () => void): void;
    onError(handler: (error: { type: string }) => void): void;
  }
}
