import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('./glassRuntime.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES5 } }).outputText;

test('a rebuilt extension replaces a cached renderer in an already-open page', () => {
  const old = () => {};
  const current = () => {};
  const world = createContext({ exports: {}, require: () => ({ createSearchGlass: current }),
    __taCreateSearchGlass: old, __taGlassBuild: 'old-build', __webpack_hash__: 'new-build' });
  runInContext(compiled, world);
  assert.equal(world.__taCreateSearchGlass, current);
  assert.equal(world.__taGlassBuild, 'new-build');
});

test('repeated injections of one build preserve the renderer and its unique filter sequence', () => {
  const first = () => {};
  const next = () => {};
  const world = createContext({ exports: {}, require: () => ({ createSearchGlass: first }), __webpack_hash__: 'same-build' });
  runInContext(compiled, world);
  world.require = () => ({ createSearchGlass: next });
  runInContext(compiled, world);
  assert.equal(world.__taCreateSearchGlass, first);
});
