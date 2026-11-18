export interface GlassContour {
  depth: number;
  nx: number;
  ny: number;
}

/** CSS squircle = superellipse(2), whose Cartesian exponent is 4. */
export function glassContour(x: number, y: number, width: number, height: number, radius: number, squircle: boolean): GlassContour {
  const r = Math.max(.01, Math.min(radius, width / 2, height / 2));
  const vx = x - Math.max(r, Math.min(width - r, x));
  const vy = y - Math.max(r, Math.min(height - r, y));
  if (!vx && !vy) return { depth: Math.min(x, y, width - x, height - y), nx: 0, ny: 0 };
  const exponent = squircle ? 4 : 2;
  const ax = Math.abs(vx) / r, ay = Math.abs(vy) / r;
  const q = Math.pow(Math.pow(ax, exponent) + Math.pow(ay, exponent), 1 / exponent);
  const gx = Math.sign(vx) * Math.pow(ax / q, exponent - 1);
  const gy = Math.sign(vy) * Math.pow(ay / q, exponent - 1);
  const length = Math.hypot(gx, gy);
  return { depth: (1 - q) * r / length, nx: gx / length, ny: gy / length };
}
