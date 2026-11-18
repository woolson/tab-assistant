import {
  CORNERS,
  EDGES,
  PACK_Y,
  REFR_FOLD_DEPTH,
  SLOTS,
  TILT_MULTIPLY,
  UNPACK,
  buildBevelArcs,
  buildReflection,
  packedFieldPng,
  buildRefraction,
  reflectionPad,
  reflectionScale,
  refractionField,
  refractionScale,
  sliceRect,
  tiltGain,
  type Axis,
  type Corner,
  type ReflectAvail,
  type ReflectionMap,
  type RefractionMap,
  type SliceRect,
  type Slot,
  type Tiles,
  fieldScales,
} from "./maps";
// The adapter injects this stylesheet into the matching document or shadow root.

export type LiquidGlassOptions = {
  /** Corner radius in CSS px. Default 30. */
  radius?: number;
  /** Width of the refracting rim, relative. Default 1.3. */
  rim?: number;
  /** Frost behind the glass in CSS px. Default 2. */
  blur?: number;
  saturate?: number;
  /** Mirror the surroundings into the rim. Costs one more backdrop layer. Default true. */
  reflect?: boolean;
  /** 1 is physical Fresnel; higher only raises the level. Default 2.5. */
  reflectStrength?: number;
  /**
   * Puts the page's scrolling content into a compositor layer of its own
   * (will-change: transform) through a stylesheet the glass injects once.
   * Without it Chromium does not raster the page in time during a fast
   * fling and shows it cut off: the glass's backdrop filters take the GPU
   * time the tiles would need. true for `main`, or a selector of your own;
   * false leaves the page alone. Default true.
   */
  promote?: boolean | string;
};

/* Rebake only when the short side moves clearly away from the baked one.
   Down is generous (a larger map laid into a smaller box IS the smaller
   shape) and waits until the size settles, so a quick overshoot never swaps
   an href mid-animation. Up is tight, because there the tiles get stretched. */
const BAKE_SLACK_DOWN = 12;
const BAKE_SLACK_UP = 3;
const BAKE_SETTLE_MS = 650;
/** Free space around the element is measured in steps of this many px. */
const AVAIL_STEP = 8;
/** Filter region margin around the box. */
const REGION = 2;
/* Least time between two redraws of the glass. Scroll events come once per
   frame; 13 ms skips every other one at 120 Hz and none at 60 Hz. The glass
   then trails the page by one frame at most, which is not visible in
   motion, and its GPU work is halved just where the frames are shortest.
   A frame that arrives late is a dropped frame, the GPU did not make it: for
   a moment the gap grows, to 25 ms after one dropped frame, 50 ms after
   three in a row. Fast scrolling hides the lag that costs. */
const TICK_GAP_MS = [13, 25, 50];
const TICK_HOLD_MS = 600;
/** A frame this long after the last one is a pause, not a dropped frame. */
const TICK_PAUSE_MS = 120;
/* Resolution of the precomputed fields, relative to CSS pixels. Every image
   in a backdrop filter is copied to the compositor with every frame, so the
   fields are kept small: they are smooth, and the reflection's is blurred
   afterwards anyway. */
/** Resolution of the baked masks (the ring, the reflection's mask). The
 *  fields pick theirs by shape and size: fieldScales in maps.ts. */
const FIELD_SCALE = 0.5;
/** What `promote: true` lifts into a layer of its own. */
const PROMOTE_DEFAULT = "main";

const REFR_CACHE = new Map<string, RefractionMap>();
function cachedRefraction(short: number, radius: number) {
  const key = `${short}|${radius}`;
  let map = REFR_CACHE.get(key);
  if (!map) {
    map = buildRefraction(short, radius);
    if (REFR_CACHE.size >= 96) REFR_CACHE.delete(REFR_CACHE.keys().next().value as string);
    REFR_CACHE.set(key, map);
  }
  return map;
}

/* Only Chromium runs url() filters inside backdrop-filter. Safari drops the
   whole declaration, blur included, so everyone else gets frosted glass
   without refraction. navigator.userAgentData exists in Chromium only. */
const SVG_BACKDROP = typeof navigator !== "undefined" && "userAgentData" in navigator;

/** False where the glass falls back to frosted glass without refraction. */
export const supportsRefraction = SVG_BACKDROP;

/* Whether CSS anchor positioning can keep the covers on the host. It then
   does so in the browser itself, on every frame and however the host moves:
   a resize, a scroll, a transition, an animated translate. Only where
   anchor() also follows the host's transforms, though: browsers differ on
   that (Chrome 144+ and Safari 27+ do, Safari 26 and Firefox do not), and
   one that ignores them would leave the covers behind a translated host.
   Probed once rather than read from a version number. */
let anchorProbe: boolean | undefined;
const anchorsFollowHost = () => {
  if (anchorProbe !== undefined) return anchorProbe;
  anchorProbe = false;
  if (typeof CSS === "undefined" || !CSS.supports("anchor-name", "--lg") || !CSS.supports("top", "anchor(top)"))
    return anchorProbe;
  const hidden = "position:fixed;visibility:hidden;pointer-events:none;";
  const a = document.createElement("div");
  const b = document.createElement("div");
  a.style.cssText = `${hidden}top:0;left:0;width:10px;height:10px;anchor-name:--lg-probe;translate:0 7px`;
  b.style.cssText =
    `${hidden}position-anchor:--lg-probe;top:anchor(top);left:anchor(left);` +
    "width:anchor-size(width);height:anchor-size(height)";
  document.body.append(a, b);
  const ra = a.getBoundingClientRect();
  const rb = b.getBoundingClientRect();
  anchorProbe = Math.abs(ra.top - rb.top) < 0.5 && Math.abs(ra.width - rb.width) < 0.5;
  a.remove();
  b.remove();
  return anchorProbe;
};

const SVG_NS = "http://www.w3.org/2000/svg";

function el<K extends keyof SVGElementTagNameMap>(parent: Node, tag: K, attrs: Record<string, string | number> = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  parent.appendChild(node);
  return node;
}

