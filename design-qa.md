# Design QA — Rules table height

## Target and environment

- Source visual truth: `design-qa/rules-height/source-rules-height-before.jpg`
- User intent: keep the existing Rules-page design, but extend the table frame through the available vertical space so the page no longer ends in a large blank region.
- Implementation screenshots:
  - `design-qa/rules-height/rules-light-750x600.png`
  - `design-qa/rules-height/rules-dark-750x600.png`
- Full-view comparison: `design-qa/rules-height/rules-height-comparison.png`
- Viewport: 750 × 600 CSS pixels.
- Source pixels: 750 × 600.
- Implementation pixels: 750 × 600.
- Density normalization: source and implementation compared at 1× with identical pixel dimensions.
- State: Simplified Chinese, four deterministic preview rules, light and dark appearances.

## Full-view comparison evidence

- Before: the Rules table ends at y=368, leaving most of the remaining page unstructured.
- After: the Rules table starts at y=96 and extends to y=552; the priority hint remains visible at y=565–582.
- The header, four 54 px rows, column widths, sidebar, actions, typography, and copy retain their previous positions and proportions.
- The comparison image places the reported source on the left and the revised light implementation on the right.

## Focused region evidence

- `.rules-list`: 590 × 456 px at x=140, y=96.
- `.rules-list-body`: 588 × 400 px, with flex growth inside the fixed header frame.
- Four-rule state: body client height and scroll height are both 400 px, so there is no unnecessary scrollbar.
- Eight-rule state: body client height remains 400 px, scroll height becomes 432 px, `overflow-y` is `auto`, and an interaction test reaches the 32 px maximum scroll offset.
- `.rules-hint`: remains fully visible at x=140, y=565 and does not overlap the table.

## Required fidelity surfaces

- Fonts and typography: unchanged; no new font, size, weight, wrapping, or truncation differences.
- Spacing and layout rhythm: table height now consumes the intended remaining vertical area; header, rows, hint spacing, radii, and horizontal grid remain unchanged.
- Colors and visual tokens: unchanged in light mode; dark mode retains its existing surfaces, borders, text, and semantic colors.
- Image quality and asset fidelity: no image or icon assets were added, replaced, stretched, or rasterized.
- Copy and content: unchanged.

## Findings

- No actionable P0, P1, or P2 mismatch remains.
- The table frame now resolves the reported blank-space problem without changing adjacent page styling.

## Comparison history

1. Baseline source: table constrained by `max-height: 365px` and `flex: 0 1 auto`, ending at y=368.
2. Fix: changed the list to `flex: 1 1 auto` with `min-height: 0`; allowed the list body to consume remaining space and kept the hint non-shrinking.
3. Post-fix light evidence: table ends at y=552 with four rows and no overflow.
4. Post-fix dark evidence: identical geometry at 590 × 456 px with no theme regression.
5. Long-list evidence: eight rows overflow only inside the table body and scroll to the expected maximum offset.

## Primary interactions tested

- Sidebar navigation from Current Tabs to Rules.
- Light and dark theme preview routes.
- New-rule flow used to grow the list from four to eight rows.
- Internal table-body scrolling with the table frame and hint fixed in place.

## Console review

- Runtime exceptions affecting Rules: none.
- Network or asset failures affecting Rules: none.
- Existing development warning: `@ant-design/icons` emits React's legacy `fill-rule` property warning while Current Tabs initially renders; it is unrelated to this layout change.

final result: passed
