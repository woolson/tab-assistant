import assert from 'node:assert/strict'
import test from 'node:test'
import { quickSearchAppearance, quickSearchGlassVariables } from './quickSearchAppearance.ts'

test('legacy settings and saved Liquid Glass use frosted glass without changing stored preferences', () => {
  assert.deepEqual(quickSearchAppearance(), { quickSearchMaterial: 'frosted', quickSearchTransparency: 45, quickSearchBlur: 24, theme: 'system' })
  const stored = { quickSearchMaterial: 'liquid', quickSearchTransparency: 63, quickSearchBlur: 32, theme: 'dark' }
  assert.deepEqual(quickSearchAppearance(stored), { ...stored, quickSearchMaterial: 'frosted' })
  assert.equal(stored.quickSearchMaterial, 'liquid')
  assert.equal(quickSearchAppearance({ theme: 'dark' }).theme, 'dark')
})

test('saved materials, transparency and blur are normalized before reaching CSS', () => {
  assert.deepEqual(quickSearchAppearance({ quickSearchMaterial: 'frosted', quickSearchTransparency: 123, quickSearchBlur: 0, theme: 'light' }), {
    quickSearchMaterial: 'frosted', quickSearchTransparency: 80, quickSearchBlur: 8, theme: 'light',
  })
  assert.deepEqual(quickSearchAppearance({ quickSearchMaterial: 'unknown', quickSearchTransparency: NaN, quickSearchBlur: Infinity, theme: 'unknown' }), quickSearchAppearance())
  assert.equal(quickSearchAppearance({ quickSearchBlur: 19.6, quickSearchTransparency: 41.2 }).quickSearchBlur, 20)
})

test('frosted presets follow the theme, ignore legacy controls and preserve the corner radius', () => {
  assert.deepEqual(quickSearchGlassVariables(quickSearchAppearance()), { '--qs-glass-opacity': '0.72', '--qs-glass-blur': '24px', '--qs-corner-radius': '38px' })
  for (const quickSearchTransparency of [20, 45, 80]) {
    for (const quickSearchBlur of [8, 24, 40]) {
      assert.deepEqual(quickSearchGlassVariables(quickSearchAppearance({ quickSearchMaterial: 'frosted', quickSearchTransparency, quickSearchBlur, theme: 'light' })), {
        '--qs-glass-opacity': '0.72', '--qs-glass-blur': '24px', '--qs-corner-radius': '38px',
      })
      assert.deepEqual(quickSearchGlassVariables(quickSearchAppearance({ quickSearchMaterial: 'frosted', quickSearchTransparency, quickSearchBlur, theme: 'dark' })), {
        '--qs-glass-opacity': '0.76', '--qs-glass-blur': '28px', '--qs-corner-radius': '38px',
      })
    }
  }
  assert.equal(quickSearchGlassVariables(quickSearchAppearance({ quickSearchMaterial: 'classic', quickSearchTransparency: 80 }))['--qs-glass-opacity'], '1.00')
})