function layer(parent: Node, cls: string) {
  const node = document.createElement("span");
  node.className = cls;
  node.setAttribute("aria-hidden", "true");
  parent.appendChild(node);
  return node;
}

/* Writing an SVG attribute, even to the same value, invalidates the filter
   and re-filters the backdrop. During a resize most values do not change
   (corners keep their size, only the edges grow), so compare first. */
const setAttr = (node: Element, name: string, value: number | string) => {
  const next = String(value);
  if (node.getAttribute(name) !== next) node.setAttribute(name, next);
};

const setRect = (node: Element, r: SliceRect) => {
  setAttr(node, "x", r.x);
  setAttr(node, "y", r.y);
  setAttr(node, "width", r.w);
  setAttr(node, "height", r.h);
};

const setStyle = (node: HTMLElement, name: string, value: string) => {
  if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value);
};

const setBackdrop = (node: HTMLElement, value: string) => {
  setStyle(node, "backdrop-filter", value);
  setStyle(node, "-webkit-backdrop-filter", value);
};

/** One displacement field (x and y as separate grey images) for a nine-slice. */
type Field = {
  edges: Partial<Record<Slot, SVGFEImageElement>>;
  corners: Record<`${Axis}${Corner}`, SVGFEImageElement>;
};

function buildField(filter: SVGFilterElement, p: string): Field {
  el(filter, "feFlood", { "flood-color": "rgb(128,128,128)", result: `${p}base` });
  const edges: Field["edges"] = {};
  for (const slot of EDGES)
    edges[slot] = el(filter, "feImage", { preserveAspectRatio: "none", result: `${p}${slot}` });
  const corners = {} as Field["corners"];
  for (const axis of ["x", "y"] as const) {
    for (const c of CORNERS)
      corners[`${axis}${c}`] = el(filter, "feImage", { preserveAspectRatio: "none", result: `${p}c${axis}${c}` });
    const merge = el(filter, "feMerge", { result: `${p}${axis}` });
    el(merge, "feMergeNode", { in: `${p}base` });
    for (const c of CORNERS) el(merge, "feMergeNode", { in: `${p}c${axis}${c}` });
    for (const slot of axis === "x" ? ["left", "right"] : ["top", "bottom"]) el(merge, "feMergeNode", { in: `${p}${slot}` });
  }
  return { edges, corners };
}

/** Grey x and y become one coloured map only at the very end (see maps.ts). */
function packField(filter: SVGFilterElement, x: string, y: string, out: string) {
  el(filter, "feColorMatrix", { in: y, type: "matrix", values: PACK_Y, result: `${out}ya` });
  el(filter, "feComposite", { in: x, in2: `${out}ya`, operator: "in", result: `${out}xy` });
  el(filter, "feColorMatrix", { in: `${out}xy`, type: "matrix", values: UNPACK, result: out });
  return el(filter, "feDisplacementMap", {
    in: "SourceGraphic",
    in2: out,
    xChannelSelector: "R",
    yChannelSelector: "G",
    result: "bent",
  });
}

function setFieldImages(field: Field, map: { slice: Tiles; prod: Record<Axis, Record<Corner, string>> }) {
  for (const slot of EDGES) setAttr(field.edges[slot]!, "href", map.slice.img[slot]!);
  for (const axis of ["x", "y"] as const)
    for (const c of CORNERS) setAttr(field.corners[`${axis}${c}`], "href", map.prod[axis][c]);
}

function layField(field: Field, tiles: Tiles, w: number, h: number, ox = 0, oy = 0) {
  for (const slot of EDGES) setRect(field.edges[slot]!, sliceRect(slot, w, h, tiles.r, tiles.reach, ox, oy));
  for (const c of CORNERS) {
    const rect = sliceRect(c, w, h, tiles.r, tiles.reach, ox, oy);
    setRect(field.corners[`x${c}`], rect);
    setRect(field.corners[`y${c}`], rect);
  }
}

/* --- Precomputed fields ---------------------------------------------------

   The displacement field only depends on the size, yet the nine-slice graph
   puts it together from some 35 primitives on every frame, and on a large
   element that is most of the glass's GPU time. Under load such a frame
   misses its deadline and Chromium shows it half drawn: the glass flickers.
   So once the size has settled, the finished x and y fields are rendered
   into two grey images, and a copy of the filter reads those instead of
   building them: the same pixels from a handful of primitives. The
   reflection's mask goes the same way. Grey, not packed colour, for the P3
   reason in maps.ts. */

type Box = { x: number; y: number; width: number; height: number };

const boxOf = (f: SVGFilterElement): Box => ({
  x: +f.getAttribute("x")!,
  y: +f.getAttribute("y")!,
  width: +f.getAttribute("width")!,
  height: +f.getAttribute("height")!,
});

/** Renders the output of a filter that reads no backdrop, over `box`, into a PNG. */
async function renderFilter(f: SVGFilterElement, box: Box, scale: number) {
  const { x, y, width: w, height: h } = box;
  f.id = "f";
  const svg =
    // Rendered at full size and scaled down by the canvas: where two tiles
    // meet, a seam rendered small would stay as a visible line.
    `<svg xmlns="${SVG_NS}" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}">` +
    `${f.outerHTML}<rect x="${x}" y="${y}" width="${w}" height="${h}" filter="url(#f)"/></svg>`;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  // onload, not decode(): decode() can hang on SVG images.
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return decoded(canvas.toDataURL("image/png"));
}

/** Resolves once `url` is decoded, so the first frame that uses it has the image. */
async function decoded(url: string) {
  await new Promise((resolve, reject) => {
    const check = new Image();
    check.onload = resolve;
    check.onerror = reject;
    check.src = url;
  });
  return url;
}

/** Renders the field `out` of a live filter over `box` into a grey PNG at `scale`. */
function renderField(live: SVGFilterElement, out: string, cut: string, box: Box, scale: number) {
  const f = live.cloneNode(true) as SVGFilterElement;
  // Everything from the packing step on reads the backdrop; drop it and end
  // the graph with the field itself.
  const from = f.querySelector(`[result="${cut}"]`);
  while (from?.nextSibling) from.nextSibling.remove();
  from?.remove();
  el(el(f, "feMerge"), "feMergeNode", { in: out });
  return renderFilter(f, box, scale);
}

