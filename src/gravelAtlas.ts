import * as THREE from "three";

/**
 * Dense pale gravel tile: overlapping irregular quartz pebbles with
 * darker contact, so a 30cm view is stones, not a noise stamp.
 */
export function createGravelAtlas(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("gravel atlas");

  ctx.fillStyle = "#9a948a";
  ctx.fillRect(0, 0, size, size);

  const tones = ["#f7f2ea", "#eee6d8", "#e0d8cc", "#d4ccc0", "#f2eadc", "#c8c2b6", "#e8e2d4", "#dcd4c8"];
  for (let i = 0; i < 5600; i++) {
    const x = (i * 53 + 17) % size;
    const y = (i * 37 + 29) % size;
    const sides = 5 + (i % 3);
    const r = 6.5 + (i % 9) * 0.95;
    const rot = ((i * 19) % 360) * (Math.PI / 180);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.beginPath();
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const rr = r * (0.72 + ((i * 7 + s * 13) % 11) * 0.035);
      const px = Math.cos(a) * rr;
      const py = Math.sin(a) * rr * 0.78;
      if (s === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    const tone = tones[i % tones.length];
    const grd = ctx.createRadialGradient(-r * 0.25, -r * 0.3, 0.5, 0, 0, r);
    grd.addColorStop(0, "#fffdf8");
    grd.addColorStop(0.35, tone);
    grd.addColorStop(1, "#7a746c");
    ctx.fillStyle = grd;
    ctx.fill();
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 10);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
