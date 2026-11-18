/**
 * Adapted from https://github.com/shuding/liquid-glass/blob/main/liquid-glass.js
 * Copyright (c) 2025 Shu Ding. MIT; see vendor/shuding-LICENSE.
 */
const smoothStep = (a: number, b: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const roundedRectSDF = (x: number, y: number, width: number, height: number, radius: number) => {
  const qx = Math.abs(x) - width + radius;
  const qy = Math.abs(y) - height + radius;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius;
};

/** The reference fragment shader, expressed as a pure UV-to-UV sampler. */
export function liquidGlassSample(u: number, v: number) {
  const ix = u - .5, iy = v - .5;
  const distanceToEdge = roundedRectSDF(ix, iy, .3, .2, .6);
  const displacement = smoothStep(.8, 0, distanceToEdge - .15);
  const scaled = smoothStep(0, 1, displacement);
  return { x: ix * scaled + .5, y: iy * scaled + .5 };
}

/** Match the reference canvas's channel clipping before gray/alpha packing. */
export function normalizeLiquidGlassField(xs: Float32Array, ys: Float32Array) {
  let peak = 0;
  for (let i = 0; i < xs.length; i++) peak = Math.max(peak, Math.abs(xs[i]), Math.abs(ys[i]));
  const scale = Math.max(.01, peak * .5);
  for (let i = 0; i < xs.length; i++) {
    xs[i] = Math.max(0, Math.min(255, 255 * (xs[i] / scale + .5)));
    ys[i] = Math.max(0, Math.min(255, 255 * (ys[i] / scale + .5)));
  }
  return scale;
}
