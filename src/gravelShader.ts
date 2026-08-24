import * as THREE from "three";

/**
 * Procedural Ryoan-ji gravel: thousands of pebbles from world-space voronoi,
 * stretched along the rake, with soft trough occlusion from the height field.
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

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform sampler2D uField;
         uniform vec2 uGarden;
         uniform float uHeightRange;
         uniform vec2 uTexel;

         float hash12(vec2 p) {
           vec3 p3 = fract(vec3(p.xyx) * 0.1031);
           p3 += dot(p3, p3.yzx + 33.33);
           return fract((p3.x + p3.y) * p3.z);
         }
         vec2 hash22(vec2 p) {
           return vec2(hash12(p), hash12(p + 19.19));
         }
         vec4 gravelCell(vec2 p) {
           vec2 n = floor(p);
           vec2 f = fract(p);
           float md = 8.0;
           float md2 = 8.0;
           vec2 bestId = n;
           vec2 bestR = f;
           for (int j = -1; j <= 1; j++) {
             for (int i = -1; i <= 1; i++) {
               vec2 g = vec2(float(i), float(j));
               vec2 o = hash22(n + g);
               vec2 r = g + o - f;
               float d = dot(r, r);
               if (d < md) {
                 md2 = md;
                 md = d;
                 bestId = n + g;
                 bestR = r;
               } else if (d < md2) {
                 md2 = d;
               }
             }
           }
           return vec4(md, md2, bestId);
         }
        `,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
         vec2 uv = vMapUv;
         vec4 field = texture2D(uField, uv);
         vec2 rake = field.gb * 2.0 - 1.0;
         float rakeLen = length(rake);
         vec2 tangent = rakeLen > 0.08 ? rake / rakeLen : vec2(1.0, 0.0);
         vec2 perp = vec2(-tangent.y, tangent.x);
         float stretch = mix(1.0, 1.55, clamp(rakeLen, 0.0, 1.0));
         float squash = mix(1.0, 0.62, clamp(rakeLen, 0.0, 1.0));
         vec2 world = (uv - 0.5) * uGarden;
         vec2 basis = vec2(dot(world, tangent) * stretch, dot(world, perp) * squash);

         vec4 cell = gravelCell(basis * 78.0);
         vec4 grit = gravelCell(basis * 148.0 + 13.7);
         float idHash = hash12(cell.zw);
         float gritHash = hash12(grit.zw + 5.2);

         vec3 pale = vec3(0.94, 0.915, 0.865);
         vec3 grey = vec3(0.80, 0.785, 0.74);
         vec3 warm = vec3(0.90, 0.855, 0.78);
         vec3 fleck = vec3(0.62, 0.60, 0.56);
         vec3 pebble = mix(pale, grey, step(0.55, idHash));
         pebble = mix(pebble, warm, step(0.82, idHash));
         pebble = mix(pebble, fleck, step(0.93, idHash));
         pebble *= 0.90 + gritHash * 0.12;

         float edge = smoothstep(0.012, 0.085, sqrt(cell.y) - sqrt(cell.x));
         pebble *= mix(0.55, 1.0, edge);
         pebble *= 0.93 + (1.0 - grit.x) * 0.08;

         float h = field.r;
         float hL = texture2D(uField, uv + vec2(-uTexel.x, 0.0)).r;
         float hR = texture2D(uField, uv + vec2(uTexel.x, 0.0)).r;
         float hD = texture2D(uField, uv + vec2(0.0, -uTexel.y)).r;
         float hU = texture2D(uField, uv + vec2(0.0, uTexel.y)).r;
         float curve = 4.0 * h - hL - hR - hD - hU;
         float trough = clamp(-curve * 5.5, 0.0, 1.0);
         float crest = clamp(curve * 5.5, 0.0, 1.0);
         vec2 lightXZ = normalize(vec2(0.88, 0.38));
         float hUp = texture2D(uField, uv + lightXZ * uTexel * 4.0).r;
         float occ = clamp((hUp - h) * 5.2, 0.0, 1.0);

         pebble *= mix(1.0, 0.62, trough);
         pebble *= mix(1.0, 1.07, crest);
         pebble *= 1.0 - occ * 0.38;
         pebble += vec3(0.03, 0.025, 0.015) * crest * (1.0 - trough);

         diffuseColor.rgb = pebble;
        `,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
         {
           vec2 uvN = vMapUv;
           vec4 fld = texture2D(uField, uvN);
           vec2 rakeN = fld.gb * 2.0 - 1.0;
           float rakeNLen = length(rakeN);
           vec2 tanN = rakeNLen > 0.08 ? rakeN / rakeNLen : vec2(1.0, 0.0);
           vec2 perpN = vec2(-tanN.y, tanN.x);
           float st = mix(1.0, 1.55, clamp(rakeNLen, 0.0, 1.0));
           float sq = mix(1.0, 0.62, clamp(rakeNLen, 0.0, 1.0));
           vec2 worldN = (uvN - 0.5) * uGarden;
           vec2 basisN = vec2(dot(worldN, tanN) * st, dot(worldN, perpN) * sq);
           vec4 cellN = gravelCell(basisN * 78.0);
           float bump = clamp(0.22 - cellN.x * 1.8, -0.08, 0.22);
           vec3 grainN = normalize(vec3(
             (hash12(cellN.zw + 1.3) - 0.5) * 0.55,
             1.0,
             (hash12(cellN.zw + 7.1) - 0.5) * 0.55
           ));
           grainN.y += bump;
           grainN = normalize(grainN);
           vec3 hx = vec3(uGarden.x * uTexel.x, (texture2D(uField, uvN + vec2(uTexel.x, 0.0)).r - fld.r) * uHeightRange, 0.0);
           vec3 hz = vec3(0.0, (texture2D(uField, uvN + vec2(0.0, uTexel.y)).r - fld.r) * uHeightRange, uGarden.y * uTexel.y);
           vec3 slopeN = normalize(cross(hz, hx));
           normal = normalize(mix(normal, slopeN, 0.55));
           normal = normalize(mix(normal, grainN, 0.42));
         }
        `,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
         roughnessFactor = mix(0.78, 0.96, hash12(floor((vMapUv - 0.5) * uGarden * 78.0)));
        `,
      );
  };
  mat.customProgramCacheKey = () => "gravel-heightfield-v2";
}
