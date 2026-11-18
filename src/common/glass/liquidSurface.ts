import { maskPng, packedFieldPng, UNPACK } from './vendor/maps';
import { glassContour } from './contour';
import { liquidGlassSample, normalizeLiquidGlassField } from './shader';

export const supportsRefraction = typeof navigator !== 'undefined' && 'userAgentData' in navigator;
let sequence = 0;
const fields = new Map<string, { width: number; height: number; scale: number; map: string; center: string; rim: string }>();
const smooth = (start: number, end: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
};

function field(width: number, height: number, radius: number, squircle: boolean) {
  const key = `${width}:${height}:${radius}:${squircle}`;
  const previous = fields.get(key);
  if (previous) return previous;
  // A small smooth field is sufficient; never allocate a screen-resolution texture.
  const scale = Math.min(.5, 480 / Math.max(width, height));
  const w = Math.max(2, Math.round(width * scale)), h = Math.max(2, Math.round(height * scale));
  const xs = new Float32Array(w * h), ys = new Float32Array(w * h);
  const center = new Float32Array(w * h), rim = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const point = glassContour((x + .5) * width / w, (y + .5) * height / h, width, height, radius, squircle);
    const sample = liquidGlassSample(x / w, y / h);
    const index = y * w + x;
    xs[index] = (sample.x - x / w) * width;
    ys[index] = (sample.y - y / h) * height;
    center[index] = smooth(.7, 7, point.depth);
    rim[index] = smooth(-.6, .5, point.depth) * (1 - smooth(.6, 6, point.depth));
  }
  // Preserve the reference shader's two-pass normalization and clipping.
  const displacementScale = normalizeLiquidGlassField(xs, ys);
  const result = { width, height, scale: displacementScale, map: packedFieldPng(w, h, xs, ys),
    center: maskPng(w, h, (x, y) => center[y * w + x]),
    rim: maskPng(w, h, (x, y) => rim[y * w + x]) };
  if (fields.size >= 4) fields.delete(fields.keys().next().value as string);
  fields.set(key, result);
  return result;
}

/** The SVG samples the live browser backdrop; no page screenshot or DOM copy is taken. */
export function createLiquidSurface(pane: HTMLElement, readable: HTMLElement, rim: HTMLElement) {
  const ns = 'http://www.w3.org/2000/svg';
  const defs = document.createElementNS(ns, 'svg');
  defs.classList.add('ta-glass-defs');
  defs.setAttribute('aria-hidden', 'true');
  defs.style.cssText = 'position:fixed;width:0;height:0;overflow:hidden;pointer-events:none';
  const filter = document.createElementNS(ns, 'filter');
  filter.id = `ta-glass-lens-${++sequence}`;
  filter.setAttribute('filterUnits', 'userSpaceOnUse');
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  filter.setAttribute('x', '0'); filter.setAttribute('y', '0');
  const texture = document.createElementNS(ns, 'feImage');
  texture.setAttribute('result', 'packed');
  texture.setAttribute('preserveAspectRatio', 'none');
  const unpack = document.createElementNS(ns, 'feColorMatrix');
  unpack.setAttribute('in', 'packed'); unpack.setAttribute('type', 'matrix');
  unpack.setAttribute('values', UNPACK); unpack.setAttribute('result', 'vectors');
  const displace = document.createElementNS(ns, 'feDisplacementMap');
  displace.setAttribute('in', 'SourceGraphic'); displace.setAttribute('in2', 'vectors');
  displace.setAttribute('xChannelSelector', 'R'); displace.setAttribute('yChannelSelector', 'G');
  displace.setAttribute('scale', '0');
  filter.append(texture, unpack, displace); defs.append(filter);
  // SVG fragment references must resolve outside a closed ShadowRoot, too.
  document.documentElement.append(defs);
  let disposed = false, version = 0, key = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const syncBounds = () => {
    const { width, height } = pane.getBoundingClientRect();
    if (width < 2 || height < 2) return;
    filter.setAttribute('width', String(width)); filter.setAttribute('height', String(height));
    texture.setAttribute('width', String(width)); texture.setAttribute('height', String(height));
    return { width: Math.round(width), height: Math.round(height) };
  };
  const update = () => {
    if (disposed) return;
    const bounds = syncBounds();
    if (!bounds) return;
    const css = getComputedStyle(pane);
    const radius = parseFloat(css.borderTopLeftRadius) || 38;
    const squircle = /squircle|superellipse\(2\)/.test(css.getPropertyValue('corner-shape'));
    const nextKey = `${bounds.width}:${bounds.height}:${radius}:${squircle}`;
    if (key === nextKey) return;
    key = nextKey;
    const current = ++version;
    const data = field(bounds.width, bounds.height, radius, squircle);
    const decoded = [data.map, data.center, data.rim].map(source => {
      const image = new Image(); image.src = source; return image.decode();
    });
    void Promise.all(decoded).then(() => {
      if (disposed || current !== version) return;
      texture.setAttribute('href', data.map);
      displace.setAttribute('scale', String(data.scale));
      readable.style.maskImage = `url("${data.center}")`;
      rim.style.maskImage = `url("${data.rim}")`;
      pane.style.setProperty('backdrop-filter', `url(#${filter.id}) blur(.25px) contrast(1.2) brightness(1.05) saturate(1.1)`);
    }).catch(() => { /* A browser that cannot decode the field keeps the uniform glass surface. */ });
  };
  const observer = new ResizeObserver(() => {
    syncBounds();
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(update, 90);
  });
  observer.observe(pane);
  update();
  return {
    update,
    destroy() {
      disposed = true; version++;
      observer.disconnect(); if (timer !== undefined) clearTimeout(timer);
      defs.remove(); pane.style.removeProperty('backdrop-filter');
      readable.style.removeProperty('mask-image'); rim.style.removeProperty('mask-image');
    },
  };
}
