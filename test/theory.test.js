const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const steno = require('../public/lib/steno.js');

// Lapwing's data is generated locally (see README), so these tests only run once it's built.
const DATA = path.join(__dirname, '..', 'public', 'data');
const BUILT = fs.existsSync(path.join(DATA, 'lapwing', 'bundle.json'));
const skip = BUILT ? false : 'Lapwing data not built: run scripts/build-theory.js lapwing <folder>';

test('Lapwing uses the same steno layout as Plover, so every key is in the same place', { skip }, () => {
  const plover = JSON.parse(fs.readFileSync(path.join(DATA, 'bundle.json'), 'utf8'));
  const lapwing = JSON.parse(fs.readFileSync(path.join(DATA, 'lapwing', 'bundle.json'), 'utf8'));
  assert.deepEqual(lapwing.layout, plover.layout);
});

test('every Lapwing stroke only uses keys from the layout', { skip }, () => {
  const dict = JSON.parse(fs.readFileSync(path.join(DATA, 'lapwing', 'dictionary.json'), 'utf8'));
  const bad = Object.keys(dict).filter((notation) =>
    notation.split('/').some((stroke) => steno.parseStroke(stroke) === null));
  assert.deepEqual(bad, []);
});

test('the Lapwing lesson words are built the same way as the Plover ones', { skip }, () => {
  const lapwing = JSON.parse(fs.readFileSync(path.join(DATA, 'lapwing', 'bundle.json'), 'utf8'));
  const we = lapwing.words.find((word) => word.text === 'we');
  assert.ok(we, 'we is in the Lapwing word list');
  assert.deepEqual(we.shown, ['WAOE']);
  assert.ok(lapwing.words.every((word) => word.shown.length > 0 && word.variants.length > 0));
});
