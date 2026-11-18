/* Displacement maps for refraction and reflection, built as a nine-slice.

   Both maps only depend on the distance to the edge and the outward normal.
   On a rounded rectangle the normal is constant along a straight edge and
   radial in a corner, so each map splits into four corner tiles, four edge
   tiles and a neutral centre. The tiles are normalised, so a size change is
   just re-laying them (x/y/width/height), never rebaking.

   Every tile is a tiny greyscale PNG data URL. Grey on purpose: on Display-P3
   screens Chrome converts coloured filter inputs into the display profile,
   which leaks green into red and twists the image. Grey and alpha survive. */

export const SLOTS = ["tl", "tr", "br", "bl", "top", "right", "bottom", "left"] as const;
export const CORNERS = ["tl", "tr", "br", "bl"] as const;
export const EDGES = ["top", "right", "bottom", "left"] as const;
export type Slot = (typeof SLOTS)[number];
export type Corner = (typeof CORNERS)[number];
export type Edge = (typeof EDGES)[number];
export type Axis = "x" | "y";

export type Tiles = { r: number; reach: number; img: Partial<Record<Slot, string>> };
export type SliceRect = { x: number; y: number; w: number; h: number };
/** Space around the element in CSS px: top, right, bottom, left. */
export type ReflectAvail = [number, number, number, number];

const CORNER_TEX = 32;
const LINE_TEX = 128;

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/* --- A minimal synchronous PNG encoder (zlib "stored", no compression) --- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

const crc32 = (bytes: Uint8Array) => {
  let c = ~0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return ~c >>> 0;
};

const chunk = (type: string, data: Uint8Array) => {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
};

/** `channels` 1 = grey, 2 = grey + alpha. Stored (uncompressed) deflate
 *  blocks of at most 65535 bytes each. */
function encodePng(w: number, h: number, channels: 1 | 2, pixels: Uint8Array) {
  const row = w * channels;
  const raw = new Uint8Array((row + 1) * h);
  for (let y = 0; y < h; y++) raw.set(pixels.subarray(y * row, (y + 1) * row), y * (row + 1) + 1);

  const len = raw.length;
  const blocks = Math.max(1, Math.ceil(len / 65535));
  const z = new Uint8Array(2 + blocks * 5 + len + 4);
  z.set([0x78, 0x01]);
  let at = 2;
  for (let k = 0; k < blocks; k++) {
    const part = raw.subarray(k * 65535, Math.min(len, (k + 1) * 65535));
    const n = part.length;
    z.set([k === blocks - 1 ? 1 : 0, n & 255, n >>> 8, ~n & 255, (~n >>> 8) & 255], at);
    z.set(part, at + 5);
    at += 5 + n;
  }
  let a = 1;
  let b = 0;
  for (let i = 0; i < len; i++) {
    a = (a + raw[i]) % 65521;
    b = (b + a) % 65521;
  }
  new DataView(z.buffer).setUint32(at, ((b << 16) | a) >>> 0);

  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, w);
  hv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = channels === 1 ? 0 : 4;

  let bin = "";
  for (const part of [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", z),
    chunk("IEND", new Uint8Array(0)),
  ])
    for (let i = 0; i < part.length; i++) bin += String.fromCharCode(part[i]);
  return "data:image/png;base64," + btoa(bin);
}

const grayPng = (w: number, h: number, value: (x: number, y: number) => number) => {
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = clamp255(value(x, y));
  return encodePng(w, h, 1, px);
};

/** White with an alpha channel, for masks (which only read alpha). */
export const maskPng = (w: number, h: number, alpha: (x: number, y: number) => number) => {
  const px = new Uint8Array(w * h * 2);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      px[(y * w + x) * 2] = 255;
      px[(y * w + x) * 2 + 1] = clamp255(alpha(x, y) * 255);
    }
  return encodePng(w, h, 2, px);
};

/* --- Tile helpers --------------------------------------------------------- */

const lineTile = (vertical: boolean, value: (f: number) => number) =>
  vertical
    ? grayPng(1, LINE_TEX, (_, y) => value((y + 0.5) / LINE_TEX))
    : grayPng(LINE_TEX, 1, (x) => value((x + 0.5) / LINE_TEX));

