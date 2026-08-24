import * as THREE from "three";

/**
 * A dense quartz-pebble albedo. Sparse dots on dark grout read as dashed
 * wallpaper; this fills the tile so a close-up is mostly stone.
 */
export function createGravelAtlas(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("gravel atlas");

  ctx.fillStyle = "#c9c2b6";
  ctx.fillRect(0, 0, size, size);

  const tones = ["#f6f1e8", "#ebe3d6", "#ddd5c8", "#d2cabc", "#f0e8dc", "#c6bfb2", "#e8e0d2", "#d8d2c6"];
  for (let i = 0; i < 7200; i++) {
    const x = (i * 47 + 13) % size;
    const y = (i * 31 + 23) % size;
    const rx = 5.5 + (i % 7) * 0.85;
    const ry = 4.2 + ((i * 3) % 6) * 0.7;
    const rot = ((i * 23) % 180) * (Math.PI / 180);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    const grd = ctx.createRadialGradient(-rx * 0.28, -ry * 0.32, 0.4, 0, 0, rx);
    const tone = tones[i % tones.length];
    grd.addColorStop(0, "#fffaf2");
    grd.addColorStop(0.22, tone);
    grd.addColorStop(0.82, tone);
    grd.addColorStop(1, "#8a8478");
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(22, 13);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
