const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../public/lib/lessons.js');

test('labels reveal after LABEL_REVEAL_MISSES wrong chords, on level 3 only', () => {
  assert.equal(L.LABEL_REVEAL_MISSES, 3);
  assert.equal(L.labelsRevealed({ level: 3 }, 2), false);
  assert.equal(L.labelsRevealed({ level: 3 }, 3), true);
  assert.equal(L.labelsRevealed({ level: 2 }, 5), false);
});
