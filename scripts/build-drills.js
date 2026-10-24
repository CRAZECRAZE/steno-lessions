// Builds public/data/drills.json: the Lapwing course's drill word lists, grouped by chapter,
// in the same word format the lessons use (see steno.buildWords).
//
// Usage: node scripts/build-drills.js <folder with the Lapwing practice files>
//
// The practice files come from https://lapwing.aerick.ca/practice/ (linked from the book's
// print.html). Each line is `word<TAB>stroke`, the same pairs Plover's dictionary uses, just in
// the other order. Files named `<chapter>-<name>.txt` belong to that chapter, and a chapter's
// test file (`<chapter>-test.txt`) is part of the same chapter's drills. Only the words the
// lessons can type are kept (lowercase, see steno.buildWords), so capitalised entries drop out.
const fs = require('node:fs');
const path = require('node:path');
const steno = require('../public/lib/steno.js');

// Chapter titles as the book gives them ("Chapter 5: Lapwing setup and basics").
const CHAPTER_TITLES = {
  5: 'Lapwing setup and basics',
  6: 'Left hand consonants continued',
  7: 'Vowels',
  8: 'Vowels continued',
  9: 'Right hand chords',
  10: 'Right hand chords continued',
  11: 'Right hand compound clusters',
  12: 'Wrapping up basic words',
  13: 'Prefixes and suffixes',
  14: 'Suffix keys and compound words',
  15: 'Syllabic splitting',
  16: 'Top 200 common English words',
  17: 'Shortening techniques',
};

function chapterOf(file) {
  const match = /^(\d+)-.+\.txt$/.exec(file);
  return match ? Number(match[1]) : null;
}

// `word<TAB>stroke` lines -> the `[stroke, word]` pairs buildWords takes. Blank or malformed
// lines are skipped.
function readPairs(text) {
  const pairs = [];
  for (const line of text.split('\n')) {
    const [word, stroke] = line.replace(/\r$/, '').split('\t');
    if (word && stroke) pairs.push([stroke.trim(), word.trim()]);
  }
  return pairs;
}

// Groups practice files by chapter and builds each chapter's words. `files` maps a file name to
// its text, so the function can be tested without touching the disk.
function buildDrills(files) {
  const byChapter = new Map();
  for (const file of Object.keys(files).sort()) {
    const chapter = chapterOf(file);
    if (chapter === null) continue;
    if (!byChapter.has(chapter)) byChapter.set(chapter, { files: [], pairs: [] });
    const group = byChapter.get(chapter);
    group.files.push(file);
    group.pairs.push(...readPairs(files[file]));
  }
  return [...byChapter]
    .sort(([a], [b]) => a - b)
    .map(([chapter, { files: names, pairs }]) => ({
      chapter,
      title: CHAPTER_TITLES[chapter] || `Chapter ${chapter}`,
      drills: names.map((name) => name.replace(/\.txt$/, '')),
      words: steno.buildWords(pairs),
    }));
}

function main() {
  const [source] = process.argv.slice(2);
  if (!source) {
    console.error('usage: node scripts/build-drills.js <folder with the Lapwing practice files>');
    process.exit(1);
  }
  const files = {};
  for (const file of fs.readdirSync(source)) {
    if (chapterOf(file) !== null) files[file] = fs.readFileSync(path.join(source, file), 'utf8');
  }
  const chapters = buildDrills(files);
  const out = path.join(__dirname, '..', 'public', 'data', 'drills.json');
  fs.writeFileSync(out, JSON.stringify({ source: 'Lapwing course drill word lists', chapters }));
  const total = chapters.reduce((sum, chapter) => sum + chapter.words.length, 0);
  console.log(`drills: ${chapters.length} chapters, ${total} words -> ${out}`);
}

if (require.main === module) main();

module.exports = { buildDrills, readPairs, chapterOf, CHAPTER_TITLES };