/** Two grey field images of the same size as one packed grey + alpha PNG. */
async function packImages(xUrl: string, yUrl: string) {
  const read = async (url: string) => {
    const img = new Image();
    img.src = url;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    // Opaque grey: read back exactly, R is the value.
    const d = g.getImageData(0, 0, c.width, c.height).data;
    return { w: c.width, h: c.height, v: Uint8Array.from({ length: c.width * c.height }, (_, k) => d[4 * k]!) };
  };
  const [x, y] = await Promise.all([read(xUrl), read(yUrl)]);
  return decoded(packedFieldPng(x.w, x.h, x.v, y.v));
}

const image = (attrs: Record<string, string | number>) => {
  const node = document.createElementNS(SVG_NS, "feImage");
  for (const [k, v] of Object.entries({ preserveAspectRatio: "none", ...attrs })) node.setAttribute(k, String(v));
  return node;
};

/** A static mask: the primitives that make it, and the box it covers. */
type BakeMask = { result: string; parts: string[]; box: Box; scale: number };

type BakeOptions = {
  /** Where the field varies; the filter region by default. Outside it the
   * image is absent, so the box must cover everything the output reads. */
  box?: Box;
  mask?: BakeMask;
  /** The packed field over `box`, already computed (refractionField): it
   * replaces the packing step, and nothing is rendered. */
  fields?: { xy: string };
};

/**
 * A copy of `live` that starts after its packing step (`cut` and the
 * composite after it) and reads the packed field from one image: one copy
 * per frame instead of two, and two primitives less. With `mask`, that mask
 * too comes from one image instead of its parts. Replaces an earlier copy
 * with the same id.
 */
/** Renders a static mask of `live` (its parts alone) over its box into a PNG. */
function renderMask(live: SVGFilterElement, mask: BakeMask) {
  const names = [...mask.parts, mask.result];
  const f = live.cloneNode(true) as SVGFilterElement;
  for (const n of Array.from(f.children)) if (!names.includes(n.getAttribute("result") ?? "")) n.remove();
  return renderFilter(f, mask.box, mask.scale);
}

async function bakeFilter(live: SVGFilterElement, xOut: string, yOut: string, cut: string, scale: number, { box = boxOf(live), mask, fields }: BakeOptions = {}) {
  const isMask = (n: Element) => !!mask && [...mask.parts, mask.result].includes(n.getAttribute("result") ?? "");
  const [xyUrl, maskUrl] = await Promise.all([
    fields ? decoded(fields.xy) : Promise.all([renderField(live, xOut, cut, box, scale), renderField(live, yOut, cut, box, scale)]).then(([x, y]) => packImages(x, y)),
    mask ? renderMask(live, mask) : "",
  ]);
  const f = live.cloneNode(true) as SVGFilterElement;
  f.id = `${live.id}-baked`;
  const from = f.querySelector(`[result="${cut}"]`)!;
  while (from.previousSibling) from.previousSibling.remove();
  // The image is what the packing makes: drop it, up to the matrix that
  // reads its result.
  const packed = from.nextElementSibling!.getAttribute("result")!;
  from.nextElementSibling!.remove();
  from.replaceWith(image({ ...box, result: packed, href: xyUrl }));
  if (mask) {
    const parts = Array.from(f.children).filter(isMask);
    parts[parts.length - 1]!.after(image({ ...mask.box, result: mask.result, href: maskUrl }));
    for (const n of parts) n.remove();
  }
  document.getElementById(f.id)?.remove();
  live.after(f);
  return f.id;
}

/**
 * The ring an edge layer's mask cuts, as one SVG image in device pixels:
 * opaque up to `rimW` in from the outline, transparent from `fade` on. The
 * same four side and four corner gradients as the CSS mask, but every piece
 * boundary lies on a whole pixel and is drawn crisp, so neighbouring pieces
 * neither leave a gap nor overlap.
 */
