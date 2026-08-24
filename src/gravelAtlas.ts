import * as THREE from "three";

/**
 * A tiled quartz-pebble albedo that still reads as gravel under flat light.
 */
export function createGravelAtlas(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("gravel atlas");

  ctx.fillStyle = "#8a847a";
  ctx.fillRect(0, 0, size, size);

  const tones = ["#f3efe6", "#e7dfd2", "#d8d0c4", "#c8c0b4", "#efe6d8", "#b8b2a6", "#f7f2ea", "#cdc6ba"];
  for (let i = 0; i < 2800; i++) {
    const x = ((i * 73 + 19) % size) + ((i * 13) % 7) - 3;
    const y = ((i * 47 + 31) % size) + ((i * 11) % 7) - 3;
    const rx = 3.2 + (i % 5) * 0.7;
    const ry = 2.4 + ((i * 3) % 5) * 0.55;
    const rot = ((i * 17) % 180) * (Math.PI / 180);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    const grd = ctx.createRadialGradient(-rx * 0.25, -ry * 0.3, 0.2, 0, 0, rx);
    const tone = tones[i % tones.length];
    grd.addColorStop(0, tone);
    grd.addColorStop(0.72, tone);
    grd.addColorStop(1, "#6e6a62");
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    if (i % 9 === 0) {
      ctx.fillStyle = "rgba(255,252,246,0.35)";
      ctx.beginPath();
      ctx.ellipse(-rx * 0.22, -ry * 0.28, rx * 0.22, ry * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(GARDEN_TILES_X, GARDEN_TILES_Y);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** ~1.1cm pebbles across the 14×8.2m court. */
const GARDEN_TILES_X = 48;
const GARDEN_TILES_Y = 28;
