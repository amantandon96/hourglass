// shared/palette.js
// Categorical palette for category identity. The slot order is what keeps adjacent
// colors distinguishable under color-vision deficiency, so never re-sort it.
// Each category keeps the slot it was given at creation, so deleting one category
// never repaints the others.

export const CATEGORY_PALETTE = [
  { light: '#2a78d6', dark: '#3987e5' }, // blue
  { light: '#eb6834', dark: '#d95926' }, // orange
  { light: '#1baf7a', dark: '#199e70' }, // aqua
  { light: '#eda100', dark: '#c98500' }, // yellow
  { light: '#e87ba4', dark: '#d55181' }, // magenta
  { light: '#008300', dark: '#0ca30c' }, // green
  { light: '#6250d6', dark: '#9085e9' }, // violet
  { light: '#e34948', dark: '#e66767' }, // red
];

// Past eight categories, extra ones fall back to a neutral gray rather than a
// generated hue that would be indistinguishable from an existing one.
const OVERFLOW = { light: '#8b8f96', dark: '#7d8188' };

/** Slot for a category: its stored colorSlot, else its position (pre-slot data). */
export function categorySlot(cat, categories) {
  if (Number.isInteger(cat.colorSlot)) return cat.colorSlot;
  return categories.indexOf(cat);
}

export function categoryColors(cat, categories) {
  return CATEGORY_PALETTE[categorySlot(cat, categories)] ?? OVERFLOW;
}

/** Inline style that exposes the category color to CSS in both themes. */
export function categoryStyle(cat, categories) {
  const { light, dark } = categoryColors(cat, categories);
  return `--cat-light:${light};--cat-dark:${dark}`;
}

/** First palette slot no existing category is using. */
export function nextFreeSlot(categories) {
  const used = new Set(categories.map((c) => categorySlot(c, categories)));
  for (let i = 0; i < CATEGORY_PALETTE.length; i++) {
    if (!used.has(i)) return i;
  }
  return CATEGORY_PALETTE.length; // overflow gray
}

export function isDarkMode() {
  return document.documentElement.dataset.theme === 'dark';
}
