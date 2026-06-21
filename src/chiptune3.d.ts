declare module 'chiptune3' {
  export class ChiptuneJsPlayer {
    gain: GainNode;
    context: AudioContext;
    constructor(cfg?: { context?: AudioContext; repeatCount?: number; stereoSeparation?: number; interpolationFilter?: number });
    load(url: string): void;
    play(buffer: ArrayBuffer): void;
    stop(): void;
    setVol(val: number): void;
    onInitialized(handler: () => void): void;
    onEnded(handler: () => void): void;
    onError(handler: (e: { type: string }) => void): void;
  }
}
