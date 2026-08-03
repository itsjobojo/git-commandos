import { Vector3, type MeshStandardMaterial } from 'three';

/**
 * Procedural surface detail for the environment.
 *
 * No texture files. Every building on the map is an instance of one box, so a
 * bitmap would either tile visibly across a thousand cubes or cost a
 * per-instance UV set; a shader keyed off world position gets facade detail
 * that never repeats, costs no bandwidth, and keeps `ASSETS.md` empty of
 * anything that needs a licence.
 *
 * Everything goes through `onBeforeCompile` on a `MeshStandardMaterial` rather
 * than a bespoke `ShaderMaterial`, for the reason given in `floor.ts` — it
 * keeps lighting, fog, shadows and tone mapping, and leaves only the pattern to
 * write.
 */

/**
 * Floor-to-floor height, and horizontal window pitch.
 *
 * These set the apparent size of the buildings and nothing else does. At a
 * 1.15 storey height a 4-unit building has three enormous windows and reads as
 * a garden wall with holes in it; tightening the pitch is what turns the same
 * box into something with storeys.
 */
const FLOOR_HEIGHT = 0.95;
const WINDOW_PITCH = 0.8;
/** Radius, in world units, of the hole punched through anything hiding the player. */
const OCCLUDER_RADIUS = 2.4;

/** Shared GLSL: value noise, an ordered dither, and facade helpers. */
const NOISE = /* glsl */ `
  float gcHash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float gcNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(gcHash(i + vec3(0,0,0)), gcHash(i + vec3(1,0,0)), f.x),
          mix(gcHash(i + vec3(0,1,0)), gcHash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(gcHash(i + vec3(0,0,1)), gcHash(i + vec3(1,0,1)), f.x),
          mix(gcHash(i + vec3(0,1,1)), gcHash(i + vec3(1,1,1)), f.x), f.y),
      f.z);
  }

  // Antialiased "inside this rectangle" test. The derivative comes from the
  // continuous coordinate, never from its fract() — fract's derivative spikes
  // at every seam, which draws a bright line down the edge of every window.
  //
  // The width is clamped, and that clamp is load-bearing. A facade seen edge-on
  // from a camera 26 units out is compressed to almost nothing vertically, so
  // its derivative explodes; unclamped, the smoothstep ramp grows wider than
  // the window itself and every opening on the far side of the street fades to
  // a flat grey nothing.
  float gcRect(vec2 f, vec2 duv, vec2 lo, vec2 hi) {
    vec2 w = min(duv * 1.1, vec2(0.22)) + 1e-5;
    vec2 a = smoothstep(lo - w, lo + w, f);
    vec2 b = 1.0 - smoothstep(hi - w, hi + w, f);
    return a.x * a.y * b.x * b.y;
  }
`;

/**
 * How much of this fragment is standing between the camera and the player.
 *
 * A cylinder test around the camera-to-player axis rather than a screen-space
 * one: same result through a perspective camera, and it needs no matrices in
 * the fragment shader. Only geometry nearer the camera than the player counts,
 * so a building behind the player never dissolves.
 */
const OCCLUSION = /* glsl */ `
  uniform vec3 uPlayerWorld;
  uniform float uOccluderRadius;

  float gcOcclusion(vec3 world) {
    vec3 toPlayer = uPlayerWorld - cameraPosition;
    float playerDist = length(toPlayer);
    vec3 axis = toPlayer / max(playerDist, 1e-4);
    vec3 rel = world - cameraPosition;
    float along = dot(rel, axis);
    if (along <= 0.0 || along >= playerDist) return 0.0;
    float perp = length(rel - axis * along);
    return 1.0 - smoothstep(uOccluderRadius * 0.45, uOccluderRadius, perp);
  }

  // Stipple rather than blend: these are opaque instanced meshes, and making
  // them transparent would force a per-instance sort and break the single
  // draw call. Screen-locked so it reads as a dissolve, not as noise.
  void gcApplyOcclusion(vec3 world) {
    float occl = gcOcclusion(world);
    if (occl <= 0.02) return;
    float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    if (dither < occl) discard;
  }
`;

