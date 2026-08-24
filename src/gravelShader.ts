import * as THREE from "three";
import { isMobileGarden, wantHighQuality } from "./device";

export interface SandLookUniforms {
  uZoom: { value: number };
}

/**
 * Packed dry grit: world-space millimetre grains with parallax relief.
 * The height field is mass; this is the sand you see at 30cm and at orbit.
 */
export function applyPackedSandShader(
  mat: THREE.MeshStandardMaterial,
  field: THREE.DataTexture,
  gardenW: number,
  gardenD: number,
  heightRange: number,
): SandLookUniforms {
  const look: SandLookUniforms = { uZoom: { value: 3.2 } };
  const steps = wantHighQuality() ? 10 : isMobileGarden() ? 4 : 6;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uField = { value: field };
    shader.uniforms.uGarden = { value: new THREE.Vector2(gardenW, gardenD) };
    shader.uniforms.uHeightRange = { value: heightRange };
    shader.uniforms.uTexel = { value: new THREE.Vector2(1 / field.image.width, 1 / field.image.height) };
    shader.uniforms.uZoom = look.uZoom;
    shader.uniforms.uSteps = { value: steps };

    const lib = `
         uniform sampler2D uField;
         uniform vec2 uGarden;
         uniform float uHeightRange;
         uniform vec2 uTexel;
         uniform float uZoom;
         uniform float uSteps;
         varying vec3 vSandWorld;
         vec2 vGritP;

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
           float edge = smoothstep(0.02, 0.22, sqrt(md));
           return vec4(id, edge, best);
         }
         float grainHeight(vec2 world) {
           float close = smoothstep(2.4, 0.55, uZoom);
           float freq = mix(210.0, 360.0, close);
           vec4 a = gritCell(world, freq);
           vec4 b = gritCell(world + vec2(0.37, 0.21), freq * 0.62);
           float h = 0.28 + a.x * 0.72;
           h *= mix(0.42, 1.0, a.y);
           h = mix(h, 0.2 + b.x * 0.55, 0.28);
           return h;
         }
         vec2 marchGrit(vec2 world) {
           vec3 viewW = normalize(cameraPosition - vSandWorld);
           float close = smoothstep(2.4, 0.55, uZoom);
           float amp = mix(0.0024, 0.0042, close);
           float drop = max(0.14, abs(viewW.y));
           vec2 walk = viewW.xz * (amp / drop);
           vec2 p = world;
           float hMarch = 1.0;
           int steps = int(uSteps + 0.5);
           for (int i = 0; i < 16; i++) {
             if (i >= steps) break;
             float gh = grainHeight(p);
             if (hMarch <= gh) break;
             p += walk * (hMarch - gh);
             hMarch -= 1.0 / max(4.0, uSteps);
           }
           return p;
         }
    `;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec3 vSandWorld;
         float sandHash12(vec2 p) {
           vec3 p3 = fract(vec3(p.xyx) * .1031);
           p3 += dot(p3, p3.yzx + 33.33);
           return fract((p3.x + p3.y) * p3.z);
         }
        `,
      )
      .replace(
        "#include <displacementmap_vertex>",
        `#include <displacementmap_vertex>
         {
           vec2 cell = floor(transformed.xz * 42.0);
           float nick = sandHash12(cell) - 0.5;
           float nick2 = sandHash12(cell + 11.7) - 0.5;
           transformed.y += nick * 0.011 + nick2 * 0.006;
           transformed.x += nick2 * 0.0035;
           transformed.z += nick * 0.0035;
           vSandWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
         }
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${lib}`)
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
         vec2 uv = vMapUv;
         vec2 world = (uv - 0.5) * uGarden;
         vGritP = marchGrit(world);
         float close = smoothstep(2.4, 0.55, uZoom);
         vec4 cell = gritCell(vGritP, mix(210.0, 360.0, close));
         float gH = grainHeight(vGritP);
         vec4 fieldS = texture2D(uField, uv);
         float fh = fieldS.r;
         float hL = texture2D(uField, uv + vec2(-uTexel.x, 0.0)).r;
         float hR = texture2D(uField, uv + vec2(uTexel.x, 0.0)).r;
         float hDn = texture2D(uField, uv + vec2(0.0, -uTexel.y)).r;
         float hUp = texture2D(uField, uv + vec2(0.0, uTexel.y)).r;
         float curve = 4.0 * fh - hL - hR - hDn - hUp;
         float trough = clamp(-curve * 3.6, 0.0, 1.0);
         float crest = clamp(curve * 3.6, 0.0, 1.0);
         vec3 pale = vec3(0.94, 0.91, 0.86);
         vec3 midc = vec3(0.87, 0.84, 0.78);
         vec3 deep = vec3(0.70, 0.66, 0.60);
         vec3 col = mix(deep, midc, cell.y);
         col = mix(col, pale, cell.x * 0.55 * cell.y);
         col *= 0.78 + gH * 0.28;
         col *= mix(1.0, 0.72, trough);
         col *= mix(1.0, 1.08, crest);
         col += vec3(0.03, 0.025, 0.016) * crest * gH;
         diffuseColor.rgb = col;
        `,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
         {
           vec2 uvN = vMapUv;
           float closeN = smoothstep(2.4, 0.55, uZoom);
           float epsN = mix(0.0018, 0.0009, closeN);
           vec3 gritN = normalize(vec3(
             grainHeight(vGritP + vec2(-epsN, 0.0)) - grainHeight(vGritP + vec2(epsN, 0.0)),
             0.55,
             grainHeight(vGritP + vec2(0.0, -epsN)) - grainHeight(vGritP + vec2(0.0, epsN))
           ));
           vec4 fld = texture2D(uField, uvN);
           vec3 hx = vec3(uGarden.x * uTexel.x, (texture2D(uField, uvN + vec2(uTexel.x, 0.0)).r - fld.r) * uHeightRange, 0.0);
           vec3 hz = vec3(0.0, (texture2D(uField, uvN + vec2(0.0, uTexel.y)).r - fld.r) * uHeightRange, uGarden.y * uTexel.y);
           vec3 slopeN = normalize(cross(hz, hx));
           normal = normalize(mix(normal, slopeN, 0.34));
           normal = normalize(mix(normal, gritN, mix(0.4, 0.72, closeN)));
         }
        `,
      );
  };
  mat.customProgramCacheKey = () => `packed-sand-pom-v2-${steps}`;
  return look;
}
