import * as THREE from "three";

/**
 * Cheap pale gravel: one hash cell plus height-field shading.
 * Smooth first (displacement), then grain — no second voronoi pass.
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
        `,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
         vec2 uv = vMapUv;
         vec4 fieldS = texture2D(uField, uv);
         vec2 rake = fieldS.gb * 2.0 - 1.0;
         float rakeLen = clamp(length(rake), 0.0, 1.0);
         vec2 tangent = rakeLen > 0.08 ? rake / max(length(rake), 1e-4) : vec2(1.0, 0.0);
         vec2 bitan = vec2(-tangent.y, tangent.x);
         vec2 world = (uv - 0.5) * uGarden;
         vec2 basis = vec2(dot(world, tangent) * mix(1.0, 1.28, rakeLen), dot(world, bitan) * mix(1.0, 0.78, rakeLen));

         vec2 cell = floor(basis * 86.0);
         float idh = hash12(cell);
         float grit = hash12(basis * 130.0);
         vec3 quartz = vec3(0.93, 0.91, 0.86);
         vec3 ash = vec3(0.80, 0.78, 0.74);
         vec3 cream = vec3(0.90, 0.86, 0.79);
         vec3 col = mix(quartz, ash, step(0.55, idh));
         col = mix(col, cream, step(0.86, idh));
         col *= 0.92 + grit * 0.1;

         float h = fieldS.r;
         float hL = texture2D(uField, uv + vec2(-uTexel.x, 0.0)).r;
         float hR = texture2D(uField, uv + vec2(uTexel.x, 0.0)).r;
         float hD = texture2D(uField, uv + vec2(0.0, -uTexel.y)).r;
         float hU = texture2D(uField, uv + vec2(0.0, uTexel.y)).r;
         float curve = 4.0 * h - hL - hR - hD - hU;
         float trough = clamp(-curve * 5.4, 0.0, 1.0);
         float crest = clamp(curve * 5.4, 0.0, 1.0);
         col *= mix(1.0, 0.72, trough);
         col *= mix(1.0, 1.07, crest);
         col += vec3(0.035, 0.03, 0.018) * crest;
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
           vec2 cellN = floor((uvN - 0.5) * uGarden * 86.0);
           vec3 grainN = normalize(vec3(hash12(cellN) - 0.5, 1.2, hash12(cellN + 4.2) - 0.5));
           normal = normalize(mix(normal, slopeN, 0.62));
           normal = normalize(mix(normal, grainN, 0.28));
         }
        `,
      );
  };
  mat.customProgramCacheKey = () => "gravel-heightfield-v4-cheap";
}
