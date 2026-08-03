import { ACESFilmicToneMapping, PCFShadowMap, SRGBColorSpace, WebGLRenderer } from 'three';
import { PALETTE } from './palette';

/**
 * WebGL renderer + resize handling. DPR is clamped: a 3x retina display at
 * 1440p would otherwise cost 4x the fill rate for no visible gain in a game
 * this stylised.
 */
export function createRenderer(canvas: HTMLCanvasElement): WebGLRenderer {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    stencil: false,
  });

  renderer.setClearColor(PALETTE.void, 1);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  // Applied after bloom, in OutputPass, so raising it lifts the final image
  // without feeding the bloom threshold any more to work with.
  renderer.toneMappingExposure = 1.45;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;

  // `info` resets itself on every `render()`, and the post chain calls render
  // several times a frame — so the debug readout was showing the cost of the
  // final fullscreen quad and nothing else. Reset once per frame instead, from
  // the game loop, so the number means the whole frame again.
  renderer.info.autoReset = false;

  return renderer;
}

export function fitToWindow(renderer: WebGLRenderer, onResize: (w: number, h: number) => void): () => void {
  const apply = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    onResize(w, h);
  };
  apply();
  window.addEventListener('resize', apply);
  return () => window.removeEventListener('resize', apply);
}
