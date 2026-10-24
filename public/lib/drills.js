// Drill pools for the Drills picker. The Lapwing book builds each chapter on the ones before it,
// so choosing a chapter practises every chapter up to and including it, merged by word text.
// Pure functions only, so it runs in the page and in tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.StenoDrills = factory();
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  // Words in the same shape steno.buildWords gives: { text, shown, variants }.
  function wordsThrough(chapters, chapter) {
    const byText = new Map();
    for (const entry of chapters) {
      if (entry.chapter > chapter) continue;
      for (const word of entry.words) {
        const existing = byText.get(word.text);
        if (!existing) {
          byText.set(word.text, { text: word.text, shown: word.shown, variants: word.variants.slice() });
          continue;
        }
        for (const variant of word.variants) {
          const key = JSON.stringify(variant);
          if (!existing.variants.some((known) => JSON.stringify(known) === key)) existing.variants.push(variant);
        }
      }
    }
    return [...byText.values()];
  }

  return { wordsThrough };
});
