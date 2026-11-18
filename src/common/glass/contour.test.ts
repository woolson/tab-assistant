import assert from 'node:assert/strict';
import test from 'node:test';
import { glassContour } from './contour.ts';

test('the optical boundary follows CSS squircle rather than the previous circular corner', () => {
  const radius = 38;
  const diagonal = radius * (1 - Math.pow(.5, .25));
  const point = glassContour(diagonal, diagonal, 760, 560, radius, true);
  assert.ok(Math.abs(point.depth) < 1e-8);
  assert.ok(Math.abs(point.nx + Math.SQRT1_2) < 1e-8);
  const oldCircularEdge = radius * (1 - Math.SQRT1_2);
  assert.ok(glassContour(oldCircularEdge, oldCircularEdge, 760, 560, radius, true).depth > 3);
});

test('the highlight mask excludes the area outside the squircle', () => {
  const point = glassContour(0, 0, 760, 560, 38, true);
  assert.ok(point.depth < 0);
});

test('unsupported corner-shape keeps a matching circular fallback', () => {
  const diagonal = 38 * (1 - Math.SQRT1_2);
  assert.ok(Math.abs(glassContour(diagonal, diagonal, 760, 560, 38, false).depth) < 1e-8);
  for (const [x, y] of [[0, 0], [10, 10], [20, 10]]) {
    const point = glassContour(x, y, 20, 20, 38, true);
    assert.ok([point.depth, point.nx, point.ny].every(Number.isFinite));
  }
});