/** Edge tiles reach as deep as the corners (R), so they shrink in step with
 *  them when `sliceRect` clamps a tile into a smaller box. */
const tileReach = (R: number, short: number) => Math.max(2, Math.min(Math.floor(short / 2), Math.ceil(R)));

/** Arc centre of each corner, in tile coordinates. */
const cornerCenters = (R: number): Record<Corner, [number, number]> => ({
  tl: [R, R],
  tr: [0, R],
  br: [0, 0],
  bl: [R, 0],
});

/** `value(q)`: q = 1 at the edge, 0 at depth R. Constant along the edge, so
 *  the tile is one texel wide and stretched. */
const edgeTile = (dir: Edge, reach: number, R: number, value: (q: number) => number) => {
  const edgeAtZero = dir === "top" || dir === "left";
  return lineTile(dir === "top" || dir === "bottom", (f) => value(1 - ((edgeAtZero ? f : 1 - f) * reach) / R));
};

/** Radial around the arc centre, `value(q)` with q = distance / R. */
const cornerTile = (key: Corner, value: (q: number) => number) => {
  const [cx, cy] = cornerCenters(1)[key];
  return grayPng(CORNER_TEX, CORNER_TEX, (x, y) =>
    value(Math.min(1, Math.hypot((x + 0.5) / CORNER_TEX - cx, (y + 0.5) / CORNER_TEX - cy)))
  );
};

/** Magnitude times direction for one axis of a corner, baked into one tile.
 *  Doing this multiply inside the filter costs a feComposite plus two extra
 *  feImage per corner and axis. */
const productTile = (
  key: Corner,
  magnitude: (q: number) => number,
  axis: Axis,
  direction: (p: number) => number,
  R: number
) => {
  const [cx, cy] = cornerCenters(1)[key];
  const v0 = direction(0);
  const v1 = direction(R);
  return grayPng(CORNER_TEX, CORNER_TEX, (x, y) => {
    const q = Math.min(1, Math.hypot((x + 0.5) / CORNER_TEX - cx, (y + 0.5) / CORNER_TEX - cy));
    const A = Math.max(0, Math.min(255, magnitude(q))) / 255;
    const f = ((axis === "x" ? x : y) + 0.5) / CORNER_TEX;
    const D = Math.max(0, Math.min(255, v0 + (v1 - v0) * f)) / 255;
    return (0.5 + A * (D - 0.5)) * 255;
  });
};

const perCorner = (tile: (key: Corner) => string) => ({ tl: tile("tl"), tr: tile("tr"), br: tile("br"), bl: tile("bl") });

/**
 * Where a tile sits in a `w` x `h` box, offset by `ox`/`oy`. The radius is
 * clamped to the box, so a map baked for a larger shape can be laid into any
 * smaller one. Degenerate tiles get 0.01px: a filter primitive with a zero
 * subregion is disabled, and engines disagree on what it then outputs.
 */
export function sliceRect(slot: Slot, w: number, h: number, r: number, reach: number, ox = 0, oy = 0): SliceRect {
  r = Math.max(0.01, Math.min(r, w / 2, h / 2));
  const mid = Math.max(0.01, w - 2 * r);
  const col = Math.max(0.01, h - 2 * r);
  const d = Math.max(0.01, Math.min(reach, Math.min(w, h) / 2));
  const rect = (x: number, y: number, sw: number, sh: number) => ({
    x: x + ox,
    y: y + oy,
    w: Math.max(0.01, sw),
    h: Math.max(0.01, sh),
  });
  switch (slot) {
    case "tl":
      return rect(0, 0, r, r);
    case "tr":
      return rect(w - r, 0, r, r);
    case "br":
      return rect(w - r, h - r, r, r);
    case "bl":
      return rect(0, h - r, r, r);
    case "top":
      return rect(r, 0, mid, d);
    case "bottom":
      return rect(r, h - d, mid, d);
    case "left":
      return rect(0, r, d, col);
    case "right":
      return rect(w - d, r, d, col);
  }
}

