/**
 * Anti-pattern answer-curve engine
 * ────────────────────────────────
 * Produces a sequence of correct-answer slots (A/B/C/D) that is:
 *  - overall balanced (~equal counts)
 *  - free of long same-letter streaks
 *  - free of two-letter monopolies / ABAB rhythms
 *  - unpredictable across windows of the quiz
 *
 * Used by:
 *  - rebuild-questions.mjs (offline bank generation)
 *  - can be mirrored in app.js (browser runtime)
 */

const LETTERS = ["A", "B", "C", "D"];

/** Uniform integer in [0, n) via crypto when available. */
export function randInt(n) {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    // rejection sampling — no modulo bias
    const max = 0x100000000;
    const limit = max - (max % n);
    const buf = new Uint32Array(1);
    let x;
    do {
      crypto.getRandomValues(buf);
      x = buf[0];
    } while (x >= limit);
    return x % n;
  }
  return Math.floor(Math.random() * n);
}

export function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

/**
 * Score a letter curve — lower is better (0 = ideal).
 * Focused on what players can actually exploit:
 *  - same-letter streaks
 *  - B/C-only or A/D-only blocks
 *  - ABAB rhythms
 *  - first/mid/last decade monopolies
 */
export function scoreCurve(curve) {
  let s = 0;
  const n = curve.length;

  // Same-letter streaks (max comfortable run: 2)
  let run = 1;
  for (let i = 1; i < n; i++) {
    if (curve[i] === curve[i - 1]) {
      run++;
      if (run >= 3) s += 100 * (run - 1);
    } else {
      run = 1;
    }
  }

  // Rolling windows of 6: at least 3 distinct; forbid 2-letter monopolies
  for (let i = 0; i <= n - 6; i++) {
    const win = curve.slice(i, i + 6);
    const d = new Set(win).size;
    if (d <= 2) s += 120;
    else if (d === 3) s += 4;
  }

  // Windows of 10: all 4 letters should appear; no pair should own ≥7
  for (let i = 0; i <= n - 10; i++) {
    const win = curve.slice(i, i + 10);
    const counts = { A: 0, B: 0, C: 0, D: 0 };
    for (const L of win) counts[L]++;
    const vals = Object.values(counts);
    if (Math.min(...vals) === 0) s += 40;
    // pair monopolies: B+C or A+D or any two
    const pairs = [
      counts.A + counts.B,
      counts.A + counts.C,
      counts.A + counts.D,
      counts.B + counts.C,
      counts.B + counts.D,
      counts.C + counts.D,
    ];
    if (Math.max(...pairs) >= 8) s += 90;
    else if (Math.max(...pairs) >= 7) s += 35;
  }

  // ABABAB / CDCDCD alternating for 6+
  for (let i = 0; i <= n - 6; i++) {
    const a = curve[i];
    const b = curve[i + 1];
    if (
      a !== b &&
      curve[i + 2] === a &&
      curve[i + 3] === b &&
      curve[i + 4] === a &&
      curve[i + 5] === b
    ) {
      s += 80;
    }
  }

  // Explicit first-10 / last-10 balance (the complaint zone)
  for (const seg of [curve.slice(0, Math.min(10, n)), curve.slice(Math.max(0, n - 10))]) {
    if (seg.length < 8) continue;
    const counts = { A: 0, B: 0, C: 0, D: 0 };
    for (const L of seg) counts[L]++;
    const vals = Object.values(counts);
    if (Math.min(...vals) === 0) s += 55;
    if (counts.B + counts.C >= 7) s += 70;
    if (counts.A + counts.D >= 7) s += 70;
    if (Math.max(...vals) >= 5) s += 40;
  }

  // Global balance
  const g = { A: 0, B: 0, C: 0, D: 0 };
  for (const L of curve) g[L]++;
  const gv = Object.values(g);
  if (Math.max(...gv) - Math.min(...gv) > 1) s += 30;

  return s;
}