/**
 * Injects world position, object normal and per-building data into a standard
 * material's shaders.
 *
 * Instanced meshes need `modelMatrix * instanceMatrix`, and getting that order
 * wrong makes every building sample the same patch of noise — which looks
 * exactly like no noise at all.
 */
function withInstanceVaryings(shader: { vertexShader: string; fragmentShader: string }): void {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
       attribute vec2 aBuilding;
       varying vec3 vGcWorld;
       varying vec3 vGcNormal;
       varying vec2 vGcBuilding;`,
    )
    .replace(
      '#include <beginnormal_vertex>',
      '#include <beginnormal_vertex>\nvGcNormal = objectNormal;\nvGcBuilding = aBuilding;',
    )
    .replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
       #ifdef USE_INSTANCING
         vGcWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
       #else
         vGcWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
       #endif`,
    );
}

/**
 * Shared fragment declarations.
 *
 * The normal is the object-space one, taken before `<normal_fragment_begin>`
 * has run — `<color_fragment>`, where this is injected, comes earlier in the
 * chunk order and has no shaded normal yet. That is fine here: buildings and
 * cover are axis-aligned boxes that are never rotated, so the object normal and
 * the world normal are the same vector.
 *
 * `gcGlow` is a global written in `<color_fragment>` and read back in
 * `<emissivemap_fragment>`, which runs later in the same `main()`. Lit windows
 * have to land in emissive rather than albedo: albedo gets shadowed and
 * lit-from-outside, and a window that goes dark when a cloud passes over it is
 * not a window.
 */
const FRAGMENT_HEAD = `
  varying vec3 vGcWorld;
  varying vec3 vGcNormal;
  varying vec2 vGcBuilding;
  vec3 gcGlow;
  ${NOISE}
  ${OCCLUSION}
`;

/**
 * Building facades.
 *
 * The read, in order of how much it matters: lit windows, because they are the
 * only thing that says "inhabited" and they give the bloom pass something to
 * do; the roofline, because varied heights are what separate one building from
 * the next; and the ground-floor band, which grounds the building and stops the
 * facade pattern running into the pavement.
 */