/* --- Refraction ----------------------------------------------------------

   The profile was measured from Apple's play button over a grid. Everything
   is in units of the corner radius R; q is the distance from the arc centre
   over R. P(q) is how far the glass samples INWARDS at that point.

     centre  1:1 up to q = 0.61, no magnification
     bulge   a soft S-step to 0.49 R: the image folds, lines turn into loops
     lip     the last few percent pull nearly the centre out to the rim,
             softly capped so lines do not snap into stubs */

const REFR_BAND = 0.39;
const REFR_DEPTH = 0.5;
const REFR_LIP_BAND = 0.3;
const REFR_LIP = 5;
const REFR_LIP_POW = 5;
/** Stretches the whole profile; 1 is the measured width. */
const REFR_WIDTH = 1.1;
const REFR_REACH = 1.5;
/** Extra pull towards the long axis' centre, so straight pill edges bend
 *  visibly. Not measured: a circle has no straight edge. 0 turns it off. */
const REFR_TILT = 0.2;
const REFR_HEAD = 1 + REFR_TILT;

/** Depth of the folding band in R. The `.lg-fold` layer covers exactly it. */
export const REFR_FOLD_DEPTH = REFR_BAND * REFR_WIDTH;

const refrProfile = (q: number) => {
  const s = 1 - (1 - q) / REFR_WIDTH;
  const u = Math.max(0, Math.min(1, (s - (1 - REFR_BAND)) / REFR_BAND));
  const v = Math.max(0, Math.min(1, (s - (1 - REFR_LIP_BAND)) / REFR_LIP_BAND));
  const d = (REFR_DEPTH * u * u * (3 - 2 * u) + REFR_LIP * Math.pow(v, REFR_LIP_POW)) * REFR_WIDTH;
  if (q <= 1e-6 || d <= 0) return 0;
  const cap = q * REFR_REACH;
  const x = d / cap;
  return (cap * x) / Math.pow(1 + x ** 4, 0.25);
};

const REFR_PEAK = (() => {
  let m = 1e-6;
  for (let i = 1; i <= 1000; i++) m = Math.max(m, refrProfile(i / 1000) / (i / 1000));
  return m;
})();

const REFR_MAG_PEAK = (() => {
  let m = 1e-6;
  for (let i = 0; i <= 1000; i++) m = Math.max(m, refrProfile(i / 1000));
  return m;
})();

export type RefractionMap = {
  /** Edge tiles: one grey component each (top/bottom y, left/right x). */
  slice: Tiles;
  /** Corner tiles per axis: magnitude times direction, pre-multiplied. */
  prod: Record<Axis, Record<Corner, string>>;
  /** Tilt magnitude; its sign across the straight run comes from `tiltRamp`. */
  tilt: Tiles;
  tiltRamp: string;
  gain: number;
};

/** Multiplies two values encoded around 0.5: 0.5 + 2(a - 0.5)(b - 0.5). */
export const TILT_MULTIPLY = { k1: 2, k2: -1, k3: -1, k4: 1 } as const;
/** y field into alpha (a = 0.5 + 0.5y), so x can be masked by it with "in".
 *  Maps stay grey + alpha until the last matrix: on a Display-P3 screen Chrome
 *  colour-manages coloured filter values (feComposite arithmetic, feBlend),
 *  which mixes G into R and bends the picture into an S. Costs y a bit. */
export const PACK_Y = "0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.5 0 0 0 0.5";
/** Grey x and y (0..255 each) as one grey + alpha PNG in the form PACK_Y and
 *  the "in" composite make of them: x in grey, y in alpha. */
export function packedFieldPng(w: number, h: number, x: ArrayLike<number>, y: ArrayLike<number>) {
  const px = new Uint8Array(w * h * 2);
  for (let k = 0; k < w * h; k++) {
    px[2 * k] = clamp255(x[k]!);
    px[2 * k + 1] = clamp255(127.5 + y[k]! / 2);
  }
  return encodePng(w, h, 2, px);
}
/** R = x, G = 2a - 1 = y, B = 0, A = 1. Goes straight into feDisplacementMap. */
export const UNPACK = "1 0 0 0 0  0 0 0 2 -1  0 0 0 0 0  0 0 0 0 1";

