import * as THREE from "three";

/**
 * Pale Ryoan-ji gravel: discrete jittered pebbles with cracks and a
 * grain-scale height nick, not a noise overlay on a smooth ridge.
 */
export function applyGravelShader(
  mat: THREE.MeshStandardMaterial,
  field: THREE.DataTexture,
  gardenW: number,
  gardenD: number,
  heightRange: number,
): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uField = { value: field };
    shader.uniforms.uGarden = { value: new THREE.Vector2(gardenW, gardenD) };
    shader.uniforms.uHeightRange = { value: heightRange };
    shader.uniforms.uTexel = { value: new THREE.Vector2(1 / field.image.width, 1 / field.image.height) };

    const hashLib = `
         float hash12(vec2 p) {
           vec3 p3 = fract(vec3(p.xyx) * .1031);
           p3 += dot(p3, p3.yzx + 33.33);
           return fract((p3.x + p3.y) * p3.z);
         }
         vec2 hash22(vec2 p) {
           float n = hash12(p);
           return vec2(n, hash12(p + 19.19));
         }
    `;

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${hashLib}`)
      .replace(
        "#include <displacementmap_vertex>",
        `#include <displacementmap_vertex>
         {
           vec2 cell = floor(transformed.xz * 86.0);
           float nick = hash12(cell) - 0.5;
           float nick2 = hash12(cell + 8.3) - 0.5;
           transformed.y += nick * 0.0052 + nick2 * 0.0024;
         }
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform sampler2D uField;
         uniform vec2 uGarden;
         uniform float uHeightRange;
         uniform vec2 uTexel;
         ${hashLib}

         void pebbleCell(vec2 world, out vec2 best, out float d1, out float d2) {
           vec2 p = world * 94.0;
           vec2 i = floor(p);
           vec2 f = fract(p);
           d1 = 8.0;
           d2 = 8.0;
           best = i;
           for (int y = -1; y <= 1; y++) {
             for (int x = -1; x <= 1; x++) {
               vec2 g = vec2(float(x), float(y));
               vec2 o = hash22(i + g);
               vec2 r = g + o * 0.68 - f;
               float d = dot(r, r);
               if (d < d1) {
                 d2 = d1;
                 d1 = d;
                 best = i + g;
               } else if (d < d2) {
                 d2 = d;
               }
             }
           }
           d1 = sqrt(d1);
           d2 = sqrt(d2);
         }
        `,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
         vec2 uv = vMapUv;
         vec4 fieldS = texture2D(uField, uv);
         vec2 world = (uv - 0.5) * uGarden;
         vec2 rake = fieldS.gb * 2.0 - 1.0;
         float rakeLen = clamp(length(rake), 0.0, 1.0);
         vec2 tangent = rakeLen > 0.08 ? rake / max(length(rake), 1e-4) : vec2(1.0, 0.0);
         vec2 bitan = vec2(-tangent.y, tangent.x);
         vec2 basis = vec2(
           dot(world, tangent) * mix(1.0, 1.12, rakeLen),
           dot(world, bitan) * mix(1.0, 0.88, rakeLen)
         );

         vec2 best;
         float d1;
         float d2;
         pebbleCell(basis, best, d1, d2);

         float idh = hash12(best);
         vec3 quartz = vec3(0.94, 0.92, 0.87);
         vec3 cream = vec3(0.90, 0.86, 0.78);
         vec3 ash = vec3(0.80, 0.78, 0.73);
         vec3 flint = vec3(0.70, 0.68, 0.63);
         vec3 col = quartz;
         col = mix(col, cream, step(0.34, idh));
         col = mix(col, ash, step(0.70, idh));
         col = mix(col, flint, step(0.90, idh));

         float speck = hash12(best + 4.7);
         col += vec3(0.045, 0.04, 0.03) * step(0.96, speck);
         col *= 0.90 + hash12(best + 11.2) * 0.10;

         float rim = smoothstep(0.18, 0.46, d1);
         float crack = smoothstep(0.010, 0.048, d2 - d1);
         float dome = 1.0 - rim * 0.22;
         col *= dome;
         col *= mix(0.58, 1.0, crack);

         float h = fieldS.r;
         float hL = texture2D(uField, uv + vec2(-uTexel.x, 0.0)).r;
         float hR = texture2D(uField, uv + vec2(uTexel.x, 0.0)).r;
         float hD = texture2D(uField, uv + vec2(0.0, -uTexel.y)).r;
         float hU = texture2D(uField, uv + vec2(0.0, uTexel.y)).r;
         float curve = 4.0 * h - hL - hR - hD - hU;
         float trough = clamp(-curve * 3.6, 0.0, 1.0);
         float crest = clamp(curve * 3.6, 0.0, 1.0);
         col *= mix(1.0, 0.78, trough);
         col *= mix(1.0, 1.06, crest);
         col += vec3(0.03, 0.026, 0.016) * crest;
         diffuseColor.rgb = col;
        `,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
         {
           vec2 uvN = vMapUv;
           vec4 fld = texture2D(uField, uvN);
           vec3 hx = vec3(uGarden.x * uTexel.x, (texture2D(uField, uvN + vec2(uTexel.x, 0.0)).r - fld.r) * uHeightRange, 0.0);
           vec3 hz = vec3(0.0, (texture2D(uField, uvN + vec2(0.0, uTexel.y)).r - fld.r) * uHeightRange, uGarden.y * uTexel.y);
           vec3 slopeN = normalize(cross(hz, hx));
           vec2 worldN = (uvN - 0.5) * uGarden;
           vec2 bestN;
           float d1n;
           float d2n;
           pebbleCell(worldN, bestN, d1n, d2n);
           vec2 j = hash22(bestN) - 0.5;
           float dome = 1.0 - smoothstep(0.12, 0.48, d1n);
           vec3 grainN = normalize(vec3(j.x * 0.85, 0.72 + dome * 0.55, j.y * 0.85));
           normal = normalize(mix(normal, slopeN, 0.48));
           normal = normalize(mix(normal, grainN, 0.46));
         }
        `,
      );
  };
  mat.customProgramCacheKey = () => "gravel-heightfield-v5-pebbles";
}
