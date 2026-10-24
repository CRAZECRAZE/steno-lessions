const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const steno = require('../public/lib/steno.js');
const lessons = require('../public/lib/lessons.js');
const drills = require('../public/lib/drills.js');
const { buildDrills, readPairs, chapterOf, CHAPTER_TITLES } = require('../scripts/build-drills.js');

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'drills.json'), 'utf8'));

// Chapters whose drill word lists the Lapwing book links (practice/<chapter>-*.txt).
const CHAPTERS_WITH_DRILLS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];

test('every chapter with drills appears in drills.json, in order', () => {
  assert.deepEqual(DATA.chapters.map((entry) => entry.chapter), CHAPTERS_WITH_DRILLS);
  for (const entry of DATA.chapters) {
    assert.equal(entry.title, CHAPTER_TITLES[entry.chapter], `chapter ${entry.chapter} title`);
    assert.ok(entry.drills.length > 0, `chapter ${entry.chapter} lists its drill files`);
    assert.ok(entry.words.length > 0, `chapter ${entry.chapter} has words`);
  }
});

test('drill words use the lesson word format and only steno strokes', () => {
  for (const entry of DATA.chapters) {
    for (const word of entry.words) {
      assert.match(word.text, /^[a-z]{1,12}$/);
      assert.ok(word.variants.length > 0);
      for (const variant of word.variants) {
        assert.ok(variant.length >= 1 && variant.length <= 3);
        for (const bits of variant) assert.ok(Number.isInteger(bits) && bits > 0);
      }
    }
  }
});

test('a chapter pool is every chapter up to it, merged by text with no repeats', () => {
  const chapters = [
    { chapter: 5, words: [{ text: 'cat', shown: ['KAT'], variants: [[1]] }] },
    { chapter: 6, words: [{ text: 'cat', shown: ['KAT'], variants: [[1], [2]] }, { text: 'dog', shown: ['TKOG'], variants: [[3]] }] },
    { chapter: 7, words: [{ text: 'sun', shown: ['SUN'], variants: [[4]] }] },
  ];
  const pool = drills.wordsThrough(chapters, 6);
  assert.deepEqual(pool.map((word) => word.text), ['cat', 'dog']);
  assert.deepEqual(pool[0].variants, [[1], [2]]);
  assert.deepEqual(drills.wordsThrough(chapters, 5).map((word) => word.text), ['cat']);
});

test('every chapter pool has words the starting keys can type', () => {
  const slotIndex = new Map(steno.SLOTS.map(([, name], index) => [name, index]));
  let startMask = 0;
  for (const name of lessons.KEY_ORDER.slice(0, 6)) startMask |= 1 << slotIndex.get(name);
  for (const entry of DATA.chapters) {
    const pool = drills.wordsThrough(DATA.chapters, entry.chapter);
    assert.ok(
      pool.some((word) => word.variants.some((variant) => variant.every((bits) => (bits & ~startMask) === 0))),
      `chapter ${entry.chapter} pool starts`,
    );
  }
});

test('build-drills groups files by chapter and keeps the book text', () => {
  assert.equal(chapterOf('9-right-v.txt'), 9);
  assert.equal(chapterOf('notes.txt'), null);
  assert.deepEqual(readPairs('cat\tKAT\r\nbad line\n\ndog\tTKOG'), [['KAT', 'cat'], ['TKOG', 'dog']]);
  const built = buildDrills({
    '6-fqm.txt': 'fat\tTEF\n',
    '6-test.txt': 'fat\tTEF\nsat\tSAT\n',
    '5-cvc.txt': 'cat\tKAT\n',
    'readme.txt': 'cat\tKAT\n',
  });
  assert.deepEqual(built.map((entry) => entry.chapter), [5, 6]);
  assert.deepEqual(built[1].drills, ['6-fqm', '6-test']);
  assert.deepEqual(built[1].words.map((word) => word.text), ['fat', 'sat']);
});