/** `k3` for adding the tilt in this box. Zero on a circle (no straight run). */
export const tiltGain = (map: RefractionMap, w: number, h: number) => {
  const r = Math.max(0.01, Math.min(map.slice.r, w / 2, h / 2));
  const straight = Math.max(0, Math.min(1, (w / 2 - r) / r));
  return (REFR_TILT * straight * REFR_MAG_PEAK) / (REFR_PEAK * REFR_HEAD);
};

/** feDisplacementMap `scale` in CSS px for the box the map is laid into. */
export const refractionScale = (map: RefractionMap, w: number, h: number) =>
  2 * map.gain * Math.max(0.01, Math.min(map.slice.r, w / 2, h / 2));

let tiltRamp: string | null = null;

export function buildRefraction(short: number, radius: number): RefractionMap {
  const R = Math.max(0.01, Math.min(radius, short / 2));
  const reach = tileReach(R, short);

  // feDisplacementMap samples further right/down above 128, so "inwards" on
  // the right edge (outward normal +1) means below 128.
  const edge = (dir: Edge) => {
    const n = dir === "left" || dir === "top" ? -1 : 1;
    return edgeTile(dir, reach, R, (q) => 128 - n * (refrProfile(q) / (REFR_PEAK * REFR_HEAD)) * 127.5);
  };

  const magnitude = (q: number) => (q > 1e-4 ? refrProfile(q) / q / (REFR_PEAK * REFR_HEAD) : 0) * 255;
  const centers = cornerCenters(R);
  const dir = (axis: Axis) => (key: Corner) => {
    const c = centers[key][axis === "x" ? 0 : 1];
    return productTile(key, magnitude, axis, (p) => (0.5 + (0.5 * (c - p)) / R) * 255, R);
  };

  const tilt = (sign: number) => (q: number) => 128 + (sign * refrProfile(q) * 127.5) / REFR_MAG_PEAK;

  return {
    slice: { r: R, reach, img: { top: edge("top"), right: edge("right"), bottom: edge("bottom"), left: edge("left") } },
    prod: { x: perCorner(dir("x")), y: perCorner(dir("y")) },
    tilt: {
      r: R,
      reach,
      img: {
        ...perCorner((key) => cornerTile(key, tilt(key === "tl" || key === "bl" ? 1 : -1))),
        top: edgeTile("top", reach, R, tilt(1)),
        bottom: edgeTile("bottom", reach, R, tilt(1)),
        left: edgeTile("left", reach, R, tilt(1)),
        right: edgeTile("right", reach, R, tilt(-1)),
      },
    },
    tiltRamp: (tiltRamp ??= lineTile(false, (f) => 255 * (1 - f))),
    gain: REFR_PEAK * REFR_HEAD,
  };
}

/** Where the tilt fades in, as a share of the peak displacement. */
const TILT_GATE = [0.2, 0.6] as const;

/**
 * The finished refraction field for one `w` x `h` box, computed per texel
 * from the exact rounded rectangle instead of laid from tiles. The nine-slice
 * meets at seams where neighbouring tiles disagree by a texel, and those
 * seams bend the image visibly ("cuts" at every tile boundary). Same profile,
 * tilt and encoding as the live graph, for its feDisplacementMap `scale`.
 *
 * `box` is the area the images cover in the filter's user space, `res` their
 * texels per CSS px. Returns the field as one grey + alpha PNG: x in grey,
 * y in alpha as a = 0.5 + 0.5y, which is what PACK_Y and the "in" composite
 * make of the two in the live graph, so it goes straight into UNPACK. One
 * image instead of two halves what feImage copies on every frame; grey and
 * alpha are not colour-managed (see PACK_Y).
 */
