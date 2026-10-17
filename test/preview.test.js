const test = require('node:test');
const assert = require('node:assert/strict');
const steno = require('../public/lib/steno.js');
const lessons = require('../public/lib/lessons.js');

// The faint text above the current word: what the held (or just released) stroke means, with
// the strokes of the word already typed right kept in front of it.

const bitsOf = (notation) => steno.parseStroke(notation);
const previewWords = steno.buildWords([
  ['KAT', 'cat'],
  ['TAET', 'data'],
  ['TKAT/A', 'data'],
  ['AB/PWES', 'abbess'],
  ['A/PWAPBD/O*PBS', 'abandons'],
]);
const wordNamed = (text) => previewWords.find((word) => word.text === text);
// What each stroke means on its own, as Plover's dictionary would say. Strokes left out here
// have no translation, so the preview has to fall back to raw steno for them.
const strokeWord = new Map(
  [
    ['KAT', 'cat'],
    ['KA', 'ka'],
    ['TKAT', 'dat'],
    ['A', 'a'],
    ['-T', 'at'],
    ['AB', 'ab'],
    ['TAET', 'data'],
  ].map(([notation, text]) => [bitsOf(notation), text]),
);

// Mirrors the app's stroke matching (finishChord): a right stroke narrows the spellings and is
// kept; a wrong one changes nothing but is what the preview shows until the next stroke.
function typing(text) {
  const word = wordNamed(text);
  const state = { done: [], candidates: word.variants, idx: 0, last: 0 };
  const view = (held) =>
    lessons.previewFor({
      word,
      done: state.done,
      held,
      candidates: state.candidates,
      strokeIdx: state.idx,
      strokeWord,
      render: steno.renderStroke,
    });
  return {
    // Holding a chord
    hold: (notation) => view(bitsOf(notation)),
    // Just after letting go of the last stroke
    rest: () => view(state.last),
    press(notation) {
      const chord = bitsOf(notation);
      state.last = chord;
      const matches = state.candidates.filter((strokes) => strokes[state.idx] === chord);
      if (matches.length === 0) return 'wrong';
      state.candidates = matches;
      state.idx += 1;
      state.done.push(chord);
      state.last = 0;
      return matches.some((strokes) => strokes.length === state.idx) ? 'done' : 'ok';
    },
  };
}

test('one stroke: holding the right chord shows the word', () => {
  const t = typing('cat');
  assert.deepEqual(t.hold('KAT'), { text: 'cat', resolved: true });
  assert.equal(t.press('KAT'), 'done');
});

test('one stroke: a wrong chord shows what it really is, never the word', () => {
  const t = typing('cat');
  assert.deepEqual(t.hold('KA'), { text: 'ka', resolved: true });
  assert.deepEqual(t.hold('KAP'), { text: 'KAP', resolved: false });
  assert.equal(t.press('KA'), 'wrong');
  assert.deepEqual(t.rest(), { text: 'ka', resolved: true });
});

test('one stroke: nothing is shown before any key is pressed', () => {
  assert.equal(typing('cat').rest(), null);
});

test('two strokes: the first stroke shows its own meaning, not the whole word', () => {
  const t = typing('data');
  assert.deepEqual(t.hold('TKAT'), { text: 'dat', resolved: true });
});

test('two strokes: the finished first stroke stays visible after letting go', () => {
  const t = typing('data');
  assert.equal(t.press('TKAT'), 'ok');
  assert.deepEqual(t.rest(), { text: 'dat', resolved: true });
});

test('two strokes: the second stroke completes the word', () => {
  const t = typing('data');
  t.press('TKAT');
  assert.deepEqual(t.hold('A'), { text: 'data', resolved: true });
  assert.equal(t.press('A'), 'done');
});

test('two strokes: a wrong second stroke keeps the first and shows the mistake after it', () => {
  const t = typing('data');
  t.press('TKAT');
  assert.equal(t.press('-T'), 'wrong');
  assert.deepEqual(t.rest(), { text: 'dat at', resolved: true });
  // The first stroke is kept through the mistake, and the right stroke still finishes the word
  assert.equal(t.press('A'), 'done');
});

test('two strokes: a wrong second stroke with no meaning shows raw steno after the first', () => {
  const t = typing('data');
  t.press('TKAT');
  assert.deepEqual(t.hold('PW'), { text: 'dat PW', resolved: false });
});

test('two strokes: a wrong FIRST stroke has nothing before it and does not advance', () => {
  const t = typing('abbess');
  assert.equal(t.press('TKAT'), 'wrong');
  assert.deepEqual(t.rest(), { text: 'dat', resolved: true });
  assert.equal(t.press('AB'), 'ok');
  assert.deepEqual(t.rest(), { text: 'ab', resolved: true });
});

test('a word with a one-stroke and a two-stroke spelling follows whichever you type', () => {
  const oneStroke = typing('data');
  assert.deepEqual(oneStroke.hold('TAET'), { text: 'data', resolved: true });
  assert.equal(oneStroke.press('TAET'), 'done');
  const twoStroke = typing('data');
  assert.deepEqual(twoStroke.hold('TKAT'), { text: 'dat', resolved: true });
});

test('three strokes: every finished stroke stays, in order', () => {
  const t = typing('abandons');
  assert.deepEqual(t.hold('A'), { text: 'a', resolved: true });
  assert.equal(t.press('A'), 'ok');
  assert.deepEqual(t.rest(), { text: 'a', resolved: true });
  // PWAPBD has no translation of its own, so it shows as raw steno and flags unresolved
  assert.deepEqual(t.hold('PWAPBD'), { text: 'a PWAPBD', resolved: false });
  assert.equal(t.press('PWAPBD'), 'ok');
  assert.deepEqual(t.rest(), { text: 'a PWAPBD', resolved: false });
});

test('three strokes: only the final stroke turns it into the word', () => {
  const t = typing('abandons');
  t.press('A');
  t.press('PWAPBD');
  assert.deepEqual(t.hold('O*PBS'), { text: 'abandons', resolved: true });
  assert.equal(t.press('O*PBS'), 'done');
});

test('three strokes: a wrong middle stroke keeps the first and does not advance', () => {
  const t = typing('abandons');
  t.press('A');
  assert.equal(t.press('AB'), 'wrong');
  assert.deepEqual(t.rest(), { text: 'a ab', resolved: true });
  assert.equal(t.press('PWAPBD'), 'ok');
  assert.deepEqual(t.rest(), { text: 'a PWAPBD', resolved: false });
});

test('three strokes: a wrong last stroke keeps both finished strokes', () => {
  const t = typing('abandons');
  t.press('A');
  t.press('PWAPBD');
  assert.equal(t.press('-T'), 'wrong');
  assert.deepEqual(t.rest(), { text: 'a PWAPBD at', resolved: false });
  assert.equal(t.press('O*PBS'), 'done');
});

test('the whole word is never shown before its final stroke', () => {
  for (const text of ['data', 'abbess', 'abandons']) {
    const longest = wordNamed(text).variants.reduce((a, b) => (b.length > a.length ? b : a));
    const t = typing(text);
    for (const bits of longest.slice(0, -1)) {
      const notation = steno.renderStroke(bits);
      assert.notEqual(t.hold(notation).text, text, `${text} shown while holding ${notation}`);
      t.press(notation);
      assert.notEqual(t.rest().text, text, `${text} shown after ${notation}`);
    }
  }
});
