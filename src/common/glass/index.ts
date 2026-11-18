import { createLiquidSurface, supportsRefraction } from './liquidSurface';
import { quickSearchAppearance, quickSearchGlassVariables, type QuickSearchAppearance } from '../quickSearchAppearance';

export interface SearchGlassController {
  update: (appearance: QuickSearchAppearance) => void;
  destroy: () => void;
}

const styledRoots = new WeakSet<Node>();
const styles = `
.ta-glass-scene { position: absolute; inset: 0; border-radius: inherit; pointer-events: none; --qs-glass-rgb: 246,249,255; }
.ta-glass-scene[data-theme='dark'] { --qs-glass-rgb: 20,26,39; }
.ta-glass-layer { position: absolute; inset: 0; border-radius: inherit; pointer-events: none; }
.ta-glass-optics { z-index: 0; }
.ta-glass-scene[data-material='classic'] .ta-glass-optics { background: rgb(var(--qs-glass-rgb)); }
.ta-glass-scene[data-material='frosted'] .ta-glass-optics { background: rgba(var(--qs-glass-rgb),var(--qs-glass-opacity)); backdrop-filter: blur(var(--qs-glass-blur)) saturate(1.5); -webkit-backdrop-filter: blur(var(--qs-glass-blur)) saturate(1.5); box-shadow: inset 0 .5px 0 rgba(255,255,255,.6); }
.ta-glass-scene[data-material='frosted'][data-theme='dark'] .ta-glass-optics { box-shadow: inset 0 .5px 0 rgba(255,255,255,.2); }
.ta-glass-scene[data-material='liquid'] .ta-glass-optics { background: rgba(var(--qs-glass-rgb),.025); backdrop-filter: blur(.25px) contrast(1.2) brightness(1.05) saturate(1.1); box-shadow: inset 0 -8px 20px rgba(0,0,0,.1); }
.ta-glass-scene[data-material='liquid'][data-theme='dark'] .ta-glass-optics { background-color: rgba(var(--qs-glass-rgb),.48); }
.ta-glass-readable { display: none; z-index: 1; background: rgba(var(--qs-glass-rgb),calc(var(--qs-glass-opacity) * .65)); backdrop-filter: blur(calc(var(--qs-glass-blur) * .25)); mask-size: 100% 100%; }
.ta-glass-scene[data-material='liquid'] .ta-glass-readable { display: block; }
.ta-glass-scene[data-material='liquid'][data-theme='dark'] .ta-glass-readable { background-color: rgba(var(--qs-glass-rgb),calc(.28 + var(--qs-glass-opacity) * .6)); }
.ta-glass-scene[data-material='liquid'][data-theme='light'][data-dark-backdrop='true'] .ta-glass-readable { background-color: rgba(var(--qs-glass-rgb),.68); }
.ta-glass-rim { display: none; z-index: 2; box-sizing: border-box; border: .5px solid rgba(255,255,255,.65); border-right-color: rgba(255,255,255,.27); border-bottom-color: rgba(255,255,255,.32);
  background: linear-gradient(132deg,rgba(255,255,255,.46),rgba(255,255,255,.06) 30%,transparent 52%,rgba(255,255,255,.22)); mask-image: linear-gradient(transparent,transparent); mask-size: 100% 100%; }
.ta-glass-scene[data-material='liquid'] .ta-glass-rim { display: block; }
.ta-glass-scene[data-material='liquid'][data-theme='dark'] .ta-glass-rim { border-color: rgba(255,255,255,.16); background: linear-gradient(132deg,rgba(255,255,255,.1),transparent 42%,rgba(255,255,255,.04)); }
@supports (corner-shape: squircle) {
  .ta-glass-scene, .ta-glass-layer { corner-shape: inherit; }
}
@media (prefers-contrast: more), (prefers-reduced-transparency: reduce) { .ta-glass-readable { background-color: rgba(var(--qs-glass-rgb),.9) !important; backdrop-filter: blur(20px); } }
`;

function ensureStyles(root: Node) {
  if (styledRoots.has(root)) return;
  const node = document.createElement('style');
  node.textContent = styles;
  if (root.nodeType === Node.DOCUMENT_NODE) (root as Document).head.append(node);
  else root.appendChild(node);
  styledRoots.add(root);
}

function hasDarkBackdrop(container: HTMLElement) {
  let element: HTMLElement | null = container.getRootNode() instanceof ShadowRoot ? document.body : container.parentElement;
  while (element) {
    const channels = getComputedStyle(element).backgroundColor.match(/[\d.]+/g)?.map(Number);
    if (channels && channels.length >= 3 && (channels[3] === undefined || channels[3] > .9)) {
      return (.2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2]) < 85;
    }
    element = element.parentElement;
  }
  return false;
}

/** A separate optical plane keeps React content out of backdrop-filter roots. */
export function createSearchGlass(container: HTMLElement, initial: QuickSearchAppearance): SearchGlassController {
  ensureStyles(container.getRootNode());
  const scene = document.createElement('div');
  scene.className = 'ta-glass-scene';
  scene.setAttribute('aria-hidden', 'true');
  const optics = document.createElement('div');
  optics.className = 'ta-glass-optics ta-glass-layer';
  const readable = document.createElement('div');
  readable.className = 'ta-glass-readable ta-glass-layer';
  const rim = document.createElement('div');
  rim.className = 'ta-glass-rim ta-glass-layer';
  scene.append(optics, readable, rim);
  container.prepend(scene);
  let engine: ReturnType<typeof createLiquidSurface> | undefined;
  let disposed = false;

  const removeEngine = () => {
    engine?.destroy();
    engine = undefined;
  };
  const update = (value: QuickSearchAppearance) => {
    if (disposed) return;
    const appearance = quickSearchAppearance(value);
    const dark = appearance.theme === 'dark' || appearance.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const material = appearance.quickSearchMaterial;
    scene.dataset.material = material === 'liquid' && !supportsRefraction ? 'frosted' : material;
    scene.dataset.theme = dark ? 'dark' : 'light';
    scene.dataset.darkBackdrop = String(hasDarkBackdrop(container));
    Object.entries(quickSearchGlassVariables({ ...appearance, theme: dark ? 'dark' : 'light' })).forEach(([name, value]) => scene.style.setProperty(name, value));
    if (material === 'liquid' && supportsRefraction) {
      if (!engine) {
        engine = createLiquidSurface(optics, readable, rim);
      }
      engine.update();
    } else removeEngine();
  };
  update(initial);
  return {
    update,
    destroy() {
      if (disposed) return;
      disposed = true; removeEngine(); scene.remove();
    },
  };
}