function hardRepairStreaks(pool) {
  const n = pool.length;
  for (let pass = 0; pass < 50; pass++) {
    let changed = false;
    for (let i = 2; i < n; i++) {
      if (pool[i] !== pool[i - 1] || pool[i] !== pool[i - 2]) continue;
      for (let j = 0; j < n; j++) {
        if (Math.abs(j - i) < 2 || pool[j] === pool[i]) continue;
        const a = pool[i];
        const b = pool[j];
        pool[i] = b;
        pool[j] = a;
        const streakAt = (idx) => {
          let left = 0;
          let right = 0;
          while (idx - 1 - left >= 0 && pool[idx - 1 - left] === pool[idx]) left++;
          while (idx + 1 + right < n && pool[idx + 1 + right] === pool[idx]) right++;
          return 1 + left + right;
        };
        if (streakAt(i) < 3 && streakAt(j) < 3) {
          changed = true;
          break;
        }
        pool[i] = a;
        pool[j] = b;
      }
    }
    if (!changed) break;
  }
  return pool;
}

/**
 * Build balanced multiset, multi-restart hill-climb until score is low.
 */
export function buildAnswerCurve(n, opts = {}) {
  const restarts = opts.restarts || 12;
  const stepsPerRestart = opts.stepsPerRestart || 1200;
  const targetScore = opts.targetScore ?? 0;

  let globalBest = null;
  let globalBestScore = Infinity;

  for (let r = 0; r < restarts; r++) {
    const base = Math.floor(n / 4);
    const rem = n % 4;
    const extras = new Set(shuffleArray(LETTERS).slice(0, rem));
    let pool = [];
    for (const L of LETTERS) {
      const c = base + (extras.has(L) ? 1 : 0);
      for (let i = 0; i < c; i++) pool.push(L);
    }
    for (let k = 0; k < 10; k++) pool = shuffleArray(pool);
    pool = hardRepairStreaks(pool);

    let best = pool.slice();
    let bestScore = scoreCurve(best);
    let current = pool.slice();
    let currentScore = bestScore;

    for (let step = 0; step < stepsPerRestart; step++) {
      const i = randInt(n);
      let j = randInt(n);
      if (i === j) continue;
      const tmp = current[i];
      current[i] = current[j];
      current[j] = tmp;
      const sc = scoreCurve(current);
      const temperature = 1 - step / stepsPerRestart;
      const accept =
        sc <= currentScore ||
        (temperature > 0.15 && randInt(1000) < temperature * 180);
      if (accept) {
        currentScore = sc;
        if (sc < bestScore) {
          bestScore = sc;
          best = current.slice();
          if (bestScore <= targetScore) break;
        }
      } else {
        current[j] = current[i];
        current[i] = tmp;
      }
    }

    best = hardRepairStreaks(best);
    bestScore = scoreCurve(best);
    if (bestScore < globalBestScore) {
      globalBestScore = bestScore;
      globalBest = best;
      if (globalBestScore <= targetScore) break;
    }
  }

  return { curve: globalBest, score: globalBestScore };
}

/**
 * Place correct text at `correctSlot`, shuffle wrongs into remaining slots.
 * `q` must have options {A,B,C,D} and correct key.
 */
export function layoutQuestion(q, correctSlot) {
  const correctText = q.options[q.correct];
  const wrongs = shuffleArray(
    LETTERS.filter((k) => k !== q.correct).map((k) => q.options[k])
  );
  const options = {};
  let wi = 0;
  for (const k of LETTERS) {
    if (k === correctSlot) options[k] = correctText;
    else options[k] = wrongs[wi++];
  }
  return {
    id: q.id,
    topic: q.topic,
    question: q.question,
    explanation: q.explanation,
    options,
    correct: correctSlot,
  };
}

/**
 * Full session layout: random question order + anti-pattern correct curve.
 */
export function buildSessionLayouts(questions) {
  const n = questions.length;
  const order = shuffleArray([...Array(n).keys()]);
  const { curve, score } = buildAnswerCurve(n);
  const layouts = {};
  order.forEach((qIndex, pos) => {
    const q = questions[qIndex];
    layouts[String(q.id)] = layoutQuestion(q, curve[pos]);
  });
  return { questionOrder: order, layouts, curve, score };
}

export { LETTERS };