function computeRefraction(map: RefractionMap, w: number, h: number, box: SliceRect, res: number, resX = res) {
  const R = Math.max(0.01, Math.min(map.slice.r, w / 2, h / 2));
  const S = refractionScale(map, w, h);
  const straight = Math.max(0, Math.min(1, (w / 2 - R) / R));
  const run = w - 2 * R;
  const tw = Math.max(1, Math.round(box.w * resX));
  const th = Math.max(1, Math.round(box.h * res));
  const xs = new Float32Array(tw * th);
  const ys = new Float32Array(tw * th);
  for (let j = 0; j < th; j++) {
    const py = box.y + ((j + 0.5) / th) * box.h;
    for (let i = 0; i < tw; i++) {
      const px = box.x + ((i + 0.5) / tw) * box.w;
      // Nearest point of the inner rectangle: the arc centre in a corner,
      // the foot on the edge line along a straight side.
      const vx = px - Math.max(R, Math.min(w - R, px));
      const vy = py - Math.max(R, Math.min(h - R, py));
      const dist = Math.hypot(vx, vy);
      if (dist < 1e-6) continue;
      const P = refrProfile(Math.min(1, dist / R)) * R;
      if (P === 0) continue;
      const side = run > 1e-6 ? Math.max(-1, Math.min(1, 1 - (2 * (px - R)) / run)) : Math.sign(w / 2 - px);
      // The tilt starts only deeper in the band (TILT_GATE): it is small and
      // 8 bits wide, so where it fades out the field steps from 127 to 128
      // in one row, and that row shows as a horizontal cut with the picture
      // above it shifted sideways. Gated, that step lies where the picture
      // is bent and softened anyway.
      const g = Math.min(1, Math.max(0, (P / (R * REFR_MAG_PEAK) - TILT_GATE[0]) / (TILT_GATE[1] - TILT_GATE[0])));
      xs[j * tw + i] = (-P * vx) / dist + REFR_TILT * straight * side * P * g * g * (3 - 2 * g);
      ys[j * tw + i] = (-P * vy) / dist;
    }
  }
  return { xs, ys, tw, th, S };
}

export function refractionField(map: RefractionMap, w: number, h: number, box: SliceRect, res: number, resX = res) {
  const { xs, ys, tw, th, S } = computeRefraction(map, w, h, box, res, resX);
  const enc = (d: Float32Array) => Float32Array.from(d, (v) => 255 * (v / S + 0.5));
  return { xy: packedFieldPng(tw, th, enc(xs), enc(ys)) };
}

/* --- Resolution of the baked fields -----------------------------------
   feImage copies its bitmap on every frame, so the fields stay as small as
   the shape allows. Across the short side lives the rim profile, a steep
   step a few px wide: that side keeps at least FIELD_TEXELS texels, full
   resolution on a small element, never under half on a large one. Along
   the long side the field is linear over the straight run (the tilt ramp,
   which bilinear scaling reproduces exactly) and bends only in the caps: a
   quarter of the other side, but at least CAP_TEXELS texels per cap. The
   reflection field is blurred afterwards and needs less, REFL_TEXELS
   across. A 62 px pill keeps full resolution across and about half along
   (83 x 66 texels), a 233 px pill 0.55 across and 0.14 along (148 x 130). */
const FIELD_TEXELS = 96;
const CAP_TEXELS = 14;
const REFL_TEXELS = 32;

/** Texels per CSS px of the baked fields for a w x h box with corner radius
 *  r: `x` and `y` for the refraction field, `refl` for the reflection's. */
export function fieldScales(w: number, h: number, r: number) {
  const short = Math.max(1, Math.min(w, h));
  const fine = Math.min(1, Math.max(0.5, FIELD_TEXELS / short));
  const coarse = Math.min(fine, Math.max(fine / 4, CAP_TEXELS / Math.max(1, r)));
  const refl = Math.min(0.5, Math.max(0.25, REFL_TEXELS / short));
  return w >= h ? { x: coarse, y: fine, refl } : { x: fine, y: coarse, refl };
}

/* --- Reflection ----------------------------------------------------------

   The part of the light that never enters the glass: it pulls in what sits
   NEXT TO the element. A backdrop-filter only sees its own border box, so the
   reflection layer overhangs the element by `pad` and a mask cuts it back to
   the shape. The overhang only feeds the filter, it never shows. */

const IOR = 1.5;
const R0 = ((1 - IOR) / (1 + IOR)) ** 2;
const SIN_CRIT = 1 / IOR;
const EYE_DIST = 2.6;
/** How far the edge reaches out, times the short side. Also the overhang. */
const REFL_REACH = 2.6;
/** Absolute cap on that reach in px. The maps have 8 bits, so the step size
 *  is scale / 255: on a big element an unbounded reach turns the reflection
 *  into stairs and squeezes far-away content into the rim. */
