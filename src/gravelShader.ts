import * as THREE from "three";

/**
 * Court bed under the instanced grains: pale angular grit in world space,
 * plus grain-scale vertex nicks so a ridge is not a smooth extruded rail.
 * This is the filler between shards — not the hero sand.
 */
export function applySandBedShader(
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

    const lib = `
         float hash12(vec2 p) {
           vec3 p3 = fract(vec3(p.xyx) * .1031);
           p3 += dot(p3, p3.yzx + 33.33);
           return fract((p3.x + p3.y) * p3.z);
         }
         vec2 hash22(vec2 p) {
           float n = hash12(p);
           return vec2(n, hash12(p + 19.1));
         }
         vec4 gritCell(vec2 world, float scale) {
           vec2 g = world * scale;
           vec2 n = floor(g);
           vec2 f = fract(g);
           float md = 8.0;
           vec2 best = vec2(0.0);
           vec2 cell = n;
           for (int j = -1; j <= 1; j++) {
             for (int i = -1; i <= 1; i++) {
               vec2 off = vec2(float(i), float(j));
               vec2 o = hash22(n + off);
               vec2 r = off + o - f;
               float d = dot(r, r);
               if (d < md) {
                 md = d;
                 best = r;
                 cell = n + off;
               }
             }
           }
           float id = hash12(cell);
           float edge = smoothstep(0.012, 0.09, sqrt(md));
           return vec4(id, edge, best);
         }
    `;

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${lib}`)
      .replace(
        "#include <displacementmap_vertex>",
        `#include <displacementmap_vertex>
         {
           vec2 cell = floor(transformed.xz * 220.0);
           float nick = hash12(cell) - 0.5;
           float nick2 = hash12(cell + 17.3) - 0.5;
           float nick3 = hash12(cell * 1.7 + 4.2) - 0.5;
           transformed.y += nick * 0.0075 + nick2 * 0.0042 + nick3 * 0.0022;
           transformed.x += nick2 * 0.0018;
           transformed.z += nick * 0.0018;
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
         ${lib}
        `,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
         vec2 uv = vMapUv;
         vec2 world = (uv - 0.5) * uGarden;
         vec4 fieldS = texture2D(uField, uv);
         float h = fieldS.r;
         float hL = texture2D(uField, uv + vec2(-uTexel.x, 0.0)).r;
         float hR = texture2D(uField, uv + vec2(uTexel.x, 0.0)).r;
         float hD = texture2D(uField, uv + vec2(0.0, -uTexel.y)).r;
         float hU = texture2D(uField, uv + vec2(0.0, uTexel.y)).r;
         float curve = 4.0 * h - hL - hR - hD - hU;
         float trough = clamp(-curve * 3.2, 0.0, 1.0);
         float crest = clamp(curve * 3.2, 0.0, 1.0);
         vec4 g0 = gritCell(world, 320.0);
         vec4 g1 = gritCell(world + vec2(0.31, 0.17), 160.0);
         vec3 pale = vec3(0.93, 0.90, 0.85);
         vec3 mid = vec3(0.86, 0.83, 0.77);
         vec3 deep = vec3(0.62, 0.58, 0.53);
         vec3 col = mix(mid, pale, g0.x);
         col = mix(col, mix(deep, mid, g1.x), 0.22);
         col *= mix(0.68, 1.0, g0.y);
         col *= mix(1.0, 0.48, trough);
         col *= mix(1.0, 1.1, crest);
         diffuseColor.rgb = col;
        `,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
         {
           vec2 uvN = vMapUv;
           vec2 worldN = (uvN - 0.5) * uGarden;
           vec4 fld = texture2D(uField, uvN);
           vec3 hx = vec3(uGarden.x * uTexel.x, (texture2D(uField, uvN + vec2(uTexel.x, 0.0)).r - fld.r) * uHeightRange, 0.0);
           vec3 hz = vec3(0.0, (texture2D(uField, uvN + vec2(0.0, uTexel.y)).r - fld.r) * uHeightRange, uGarden.y * uTexel.y);
           vec3 slopeN = normalize(cross(hz, hx));
           vec4 cell = gritCell(worldN, 240.0);
           vec3 gritN = normalize(vec3((cell.x - 0.5) * 0.7, 1.15, (hash12(cell.xy + 3.1) - 0.5) * 0.7));
           normal = normalize(mix(normal, slopeN, 0.28));
           normal = normalize(mix(normal, gritN, 0.34));
         }
        `,
      );
  };
  mat.customProgramCacheKey = () => "sand-bed-grit-v4";
}
