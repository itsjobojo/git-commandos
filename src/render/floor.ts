import { Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';
import { PALETTE, color } from './palette';

/**
 * The ground: asphalt with concrete slabs, kerb joints and standing water.
 *
 * This used to be a glowing wireframe grid, which was legible but told you the
 * map was a diagram. Now that the walls are buildings the ground has to be
 * street, and it has three jobs beyond looking like tarmac: give the eye
 * something to measure movement against (a perfectly even plane makes running
 * feel like sliding on glass), stay dark enough that the emissive palette still
 * carries, and cost nothing — it is one plane covering the entire map.
 *
 * All of it is a patched `MeshStandardMaterial` rather than a raw
 * `ShaderMaterial`. That route matters: a bespoke shader would need its own
 * lighting, fog, tone mapping and shadow code, and without shadow support the
 * player visibly floats. Patching keeps all of that and leaves only the
 * pattern to write.
 */
export function createFloor(width: number, depth: number): Mesh {
  const geometry = new PlaneGeometry(width, depth, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(width / 2, 0, depth / 2);

  const material = new MeshStandardMaterial({
    color: PALETTE.floor,
    roughness: 0.94,
    metalness: 0.0,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSeam = { value: color(PALETTE.floorLine) };
    shader.uniforms.uPaint = { value: color(PALETTE.floorLineMajor) };
    /** Concrete slab size. Matches the 2-unit map tile so joints line up with buildings. */
    shader.uniforms.uSlab = { value: 2 };
    /** Slabs per road-marking block. */
    shader.uniforms.uBlock = { value: 8 };
    shader.uniforms.uFadeStart = { value: 34 };
    shader.uniforms.uFadeEnd = { value: 96 };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFloorWorld;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvFloorWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        varying vec3 vFloorWorld;
        uniform vec3 uSeam;
        uniform vec3 uPaint;
        uniform float uSlab;
        uniform float uBlock;
        uniform float uFadeStart;
        uniform float uFadeEnd;

        // Wetness is written in <color_fragment> and read back in
        // <roughnessmap_fragment>, which runs later in the same main(). A
        // puddle has to change the roughness, not just the colour — a dark
        // patch that is still matte reads as a stain, whereas dropping the
        // roughness gets a real specular highlight off the sun and sells it.
        float gcWet;

        float floorHash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        float floorNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(floorHash(i), floorHash(i + vec2(1,0)), f.x),
                     mix(floorHash(i + vec2(0,1)), floorHash(i + vec2(1,1)), f.x), f.y);
        }

        float floorFbm(vec2 p) {
          return floorNoise(p) * 0.55 + floorNoise(p * 2.3) * 0.28 + floorNoise(p * 5.1) * 0.17;
        }

        // Value noise is built on an axis-aligned lattice, so sampling it
        // straight along world XZ lays a faint corduroy weave over the whole
        // street. Rotating the sample off-axis breaks that up; the angle is
        // arbitrary, it just must not be a multiple of 90°.
        vec2 floorSkew(vec2 p) {
          const float C = 0.8253356;  // cos(34.4°)
          const float S = 0.5646425;  // sin(34.4°)
          return vec2(p.x * C - p.y * S, p.x * S + p.y * C);
        }

        // Analytically anti-aliased line coverage on a lattice of the given size.
        float floorSeam(vec2 worldXZ, float size, float sharpness) {
          vec2 p = worldXZ / size;
          vec2 d = fwidth(p) * sharpness;
          vec2 g = abs(fract(p - 0.5) - 0.5) / max(d, vec2(1e-5));
          return 1.0 - min(min(g.x, g.y), 1.0);
        }
        `,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        #include <color_fragment>
        {
          vec2 xz = vFloorWorld.xz;
          float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, distance(cameraPosition.xz, xz));

          // Aggregate. The grit octave is deliberately coarse and faded out
          // with distance: at a finer pitch its cells fall below a pixel and
          // alias into a shimmering weave across the whole street, which is
          // far more distracting than no texture at all.
          float grit = floorNoise(floorSkew(xz) * 6.5);
          // NB: not "patch" — that is a reserved word in GLSL ES (tessellation),
          // and naming it that silently fails the whole shader to compile.
          float wear = floorFbm(floorSkew(xz) * 0.14);
          diffuseColor.rgb *= 0.8 + wear * 0.44;
          diffuseColor.rgb *= 0.95 + grit * 0.11 * fade;

          // Slab joints — recessed, so they darken rather than glow. This is
          // the replacement for the old grid: same navigational read, but it
          // sits in the surface instead of floating on top of it.
          float joint = floorSeam(xz, uSlab, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.45, joint * 0.85 * fade);

          // Expansion joints every block, slightly wider and lighter — worn
          // concrete showing through. Faded with distance so the far side of
          // the map does not moire.
          float expansion = floorSeam(xz, uSlab * uBlock, 1.4);
          diffuseColor.rgb = mix(diffuseColor.rgb, uSeam * 0.5, expansion * 0.42 * fade);

          // Standing water. Rare, soft-edged, and darker than dry tarmac.
          float water = smoothstep(0.62, 0.86, floorFbm(xz * 0.21 + 13.7));
          gcWet = water;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.52, water);

          // A faint cool sheen on the water, so it still reads on a surface
          // this dark even when the sun is not hitting the specular lobe.
          diffuseColor.rgb += uPaint * 0.06 * water * fade;
        }
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.12, gcWet);',
      );
  };
  // Without this, three reuses a cached program compiled before the patch.
  material.customProgramCacheKey = () => 'gc-floor-asphalt-v1';

  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.name = 'floor';
  return mesh;
}