const REFL_REACH_MAX = 160;
const RIM_SPAN = 2;
/** Curvature of the mirrored image: compressed towards the rim like a
 *  curved surface would. 0 is a flat mirror. */
const REFL_CURVE = 1.3;
const REFL_FLOOR = 0.3;
const REFL_INNER = 0.35;
const REFL_FADE = 0.22;
/** Softening of the mirrored image, at least REFL_BLUR px. The maps have 8
 *  bits, so the reflection moves in steps of scale / 255 px; a hard edge in
 *  the reflected content shows them as stairs unless the blur covers them. */
const REFL_BLUR = 1;
const REFL_BLUR_PER_STEP = 1.4;

type V3 = [number, number, number];
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm3 = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** Snell's law; null means total internal reflection. */
const refract3 = (i: V3, n: V3, eta: number): V3 | null => {
  const cosi = -dot3(i, n);
  const k = 1 - eta * eta * (1 - cosi * cosi);
  if (k < 0) return null;
  const f = eta * cosi - Math.sqrt(k);
  return [eta * i[0] + f * n[0], eta * i[1] + f * n[1], eta * i[2] + f * n[2]];
};
const smootherstep = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * c * (c * (c * 6 - 15) + 10);
};

export type ReflectionMap = {
  slice: Tiles;
  prod: Record<Axis, Record<Corner, string>>;
  /** Fresnel weight as nine-slice alpha tiles, applied inside the filter. */
  mask: Tiles;
  /** Overhang of the layer: top, right, bottom, left. */
  pad: ReflectAvail;
  scale: number;
  blur: number;
};

/** Mask corner sampling: wedges sit on the fan's EDGES so the corner meets
 *  the edge tile without a jump. Radial stops are denser near the rim. */
const WEDGES = 24;
const CSTOPS = 28;
const cornerAt = (i: number) => 1 - Math.pow(1 - i / CSTOPS, 1.7);

export const reflectionScale = (map: ReflectionMap, w: number, h: number) =>
  (map.scale / map.slice.r) * Math.max(0.01, Math.min(map.slice.r, w / 2, h / 2));

/** Overhang per side for a given free space: the reach, but never past the
 *  viewport. Two spaces with the same overhang give the same map. */
export const reflectionPad = (short: number, avail: ReflectAvail): ReflectAvail => {
  const L = Math.min(REFL_REACH * short, REFL_REACH_MAX);
  const cap = (a: number) => Math.max(0, Math.floor(Math.min(L, a)));
  return [cap(avail[0]), cap(avail[1]), cap(avail[2]), cap(avail[3])];
};

