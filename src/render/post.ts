import { Vector2, type Scene, type Camera, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * Bloom, vignette and grain.
 *
 * The palette is built almost entirely out of emissives against near-black —
 * the beacon column, tracers, muzzle flash, the crate cores, the meeting rings.
 * Without a bloom pass all of that renders as flat fills, and the game looks
 * like a diagram of itself. Bloom is what makes an emissive read as a light
 * source rather than a coloured rectangle.
 *
 * Tone mapping deliberately moves to `OutputPass`. Three only applies the
 * renderer's tone mapping when drawing straight to the canvas, so with a
 * composer in the way the intermediate targets stay linear and the mapping has
 * to happen at the end of the chain instead.
 */

/**
 * Bloom runs at half resolution.
 *
 * It is a five-mip gaussian pyramid and the most expensive thing in the frame
 * by a wide margin. The budget is 60fps on integrated graphics; at full
 * resolution this pass alone will not hold that, and at half resolution the
 * difference is invisible on a glow this soft.
 */
const BLOOM_SCALE = 0.5;

const VIGNETTE_SHADER = {
  uniforms: {
    tDiffuse: { value: null as unknown },
    uTime: { value: 0 },
    uStrength: { value: 1.05 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uStrength;
    varying vec2 vUv;

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);

      // Pull the corners down so the eye settles on the player rather than on
      // the brightest thing at the edge of frame.
      vec2 d = (vUv - 0.5) * vec2(1.0, 0.92);
      float vignette = 1.0 - smoothstep(0.28, 0.78, length(d)) * 0.55 * uStrength;
      texel.rgb *= vignette;

      // A little grain. Flat near-black banded visibly on 8-bit displays, and
      // dithering it is cheaper and better looking than deepening the fog.
      float grain = fract(sin(dot(vUv * 1024.0 + uTime, vec2(12.9898, 78.233))) * 43758.5453);
      texel.rgb += (grain - 0.5) * 0.022;

      gl_FragColor = texel;
    }
  `,
};

export class PostChain {
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly vignette: ShaderPass;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera, width: number, height: number) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    this.bloom = new UnrealBloomPass(
      new Vector2(width * BLOOM_SCALE, height * BLOOM_SCALE),
      // Strength, radius, threshold.
      //
      // Retuned once the city went in. The threshold has to clear sunlit
      // concrete, not just the floor: a few hundred lit windows plus every
      // south-facing facade was enough input that the pyramid veiled the whole
      // frame in white and the ground stopped reading as asphalt. A tighter
      // radius keeps the glow attached to what is emitting it.
      0.44,
      0.58,
      0.62,
    );
    this.composer.addPass(this.bloom);

    this.vignette = new ShaderPass(VIGNETTE_SHADER);
    this.composer.addPass(this.vignette);

    // Applies ACES + sRGB. Must be last.
    this.composer.addPass(new OutputPass());

    this.setSize(width, height);
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
    this.bloom.setSize(width * BLOOM_SCALE, height * BLOOM_SCALE);
  }

  /** @param time real elapsed seconds — drives the grain only. */
  render(time: number): void {
    this.vignette.uniforms.uTime.value = time % 1000;
    this.composer.render();
  }

  dispose(): void {
    this.composer.dispose();
  }
}
