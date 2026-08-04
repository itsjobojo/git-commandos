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
  // Applied after bloom, in OutputPass, so moving it changes the final image
  // without feeding the bloom threshold any more or less to work with — which
  // is exactly what a night pass wants: the concrete comes down, the lit
  // windows and the tracers keep their glow.
  renderer.toneMappingExposure = 1.34;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;

  // `info` resets itself on every `render()`, and the post chain calls render
  // several times a frame — so the debug readout was showing the cost of the
  // final fullscreen quad and nothing else. Reset once per frame instead, from
  // the game loop, so the number means the whole frame again.
  renderer.info.autoReset = false;

  // Cmd/Ctrl + wheel over the canvas zooms the browser page, not the game.
  //
  // It is one slip of a thumb on a trackpad, it sticks — Chrome remembers zoom
  // per origin, so it survives a reload and every run after it — and what it
  // looks like from inside the game is that the camera crept in and stayed
  // there. It also quietly halves the resolution: `setPixelRatio` clamps at 2,
  // so past 100% zoom the backing store stops keeping up and the whole scene
  // goes soft. Nothing here is scrollable and nothing reads the wheel, so there
  // is no gesture to preserve.
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    },
    { passive: false },
  );

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
