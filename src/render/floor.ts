import { Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';
import { PALETTE, color } from './palette';

/**
 * Procedural floor: a single plane whose grid is injected into a standard
 * material rather than drawn by a bespoke shader.
 *
 * The patched-material route matters — a raw ShaderMaterial would need its own
 * lighting, fog, tone mapping and shadow code, and without shadow support the
 * player visibly floats. Patching `MeshStandardMaterial` gets all of that for
 * free and leaves only the grid maths to write.
 */
export function createFloor(width: number, depth: number): Mesh {
  const geometry = new PlaneGeometry(width, depth, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(width / 2, 0, depth / 2);

  const material = new MeshStandardMaterial({
    color: PALETTE.floor,
    roughness: 0.96,
    metalness: 0.0,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uLine = { value: color(PALETTE.floorLine) };
    shader.uniforms.uLineMajor = { value: color(PALETTE.floorLineMajor) };
    shader.uniforms.uTile = { value: 2 };
    shader.uniforms.uMajorEvery = { value: 8 };
    shader.uniforms.uFadeStart = { value: 26 };
    shader.uniforms.uFadeEnd = { value: 72 };

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
        uniform vec3 uLine;
        uniform vec3 uLineMajor;
        uniform float uTile;
        uniform float uMajorEvery;
        uniform float uFadeStart;
        uniform float uFadeEnd;

        // Analytically anti-aliased grid coverage for a given cell size.
        float floorGrid(vec2 worldXZ, float size) {
          vec2 p = worldXZ / size;
          vec2 d = fwidth(p);
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
          // Lines fade out with distance so the far side of the map doesn't moire.
          float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, distance(cameraPosition.xz, xz));
          float minor = floorGrid(xz, uTile);
          float major = floorGrid(xz, uTile * uMajorEvery);
          diffuseColor.rgb = mix(diffuseColor.rgb, uLine, minor * 0.5 * fade);
          diffuseColor.rgb = mix(diffuseColor.rgb, uLineMajor, major * 0.8 * fade);
        }
        `,
      );
  };
  // Without this, three reuses a cached program compiled before the patch.
  material.customProgramCacheKey = () => 'gc-floor-grid-v1';

  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.name = 'floor';
  return mesh;
}
