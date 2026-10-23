const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const steno = require('../public/lib/steno.js');

const layoutText = fs.readFileSync(path.join(__dirname, 'fixtures', 'layout.txt'), 'utf8');

test('parseStroke reads Plover strokes the way keymux does', () => {
  // K + A + right T = "cat"
  assert.equal(steno.parseStroke('KAT'), (1 << 2) | (1 << 7) | (1 << 18));
  // Right-only strokes need the dash
  assert.equal(steno.parseStroke('-PB'), (1 << 14) | (1 << 15));
  // Numbers start with #
  assert.equal(steno.parseStroke('#T'), (1 << 22) | (1 << 1));
});

test('parseStroke rejects anything that is not a single stroke', () => {
  assert.equal(steno.parseStroke('xyz'), null);
  assert.equal(steno.parseStroke(''), null);
  // A left-hand letter after a vowel needs a dash
  assert.equal(steno.parseStroke('AK'), null);
});

test('parseLayout reads keymux layout output into keys and combined keys', () => {
  const layout = steno.parseLayout(layoutText);
  assert.equal(layout.slots.length, 23);
  const s = layout.slots.find((slot) => slot.name === 'S-');
  assert.equal(s.label, 'A');
  assert.equal(s.sound, 's');
  assert.equal(s.index, 0);

  // Comma presses -E and -U together
  const comma = layout.keys.find((key) => key.label === ',');
  assert.equal(comma.combined, true);
  assert.equal(comma.bits, (1 << 10) | (1 << 11));
});

test('parseLayout keeps a steno key\'s first row as its own and treats repeats as extra keys', () => {
  const layout = steno.parseLayout(`${layoutText.trimEnd()}\nS-  Q  s\n*  G  *\n#  2  #\n`);
  assert.equal(layout.slots.length, 23);
  assert.equal(layout.slots.find((slot) => slot.name === 'S-').label, 'A');
  assert.equal(layout.slots.find((slot) => slot.name === '#').label, '1');
  const q = layout.keys.find((key) => key.label === 'Q');
  assert.equal(q.bits, 1 << 0);
  assert.equal(q.combined, false);
  assert.equal(layout.keys.find((key) => key.label === 'G').bits, 1 << 9);
  assert.equal(layout.keys.find((key) => key.label === '2').bits, 1 << 22);
});

test('the bundled layout presses S- on Q, * on G, and # on every number-row key', () => {
  const bundle = require('../public/data/bundle.json');
  const bitsFor = (label) => bundle.layout.keys.find((key) => key.label === label).bits;
  assert.equal(bitsFor('A'), bitsFor('Q'));
  assert.equal(bitsFor('T'), bitsFor('G'));
  for (const digit of '1234567890') assert.equal(bitsFor(digit), 1 << 22, digit);
  assert.equal(bundle.layout.slots.length, 23);
});

test('namesInBits lists the steno keys in a stroke in Plover order', () => {
  assert.deepEqual(steno.namesInBits(steno.parseStroke('KAT')), ['K-', 'A-', '-T']);
});

test('buildWords keeps plain words and the shortest stroke for each', () => {
  const words = steno.buildWords([
    ['KAT', 'cat'],
    ['KAT/-PB', 'cat'],
    ['-PB', 'and'],
    ['KPA/TKAOEU', 'example'],
    ['TEFT', 'Test'],
    ['1/THOEUB', '1,000'],
    ['{^ing}', '{^ing}'],
    ['bad/stroke/a/b', 'x'],
  ]);
  const byText = Object.fromEntries(words.map((word) => [word.text, word]));
  assert.deepEqual(Object.keys(byText).sort(), ['and', 'cat', 'example']);
  assert.deepEqual(byText.cat.shown, ['KAT']);
  assert.deepEqual(byText.cat.variants[0], [steno.parseStroke('KAT')]);
  assert.equal(byText.cat.variants.length, 2, 'KAT and KAT/-PB both type "cat"');
  assert.deepEqual(byText.example.shown, ['KPA', 'TKAOEU']);
});

test('buildWords keeps every stroke for a word and shows the one with fewest keys', () => {
  const words = steno.buildWords([
    ['STK', 'and'],
    ['-PB', 'and'],
  ]);
  const and = words[0];
  assert.equal(and.variants.length, 2, 'both strokes are accepted');
  assert.deepEqual(and.shown, ['-PB'], 'the two-key stroke is shown first');
});

test('displayName keeps the dash only where a letter has a left and a right key', () => {
  const names = (list) => list.map(steno.displayName);
  assert.deepEqual(names(['-E', 'A-', 'K-', 'W-', '-F', '*', '#']), ['E', 'A', 'K', 'W', 'F', '*', '#']);
  assert.deepEqual(names(['S-', '-S', 'T-', '-T', 'R-', '-R', 'P-', '-P']), ['S', '-S', 'T', '-T', 'R', '-R', 'P', '-P']);
});

test('keyGroup puts left-hand keys (star included), vowels, and right-hand keys in their own groups', () => {
  const groups = ['S-', 'R-', 'A-', '*', '-E', '-U', '-F', '-T', '#'].map(steno.keyGroup);
  assert.deepEqual(groups, ['left', 'left', 'middle', 'left', 'middle', 'middle', 'right', 'right', '']);
});

test('displayOrder reads #STKPWHRAO*EUFRPBLGTSDZ, with the number key first', () => {
  assert.deepEqual(steno.displayOrder(steno.namesInBits(steno.parseStroke('#SKWRAO*EUF'))), ['#', 'S-', 'K-', 'W-', 'R-', 'A-', 'O-', '*', '-E', '-U', '-F']);
});


test('buildNumberWords makes every one-stroke number, in steno order, using the # key', () => {
  const words = steno.buildNumberWords();
  assert.equal(words.length, 1023);
  const byText = new Map(words.map((word) => [word.text, word]));
  assert.deepEqual(byText.get('12').shown, ['#ST']);
  assert.deepEqual(byText.get('10').shown, ['#SO']);
  assert.deepEqual(byText.get('9').shown, ['#-T']);
  assert.equal(byText.get('21'), undefined, 'out of steno order, so not one stroke');
  assert.equal(byText.get('11'), undefined);
  for (const word of words) {
    assert.equal(word.variants.length, 1);
    assert.equal(steno.renderStroke(word.variants[0][0]), word.shown[0]);
    assert.ok(word.variants[0][0] & (1 << 22), `${word.text} uses #`);
  }
});

test('renderStroke writes a stroke bitmask in Plover notation', () => {
  for (const text of ['KAT', '-PB', 'TEFT', '#T', 'STKPWHR', '-FRPBLGTSDZ', '*', 'TK-PB', 'R-R']) {
    assert.equal(steno.renderStroke(steno.parseStroke(text)), text);
  }
});

test('displayStroke shows a stroke in Plover notation', () => {
  const cases = {
    'THAOETS': 'THAOETS', 'STR-RTS': 'STR-RTS', '-TS': '-TS', 'S': 'S', 'KAT': 'KAT',
    'RARTS': 'RARTS', 'O*PBS': 'O*PBS', '*': '*', '#T': '#T', '#-T': '#-T', '#': '#',
    'AEU': 'AEU', 'SKWR-FRPB': 'SKWR-FRPB',
  };
  for (const [plover, shown] of Object.entries(cases)) {
    const bits = steno.parseStroke(plover);
    assert.equal(steno.displayStroke(bits), shown, plover);
    assert.equal(steno.parseStroke(steno.renderStroke(bits)), bits, 'renderStroke still round-trips');
  }
});
