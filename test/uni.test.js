const test = require('node:test');
const assert = require('node:assert');
const U = require('../public/lib/uni.js');
const S = require('../public/lib/steno.js');

test('parseHidState accepts a 0x50 report and reads 8 big-endian bytes', () => {
  const report = [0x50, 0x80, 0, 0, 0, 0, 0, 0, 0];
  assert.strictEqual(U.parseHidState(report), 1n << 63n);
  assert.strictEqual(U.parseHidState([0x50, 0, 0, 0, 0, 0, 0, 0, 0x01]), 1n);
});

test('parseHidState rejects wrong report id and short reports', () => {
  assert.strictEqual(U.parseHidState([0x51, 0x80, 0, 0, 0, 0, 0, 0, 0]), null);
  assert.strictEqual(U.parseHidState([0x50, 0x80, 0]), null);
});

test('chartKeys reads chart names from the MSB down', () => {
  assert.deepStrictEqual(U.chartKeys(1n << 63n), ['S1-']);
  assert.deepStrictEqual(U.chartKeys((1n << 63n) | (1n << 62n)), ['S1-', 'T-']);
  assert.deepStrictEqual(U.chartKeys(1n << 40n), ['S2-']);
  assert.deepStrictEqual(U.chartKeys(0n), []);
});

test('leverSlot maps split levers onto lesson slots and ignores X keys', () => {
  assert.strictEqual(U.leverSlot('S1-'), 'S-');
  assert.strictEqual(U.leverSlot('S2-'), 'S-');
  assert.strictEqual(U.leverSlot('*3'), '*');
  assert.strictEqual(U.leverSlot('#1'), '#');
  assert.strictEqual(U.leverSlot('#C'), '#');
  assert.strictEqual(U.leverSlot('X1'), null);
  assert.strictEqual(U.leverSlot('T-'), 'T-');
  assert.strictEqual(U.leverSlot('-Z'), '-Z');
});

test('strokeBits merges levers onto slot bits', () => {
  const sBit = 1 << S.SLOTS.findIndex(([, name]) => name === 'S-');
  const starBit = 1 << S.SLOTS.findIndex(([, name]) => name === '*');
  const hashBit = 1 << S.SLOTS.findIndex(([, name]) => name === '#');
  assert.strictEqual(U.strokeBits(['S1-', 'S2-']), sBit);
  assert.strictEqual(U.strokeBits(['*1', '*2', '*3', '*4']), starBit);
  assert.strictEqual(U.strokeBits(['#1', '#2']), hashBit);
  assert.strictEqual(U.strokeBits(['X1']), 0);
  assert.strictEqual(U.strokeBits(['S1-', 'T-']), sBit | (1 << 1));
});

test('UNI_KEYS is the 28-key Uni v4 grid covering every lesson slot', () => {
  assert.strictEqual(U.UNI_KEYS.length, 28);
  const positions = new Set(U.UNI_KEYS.map((k) => `${k.half}:${k.row}:${k.col}`));
  assert.strictEqual(positions.size, 28);
  const slots = new Set(U.UNI_KEYS.map((k) => k.slot));
  assert.strictEqual(slots.size, 23);
  for (const [, name] of S.SLOTS) assert.ok(slots.has(name), `missing slot ${name}`);
  assert.deepStrictEqual(U.UNI_KEYS.filter((k) => k.name === 'S1-'), [{ name: 'S1-', slot: 'S-', half: 'L', row: 0, col: 0 }]);
  assert.deepStrictEqual(U.UNI_KEYS.filter((k) => k.name === '#2'), [{ name: '#2', slot: '#', half: 'R', row: 2, col: 2 }]);
});

test('hintNames renders steno display names in display order', () => {
  const aBit = 1 << S.SLOTS.findIndex(([, name]) => name === 'A-');
  const tBit = 1 << S.SLOTS.findIndex(([, name]) => name === '-T');
  assert.deepStrictEqual(U.hintNames(aBit | tBit), ['A', '-T']);
});
