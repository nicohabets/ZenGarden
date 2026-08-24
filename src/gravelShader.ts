import * as THREE from "three";

/**
 * Height-field shading over a pebble atlas: troughs darken, crests catch
 * light, and a grain-scale nick breaks the plastic-rail silhouette.
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
    `;

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${hashLib}`)
      .replace(
        "#include <displacementmap_vertex>",
        `#include <displacementmap_vertex>
         {
           vec2 cell = floor(transformed.xz * 96.0);
           float nick = hash12(cell) - 0.5;
           float nick2 = hash12(cell + 9.1) - 0.5;
           transformed.y += nick * 0.007 + nick2 * 0.003;
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
        `,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
         vec2 uv = vMapUv;
         vec4 fieldS = texture2D(uField, uv);
         float h = fieldS.r;
         float hL = texture2D(uField, uv + vec2(-uTexel.x, 0.0)).r;
         float hR = texture2D(uField, uv + vec2(uTexel.x, 0.0)).r;
         float hD = texture2D(uField, uv + vec2(0.0, -uTexel.y)).r;
         float hU = texture2D(uField, uv + vec2(0.0, uTexel.y)).r;
         float curve = 4.0 * h - hL - hR - hD - hU;
         float trough = clamp(-curve * 3.4, 0.0, 1.0);
         float crest = clamp(curve * 3.4, 0.0, 1.0);
         float slope = (hR - hL) * 3.6 + (hU - hD) * 1.6;
         vec3 col = diffuseColor.rgb;
         col *= 0.78 + clamp(0.5 + slope, 0.0, 1.0) * 0.44;
         col *= mix(1.0, 0.62, trough);
         col *= mix(1.0, 1.12, crest);
         col += vec3(0.05, 0.042, 0.028) * crest;
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
           vec2 cellN = floor((uvN - 0.5) * uGarden * 96.0);
           vec3 grainN = normalize(vec3(hash12(cellN) - 0.5, 1.05, hash12(cellN + 5.2) - 0.5));
           normal = normalize(mix(normal, slopeN, 0.42));
           normal = normalize(mix(normal, grainN, 0.38));
         }
        `,
      );
  };
  mat.customProgramCacheKey = () => "gravel-heightfield-v6-atlas";
}
