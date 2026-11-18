import { createSearchGlass } from '../../common/glass';

const scope = globalThis as typeof globalThis & { __taCreateSearchGlass?: typeof createSearchGlass; __taGlassBuild?: string };
// A rebuilt extension can reuse the existing isolated world. Replace stale renderers,
// while repeated shortcuts within the same build preserve filter IDs and the field cache.
if (!scope.__taCreateSearchGlass || scope.__taGlassBuild !== __webpack_hash__) {
  scope.__taCreateSearchGlass = createSearchGlass;
  scope.__taGlassBuild = __webpack_hash__;
}
