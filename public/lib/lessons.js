// Lesson engine: start with a few steno keys, practice words that use only those keys, and
// unlock one more key once you type fast enough and accurately enough. Pure functions only,
// so it runs in the page and in tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./word-frequency.js'));
  } else {
    root.StenoLessons = factory(root.StenoWordFreq);
  }
})(typeof self !== 'undefined' ? self : globalThis, function (WordFreq) {
  // Order keys are introduced in: the vowels and the most common consonant sounds
  // first, then the rest of the left hand, the right hand, and finally the star and
  // number keys. Names are keymux's config names.
  const KEY_ORDER = [
    '-E', 'A-', 'T-', 'S-', 'K-', '-T', '-S', 'R-', '-R', 'H-', 'O-', 'P-',
    'W-', '-U', '-L', '-D', '-P', '-B', '-G', '-F', '*', '-Z', '#',
  ];
  const START_KEYS = 6;
  // Words in one lesson: the stream shows exactly this many, and the same count is used to
  // judge speed and accuracy before a key can unlock. The history is cleared on each unlock,
  // so a lesson's words line up exactly with the judging window.
  const LESSON_SIZE = 30;
  // Share of strokes that must be right on the first try.
  const ACCURACY_TARGET = 0.95;
  // Share of attempts on a single key that must be right before it can gate an unlock.
  const KEY_ACCURACY_TARGET = 0.8;
  // Completed words kept in the history. Only the newest LESSON_SIZE matter for unlocking.
  const HISTORY_LIMIT = 100;
  // Time added to a stroke's average for each miss on it.
  const MISS_PENALTY_MS = 800;
  // A stroke that takes this long or less is "fast" for one key (ms).
  const TARGET_MS = 1200;
  // Samples needed before a key's speed bar reads as full.
  const SAMPLES_TO_LEARN = 5;
  // Longest word a lesson will use.
  const MAX_WORD_LENGTH = 9;
  // Finished lessons' accuracy kept for the streak summary.
  const LESSON_HISTORY_LIMIT = 10;
  // Attempts on one key kept for its rolling accuracy, so the unlock gate reflects recent
  // play (about one lesson's worth) instead of a lifetime total that's nearly impossible to
  // move once a key has thousands of samples.
  const KEY_ACCURACY_WINDOW = 30;
  // Attempts needed on a key before its rolling accuracy can gate an unlock.
  const KEY_ACCURACY_MIN_SAMPLES = 5;
  // The etude<->concerto complexity slider, 0-100. Below ETUDE_MAX: isolated, minimal-load
  // reps on the focus key alone (an "etude"). Above CONCERTO_MIN: full-length words that
  // deliberately recombine several recently-unlocked keys together (a "concerto"). Between
  // the two: today's normal word picking, unchanged.
  const ETUDE_MAX = 40;
  const CONCERTO_MIN = 75;
  // Longest word an etude-band pick will use - the point is an isolated, minimal-load rep.
  const ETUDE_MAX_LENGTH = 3;
  // How many of the most-recently-unlocked keys a concerto-band pick tries to recombine.
  const RECOMBINE_LAST = 3;
  // Attempts on a key's rolling window needed before its mastery tier can reach 2 (fully
  // sustained), so a lucky short streak can't fade a scaffold prematurely.
  const MASTERY_TIER_1_CONFIDENCE = 0.6;
  const MASTERY_TIER_2_CONFIDENCE = 0.9;
  // Recent probe reps kept per key, for comparing isolated-rep speed against blended speed.
  const PROBE_WINDOW = 10;
  const PROBE_MIN_SAMPLES = 3;
  // How much faster an isolated probe rep should be than blended practice, as a fraction of
  // blended speed. Isolated reps should always be comfortably faster; a gap below this means
  // word complexity is not the real bottleneck - raw chord-formation speed is.
  const HEALTHY_PROBE_GAP = 0.2;
  // How hard word weighting leans toward a key's own weakness: a fully unknown key (weakness
  // 1) multiplies a word's weight by (1 + WEAKNESS_GAIN); a fully confident key (weakness 0)
  // leaves it untouched. Squared in `keyWeakness` so a clearly weak key pulls much harder than
  // a merely imperfect one, instead of every non-mastered key crowding in evenly.
  const WEAKNESS_GAIN = 3;
  // Correct reps (recordChord samples) during which a freshly-unlocked key is treated as
  // maximally weak for word selection, regardless of how fast its measured `confidence`
  // happens to climb. confidence can read near 1 after as few as SAMPLES_TO_LEARN good reps,
  // which is not enough real practice for the key to have earned losing its selection
  // priority to whichever other key is now the single lowest-confidence one.
  const NEW_KEY_GRACE_SAMPLES = 15;

  // Words per minute needed to unlock the next key. A flat bar for every key - per-key
  // accuracy gating (KEY_ACCURACY_TARGET) is what actually proves a new key is mastered,
  // so a rising speed target on top of that only punished the lesson right after a brand
  // new, still-unfamiliar key was introduced.
  const WPM_TARGET = 35;
  function wpmTarget() {
    return WPM_TARGET;
  }

  function lengthWeight(length) {
    if (length <= 1) return 0.2;
    if (length === 2) return 0.6;
    if (length <= 6) return 1;
    return 0.6;
  }

  function strokeWeight(strokes) {
    if (strokes === 1) return 2;
    if (strokes === 2) return 1;
    return 0.3;
  }

  // Scaffolds default ON (always shown) - fading is something a learner opts into by
  // unchecking a box, never a surprise sprung on a fresh or imported profile.
  function defaultScaffolds() {
    return { labels: true, target: true, keyboard: true };
  }

  function emptyProgress() {
    return { unlocked: START_KEYS, keys: {}, words: [], lessonHistory: [], totalTyped: 0, scaffolds: defaultScaffolds() };
  }

  // Keeps only the fields the engine understands, so an old or damaged save still loads.
  function normalize(saved) {
    const progress = emptyProgress();
    if (!saved || typeof saved !== 'object') return progress;
    if (Number.isInteger(saved.unlocked)) {
      progress.unlocked = Math.min(Math.max(saved.unlocked, 1), KEY_ORDER.length);
    }
    if (saved.keys && typeof saved.keys === 'object') {
      for (const name of KEY_ORDER) {
        const stat = saved.keys[name];
        if (!stat || typeof stat !== 'object') continue;
        progress.keys[name] = {
          samples: Math.max(0, Number(stat.samples) || 0),
          ewmaMs: typeof stat.ewmaMs === 'number' ? stat.ewmaMs : null,
          misses: Math.max(0, Number(stat.misses) || 0),
          recent: Array.isArray(stat.recent)
            ? stat.recent.filter((hit) => hit === 0 || hit === 1).slice(-KEY_ACCURACY_WINDOW)
            : [],
          probeRecent: Array.isArray(stat.probeRecent)
            ? stat.probeRecent.filter((ms) => Number.isFinite(ms) && ms > 0).slice(-PROBE_WINDOW)
            : [],
        };
      }
    }
    if (Array.isArray(saved.words)) {
      progress.words = saved.words
        .filter((word) => word && Number.isFinite(word.ms) && Number.isFinite(word.strokes) && Number.isFinite(word.misses))
        .slice(-HISTORY_LIMIT);
    }
    if (Array.isArray(saved.lessonHistory)) {
      progress.lessonHistory = saved.lessonHistory
        .filter((entry) => entry && Number.isFinite(entry.accuracy) && Number.isFinite(entry.wpm))
        .slice(-LESSON_HISTORY_LIMIT);
    }
    if (saved.scaffolds && typeof saved.scaffolds === 'object') {
      for (const stage of Object.keys(progress.scaffolds)) {
        if (typeof saved.scaffolds[stage] === 'boolean') progress.scaffolds[stage] = saved.scaffolds[stage];
      }
    }
    if (Number.isFinite(saved.totalTyped)) {
      progress.totalTyped = Math.max(0, Math.floor(saved.totalTyped));
    }
    return progress;
  }

  function unlockedNames(progress) {
    return KEY_ORDER.slice(0, progress.unlocked);
  }

  // Records one chord: `names` are the steno keys it pressed, `ms` how long it took.
  // A miss adds a penalty to the average rather than counting as a sample.
  function recordChord(progress, names, ms, correct) {
    for (const name of names) {
      const stat = progress.keys[name] || { samples: 0, ewmaMs: null, misses: 0, recent: [], probeRecent: [] };
      const cost = correct ? ms : ms + MISS_PENALTY_MS;
      stat.ewmaMs = stat.ewmaMs === null ? cost : stat.ewmaMs * 0.7 + cost * 0.3;
      // A plain rolling window (not an EWMA), so a single recent miss can't swing the gate by
      // itself and a bad patch from thousands of attempts ago can't keep it stuck either -
      // only the last KEY_ACCURACY_WINDOW attempts on this key count.
      stat.recent = [...(stat.recent || []), correct ? 1 : 0].slice(-KEY_ACCURACY_WINDOW);
      if (correct) {
        stat.samples += 1;
      } else {
        stat.misses += 1;
      }
      progress.keys[name] = stat;
    }
    return progress;
  }

  // Records one completed word: `ms` from its first key to its last, `strokes` strokes
  // typed correctly, `misses` strokes that needed another try.
  function recordWord(progress, { ms, strokes, misses }) {
    progress.words.push({ ms, strokes, misses });
    if (progress.words.length > HISTORY_LIMIT) {
      progress.words.splice(0, progress.words.length - HISTORY_LIMIT);
    }
    // Counts every word ever finished, never trimmed or reset (unlike `words`, which is just
    // the current judging window). This is a forward-only fingerprint: real play only ever
    // increases it, so a pasted-in save with a lower count than what's already here can only
    // be older progress, not something earned since.
    progress.totalTyped += 1;
    return progress;
  }

  // Speed and accuracy over the newest words, since the last unlock. `count` is how many
  // words were used, which can be fewer than LESSON_SIZE early on.
  function windowStats(progress) {
    const recent = progress.words.slice(-LESSON_SIZE);
    const count = recent.length;
    const ms = recent.reduce((sum, word) => sum + word.ms, 0);
    const strokes = recent.reduce((sum, word) => sum + word.strokes, 0);
    const misses = recent.reduce((sum, word) => sum + word.misses, 0);
    return {
      count,
      wpm: ms > 0 ? (count * 60000) / ms : 0,
      accuracy: strokes + misses > 0 ? (strokes + misses - misses) / (strokes + misses) : 1,
    };
  }

  // A single number combining speed and accuracy, for the HUD's Score metric.
  function scoreFor(stats) {
    return Math.round(stats.wpm * stats.accuracy * 20);
  }

  // Share of the last KEY_ACCURACY_WINDOW attempts on one key that were right. 1 (not a gate)
  // if the key hasn't been attempted enough yet, so it doesn't block unlocking before there's
  // enough recent data, and so it can't trap you on a bad patch forever - it clears as soon as
  // enough recent attempts are good, no matter how many total attempts came before.
  function keyAccuracy(progress, name) {
    const stat = progress.keys[name];
    if (!stat || stat.recent.length < KEY_ACCURACY_MIN_SAMPLES) return 1;
    return stat.recent.reduce((sum, hit) => sum + hit, 0) / stat.recent.length;
  }

  // Whether every unlocked key is individually accurate enough, not just the overall average.
  function keysAccurateEnough(progress) {
    return unlockedNames(progress).every((name) => keyAccuracy(progress, name) >= KEY_ACCURACY_TARGET);
  }

  // Whether the newest words are fast and accurate enough to unlock the next key.
  function canUnlock(progress) {
    if (progress.unlocked >= KEY_ORDER.length) return false;
    const stats = windowStats(progress);
    return stats.count >= LESSON_SIZE
      && stats.wpm >= wpmTarget(progress.unlocked)
      && stats.accuracy >= ACCURACY_TARGET
      && keysAccurateEnough(progress);
  }

  // Unlocks the next key if canUnlock says so. Starts counting words again from zero.
  // Returns true if a key was added.
  function unlockIfReady(progress) {
    if (!canUnlock(progress)) return false;
    progress.unlocked += 1;
    progress.words = [];
    return true;
  }

  // Appends a finished lesson's accuracy to the short streak history shown on the HUD.
  function recordLesson(progress, stats) {
    progress.lessonHistory.push({ accuracy: stats.accuracy, wpm: stats.wpm });
    if (progress.lessonHistory.length > LESSON_HISTORY_LIMIT) {
      progress.lessonHistory.splice(0, progress.lessonHistory.length - LESSON_HISTORY_LIMIT);
    }
    return progress;
  }

  // 0 to 1: how well a key is known. Shown as the key's bar, and used to pick the key that
  // most needs practice. Needs samples and speed, and accuracy: a key typed fast but wrong
  // a lot is not actually known, even though it would look full on speed alone.
  function confidence(progress, name) {
    const stat = progress.keys[name];
    if (!stat || stat.ewmaMs === null) return 0;
    const enough = Math.min(1, stat.samples / SAMPLES_TO_LEARN);
    const speed = Math.min(1, TARGET_MS / stat.ewmaMs);
    const accuracy = Math.min(1, keyAccuracy(progress, name) / KEY_ACCURACY_TARGET);
    return enough * speed * accuracy;
  }

  // The unlocked key that needs the most practice. Ties go to the one introduced later.
  function focusKey(progress) {
    let focus = null;
    let weakest = Infinity;
    for (const name of unlockedNames(progress)) {
      const score = confidence(progress, name);
      if (score <= weakest) {
        weakest = score;
        focus = name;
      }
    }
    return focus;
  }

  // 0 (learning), 1 (solid), 2 (fully sustained): how settled a key is, for fading scaffolds.
  // Both tiers need the whole rolling accuracy window full (KEY_ACCURACY_WINDOW real recent
  // attempts on this exact key), not just "enough samples to count" - confidence alone can
  // read as high after only a handful of reps (its own samples ramp tops out at just
  // SAMPLES_TO_LEARN), which let a scaffold fade within the first few words after a key
  // unlocked for anyone with real practice history on the *other* keys, and flicker as a
  // live EWMA confidence bounced across the threshold. Requiring the full window means a
  // scaffold only ever fades after real, sustained practice on that specific key.
  function masteryTier(progress, name) {
    const stat = progress.keys[name];
    if (!stat || stat.recent.length < KEY_ACCURACY_WINDOW) return 0;
    const conf = confidence(progress, name);
    if (conf >= MASTERY_TIER_2_CONFIDENCE) return 2;
    if (conf >= MASTERY_TIER_1_CONFIDENCE) return 1;
    return 0;
  }

  // The lowest mastery tier among unlocked keys: a scaffold only fades once every unlocked
  // key, not just the newest one, is ready for less help.
  function scaffoldTier(progress) {
    const names = unlockedNames(progress);
    if (names.length === 0) return 0;
    return Math.min(...names.map((name) => masteryTier(progress, name)));
  }

  // The tier each scaffold stage needs scaffoldTier to reach before it defaults to fading.
  const SCAFFOLD_STAGE_TIER = { labels: 1, target: 2, keyboard: 2 };

  // Whether a given scaffold (one of SCAFFOLD_STAGE_TIER's keys) should be shown. `override`
  // is the matching checkbox's own checked state, and always wins outright: a scaffold is
  // only ever defaulted away, never removed with no way back. This is the one function both
  // the fade decision and its override live in, so the override behaviour itself is covered
  // by a plain unit test rather than only living, unverified, inside app.js's DOM code.
  function scaffoldVisible(progress, stage, override) {
    if (override) return true;
    return scaffoldTier(progress) < SCAFFOLD_STAGE_TIER[stage];
  }

  // The etude<->concerto dial, 0-100: how ready the focus key is, reusing the same signal
  // that already drives its HUD bar. Recomputed fresh every call, no state of its own.
  function complexityScore(progress) {
    const focus = focusKey(progress);
    if (!focus) return 0;
    return confidence(progress, focus) * 100;
  }

  function complexityBand(score) {
    if (score < ETUDE_MAX) return 'etude';
    if (score >= CONCERTO_MIN) return 'concerto';
    return 'study';
  }

  // Appends one isolated-rep timing for `name`, kept apart from the normal blended ewmaMs so
  // probe (isolated) speed and everyday (blended) speed can be compared.
  function recordProbe(progress, name, ms) {
    const stat = progress.keys[name] || { samples: 0, ewmaMs: null, misses: 0, recent: [], probeRecent: [] };
    stat.probeRecent = [...(stat.probeRecent || []), ms].slice(-PROBE_WINDOW);
    progress.keys[name] = stat;
    return progress;
  }

  // How much faster `name`'s isolated probe reps are than its everyday blended speed, as a
  // fraction of blended speed (0.2 = probes are 20% faster, as a healthy gap should be).
  // null if there is not enough probe data yet to judge. A gap at or below HEALTHY_PROBE_GAP
  // (including negative, i.e. probes no faster or even slower) means complexity is not the
  // real bottleneck for this key - raw chord-formation speed is.
  function kinematicGap(progress, name) {
    const stat = progress.keys[name];
    if (!stat || !stat.ewmaMs || !stat.probeRecent || stat.probeRecent.length < PROBE_MIN_SAMPLES) return null;
    const probeAvg = stat.probeRecent.reduce((sum, ms) => sum + ms, 0) / stat.probeRecent.length;
    return (stat.ewmaMs - probeAvg) / stat.ewmaMs;
  }

  // Bit mask of the unlocked keys, using the same bit order as keymux's slots.
  function unlockedMask(progress, slotIndex) {
    return unlockedNames(progress).reduce((mask, name) => mask | (1 << slotIndex.get(name)), 0);
  }

  // The stroke sequences of a word that use only unlocked keys.
  function usableVariants(word, mask) {
    return word.variants.filter((strokes) => strokes.every((bits) => (bits & ~mask) === 0));
  }

  function bitCount(bits) {
    let count = 0;
    for (let rest = bits; rest; rest &= rest - 1) count += 1;
    return count;
  }

  // The stroke sequences to show for a word, using only unlocked keys. The first one is the
  // stroke to type: fewest strokes, then fewest keys.
  function displayVariants(word, mask) {
    const keyCount = (strokes) => strokes.reduce((total, bits) => total + bitCount(bits), 0);
    return usableVariants(word, mask)
      .map((strokes) => ({ strokes, keys: keyCount(strokes) }))
      .sort((a, b) => a.strokes.length - b.strokes.length || a.keys - b.keys)
      .map((item) => item.strokes);
  }

  // 0 (fully known) to 1 (fully unknown): how much a key's own weakness should pull word
  // selection toward it. A key still inside its new-key grace period (never attempted, or
  // under NEW_KEY_GRACE_SAMPLES correct reps so far) reads as maximally weak outright, rather
  // than trusting `confidence`'s fast-ramping early reading.
  function keyWeakness(progress, name) {
    const stat = progress.keys[name];
    if (!stat || stat.samples < NEW_KEY_GRACE_SAMPLES) return 1;
    return 1 - confidence(progress, name);
  }

  // How much a word's weight should scale up for the unlocked keys its stroke actually uses -
  // every one of them, not just the single globally-weakest key, so a word touching two
  // merely-shaky keys gets compounded priority instead of needing to wait for one key to
  // become the sole focus. Squared per key (see WEAKNESS_GAIN) so weakness compounds instead
  // of just adding up.
  function weaknessBoost(progress, bits, slotIndex) {
    let boost = 1;
    for (const name of unlockedNames(progress)) {
      if (!(bits & (1 << slotIndex.get(name)))) continue;
      const weak = keyWeakness(progress, name);
      boost *= 1 + WEAKNESS_GAIN * weak * weak;
    }
    return boost;
  }

  // Picks words for the stream. Only words with at least one stroke sequence that uses
  // unlocked keys are eligible. Words touching weaker unlocked keys come up more often (see
  // `weaknessBoost`), and words in `avoid` (recently typed) are skipped where possible.
  // `random` returns [0, 1). `options.allowMask`, if given, is used in place of the unlocked
  // mask to decide which words are eligible (but is expected to already be a subset of it) -
  // this is how an etude pick restricts itself to the focus key plus only already-mastered
  // keys. `options.bonusFn`, if given, multiplies a word's weight by `bonusFn(usable)` - this
  // is how a concerto pick rewards words that recombine several recently-unlocked keys
  // together.
  function pickWords(words, progress, slotIndex, options = {}) {
    const random = options.random || Math.random;
    const count = options.count || LESSON_SIZE;
    const avoid = new Set(options.avoid || []);
    const maxLength = options.maxLength || MAX_WORD_LENGTH;
    const mask = unlockedMask(progress, slotIndex);
    const eligibilityMask = options.allowMask !== undefined ? options.allowMask & mask : mask;
    const bonusFn = options.bonusFn || (() => 1);

    const eligible = [];
    for (const word of words) {
      if (word.text.length > maxLength) continue;
      const usable = usableVariants(word, eligibilityMask);
      if (usable.length > 0) eligible.push({ word, usable });
    }
    if (eligible.length === 0) return [];

    const pool = eligible.filter(({ word }) => !avoid.has(word.text));
    const source = pool.length >= count ? pool : eligible;
    const weighted = source.map(({ word, usable }) => {
      // Plover's dictionary has no word frequencies, so combine a real frequency list with
      // the length/stroke heuristics: medium length, one stroke, and actually common words win.
      let weight = lengthWeight(word.text.length) * strokeWeight(usable[0].length) * WordFreq.freqWeight(word.text);
      const bits = usable[0].reduce((combined, strokeBits) => combined | strokeBits, 0);
      weight *= weaknessBoost(progress, bits, slotIndex);
      weight *= bonusFn(usable);
      return { word, weight };
    });

    const chosen = [];
    const taken = new Set();
    while (chosen.length < count && taken.size < weighted.length) {
      const open = weighted.filter(({ word }) => !taken.has(word.text));
      const total = open.reduce((sum, item) => sum + item.weight, 0);
      let roll = random() * total;
      let picked = open[open.length - 1];
      for (const item of open) {
        roll -= item.weight;
        if (roll < 0) {
          picked = item;
          break;
        }
      }
      taken.add(picked.word.text);
      chosen.push(picked.word);
    }
    return chosen;
  }

  // One full lesson's worth of words: exactly LESSON_SIZE words (fewer only if the unlocked
  // keys cannot make that many distinct eligible words).
  function startLesson(words, progress, slotIndex, options = {}) {
    return pickWords(words, progress, slotIndex, { ...options, count: LESSON_SIZE });
  }

  // Bitmask of unlocked keys at or above `tier` - the "already comfortable" keys an etude
  // pick is allowed to lean on besides the focus key itself.
  function masteredMask(progress, slotIndex, tier) {
    let mask = 0;
    for (const name of unlockedNames(progress)) {
      if (masteryTier(progress, name) >= tier) mask |= 1 << slotIndex.get(name);
    }
    return mask;
  }

  // Bitmask of the `n` most-recently-unlocked keys, for the concerto-band recombination bonus.
  function recentlyUnlockedMask(progress, slotIndex, n) {
    const names = unlockedNames(progress).slice(-n);
    return names.reduce((mask, name) => mask | (1 << slotIndex.get(name)), 0);
  }

  // One word, chosen for the live complexity band: 'etude' (isolated, minimal-load reps on
  // the focus key), 'study' (today's normal picking, unchanged), or 'concerto' (full-length
  // words that deliberately recombine several recently-unlocked keys). The band is read from
  // `complexityScore` fresh every call, so it can move word to word, not just at a boundary -
  // unless `options.forceBand` overrides it (used for scheduled diagnostic probes) or a
  // `kinematicGap` deficit on the focus key forces 'etude' regardless of its confidence score,
  // because a key whose isolated reps are not substantially faster than its blended reps is
  // not actually being held back by word complexity.
  function nextWord(words, progress, slotIndex, options = {}) {
    const focus = focusKey(progress);
    const gap = focus ? kinematicGap(progress, focus) : null;
    const deficit = gap !== null && gap <= HEALTHY_PROBE_GAP;
    const band = options.forceBand || (deficit ? 'etude' : complexityBand(complexityScore(progress)));
    const pickOptions = { ...options, count: 1 };
    delete pickOptions.forceBand;
    delete pickOptions.isProbe;

    if (band === 'etude' && focus) {
      const focusBit = 1 << slotIndex.get(focus);
      pickOptions.allowMask = masteredMask(progress, slotIndex, 1) | focusBit;
      pickOptions.maxLength = ETUDE_MAX_LENGTH;
    } else if (band === 'concerto') {
      const recentMask = recentlyUnlockedMask(progress, slotIndex, RECOMBINE_LAST);
      pickOptions.bonusFn = (usable) => {
        if (!recentMask) return 1;
        const bits = usable[0].reduce((mask, b) => mask | b, 0);
        let count = 0;
        for (let rest = bits & recentMask; rest; rest &= rest - 1) count += 1;
        return 1 + count;
      };
    }

    let picked = pickWords(words, progress, slotIndex, pickOptions)[0];
    // An etude restriction (or any band option) can legitimately leave nothing eligible early
    // on, when few keys are mastered yet - fall back to a plain pick rather than return nothing.
    if (!picked) picked = pickWords(words, progress, slotIndex, { ...options, count: 1 })[0];
    if (!picked) return null;
    return { ...picked, band, isProbe: Boolean(options.isProbe), focusKeyAtPick: focus };
  }

  // Whether loading `incoming` in place of `current` would erase real progress. totalTyped
  // only ever grows during real play, so a lower count can only mean older, replayed, or
  // tampered-with data, never progress earned since.
  function isRewind(current, incoming) {
    return (incoming.totalTyped || 0) < (current.totalTyped || 0);
  }

  return {
    KEY_ORDER,
    START_KEYS,
    LESSON_SIZE,
    ACCURACY_TARGET,
    KEY_ACCURACY_TARGET,
    TARGET_MS,
    ETUDE_MAX,
    CONCERTO_MIN,
    PROBE_WINDOW,
    HEALTHY_PROBE_GAP,
    WEAKNESS_GAIN,
    NEW_KEY_GRACE_SAMPLES,
    emptyProgress,
    normalize,
    unlockedNames,
    recordChord,
    recordWord,
    recordProbe,
    windowStats,
    scoreFor,
    keyAccuracy,
    canUnlock,
    wpmTarget,
    WPM_TARGET,
    confidence,
    keyWeakness,
    masteryTier,
    scaffoldTier,
    scaffoldVisible,
    complexityScore,
    complexityBand,
    kinematicGap,
    unlockIfReady,
    recordLesson,
    focusKey,
    unlockedMask,
    usableVariants,
    displayVariants,
    pickWords,
    nextWord,
    startLesson,
    isRewind,
  };
});