export function buildReflection(
  width: number,
  height: number,
  radius: number,
  rim: number,
  strength: number,
  avail: ReflectAvail
): ReflectionMap | null {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  const R = Math.max(0.01, Math.min(radius, w / 2, h / 2));

  // Overhang: as far as the edge reaches, but never past the viewport --
  // there is no backdrop out there. Short on room, that side is compressed.
  const L = Math.min(REFL_REACH * short, REFL_REACH_MAX);
  const pad = reflectionPad(short, avail);
  if (Math.max(...pad) < 2) return null;
  const [kT, kR, kB, kL] = pad.map((p) => Math.max(0, Math.min(1, p / L)));

  const band = Math.min(Math.max(13 * rim, short * 0.22), short * 0.45);
  const rimW = Math.max(1, 1.8 * rim);
  const ring = Math.min(band * RIM_SPAN, short / 2 - 1);
  const fadeEnd = Math.min(ring, rimW + short * REFL_FADE);
  const eyeZ = EYE_DIST * long;

  const tanT = Math.tan(REFL_CURVE);
  const reachAt = (D: number) => {
    const u = Math.min(1, Math.max(0, D / ring));
    return REFL_CURVE > 1e-4 ? Math.atan(u * tanT) / REFL_CURVE : u;
  };
  const reflProfile = (q: number) => (L / R) * reachAt(R * (1 - q));

  // Behind the fade the weight is 0, so the corner magnitude may run out
  // towards the centre instead of blowing up with 1/q.
  const qMin = Math.max(0.15, 1 - fadeEnd / R - 0.05);
  const cornerMag = (q: number) => reflProfile(q) / Math.max(q, qMin);
  let peak = 1e-6;
  for (let i = 0; i <= 1000; i++) peak = Math.max(peak, cornerMag(i / 1000));

  /** Fresnel + total internal reflection at a point; `D` is depth inwards. */
  const weight = (ex: number, ey: number, gx: number, gy: number, D: number) => {
    const sN = Math.min(1, D / band);
    const c = 1 - sN;
    const slope = sN >= 1 ? 0 : c / Math.max(0.025, Math.sqrt(1 - c * c));
    const n = norm3([gx * slope, gy * slope, 1]);
    const v = norm3([w / 2 - ex, h / 2 - ey, eyeZ]);
    const cosT = Math.min(1, Math.max(0, dot3(n, v)));
    const fres = R0 + (1 - R0) * Math.pow(1 - cosT, 5);

    let tir = 1;
    const into = refract3([-v[0], -v[1], -v[2]], n, 1 / IOR);
    if (into) tir = Math.min(1, Math.max(0, (Math.hypot(into[0], into[1]) - SIN_CRIT * 0.94) / (SIN_CRIT * 0.12)));

    // Nothing in the outermost ring: there the edge layers own the look.
    const inner =
      D <= rimW ? 0 : fadeEnd > rimW ? REFL_INNER * (1 - smootherstep((D - rimW) / (fadeEnd - rimW))) : 0;
    return Math.min(1, Math.max(REFL_FLOOR, fres + (1 - fres) * tir) * strength * inner);
  };

  const maskReach = Math.max(2, Math.floor(short / 2));

  const edgeDefs = {
    top: { gx: 0, gy: -1, at: (D: number) => [w / 2, D] as const },
    bottom: { gx: 0, gy: 1, at: (D: number) => [w / 2, h - D] as const },
    left: { gx: -1, gy: 0, at: (D: number) => [D, h / 2] as const },
    right: { gx: 1, gy: 0, at: (D: number) => [w - D, h / 2] as const },
  };

  const maskEdge = (key: Edge) => {
    const def = edgeDefs[key];
    const flip = key === "bottom" || key === "right";
    const vertical = key === "top" || key === "bottom";
    return maskPng(vertical ? 1 : LINE_TEX, vertical ? LINE_TEX : 1, (x, y) => {
      const t = ((vertical ? y : x) + 0.5) / LINE_TEX;
      const f = flip ? 1 - t : t;
      const [ex, ey] = def.at(f * maskReach);
      return weight(ex, ey, def.gx, def.gy, f * maskReach);
    });
  };

  const maskDefs = {
    tl: { a0: Math.PI, cx: R, cy: R, ecx: R, ecy: R },
    tr: { a0: -Math.PI / 2, cx: 0, cy: R, ecx: w - R, ecy: R },
    br: { a0: 0, cx: 0, cy: 0, ecx: w - R, ecy: h - R },
    bl: { a0: Math.PI / 2, cx: R, cy: 0, ecx: R, ecy: h - R },
  };

  const maskCorner = (key: Corner) => {
    const def = maskDefs[key];
    const wedgeStops: number[][] = [];
    for (let k = 0; k < WEDGES; k++) {
      const th = def.a0 + (k / (WEDGES - 1)) * (Math.PI / 2);
      const gx = Math.cos(th);
      const gy = Math.sin(th);
      const stops: number[] = [];
      for (let i = 0; i <= CSTOPS; i++) {
        const rho = cornerAt(i) * R;
        stops.push(weight(def.ecx + gx * rho, def.ecy + gy * rho, gx, gy, R - rho));
      }
      wedgeStops.push(stops);
    }
    const n = Math.max(8, Math.min(128, Math.ceil(R * 2)));
    return maskPng(n, n, (x, y) => {
      const dx = ((x + 0.5) / n) * R - def.cx;
      const dy = ((y + 0.5) / n) * R - def.cy;
      const rho = Math.hypot(dx, dy);
      if (rho >= R) return 0;
      let t = Math.atan2(dy, dx) - def.a0;
      t = ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (t > Math.PI / 2) t = t > Math.PI + Math.PI / 4 ? 0 : Math.PI / 2;
      const stops = wedgeStops[Math.round((t / (Math.PI / 2)) * (WEDGES - 1))];
      const f = rho / R;
      let i = 0;
      while (i < CSTOPS - 1 && cornerAt(i + 1) < f) i++;
      const f0 = cornerAt(i);
      const f1 = cornerAt(i + 1);
      const u = f1 > f0 ? Math.min(1, Math.max(0, (f - f0) / (f1 - f0))) : 0;
      return stops[i] + (stops[i + 1] - stops[i]) * u;
    });
  };

  // Same decomposition as the refraction, but pointing OUTWARDS, with each
  // side's compression baked into its tiles.
  const reach = tileReach(R, short);
  const kEdge = { top: kT, right: kR, bottom: kB, left: kL };
  const offEdge = (key: Edge) => {
    const sign = key === "top" || key === "left" ? -1 : 1;
    return edgeTile(key, reach, R, (q) => 128 + sign * ((kEdge[key] * reflProfile(q)) / peak) * 127.5);
  };

  const centers = cornerCenters(R);
  const offMag = (q: number) => (cornerMag(q) / peak) * 255;
  const offDir = (axis: Axis) => (key: Corner) => {
    const c = centers[key][axis === "x" ? 0 : 1];
    const k = axis === "x" ? (key === "tl" || key === "bl" ? kL : kR) : key === "tl" || key === "tr" ? kT : kB;
    return productTile(key, offMag, axis, (p) => (0.5 + (0.5 * k * (p - c)) / R) * 255, R);
  };

  return {
    slice: { r: R, reach, img: { top: offEdge("top"), right: offEdge("right"), bottom: offEdge("bottom"), left: offEdge("left") } },
    prod: { x: perCorner(offDir("x")), y: perCorner(offDir("y")) },
    mask: {
      r: R,
      reach: maskReach,
      img: {
        ...perCorner(maskCorner),
        top: maskEdge("top"),
        right: maskEdge("right"),
        bottom: maskEdge("bottom"),
        left: maskEdge("left"),
      },
    },
    pad,
    scale: 2 * peak * R,
    blur: Math.max(REFL_BLUR, ((2 * peak * R) / 255) * REFL_BLUR_PER_STEP),
  };
}

