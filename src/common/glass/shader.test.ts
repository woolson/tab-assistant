import assert from 'node:assert/strict';
import test from 'node:test';
import { liquidGlassSample, normalizeLiquidGlassField } from './shader.ts';

test('the adapted shader matches samples captured from the shuding reference fragment', () => {
  const samples = [
    [.5, .5, .5, .5],
    [.9, .5, .8997628544918552, .5],
    [.5, .95, .5, .9388473114114266],
    [.9, .9, .7930067399386587, .7930067399386587],
    [.1, .1, .20699326006134133, .20699326006134133],
  ];
  for (const [u, v, x, y] of samples) {
    const actual = liquidGlassSample(u, v);
    assert.ok(Math.abs(actual.x - x) < 1e-12);
    assert.ok(Math.abs(actual.y - y) < 1e-12);
  }
});

test('opposite corners retain the reference lens symmetry', () => {
  const a = liquidGlassSample(.07, .23), b = liquidGlassSample(.93, .77);
  assert.ok(Math.abs(a.x + b.x - 1) < 1e-12);
  assert.ok(Math.abs(a.y + b.y - 1) < 1e-12);
});

test('the center stays stationary while the rim samples inward', () => {
  assert.deepEqual(liquidGlassSample(.5, .5), { x: .5, y: .5 });
  const edge = liquidGlassSample(1, .5);
  assert.ok(edge.x < 1 && edge.x > .5);
  assert.equal(edge.y, .5);
});

test('reference channel clipping preserves the alpha-packed field at extreme corners', () => {
  const xs = new Float32Array([-4, -1, 0, 1, 4]);
  const ys = new Float32Array([4, 1, 0, -1, -4]);
  assert.equal(normalizeLiquidGlassField(xs, ys), 2);
  assert.deepEqual(Array.from(xs), [0, 0, 127.5, 255, 255]);
  assert.deepEqual(Array.from(ys), [255, 255, 127.5, 0, 0]);
  // The borrowed PNG packing reserves alpha .5..1 for Y; alpha 0 loses X, too.
  assert.ok(Array.from(ys).every(value => 127.5 + value / 2 >= 127.5));
});