function ringMask(w: number, h: number, r: number, rimW: number, fade: number, dpr: number) {
  const W = Math.max(1, Math.round(w * dpr));
  const H = Math.max(1, Math.round(h * dpr));
  const sx = W / w;
  const sy = H / h;
  const R = Math.min(r, w / 2, h / 2);
  const d = Math.max(0.01, Math.min(fade, R));
  const s = Math.min(1, rimW / d);
  const bx = Math.min(Math.floor(W / 2), Math.round(R * sx));
  const by = Math.min(Math.floor(H / 2), Math.round(R * sy));
  const hx = Math.floor(W / 2);
  const hy = Math.floor(H / 2);
  const stops = (a: number, b: number) =>
    `<stop offset="${a}" stop-opacity="${a === s ? 1 : 0}"/><stop offset="${b}" stop-opacity="${b === s ? 1 : 0}"/>`;
  const linear = (id: string, x1: number, y1: number, x2: number, y2: number) =>
    `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops(s, 1)}</linearGradient>`;
  // Radial: transparent at depth `fade`, opaque from `rimW`, opaque beyond
  // the arc too (pad), like the CSS gradient: the host's outline cuts there.
  const radial = (id: string, cx: number, cy: number) =>
    `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${R * sx}" gradientTransform="translate(${cx} ${cy}) scale(1 ${sy / sx}) translate(${-cx} ${-cy})">` +
    `<stop offset="${(R - d) / R}" stop-opacity="0"/><stop offset="${(R - Math.min(rimW, d)) / R}" stop-opacity="1"/></radialGradient>`;
  const rect = (x: number, y: number, rw: number, rh: number, fill: string) =>
    rw > 0 && rh > 0 ? `<rect x="${x}" y="${y}" width="${rw}" height="${rh}" fill="url(#${fill})"/>` : "";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges"><defs>` +
    linear("t", 0, 0, 0, d * sy) +
    linear("b", 0, H, 0, H - d * sy) +
    linear("l", 0, 0, d * sx, 0) +
    linear("r", W, 0, W - d * sx, 0) +
    radial("ctl", R * sx, R * sy) +
    radial("ctr", W - R * sx, R * sy) +
    radial("cbr", W - R * sx, H - R * sy) +
    radial("cbl", R * sx, H - R * sy) +
    `</defs>` +
    rect(bx, 0, W - 2 * bx, hy, "t") +
    rect(bx, hy, W - 2 * bx, H - hy, "b") +
    rect(0, by, hx, H - 2 * by, "l") +
    rect(hx, by, W - hx, H - 2 * by, "r") +
    rect(0, 0, bx, by, "ctl") +
    rect(W - bx, 0, bx, by, "ctr") +
    rect(W - bx, H - by, bx, by, "cbr") +
    rect(0, H - by, bx, by, "cbl") +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** The ring widths an edge layer resolves its CSS to, in CSS px. */
function ringWidths(layerEl: HTMLElement) {
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;left:0;top:0;width:var(--w);height:var(--d);visibility:hidden";
  layerEl.append(probe);
  const r = probe.getBoundingClientRect();
  probe.remove();
  return { rimW: r.width, fade: r.height };
}

let instances = 0;

/**
 * Turns `host` into liquid glass. The host keeps its own content; the glass
 * layers are inserted in front of it and everything else is raised above
 * them. Size changes of the host are followed automatically.
 */
export function createLiquidGlass(host: HTMLElement, options: LiquidGlassOptions = {}) {
  const {
    radius = 30,
    rim = 1.3,
    blur = 2.5,
    saturate = 1.1,
    reflect = true,
    reflectStrength = 2.5,
    promote = true,
  } = options;
  const uid = ++instances;
  if (promote && !document.getElementById("lg-promote")) {
    const st = document.createElement("style");
    st.id = "lg-promote";
    st.textContent = `${promote === true ? PROMOTE_DEFAULT : promote} { will-change: transform }`;
    document.head.append(st);
  }
  const refractId = `ta-lg-refract-${uid}`;
  const reflectId = `ta-lg-reflect-${uid}`;

  host.classList.add("lg-host");
  host.style.borderRadius = `${radius}px`;

  const root = document.createDocumentFragment();

  /* --- The two filters, as real SVG in the document ---------------------- */

  const defs = el(root, "svg", { class: "lg-defs", width: 0, height: 0, "aria-hidden": "true" });

  const refrFilter = el(defs, "filter", {
    id: refractId,
    filterUnits: "userSpaceOnUse",
    "color-interpolation-filters": "sRGB",
    x: -REGION,
    y: -REGION,
  });
  const refrField = buildField(refrFilter, "r");

  // Tilt: magnitude tiles times a sign field (+1 left, ramp over the straight
  // run, -1 right), added onto the x field with a strength that follows the
  // length of the straight run.
  el(refrFilter, "feFlood", { "flood-color": "rgb(128,128,128)", result: "tbase" });
  const tiltTiles: Partial<Record<Slot, SVGFEImageElement>> = {};
  for (const slot of SLOTS) tiltTiles[slot] = el(refrFilter, "feImage", { preserveAspectRatio: "none", result: `t${slot}` });
  const tmag = el(refrFilter, "feMerge", { result: "tmag" });
  el(tmag, "feMergeNode", { in: "tbase" });
  for (const slot of SLOTS) el(tmag, "feMergeNode", { in: `t${slot}` });
  el(refrFilter, "feFlood", { "flood-color": "rgb(255,255,255)", result: "sbase" });
  const tiltRamp = el(refrFilter, "feImage", { preserveAspectRatio: "none", y: 0, result: "sramp" });
  const sfield = el(refrFilter, "feMerge", { result: "sfield" });
  el(sfield, "feMergeNode", { in: "sbase" });
  el(sfield, "feMergeNode", { in: "sramp" });
  el(refrFilter, "feComposite", { in: "tmag", in2: "sfield", operator: "arithmetic", ...TILT_MULTIPLY, result: "tvec" });
  const tiltAdd = el(refrFilter, "feComposite", { in: "rx", in2: "tvec", operator: "arithmetic", k1: 0, k2: 1, result: "rxt" });
  const refrDisp = packField(refrFilter, "rxt", "ry", "rmap");
  // The displacement is the last step. A fold band after it (a 1.5px blur
  // of the bent picture laid over the sharp one where the field squeezes
  // it, four primitives and an image) changed nothing visible under the
  // frost blur, and in Chrome its passes were the largest single cost of
  // the glass, the one that cut the page off in fast flings. Gone.

  const reflFilter = el(defs, "filter", {
    id: reflectId,
    filterUnits: "userSpaceOnUse",
    "color-interpolation-filters": "sRGB",
    x: -REGION,
    y: -REGION,
  });
  const reflField = buildField(reflFilter, "f");
  // Everything from here on only has to cover the outline (plus the blur's
  // reach): the region is the whole overhang, which the mirror reads from,
  // but a primitive's output is drawn at the size of its subregion, and
  // these are the expensive ones. sync() keeps them to the box.
  const reflTailFrom = reflFilter.children.length;
  const reflDisp = packField(reflFilter, "fx", "fy", "fmap");
  // A curved mirror compresses its image and loses angular resolution.
  const reflBlur = el(reflFilter, "feGaussianBlur", { in: "bent", result: "fsoft" });
  // Cut back to the shape here, not with a CSS mask: a mask is rasterised
  // like content, and under load Chromium draws frames before it is, which
  // drops the whole reflection for that frame. Where the filter leaves
  // transparency, the page shows through unchanged.
  const reflMask: Partial<Record<Slot, SVGFEImageElement>> = {};
  for (const slot of SLOTS) reflMask[slot] = el(reflFilter, "feImage", { preserveAspectRatio: "none", result: `fm${slot}` });
  const reflMaskMerge = el(reflFilter, "feMerge", { result: "fmask" });
  for (const slot of SLOTS) el(reflMaskMerge, "feMergeNode", { in: `fm${slot}` });
  el(reflFilter, "feComposite", { in: "fsoft", in2: "fmask", operator: "in" });

  /* --- The layers ---------------------------------------------------------

     Siblings, not nested: an element with backdrop-filter is a backdrop root,
     so a child of it would only see its parent, not the page. Order matters,
     a backdrop-filter sees what was painted before it. The reflection comes
     first so its backdrop is the page only (not the shadow and caustic below
     the pill); z-index lifts it above the pane when painting. */

  const reflectLayer = layer(root, "lg-layer lg-reflect");
  reflectLayer.hidden = true;
  const causticWrap = layer(root, "lg-layer lg-caustic");
  layer(causticWrap, "lg-caustic-ring");
  const pane = layer(root, "lg-layer lg-pane");
  const fold = layer(root, "lg-layer lg-edge lg-fold");
  const glint = layer(root, "lg-layer lg-edge lg-glint");
  const rimLayer = layer(root, "lg-layer lg-edge lg-rim");
  host.prepend(root);

  // The covers are siblings, so nothing ties them to the host's position.
  // Where the browser can (see anchorsFollowHost), CSS anchor positioning
  // does: it keeps them on the host on every frame, however the host moves.
  // Everywhere else place() lays them out in px. The host keeps any
  // anchor-name it already has.
  const anchorName = `--lg-host-${uid}`;
  const ownAnchor = host.style.getPropertyValue("anchor-name");
  const anchors = anchorsFollowHost();
  if (anchors) {
    const given = getComputedStyle(host).getPropertyValue("anchor-name").trim();
    host.style.setProperty("anchor-name", given && given !== "none" ? `${given}, ${anchorName}` : anchorName);
  }
  /** Covers the browser keeps on the host. One found elsewhere (see place)
   *  leaves this set for good and is laid out in px. */
  const anchored = new Set<HTMLElement>();
  const anchorTo = (c: HTMLElement) => {
    c.style.setProperty("position-anchor", anchorName);
    c.style.setProperty("left", "anchor(left)");
    c.style.setProperty("top", "anchor(top)");
    c.style.setProperty("width", "anchor-size(width)");
    c.style.setProperty("height", "anchor-size(height)");
    anchored.add(c);
  };

  // The two layers that differ most between light and dark: a sibling right
  // after the host, not a layer inside it, so they can be crossfaded without
  // touching the glass (addCover). A paint change inside the host repaints
  // the glass, and doing that on every frame flickers. Above everything the
  // host draws, content included.
  const makeCover = () => {
    const c = document.createElement("div");
    c.className = "lg-cover";
    c.setAttribute("aria-hidden", "true");
    c.style.position = "absolute";
    layer(c, "lg-layer lg-edge lg-spec");
    layer(c, "lg-layer lg-underlay");
    if (anchors) anchorTo(c);
    return c;
  };
  const cover = makeCover();
  const covers = [cover];
  host.after(cover);

  // A near-invisible fill right under the glass; refresh() changes it so
  // Chromium redraws the glass (see refresh below). It is page content, a
  // sibling before the host, not a layer inside it: a change inside the host
  // repaints the host's own layers, and that flickered. Being before the
  // host, it cannot anchor to it (an anchor has to come first), so place()
  // always lays it out.
  const tick = document.createElement("span");
  tick.className = "lg-tick";
  tick.setAttribute("aria-hidden", "true");
  // Out of the flow from the start, so it never becomes a flex or grid item.
  tick.style.position = "absolute";
  host.before(tick);

  /** Whether an anchored cover really sits on the host (r: the host's box). */
  const onHost = (el: HTMLElement, r: DOMRect) => {
    // Nothing to compare while the host or the cover is not rendered.
    if (!host.getClientRects().length || !el.getClientRects().length) return true;
    const c = el.getBoundingClientRect();
    return (
      Math.abs(c.left - r.left) < 1 &&
      Math.abs(c.top - r.top) < 1 &&
      Math.abs(c.width - r.width) < 1 &&
      Math.abs(c.height - r.height) < 1
    );
  };

  /** Lays the fill and the covers onto the host. Ignores transforms, except
   *  on a cover the browser keeps on the host: that one follows them. */
  const place = () => {
    const cs = getComputedStyle(host);
    const fixed = cs.position === "fixed";
    const r = host.getBoundingClientRect();
    // Unrounded, unlike offsetLeft/offsetTop: a pixel off shows at the edge.
    const o = fixed ? { left: 0, top: 0 } : (host.offsetParent ?? document.body).getBoundingClientRect();
    // Without the host's own translate: give the fill (and covers laid out in
    // px) the same one (an animated translate, say) and they move along.
    const [tx = 0, ty = 0] = cs.translate === "none" ? [] : cs.translate.split(" ").map(parseFloat);
    for (const el of [tick, ...covers]) {
      setStyle(el, "position", fixed ? "fixed" : "absolute");
      if (anchored.has(el)) {
        if (onHost(el, r)) continue;
        // Not on the host after all: a cover given the host's translate
        // itself (the way to follow one before anchoring), or appended to a
        // parent where it cannot anchor. Laid out in px from here on.
        el.style.removeProperty("position-anchor");
        anchored.delete(el);
      }
      setStyle(el, "left", `${r.left - o.left - tx}px`);
      setStyle(el, "top", `${r.top - o.top - ty}px`);
      setStyle(el, "width", `${r.width}px`);
      setStyle(el, "height", `${r.height}px`);
    }
    // A cover is not a child, so it inherits nothing from the host.
    for (const c of covers) {
      setStyle(c, "z-index", cs.zIndex);
      setStyle(c, "border-radius", cs.borderRadius);
      for (const name of ["--lg-r", "--lg-s", "--lg-rim-w", "--lg-rim-fade"]) {
        const v = cs.getPropertyValue(name);
        if (v) setStyle(c, name, v);
        else c.style.removeProperty(name);
      }
    }
  };

  // Edge layers only change exposure, they never displace -- displacing in
  // more than one layer drags image parts to places they do not belong.
  // Set inline: CSS minifiers like to merge or drop backdrop-filter when the
  // prefixed and unprefixed versions sit next to each other.
  const bevel = (prop: string, exposure: number, sat: number) =>
    `brightness(var(--lg-${prop}-exp, ${exposure})) saturate(var(--lg-${prop}-sat, ${sat}))`;
  setBackdrop(fold, "brightness(var(--lg-fold-exp, 1.08)) saturate(var(--lg-fold-sat, 1.3))");
  fold.style.setProperty("--lg-fold-k", String(REFR_FOLD_DEPTH));
  setBackdrop(glint, bevel("glint", 1.35, 3.1));
  setBackdrop(rimLayer, bevel("rim", 0.84, 2.2));

  const frost = `${blur > 0 ? ` blur(${blur}px)` : ""} saturate(${saturate})`;
  const setPane = (v: string) => setBackdrop(pane, v);
  const setRefl = (v: string) => setBackdrop(reflectLayer, v);
  setPane(frost.trim());

  /* --- State --------------------------------------------------------------- */

  let w = 0;
  let h = 0;
  let baked = 0;
  let refr: RefractionMap | null = null;
  let refl: ReflectionMap | null = null;
  let reflSize = { w: 0, h: 0 };
  let avail: ReflectAvail | null = null;
  let bakeTimer = 0;
  let viewTimer = 0;
  let fieldTimer = 0;
  // What the baked refraction and reflection in use were baked for; the
  // two are baked apart, so a new overhang (the reflection alone) leaves
  // the pane's baked filter in place.
  let refrKey = "";
  let reflKey = "";
  let pendRefr = false;
  let pendRefl = false;
  let bakedOnce = false;
  let lastSpot = "";

  const measureAvail = (): ReflectAvail => {
    const r = host.getBoundingClientRect();
    const q = (v: number) => Math.max(0, Math.floor(v / AVAIL_STEP) * AVAIL_STEP);
    return [q(r.top), q(innerWidth - r.right), q(innerHeight - r.bottom), q(r.left)];
  };

  /** Lays every tile into the current box. Never bakes. */
  const sync = () => {
    host.style.setProperty("--lg-r", `${Math.max(0.01, Math.min(radius, w / 2, h / 2))}px`);

    if (refr) {
      layField(refrField, refr.slice, w, h);
      for (const slot of SLOTS) setRect(tiltTiles[slot]!, sliceRect(slot, w, h, refr.tilt.r, refr.tilt.reach));
      const r = Math.max(0.01, Math.min(refr.slice.r, w / 2, h / 2));
      setAttr(tiltRamp, "x", r);
      setAttr(tiltRamp, "width", Math.max(0.01, w - 2 * r));
      setAttr(tiltRamp, "height", h);
      const g = tiltGain(refr, w, h);
      setAttr(tiltAdd, "k3", g);
      setAttr(tiltAdd, "k4", -g / 2);
      setAttr(refrDisp, "scale", refractionScale(refr, w, h));
      setAttr(refrFilter, "width", w + REGION * 2);
      setAttr(refrFilter, "height", h + REGION * 2);
    }

    if (refl) {
      const [pt, pr, pb, pl] = refl.pad;
      layField(reflField, refl.slice, w, h, pl, pt);
      setAttr(reflDisp, "scale", reflectionScale(refl, w, h));
      setAttr(reflFilter, "width", w + pl + pr + REGION * 2);
      setAttr(reflFilter, "height", h + pt + pb + REGION * 2);
      const m = Math.ceil(3 * refl.blur) + REGION;
      for (let i = reflTailFrom; i < reflFilter.children.length; i++)
        setRect(reflFilter.children[i]!, { x: pl - m, y: pt - m, w: w + 2 * m, h: h + 2 * m });
      for (const slot of SLOTS) {
        const r = sliceRect(slot, w, h, refl.mask.r, refl.mask.reach, pl, pt);
        // A pill has no straight sides: their tiles shrink to 0.01px, but
        // an image is drawn at least a pixel wide, as a seam. Zero size
        // disables the primitive.
        setRect(reflMask[slot]!, r.w < 0.5 || r.h < 0.5 ? { ...r, w: 0, h: 0 } : r);
      }
    }

    place();
    const arcs = buildBevelArcs(w, h);
    setStyle(glint, "--lg-arc-glint", arcs.glint);
    for (const c of covers) setStyle(c.querySelector<HTMLElement>(".lg-spec")!, "--lg-arc-glint", arcs.glint);
    setStyle(rimLayer, "--lg-arc-rim", arcs.rim);
    scheduleFields();
  };

  /* Ring masks follow the same rule as the fields: CSS tiles while the size
     moves (a new image every frame would not be rasterised in time), one
     image per edge layer once it settles. */
  let ringKey = "";
  const edgeLayers = () => [fold, glint, rimLayer, ...covers.map((c) => c.querySelector<HTMLElement>(".lg-spec")!)];
  const clearRings = () => {
    if (!ringKey) return;
    ringKey = "";
    for (const e of edgeLayers()) e.removeAttribute("data-ring");
  };
  const applyRings = async () => {
    const key = `${w}x${h}@${devicePixelRatio}`;
    if (key === ringKey) return;
    const r = Math.max(0.01, Math.min(radius, w / 2, h / 2));
    const jobs = edgeLayers().map(async (e) => {
      const { rimW, fade } = ringWidths(e);
      return { e, url: await decoded(ringMask(w, h, r, rimW, fade, devicePixelRatio)) };
    });
    const done = await Promise.all(jobs);
    if (`${w}x${h}@${devicePixelRatio}` !== key) return;
    ringKey = key;
    for (const { e, url } of done) {
      setStyle(e, "--lg-ring", `url("${url}")`);
      e.setAttribute("data-ring", "");
    }
  };

  /* Live graph while the size moves, precomputed fields once it settles.
     The first bake goes at once: until it lands, the glass costs its live
     graphs (some 70 primitives and their tile images). Later changes wait
     a moment, so a size animation is not baked on every frame. */
  const scheduleFields = () => {
    if (!refr) return;
    const rKey = `${w}x${h}`;
    const fKey = refl ? `${rKey}:${refl.pad.join(",")}` : "";
    if (rKey !== refrKey) {
      refrKey = rKey;
      pendRefr = true;
      setPane(`url(#${refractId})${frost}`);
      if (!ringKey.startsWith(`${rKey}@`)) clearRings();
    }
    if (fKey !== reflKey) {
      reflKey = fKey;
      pendRefl = true;
      if (refl) setRefl(`url(#${reflectId})`);
    }
    if (!pendRefr && !pendRefl) return;
    clearTimeout(fieldTimer);
    fieldTimer = window.setTimeout(async () => {
      const doRefr = pendRefr;
      const doRefl = pendRefl && !!refl;
      pendRefr = pendRefl = false;
      const field = refr!;
      const map = refl;
      const res = fieldScales(w, h, Math.min(field.slice.r, w / 2, h / 2));
      try {
        if (doRefr) {
          const region = { x: -REGION, y: -REGION, width: w + 2 * REGION, height: h + 2 * REGION };
          const refrBaked = await bakeFilter(refrFilter, "rxt", "ry", "rmapya", res.y, {
            box: region,
            fields: refractionField(field, w, h, { x: region.x, y: region.y, w: region.width, h: region.height }, res.y, res.x),
          });
          if (rKey === refrKey) {
            // Still the size it was baked for.
            setPane(`url(#${refrBaked})${frost}`);
            bakedOnce = true;
          }
        }
        if (doRefl && map) {
          const box = { x: map.pad[3], y: map.pad[0], width: w, height: h };
          // The field is flat beyond the outline, and the mask discards all
          // of it but the blur's reach into the box.
          const m = Math.ceil(3 * map.blur) + REGION;
          const mask: BakeMask = { result: "fmask", parts: SLOTS.map((slot) => `fm${slot}`), box, scale: FIELD_SCALE };
          const reflBaked = await bakeFilter(reflFilter, "fx", "fy", "fmapya", res.refl, {
            box: { x: box.x - m, y: box.y - m, width: box.width + 2 * m, height: box.height + 2 * m },
            mask,
          });
          if (fKey === reflKey) setRefl(`url(#${reflBaked})`);
        }
        await applyRings();
      } catch {
        // Canvas or SVG image unavailable: the live graph stays, it only costs more.
      }
    }, bakedOnce ? 300 : 0);
  };

  /** New reflection map: when the bake size or the free space around changes. */
  const rebuildReflection = () => {
    refl = reflect && avail ? buildReflection(reflSize.w, reflSize.h, radius, rim, reflectStrength, avail) : null;
    reflKey = "";
    reflectLayer.hidden = !refl;
    if (!refl) return;

    setFieldImages(reflField, refl);
    setAttr(reflBlur, "stdDeviation", refl.blur);
    const [pt, pr, pb, pl] = refl.pad;
    // Same shape as the mask: keeps the filter work to the outline instead
    // of the whole overhang.
    const clip = `inset(${pt}px ${pr}px ${pb}px ${pl}px round var(--lg-r))`;
    reflectLayer.style.inset = `${-pt}px ${-pr}px ${-pb}px ${-pl}px`;
    setStyle(reflectLayer, "clip-path", clip);
    setStyle(reflectLayer, "-webkit-clip-path", clip);
    for (const slot of SLOTS) setAttr(reflMask[slot]!, "href", refl.mask.img[slot]!);
    setRefl(`url(#${reflectId})`);
  };

  const bake = (short: number) => {
    baked = short;
    refrKey = reflKey = ""; // new tiles: the precomputed fields are stale
    refr = cachedRefraction(short, radius);
    setFieldImages(refrField, refr);
    for (const slot of SLOTS) setAttr(tiltTiles[slot]!, "href", refr.tilt.img[slot]!);
    setAttr(tiltRamp, "href", refr.tiltRamp);
    // The reflection depends on the full size, but only follows the bake --
    // otherwise it would rebuild on every frame of a width animation.
    reflSize = { w, h };
    rebuildReflection();
    setPane(`url(#${refractId})${frost}`);
  };

  const onResize = () => {
    const nw = Math.round(host.clientWidth);
    const nh = Math.round(host.clientHeight);
    if (nw < 8 || nh < 8 || (nw === w && nh === h)) return;
    w = nw;
    h = nh;

    const s = Math.min(w, h);
    if (!SVG_BACKDROP) {
      // Frosted fallback: nothing to bake.
    } else if (!refr) {
      avail = measureAvail();
      bake(s);
    } else if (s > baked + BAKE_SLACK_UP) {
      clearTimeout(bakeTimer);
      bake(s);
    } else if (baked - s > BAKE_SLACK_DOWN) {
      clearTimeout(bakeTimer);
      bakeTimer = window.setTimeout(() => {
        const settled = Math.min(Math.round(host.clientWidth), Math.round(host.clientHeight));
        if (Math.abs(settled - s) <= 1 && baked - settled > BAKE_SLACK_DOWN) {
          bake(settled);
          sync();
        }
      }, BAKE_SETTLE_MS);
    } else {
      clearTimeout(bakeTimer);
    }
    sync();
  };

  // Only the reflection depends on where the element sits. Re-measure once
  // the ELEMENT stands still (transitions fire no scroll events), and swap
  // nothing while it moves: a fresh mask is not rasterised for a frame.
  const onView = () => {
    // The fill and the covers go along right away. Waiting for the element
    // to stand still left them behind it for a quarter to half a second
    // whenever it moved: a fixed glass centred in a viewport whose height
    // changes (a mobile address bar) showed its veil and edge light beside it.
    place();
    clearTimeout(viewTimer);
    viewTimer = window.setTimeout(function check() {
      const r = host.getBoundingClientRect();
      const spot = `${Math.round(r.top)}:${Math.round(r.left)}`;
      if (spot !== lastSpot) {
        lastSpot = spot;
        viewTimer = window.setTimeout(check, 120);
        return;
      }
      place();
      const next = measureAvail();
      if (!refr) return;
      // Only rebuild when the overhang actually changes: with room to spare
      // on every side, moving or resizing the element gives the same map.
      const short = Math.min(reflSize.w, reflSize.h);
      const before = avail && reflectionPad(short, avail);
      avail = next;
      if (!before || reflectionPad(short, next).some((v, i) => v !== before[i])) {
        rebuildReflection();
        sync();
      }
    }, 220);
  };

  // Chromium redraws the glass only when something changes under its own
  // outline. The reflection also reads the area around it, so while the page
  // scrolls past with nothing changing right underneath (one flat colour),
  // the reflection holds a stale picture and catches up in a jump: a flicker.
  // The fill changes in a frame callback, once per frame at most: two
  // toggles in one frame would cancel out. A frame that comes too soon after
  // the last redraw passes the toggle on to the next frame, so the last
  // position of a scroll is always drawn.
  let tickAt = -Infinity;
  let tickReq = 0;
  let frameAt = -Infinity;
  // The display's frame time, learnt from the shortest gap seen; it creeps
  // up so a move to a slower display is learnt too.
  let frameMs = 50;
  let gap = TICK_GAP_MS[0]!;
  let gapUntil = -Infinity;
  const applyTick = (now: number) => {
    tickReq = 0;
    const dt = now - frameAt;
    frameAt = now;
    if (dt < TICK_PAUSE_MS) {
      frameMs = Math.min(Math.max(4, dt), frameMs * 1.02);
      const level = dt >= 4 * frameMs + 2 ? 2 : dt >= 2 * frameMs + 2 ? 1 : 0;
      if (level) {
        gap = Math.max(gap, TICK_GAP_MS[level]!);
        gapUntil = now + TICK_HOLD_MS;
      }
    }
    if (now > gapUntil) gap = TICK_GAP_MS[0]!;
    if (now - tickAt < gap) {
      tickReq = requestAnimationFrame(applyTick);
      return;
    }
    tickAt = now;
    tick.toggleAttribute("data-tick");
  };
  const refresh = () => {
    if (!tickReq) tickReq = requestAnimationFrame(applyTick);
  };
  const onScroll = () => {
    if (refl) refresh();
    onView();
  };

  // A CSS transition or animation that moves the host or an ancestor (left,
  // top, inset, margin: the recommended way to move the glass) fires no
  // resize and no scroll, so nothing above notices it. Follow it frame by
  // frame until it is over and the host stands still, then re-measure the
  // reflection once. Anchored covers move by themselves; this carries the
  // fill, and covers laid out in px.
  let followReq = 0;
  const moving = () =>
    document.getAnimations().some((a) => {
      // Scroll-driven animations follow the scroll, which onScroll handles.
      if (a.playState !== "running" || a.timeline !== document.timeline) return false;
      const target = (a.effect as KeyframeEffect | null)?.target;
      const end = a.effect?.getComputedTiming().endTime;
      return !!target && target.contains(host) && typeof end === "number" && Number.isFinite(end);
    });
  const follow = () => {
    if (followReq) return;
    let last = "";
    let still = 0;
    const step = () => {
      place();
      const r = host.getBoundingClientRect();
      const spot = `${r.left}:${r.top}:${r.width}:${r.height}`;
      still = spot === last ? still + 1 : 0;
      last = spot;
      if (still < 3 || moving()) {
        followReq = requestAnimationFrame(step);
      } else {
        followReq = 0;
        onView();
      }
    };
    followReq = requestAnimationFrame(step);
  };
  const onMotion = (e: Event) => {
    if (e.target instanceof Node && e.target.contains(host)) follow();
  };

  const ro = new ResizeObserver(onResize);
  ro.observe(host);
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onView, { passive: true });
  document.addEventListener("transitionrun", onMotion, { capture: true, passive: true });
  document.addEventListener("animationstart", onMotion, { capture: true, passive: true });
  onResize();
  // The first measurement may run before layout or fonts have settled.
  onView();

  return {
    /**
     * Scrolling is handled already. Content that changes next to the glass on
     * its own (a playing video) still freezes in the reflection; call this
     * for every frame of such content to keep it live.
     */
    refresh,
    /**
     * Re-places the fill under the glass and the covers over it after the
     * host moved without changing size in a way the glass does not see: from
     * a script, say, or from fixed to absolute. Resizes, scrolling and CSS
     * transitions and animations of the host or an ancestor are followed
     * already.
     */
    update() {
      place();
      onView();
    },
    /**
     * True where the browser keeps the covers on the host itself (CSS anchor
     * positioning that follows transforms). They then follow an animated
     * translate of the host too: do not give them the same one. Elsewhere
     * they ignore the host's translate, so give them the same one to follow.
     */
    coversFollowHost: anchors,
    /**
     * A further cover with a fixed tuning, appended to `parent`; hides the
     * built-in one. Make one light and one dark cover and crossfade them with
     * opacity (on a will-change: opacity layer): the compositor blends them
     * without repainting anything. Positioned like the host, so with a host
     * that is not fixed, `parent` must be its parent.
     */
    addCover(parent: HTMLElement, dark: number) {
      const c = makeCover();
      c.style.setProperty("--lg-dark", String(dark));
      parent.append(c);
      covers.push(c);
      cover.hidden = true;
      place();
      sync();
      return c;
    },
    destroy() {
      ro.disconnect();
      clearTimeout(bakeTimer);
      clearTimeout(viewTimer);
      clearTimeout(fieldTimer);
      cancelAnimationFrame(tickReq);
      cancelAnimationFrame(followReq);
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onView);
      document.removeEventListener("transitionrun", onMotion, { capture: true });
      document.removeEventListener("animationstart", onMotion, { capture: true });
      host.querySelectorAll(":scope > .lg-layer, :scope > .lg-defs").forEach((n) => n.remove());
      tick.remove();
      for (const c of covers) c.remove();
      if (anchors) {
        if (ownAnchor) host.style.setProperty("anchor-name", ownAnchor);
        else host.style.removeProperty("anchor-name");
      }
      host.classList.remove("lg-host");
    },
  };
}