/* --- Edge lighting --------------------------------------------------------

   Two complementary conic gradients (glint + rim = 1 everywhere) that pick
   which part of the edge is lit. Lighting follows the surface NORMAL, so the
   angles are warped by the aspect ratio: on a wide pill the long edges take a
   wider angular range. 0.4 is a compromise between following the shape (2)
   and keeping all four transitions equally soft (0). */

const ARC_PEAK = 45;
const ARC_SHAPE = 0.4;
const ARC_STEP = 3;
const ARC_CACHE = new Map<string, { glint: string; rim: string }>();

export function buildBevelArcs(width: number, height: number) {
  const w = Math.round(width);
  const h = Math.round(height);
  const key = `${w}:${h}`;
  const hit = ARC_CACHE.get(key);
  if (hit) return hit;

  const ax = 1 / Math.pow(Math.max(1, w) / 2, ARC_SHAPE);
  const by = 1 / Math.pow(Math.max(1, h) / 2, ARC_SHAPE);
  const glint = (deg: number) => {
    const r = (deg * Math.PI) / 180;
    const n = ((Math.atan2(Math.sin(r) * ax, Math.cos(r) * by) * 180) / Math.PI + 360) % 360;
    return (1 + Math.cos((2 * (n - ARC_PEAK) * Math.PI) / 180)) / 2;
  };
  const stop = (v: number, deg: number) =>
    `${v >= 0.9995 ? "#000" : v <= 0.0005 ? "transparent" : `rgba(0,0,0,${+v.toFixed(3)})`} ${deg}deg`;
  const build = (fn: (deg: number) => number) => {
    const parts = ["from 0deg"];
    for (let deg = 0; deg <= 360; deg += ARC_STEP) parts.push(stop(fn(deg), deg));
    return `conic-gradient(${parts.join(",")})`;
  };

  const res = { glint: build(glint), rim: build((deg) => 1 - glint(deg)) };
  if (ARC_CACHE.size >= 48) ARC_CACHE.delete(ARC_CACHE.keys().next().value as string);
  ARC_CACHE.set(key, res);
  return res;
}
