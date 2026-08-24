import * as THREE from "three";

/**
 * Pale Ryoan-ji gravel: rounded quartz pebbles in world space, stretched
 * along the rake, with trough occlusion from the height field.
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
           vec3 p3 = fract(vec3(p.xyx) * .1031);
           p3 += dot(p3, p3.yzx + 33.33);
           return fract((p3.x + p3.y) * p3.z);
         }
         vec2 hash22(vec2 p) {
           return vec2(hash12(p), hash12(p + 19.19));
         }
         // x = dist^2, yz = id, w = signed cell offset along x for normals
         vec4 pebble(vec2 p) {
           vec2 n = floor(p);
           vec2 f = fract(p);
           float md = 8.0;
           vec2 id = n;
           vec2 rr = vec2(0.0);
           for (int j = -1; j <= 1; j++) {
             for (int i = -1; i <= 1; i++) {
               vec2 g = vec2(float(i), float(j));
               vec2 o = hash22(n + g) * 0.72 + 0.14;
               vec2 r = g + o - f;
               float d = dot(r, r);
               if (d < md) {
                 md = d;
                 id = n + g;
                 rr = r;
               }
             }
           }
           return vec4(md, id, rr.x);
         }
        `,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
         vec2 uv = vMapUv;
         vec4 fieldS = texture2D(uField, uv);
         vec2 rake = fieldS.gb * 2.0 - 1.0;
         float rakeLen = clamp(length(rake), 0.0, 1.0);
         vec2 tangent = rakeLen > 0.08 ? rake / length(rake) : vec2(1.0, 0.0);
         vec2 bitan = vec2(-tangent.y, tangent.x);
         vec2 world = (uv - 0.5) * uGarden;
         vec2 basis = vec2(dot(world, tangent) * mix(1.0, 1.35, rakeLen), dot(world, bitan) * mix(1.0, 0.72, rakeLen));

         vec4 p0 = pebble(basis * 92.0);
         vec4 p1 = pebble(basis * 92.0 + vec2(37.1, 11.6));
         float idh = hash12(p0.yz);
         float idh2 = hash12(p1.yz + 3.1);

         vec3 quartz = vec3(0.93, 0.91, 0.86);
         vec3 ash = vec3(0.78, 0.76, 0.72);
         vec3 cream = vec3(0.90, 0.86, 0.79);
         vec3 flint = vec3(0.68, 0.66, 0.62);
         vec3 col = mix(quartz, ash, step(0.58, idh));
         col = mix(col, cream, step(0.84, idh));
         col = mix(col, flint, step(0.95, idh));
         col *= 0.94 + idh2 * 0.08;

         float rad = sqrt(p0.x);
         float dome = smoothstep(0.62, 0.12, rad);
         col *= 0.82 + dome * 0.22;

         float h = fieldS.r;
         float hL = texture2D(uField, uv + vec2(-uTexel.x, 0.0)).r;
         float hR = texture2D(uField, uv + vec2(uTexel.x, 0.0)).r;
         float hD = texture2D(uField, uv + vec2(0.0, -uTexel.y)).r;
         float hU = texture2D(uField, uv + vec2(0.0, uTexel.y)).r;
         float curve = 4.0 * h - hL - hR - hD - hU;
         float trough = clamp(-curve * 6.2, 0.0, 1.0);
         float crest = clamp(curve * 6.2, 0.0, 1.0);
         vec2 lightXZ = normalize(vec2(0.9, 0.32));
         float hUp = texture2D(uField, uv + lightXZ * uTexel * 5.0).r;
         float occ = clamp((hUp - h) * 6.0, 0.0, 1.0);

         col *= mix(1.0, 0.7, trough);
         col *= mix(1.0, 1.08, crest);
         col *= 1.0 - occ * 0.28;
         col += vec3(0.045, 0.038, 0.022) * dome * crest;

         diffuseColor.rgb = col;
        `,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
         {
           vec2 uvN = vMapUv;
           vec4 fld = texture2D(uField, uvN);
           vec2 rakeN = fld.gb * 2.0 - 1.0;
           float rakeNLen = clamp(length(rakeN), 0.0, 1.0);
           vec2 tanN = rakeNLen > 0.08 ? rakeN / length(rakeN) : vec2(1.0, 0.0);
           vec2 bitN = vec2(-tanN.y, tanN.x);
           vec2 worldN = (uvN - 0.5) * uGarden;
           vec2 basisN = vec2(dot(worldN, tanN) * mix(1.0, 1.35, rakeNLen), dot(worldN, bitN) * mix(1.0, 0.72, rakeNLen));
           vec4 pN = pebble(basisN * 92.0);
           vec3 grainN = normalize(vec3(pN.w * 1.4, 0.85, (hash12(pN.yz + 8.2) - 0.5) * 1.1));
           vec3 hx = vec3(uGarden.x * uTexel.x, (texture2D(uField, uvN + vec2(uTexel.x, 0.0)).r - fld.r) * uHeightRange, 0.0);
           vec3 hz = vec3(0.0, (texture2D(uField, uvN + vec2(0.0, uTexel.y)).r - fld.r) * uHeightRange, uGarden.y * uTexel.y);
           vec3 slopeN = normalize(cross(hz, hx));
           normal = normalize(mix(normal, slopeN, 0.7));
           normal = normalize(mix(normal, grainN, 0.38));
         }
        `,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
         roughnessFactor = mix(0.74, 0.95, hash12(floor((vMapUv - 0.5) * uGarden * 92.0)));
        `,
      );
  };
  mat.customProgramCacheKey = () => "gravel-heightfield-v3";
}
