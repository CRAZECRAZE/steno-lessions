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
  // Keys under this recent accuracy get a reserved share of words that contain them, so a key
  // stuck below KEY_ACCURACY_TARGET still gets the reps it needs to climb out.
  const DRILL_ACCURACY = 0.88;
  const DRILL_SHARE = 0.5;
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
  // How hard word weighting leans toward a chord's single weakest unlocked key: at weakness 1
  // (fully unknown/inaccurate) a word's weight multiplies by (1 + WEAKNESS_GAIN); at weakness 0
  // it's untouched. Squared in `weaknessBoost` so the curve favors genuinely extreme weakness
  // much more than merely moderate weakness, instead of scaling linearly with it. Tuned
  // (empirically, against real play data) so a key sitting around 60% accuracy while
  // everything else is 85%+ lands in roughly the 50% range of words it's eligible for.
  const WEAKNESS_GAIN = 150;
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
  // Per prestige level. 1: any visual aid (keyboard diagram or key hints) may be on.
  // 2: no diagram or hints, but a stroke helper (stroke labels or target highlight) may be on.
  // 3: every helper off, typing from the word alone.
  const LEVEL_WPM = { 1: 28, 2: 38, 3: 50 };
  const MAX_LEVEL = 3;
  function wpmTarget(level = 1) {
    return LEVEL_WPM[level] || LEVEL_WPM[1];
  }

  // The prestige level the current settings put you on. `scaffolds` is progress.scaffolds.
  function levelFor(scaffolds, hintsOn) {
    if (scaffolds.keyboard || hintsOn) return 1;
    if (scaffolds.labels || scaffolds.target) return 2;
    return 3;
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
    return {
      unlocked: START_KEYS,
      keys: {},
      words: [],
      lessonHistory: [],
      totalTyped: 0,
      // Prestige levels finished (level -> true), shared across levels like totalTyped.
      completed: {},
      scaffolds: defaultScaffolds(),
      scaffoldMarks: {},
      level: 1,
      // The saved progress of every level you are not on right now (level -> the fields in
      // LEVEL_FIELDS), so going up a level starts fresh and coming back restores it.
      stash: {},
    };
  }

  // The per-level fields of a progress object. Everything else (scaffold checkboxes,
  // totalTyped) is shared across levels.
  const LEVEL_FIELDS = ['unlocked', 'keys', 'words', 'lessonHistory', 'scaffoldMarks'];

  function pickLevelFields(progress) {
    const slice = {};
    for (const field of LEVEL_FIELDS) slice[field] = progress[field];
    return slice;
  }

  // One row per prestige level for the HUD: its wpm bar, how many keys you have unlocked on
  // it, whether you are on it now, and whether every key is unlocked there ("done").
  function levelSummary(progress) {
    const rows = [];
    for (let level = 1; level <= MAX_LEVEL; level++) {
      const active = level === progress.level;
      const slice = active ? progress : progress.stash[level];
      const unlocked = slice ? slice.unlocked : START_KEYS;
      const started = active || Boolean(slice && (slice.unlocked > START_KEYS || Object.keys(slice.keys).length > 0));
      rows.push({
        level,
        wpm: LEVEL_WPM[level],
        unlocked,
        total: KEY_ORDER.length,
        active,
        started,
        allUnlocked: unlocked >= KEY_ORDER.length,
        done: Boolean(progress.completed[level]),
      });
    }
    return rows;
  }

  // Moves to prestige `level`: the current level's progress is set aside and the target
  // level's is loaded (a brand new start if it has none yet). Returns true if it changed.
  function switchLevel(progress, level) {
    if (!LEVEL_WPM[level] || progress.level === level) return false;
    progress.stash[progress.level] = pickLevelFields(progress);
    const next = progress.stash[level] || pickLevelFields(emptyProgress());
    delete progress.stash[level];
    Object.assign(progress, next);
    progress.level = level;
    return true;
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
    if (saved.scaffoldMarks && typeof saved.scaffoldMarks === 'object') {
      for (const stage of Object.keys(saved.scaffoldMarks)) {
        const mark = saved.scaffoldMarks[stage];
        if (!mark || typeof mark !== 'object') continue;
        const cleaned = {};
        for (const name of KEY_ORDER) {
          const entry = mark[name];
          if (!entry || typeof entry !== 'object') continue;
          cleaned[name] = { samples: Math.max(0, Number(entry.samples) || 0), misses: Math.max(0, Number(entry.misses) || 0) };
        }
        progress.scaffoldMarks[stage] = cleaned;
      }
    }
    if (Number.isFinite(saved.totalTyped)) {
      progress.totalTyped = Math.max(0, Math.floor(saved.totalTyped));
    }
    if (saved.completed && typeof saved.completed === 'object') {
      for (const level of Object.keys(LEVEL_WPM)) {
        if (saved.completed[level] === true) progress.completed[level] = true;
      }
    }
    if (Number.isInteger(saved.level) && LEVEL_WPM[saved.level]) progress.level = saved.level;
    if (saved.stash && typeof saved.stash === 'object') {
      for (const level of Object.keys(LEVEL_WPM)) {
        const entry = saved.stash[level];
        if (Number(level) === progress.level || !entry || typeof entry !== 'object') continue;
        progress.stash[level] = pickLevelFields(normalize(entry));
      }
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
  function meetsTargets(progress) {
    const stats = windowStats(progress);
    return stats.count >= LESSON_SIZE
      && stats.wpm >= wpmTarget(progress.level)
      && stats.accuracy >= ACCURACY_TARGET
      && keysAccurateEnough(progress);
  }

  function canUnlock(progress) {
    return progress.unlocked < KEY_ORDER.length && meetsTargets(progress);
  }

  // A prestige level is complete only once every key is unlocked AND a fresh lesson (the
  // window restarts when the last key unlocks) clears the same speed and accuracy bars as an
  // unlock. Merely unlocking the last key does not count. Once earned it stays earned.
  function completeIfReady(progress) {
    if (progress.completed[progress.level]) return false;
    if (progress.unlocked < KEY_ORDER.length || !meetsTargets(progress)) return false;
    progress.completed[progress.level] = true;
    return true;
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

  // Whether a scaffold should be shown: exactly its checkbox. Unchecking hides it right away;
  // there is no waiting on mastery. (`progress` and `stage` stay in the signature for callers.)
  function scaffoldVisible(progress, stage, override) {
    return Boolean(override);
  }

  // Snapshots every unlocked key's current samples/misses as the redo baseline for `stage`.
  // Called the moment a scaffold checkbox goes from checked to unchecked, so
  // `scaffoldRedoMastered` below has a clean "zero" to measure fresh practice from - without
  // this, unchecking a box after already mastering everything would satisfy a scaffold-off
  // badge instantly, with no actual redo. A key with no entry yet (unlocked after this mark is
  // taken) is treated as a 0 baseline wherever it's read, so it needs no entry of its own.
  function recordScaffoldOff(progress, stage) {
    progress.scaffoldMarks = progress.scaffoldMarks || {};
    const marks = {};
    for (const name of unlockedNames(progress)) {
      const stat = progress.keys[name];
      marks[name] = { samples: stat ? stat.samples : 0, misses: stat ? stat.misses : 0 };
    }
    progress.scaffoldMarks[stage] = marks;
  }

  // Only for a save from before scaffold-redo badges existed: if `stage` is already off with
  // no mark on record, treat right now as the baseline rather than letting old mastery earned
  // before this feature shipped count as an instant, unearned redo. A no-op once a mark exists.
  function ensureScaffoldMark(progress, stage) {
    if (progress.scaffoldMarks && progress.scaffoldMarks[stage]) return;
    recordScaffoldOff(progress, stage);
  }

  // Whether every unlocked key has been mastered (tier 2) using only practice recorded since
  // `stage` last went off - not just mastered right now while it happens to be off. A key needs
  // `SAMPLES_TO_LEARN` fresh correct reps (confidence's own "enough practice" bar) and
  // `KEY_ACCURACY_WINDOW` fresh attempts (enough to have fully displaced its pre-mark accuracy
  // window) since the mark, on top of currently reading as tier 2.
  function scaffoldRedoMastered(progress, stage) {
    const names = unlockedNames(progress);
    // No mark at all (as opposed to one with a missing entry for some key - see below) means
    // this stage was never actually recorded as going off, so there is no redo to measure -
    // without this, an un-marked stage would read as "baseline zero" and pass instantly off
    // of mastery earned long before it ever went off.
    if (names.length === 0 || !progress.scaffoldMarks || !progress.scaffoldMarks[stage]) return false;
    const marks = progress.scaffoldMarks[stage];
    return names.every((name) => {
      if (masteryTier(progress, name) < 2) return false;
      const stat = progress.keys[name];
      if (!stat) return false;
      const mark = marks[name] || { samples: 0, misses: 0 };
      const freshSamples = stat.samples - mark.samples;
      const freshAttempts = stat.samples + stat.misses - (mark.samples + mark.misses);
      return freshSamples >= SAMPLES_TO_LEARN && freshAttempts >= KEY_ACCURACY_WINDOW;
    });
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

  // 0 (fully accurate) to 1 (always wrong): how much a key's own weakness should pull word
  // selection toward it. Deliberately the *raw* accuracy deficit, not `confidence` - confidence
  // normalizes accuracy against KEY_ACCURACY_TARGET (0.8) and multiplies in a speed term that
  // saturates to 1 almost immediately, which together compress a real, meaningful accuracy
  // problem (e.g. 60% when everything else is 85%+) down to a barely-there signal. Word
  // selection should react to the actual error rate, not that squashed mastery metric. A key
  // still inside its new-key grace period (never attempted, or under NEW_KEY_GRACE_SAMPLES
  // correct reps so far) reads as maximally weak outright, rather than trusting an early
  // accuracy reading from too few attempts.
  function keyWeakness(progress, name) {
    const stat = progress.keys[name];
    if (!stat || stat.samples < NEW_KEY_GRACE_SAMPLES) return 1;
    return 1 - keyAccuracy(progress, name);
  }

  // How much a word's weight should scale up for its single weakest unlocked key - the worst
  // key present in the stroke, not a product over every key it uses. A chord that happens to
  // fire several keys at once (many steno briefs do: SKWR, TPH, AO...) must not get a bigger
  // boost just for using more keys - every real key has *some* nonzero weakness most of the
  // time, so multiplying a per-key factor across a 4-5 key chord compounds into a huge,
  // meaningless boost that has nothing to do with any of those keys actually being weak. Using
  // the max keeps the boost keyed to how bad the worst key in the chord is, independent of how
  // many keys it has.
  function weaknessBoost(progress, bits, slotIndex) {
    let maxWeak = 0;
    for (const name of unlockedNames(progress)) {
      if (!(bits & (1 << slotIndex.get(name)))) continue;
      maxWeak = Math.max(maxWeak, keyWeakness(progress, name));
    }
    return 1 + WEAKNESS_GAIN * maxWeak * maxWeak;
  }

  // Precomputed bit -> keyWeakness for every unlocked key, built once per pickWords call
  // rather than once per candidate word. keyWeakness is the same for a given key across every
  // word in the call, so recomputing it (and the keyAccuracy scan behind it) per word turns a
  // single pass over the dictionary into a pass that's quadratic in the unlocked key count -
  // noticeable once a lesson has unlocked more than a handful of keys.
  function weaknessByBit(progress, slotIndex) {
    const byBit = new Map();
    for (const name of unlockedNames(progress)) {
      byBit.set(1 << slotIndex.get(name), keyWeakness(progress, name));
    }
    return byBit;
  }

  // Same result as `weaknessBoost`, from the precomputed map above, and only walking the bits
  // actually set in this word's chord rather than every unlocked key.
  function weaknessBoostFromMap(byBit, bits) {
    let maxWeak = 0;
    for (let rest = bits; rest; rest &= rest - 1) {
      const weak = byBit.get(rest & -rest);
      if (weak !== undefined && weak > maxWeak) maxWeak = weak;
    }
    return 1 + WEAKNESS_GAIN * maxWeak * maxWeak;
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
      if (usable.length === 0) continue;
      if (options.requireMask && !usable.some((variant) => variant.some((b) => b & options.requireMask))) continue;
      eligible.push({ word, usable });
    }
    if (eligible.length === 0) return [];

    const pool = eligible.filter(({ word }) => !avoid.has(word.text));
    const source = pool.length >= count ? pool : eligible;
    const byBit = weaknessByBit(progress, slotIndex);
    const weighted = source.map(({ word, usable }) => {
      // Plover's dictionary has no word frequencies, so combine a real frequency list with
      // the length/stroke heuristics: medium length, one stroke, and actually common words win.
      let weight = lengthWeight(word.text.length) * strokeWeight(usable[0].length) * WordFreq.freqWeight(word.text);
      const bits = usable[0].reduce((combined, strokeBits) => combined | strokeBits, 0);
      weight *= weaknessBoostFromMap(byBit, bits);
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

  // The live complexity band ('etude'/'study'/'concerto') plus the pickWords options that
  // enforce it, shared by `nextWord` and `nextWords` so a batch call picks the band once
  // instead of re-deriving the identical answer (it's a pure function of `progress`, which
  // neither picker mutates) on every word in the batch.
  function bandPickOptions(progress, slotIndex, options) {
    const focus = focusKey(progress);
    const gap = focus ? kinematicGap(progress, focus) : null;
    const deficit = gap !== null && gap <= HEALTHY_PROBE_GAP;
    const band = options.forceBand || (deficit ? 'etude' : complexityBand(complexityScore(progress)));
    const pickOptions = { ...options };
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
    return { band, focus, pickOptions };
  }

  // Bitmask of unlocked keys whose recent accuracy sits under DRILL_ACCURACY. Rare keys (-Z, #,
  // -D) show up in few words, so left to the weighted pick alone they never get enough reps to
  // lift their accuracy past the unlock bar; this mask feeds a reserved share of drill words.
  function weakMask(progress, slotIndex) {
    let mask = 0;
    for (const name of unlockedNames(progress)) {
      const stat = progress.keys[name];
      if (stat && stat.recent.length >= KEY_ACCURACY_MIN_SAMPLES && keyAccuracy(progress, name) < DRILL_ACCURACY) {
        mask |= 1 << slotIndex.get(name);
      }
    }
    return mask;
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
    const { band, focus, pickOptions } = bandPickOptions(progress, slotIndex, options);
    let picked;
    const drill = options.forceBand ? 0 : weakMask(progress, slotIndex);
    if (drill && (options.random || Math.random)() < DRILL_SHARE) {
      picked = pickWords(words, progress, slotIndex, { ...options, requireMask: drill, count: 1 })[0];
    }
    if (!picked) picked = pickWords(words, progress, slotIndex, { ...pickOptions, count: 1 })[0];
    // An etude restriction (or any band option) can legitimately leave nothing eligible early
    // on, when few keys are mastered yet - fall back to a plain pick rather than return nothing.
    if (!picked) picked = pickWords(words, progress, slotIndex, { ...options, count: 1 })[0];
    if (!picked) return null;
    return { ...picked, band, isProbe: Boolean(options.isProbe), focusKeyAtPick: focus };
  }

  // `count` words for the live band in one pass, for a caller that needs several at once (the
  // decorative ghost strip) and would otherwise call `nextWord` in a loop - which looks
  // harmless but reruns the exact same whole-dictionary scan, with the exact same band and
  // `avoid` set, once per word instead of once total, since nothing any of those calls read
  // (the band, the mask, `progress` itself) changes between them.
  function nextWords(words, progress, slotIndex, count, options = {}) {
    const { band, focus, pickOptions } = bandPickOptions(progress, slotIndex, options);
    const drill = options.forceBand ? 0 : weakMask(progress, slotIndex);
    const drillCount = drill ? Math.round(count * DRILL_SHARE) : 0;
    const picked = drillCount
      ? pickWords(words, progress, slotIndex, { ...options, requireMask: drill, count: drillCount })
      : [];
    const normal = pickWords(words, progress, slotIndex, {
      ...pickOptions,
      avoid: [...(options.avoid || []), ...picked.map((word) => word.text)],
      count: count - picked.length,
    });
    picked.push(...normal);
    // Same fallback as `nextWord`, applied to whatever's still missing after the band-
    // restricted pass, rather than one plain pick per missing word.
    if (picked.length < count) {
      const avoid = [...(options.avoid || []), ...picked.map((word) => word.text)];
      const rest = pickWords(words, progress, slotIndex, { ...options, avoid, count: count - picked.length });
      picked.push(...rest);
    }
    return picked.map((word) => ({ ...word, band, isProbe: Boolean(options.isProbe), focusKeyAtPick: focus }));
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
    confidence,
    keyWeakness,
    weaknessBoost,
    masteryTier,
    scaffoldTier,
    scaffoldVisible,
    recordScaffoldOff,
    ensureScaffoldMark,
    scaffoldRedoMastered,
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
    nextWords,
    startLesson,
    isRewind,
    LEVEL_WPM,
    MAX_LEVEL,
    levelFor,
    levelSummary,
    completeIfReady,
    switchLevel,
  };
});