export function applyFacadeSurface(material: MeshStandardMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPlayerWorld = { value: new Vector3(0, 0.9, 0) };
    shader.uniforms.uOccluderRadius = { value: OCCLUDER_RADIUS };
    shader.uniforms.uFloorHeight = { value: FLOOR_HEIGHT };
    shader.uniforms.uWindowPitch = { value: WINDOW_PITCH };
    withInstanceVaryings(shader);
    // Held so the game loop can move the focus without re-reaching into three.
    material.userData.gcUniforms = shader.uniforms;

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\n${FRAGMENT_HEAD}\nuniform float uFloorHeight;\nuniform float uWindowPitch;`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        #include <color_fragment>
        gcGlow = vec3(0.0);
        {
          gcApplyOcclusion(vGcWorld);

          float seed = vGcBuilding.x;
          float buildingHeight = max(vGcBuilding.y, 0.001);
          float side = 1.0 - abs(vGcNormal.y);
          float y = vGcWorld.y;

          // ---- Archetype --------------------------------------------------
          // Three kinds of building, chosen per structure. Without this every
          // facade is the same regular grid of lit squares and the city reads
          // as one repeated wallpaper, however much the rooflines vary.
          float kind = gcHash(vec3(seed * 313.0, 7.0, 3.0));
          float isBlank = step(kind, 0.26);          // blind concrete flank, no glazing
          float isHome  = step(0.74, kind);          // smaller, warmer, domestic windows

          // Per-building tint, wide enough to actually separate neighbours.
          diffuseColor.rgb *= 0.62 + gcHash(vec3(seed * 41.0)) * 0.52;

          // ---- Roof -------------------------------------------------------
          // Gravel and plant, seen from directly above and facing a 2.4
          // intensity sun. Left alone it is the largest and brightest surface
          // on screen, burns to white, and then blooms — turning the skyline
          // into backlit ice and drowning the emissives bloom exists to serve.
          float roofGrain = gcNoise(vGcWorld * vec3(3.1, 1.0, 3.1));
          vec3 roofColour = diffuseColor.rgb * (0.34 + roofGrain * 0.16);

          // ---- Facade -----------------------------------------------------
          // Pick the axis the wall runs along, so windows march across the face
          // rather than smearing round the corner.
          float facesX = step(0.5, abs(vGcNormal.x));
          float u = mix(vGcWorld.x, vGcWorld.z, facesX);
          vec2 cell = vec2(u / uWindowPitch, y / uFloorHeight);
          vec2 duv = vec2(fwidth(u) / uWindowPitch, fwidth(y) / uFloorHeight);
          vec2 f = fract(cell);
          vec2 id = floor(cell);

          // Concrete between the openings. Sampled off-axis for the same reason
          // the ground is: value noise on a world-aligned lattice lays a visible
          // corduroy down every flat face.
          float grain = gcNoise(vGcWorld.zxy * vec3(1.3, 0.7, 1.9) + 4.3);
          vec3 facade = diffuseColor.rgb * (0.82 + grain * 0.2);

          // A shadow line at every floor slab — cheap, and it is most of what
          // makes a flat face read as having storeys.
          facade *= 1.0 - smoothstep(0.10, 0.0, f.y) * 0.30;

          // Blind flanks get cast-concrete panel joints instead of glazing, so
          // a windowless building still has something to look at.
          float panel = 1.0 - min(abs(fract(u / 1.55 - 0.5) - 0.5) / max(fwidth(u) / 1.55, 1e-5), 1.0);
          facade *= 1.0 - panel * 0.26 * isBlank;

          // Domestic windows are smaller and squarer than office glazing.
          vec2 winLo = mix(vec2(0.20, 0.30), vec2(0.30, 0.36), isHome);
          vec2 winHi = mix(vec2(0.80, 0.84), vec2(0.70, 0.76), isHome);
          float window = gcRect(f, duv, winLo, winHi) * (1.0 - isBlank);

          // The ground floor is glazed differently: one tall band instead of a
          // row of punched openings, so the base of the building reads as a
          // frontage rather than as more of the same.
          float ground = 1.0 - step(uFloorHeight * 1.4, y);
          float shopfront = gcRect(f, duv, vec2(0.12, 0.18), vec2(0.88, 0.92)) * (1.0 - isBlank);
          window = mix(window, shopfront, ground);

          // Recessed glass: darker than the wall even when unlit, which is what
          // gives the facade depth in daylight.
          facade = mix(facade, facade * 0.42, window);

          // ---- Lit windows ------------------------------------------------
          float roll = gcHash(vec3(id, seed * 133.0));

          // How much of this building is still occupied — and for most of them,
          // the answer is none.
          //
          // The subtraction is the important part: any building whose roll
          // falls under the threshold gets a lit chance of exactly zero, so
          // roughly half the city is completely dark. Giving every building
          // even a small lit fraction is what turned the skyline into a solid
          // sheet of light. A few busy buildings against many dark ones is both
          // more varied and far easier on the bloom pass.
          float life = gcHash(vec3(seed * 71.0, 1.0, 1.0));
          float litChance = max(0.0, life - 0.3) * 0.72;
          // Street level keeps a little more life than the floors above, so
          // the route you actually walk down is not pitch black.
          float groundChance = max(0.0, life - 0.12) * 0.45;
          litChance = mix(litChance, groundChance, ground);
          float lit = step(1.0 - litChance, roll) * window * side;

          // Two lamp colours: warm office light, and the cold blue-white of a
          // room lit only by the monitors. Mostly warm.
          // Homes run warm; offices are the ones lit by monitors at this hour.
          float cool = step(mix(0.62, 0.94, isHome), gcHash(vec3(id.yx, seed * 17.0)));
          vec3 lamp = mix(vec3(1.0, 0.72, 0.38), vec3(0.55, 0.86, 1.0), cool);
          // Vary the level so a facade is not a uniform grid of identical dots.
          //
          // Kept low deliberately. There are several hundred lit windows in
          // frame and every one of them feeds the bloom pyramid; at emissive 1.0
          // apiece the pass had so much to work with that the whole screen went
          // to milk and the beacon stopped being the brightest thing on it.
          // A window is a small light seen at distance, not a light source.
          float level = 0.2 + gcHash(vec3(id * 3.0, seed)) * 0.3;

          gcGlow = lamp * lit * level;
          facade += lamp * lit * 0.1;

          // ---- Combine ----------------------------------------------------
          diffuseColor.rgb = mix(roofColour, facade, side);

          // Dark at the base so buildings sit into the ground rather than
          // hovering, and a lit lip just under the roofline. The lip is gated
          // to the vertical faces: unclamped it covered the whole roof,
          // because every point up there is at full height.
          float h01 = clamp(y / buildingHeight, 0.0, 1.0);
          diffuseColor.rgb *= mix(1.0, mix(0.62, 1.0, h01), side);
          diffuseColor.rgb += vec3(0.05, 0.09, 0.13) * smoothstep(0.93, 1.0, h01) * side;
        }
        `,
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gcGlow;',
      );
  };
  material.customProgramCacheKey = () => 'gc-facade-v1';
}

