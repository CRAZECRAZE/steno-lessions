const { test } = require('node:test');
const assert = require('node:assert/strict');
const lessons = require('../public/lib/lessons.js');

// Stroke bits in the tests are small masks: A=1, B=2, C=4, D=8.
const A = 1, B = 2, C = 4, D = 8;

test('a stroke that is next for some spelling is accepted, and keeps those spellings', () => {
  const candidates = [[A, B], [A, C]];
  const fit = lessons.classifyStroke({ chord: A, candidates, all: candidates, strokeIdx: 0 });
  assert.equal(fit.type, 'next');
  assert.deepEqual(fit.matches, [[A, B], [A, C]]);
});

test('the stroke after the first one is matched against the spellings still possible', () => {
  const candidates = [[A, B], [A, C]];
  const fit = lessons.classifyStroke({ chord: C, candidates: [[A, C]], all: candidates, strokeIdx: 1 });
  assert.equal(fit.type, 'next');
  assert.deepEqual(fit.matches, [[A, C]]);
});

test('the first stroke of a spelling restarts a word that is partly typed', () => {
  const all = [[A, B], [C, D]];
  const fit = lessons.classifyStroke({ chord: C, candidates: [[A, B]], all, strokeIdx: 1 });
  assert.equal(fit.type, 'restart');
  assert.deepEqual(fit.matches, [[C, D]]);
});

test('a first stroke does not restart at the start of the word, where it would just be a mistake', () => {
  const all = [[A], [B, C]];
  const fit = lessons.classifyStroke({ chord: C, candidates: all, all, strokeIdx: 0 });
  assert.equal(fit, null);
});

test('part of the next stroke is held, not counted as a mistake', () => {
  const candidates = [[A | B]];
  const fit = lessons.classifyStroke({ chord: A, candidates, all: candidates, strokeIdx: 0 });
  assert.deepEqual(fit, { type: 'partial' });
});

test('a stroke with a key the next stroke does not use is a real mistake', () => {
  const candidates = [[A | B]];
  assert.equal(lessons.classifyStroke({ chord: A | C, candidates, all: candidates, strokeIdx: 0 }), null);
});

test('a stroke that fits nothing is a real mistake', () => {
  const candidates = [[A, B]];
  assert.equal(lessons.classifyStroke({ chord: D, candidates, all: candidates, strokeIdx: 0 }), null);
});

test('an empty chord is never a stroke', () => {
  const candidates = [[A]];
  assert.equal(lessons.classifyStroke({ chord: 0, candidates, all: candidates, strokeIdx: 0 }), null);
});