/**
 * The parapet cap that rings each roof, and street-level cover.
 *
 * Same treatment for both: plain cast concrete, no windows. The parapet is what
 * gives a roofline an actual edge instead of a cut, and it is the one place the
 * silhouette catches light.
 */
export function applyConcreteSurface(material: MeshStandardMaterial, height: number): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uConcreteHeight = { value: height };
    shader.uniforms.uPlayerWorld = { value: new Vector3(0, 0.9, 0) };
    shader.uniforms.uOccluderRadius = { value: OCCLUDER_RADIUS };
    withInstanceVaryings(shader);
    material.userData.gcUniforms = shader.uniforms;

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_HEAD}\nuniform float uConcreteHeight;`)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        #include <color_fragment>
        gcGlow = vec3(0.0);
        {
          gcApplyOcclusion(vGcWorld);

          float side = 1.0 - abs(vGcNormal.y);
          float h = clamp(vGcWorld.y / max(uConcreteHeight, 0.001), 0.0, 1.0);
          float grain = gcNoise(vGcWorld * vec3(1.6, 1.6, 1.6));
          diffuseColor.rgb *= 0.8 + grain * 0.34;
          diffuseColor.rgb *= mix(0.62, 0.98, h);
          diffuseColor.rgb *= mix(1.0, 0.6, 1.0 - side);
          diffuseColor.rgb += vec3(0.07, 0.11, 0.15) * smoothstep(0.72, 1.0, h) * side;
        }
        `,
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gcGlow;',
      );
  };
  material.customProgramCacheKey = () => `gc-concrete-v1-${height.toFixed(2)}`;
}

/**
 * Move the point that occluding geometry dissolves around. Call once a frame
 * with the player's position; a no-op until the material has compiled.
 */
export function setOccluderFocus(materials: MeshStandardMaterial[], x: number, y: number, z: number): void {
  for (const material of materials) {
    const uniforms = material.userData.gcUniforms as
      | { uPlayerWorld?: { value: Vector3 } }
      | undefined;
    uniforms?.uPlayerWorld?.value.set(x, y, z);
  }
}
