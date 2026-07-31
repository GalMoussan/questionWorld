/* ═══════════════════════════════════════════════════════════
   Quiz Master — App Logic (multi-quiz)
   ═══════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  // v5: force fresh sessions so anti-pattern option layouts always apply
  // (v4 resumes could show bank letters if layouts were missing/stale)
  const STORAGE_PREFIX = "psychQuizMaster_v5_";
  const LEGACY_KEYS = [
    "psychQuizMaster_v1",
    "psychQuizMaster_v2",
    "psychQuizMaster_v3",
    "psychQuizMaster_v4_", // prefix cleaned in clearProgress via catalog keys too
  ];
  const TOTAL = () => state.questions.length;
  const OPTION_KEYS = ["A", "B", "C", "D"];

  /**
   * Available quizzes.
   * enabled:false hides from landing (keeps bank loadable for later).
   * hasSheet + sheet: multi-doc or single-sheet highlight support.
   */
  const QUIZ_CATALOG = {
    psychology: {
      id: "psychology",
      title: "Psychology",
      shortLabel: "Psychology",
      enabled: false,
      questions:
        typeof QUIZ_QUESTIONS !== "undefined" ? QUIZ_QUESTIONS : [],
      hasSheet: true,
      sheet: {
        kind: "single",
        pdf: "assets/remembrance-sheet.pdf",
        highlightsUrl: "assets/sheet/highlights.json",
        pageFile: (page) => `assets/sheet/page-${page}.png`,
      },
      exportName: "study-plan-psychology.md",
    },
    shesaim: {
      id: "shesaim",
      title: "SHESAIM",
      shortLabel: "SHESAIM · שסעים",
      enabled: false,
      questions:
        typeof SHESAIM_QUESTIONS !== "undefined" ? SHESAIM_QUESTIONS : [],
      hasSheet: false,
      exportName: "study-plan-shesaim.md",
    },
    logicb: {
      id: "logicb",
      title: "לוגיקה ב - פול פאוור",
      shortLabel: "לוגיקה ב · פול פאוור",
      enabled: true,
      questions:
        typeof LOGICB_QUESTIONS !== "undefined" ? LOGICB_QUESTIONS : [],
      hasSheet: true,
      sheet: {
        kind: "multi-doc",
        /** doc number → PDF path */
        pdfForDoc: (doc) => `assets/logic-b/tamsir-${doc}.pdf`,
        highlightsUrl: "assets/logic-b/sheet/highlights.json",
        pageFile: (doc, page) => `assets/logic-b/sheet/t${doc}-p${page}.png`,
        docLabel: (doc) => `תמסיר ${doc}`,
      },
      exportName: "study-plan-logicb.md",
    },
    sociology: {
      id: "sociology",
      title: "מבוא לסוציולוגיה של החינוך",
      shortLabel: "סוציולוגיה של החינוך",
      enabled: true,
      questions:
        typeof SOCIOLOGY_QUESTIONS !== "undefined" ? SOCIOLOGY_QUESTIONS : [],
      hasSheet: false,
      exportName: "study-plan-sociology.md",
    },
  };

  function enabledQuizzes() {
    return Object.values(QUIZ_CATALOG).filter((q) => q.enabled !== false);
  }

  function storageKey(quizId) {
    return STORAGE_PREFIX + (quizId || state.quizId || "psychology");
  }

  function activeQuizMeta() {
    if (state.quizId && QUIZ_CATALOG[state.quizId]) {
      return QUIZ_CATALOG[state.quizId];
    }
    return enabledQuizzes()[0] || QUIZ_CATALOG.logicb;
  }

  // ── State ──────────────────────────────────────────────
  const state = {
    screen: "landing",
    quizId: null, // set when user picks a quiz
    index: 0,
    score: 0, // first-try correct count
    streak: 0,
    maxStreak: 0,
    soundOn: true,
    startedAt: null,
    questionStartedAt: null,
    lockedBlocks: 0,
    answers: [], // per-question analytics
    questions: (QUIZ_CATALOG.logicb && QUIZ_CATALOG.logicb.questions) || [],
    /** indices into questions[] in play order (shuffled each new quiz) */
    questionOrder: [],
    /**
     * Per-question display layout for this session:
     * { "12": { options: {A,B,C,D}, correct: "C" } }
     */
    layouts: {},
    /** debug/analytics: correct-letter curve for this session */
    answerCurve: [],
    /** Player display name for scoreboard (set before new run) */
    playerName: "",
    /** Pending quiz id while name modal is open */
    pendingQuizId: null,
    /** Prevent double-writing the same finished run to scoreboard */
    scoreboardLogged: false,
  };

  // ── Scoreboard (local to this browser / device) ────────
  const SCOREBOARD_KEY = "quizScoreboard_v1";
  const SCORE_TIERS = [
    { min: 0,  max: 39, label: "Need practice", tier: 0 },
    { min: 40, max: 59, label: "Good", tier: 1 },
    { min: 60, max: 74, label: "Better than usual", tier: 2 },
    { min: 75, max: 89, label: "Incredible", tier: 3 },
    { min: 90, max: 100, label: "WTF - born for this", tier: 4 },
  ];

  function scoreLabelFromMastery(pct) {
    const p = Math.max(0, Math.min(100, Math.round(pct)));
    for (const t of SCORE_TIERS) {
      if (p >= t.min && p <= t.max) return t;
    }
    return SCORE_TIERS[0];
  }

  function loadScoreboard() {
    try {
      const raw = localStorage.getItem(SCOREBOARD_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }

  function saveScoreboard(entries) {
    try {
      localStorage.setItem(SCOREBOARD_KEY, JSON.stringify(entries.slice(0, 200)));
    } catch (_) { /* ignore quota */ }
  }

  function addScoreboardEntry(entry) {
    const list = loadScoreboard();
    list.push(entry);
    // Rank: higher tier first, then mastery, then first-try ratio, then newest
    list.sort((a, b) => {
      if ((b.tier ?? 0) !== (a.tier ?? 0)) return (b.tier ?? 0) - (a.tier ?? 0);
      if ((b.mastery ?? 0) !== (a.mastery ?? 0)) return (b.mastery ?? 0) - (a.mastery ?? 0);
      const ar = (a.total || 1) ? (a.firstTry || 0) / (a.total || 1) : 0;
      const br = (b.total || 1) ? (b.firstTry || 0) / (b.total || 1) : 0;
      if (br !== ar) return br - ar;
      return (b.at || 0) - (a.at || 0);
    });
    saveScoreboard(list);
    return list;
  }

  // ── DOM ────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const els = {
    landing: $("#screen-landing"),
    question: $("#screen-question"),
    explain: $("#screen-explain"),
    results: $("#screen-results"),
    quizPsychBtn: $("#btn-quiz-psychology"),
    quizShesaimBtn: $("#btn-quiz-shesaim"),
    quizLogicbBtn: $("#btn-quiz-logicb"),
    resumeBtn: $("#btn-resume"),
    soundBtn: $("#btn-sound"),
    scoreboardBtn: $("#btn-scoreboard"),
    resetBtn: $("#btn-reset"),
    nameModal: $("#name-modal"),
    playerNameInput: $("#player-name-input"),
    nameModalError: $("#name-modal-error"),
    btnNameStart: $("#btn-name-start"),
    btnNameCancel: $("#btn-name-cancel"),
    scoreboardModal: $("#scoreboard-modal"),
    scoreboardList: $("#scoreboard-list"),
    scoreboardEmpty: $("#scoreboard-empty"),
    btnScoreboardClose: $("#btn-scoreboard-close"),
    btnScoreboardDone: $("#btn-scoreboard-done"),
    btnScoreboardClear: $("#btn-scoreboard-clear"),
    resultsScoreBadge: $("#results-score-badge"),
    resultsScoreName: $("#results-score-name"),
    resultsScoreLabel: $("#results-score-label"),
    qCount: $("#q-count"),
    scoreCircle: $("#score-circle"),
    progressFill: $("#progress-fill"),
    topicBadge: $("#topic-badge"),
    questionText: $("#question-text"),
    answers: $("#answers"),
    focusFill: $("#focus-fill"),
    focusStreak: $("#focus-streak"),
    tryAgain: $("#try-again-toast"),
    screenFlash: $("#screen-flash"),
    correctBanner: $("#correct-banner"),
    explainText: $("#explain-text"),
    sheetRef: $("#sheet-ref"),
    sheetRefTitle: $("#sheet-ref-title"),
    sheetRefHint: $("#sheet-ref-hint"),
    sheetRefLink: $("#sheet-ref-link"),
    sheetViewer: $("#sheet-viewer"),
    sheetViewport: $("#sheet-viewport"),
    sheetPageCanvas: $("#sheet-page-canvas"),
    sheetCropWrap: $("#sheet-crop-wrap"),
    sheetCropCanvas: $("#sheet-crop-canvas"),
    btnSheetExpand: $("#btn-sheet-expand"),
    btnSheetOpenHl: $("#btn-sheet-open-hl"),
    sheetLightbox: $("#sheet-lightbox"),
    sheetLightboxInner: $("#sheet-lightbox-inner"),
    btnSheetClose: $("#btn-sheet-close"),
    btnGotIt: $("#btn-got-it"),
    btnConfused: $("#btn-confused"),
    confetti: $("#confetti-canvas"),
    starfield: $("#starfield"),
    kBlocks: $("#knowledge-blocks"),
  };

  /** @type {{ pages?: object, highlights?: Record<string, object>, docs?: object } | null} */
  let sheetHighlights = null;
  /** Cache key so switching quizzes reloads the right highlights.json */
  let sheetHighlightsKey = null;
  let sheetHighlightsPromise = null;
  let currentHighlight = null;
  /** @type {HTMLImageElement | null} */
  let currentSheetImg = null;

  // ── Screens ────────────────────────────────────────────
  function showScreen(name) {
    state.screen = name;
    ["landing", "question", "explain", "results"].forEach((s) => {
      const el = els[s];
      if (!el) return;
      el.classList.toggle("active", s === name);
    });
  }

  // ── LocalStorage ───────────────────────────────────────
  function saveProgress() {
    if (!state.quizId) return;
    try {
      const payload = {
        quizId: state.quizId,
        index: state.index,
        score: state.score,
        streak: state.streak,
        maxStreak: state.maxStreak,
        soundOn: state.soundOn,
        answers: state.answers,
        lockedBlocks: state.lockedBlocks,
        startedAt: state.startedAt,
        questionOrder: state.questionOrder,
        layouts: state.layouts,
        answerCurve: state.answerCurve,
        playerName: state.playerName || "",
        scoreboardLogged: !!state.scoreboardLogged,
        savedAt: Date.now(),
      };
      localStorage.setItem(storageKey(state.quizId), JSON.stringify(payload));
    } catch (_) { /* ignore */ }
  }

  function loadProgress(quizId) {
    try {
      const raw = localStorage.getItem(storageKey(quizId || state.quizId));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function clearProgress(quizId) {
    try {
      if (quizId) {
        localStorage.removeItem(storageKey(quizId));
      } else if (state.quizId) {
        localStorage.removeItem(storageKey(state.quizId));
      } else {
        Object.keys(QUIZ_CATALOG).forEach((id) => {
          localStorage.removeItem(storageKey(id));
        });
      }
      // Drop exact legacy keys + any psychQuizMaster_v* prefixes (old sessions)
      LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith("psychQuizMaster_v") && !k.startsWith(STORAGE_PREFIX)) {
          localStorage.removeItem(k);
        }
      }
    } catch (_) {}
  }

  function isResumablePayload(p, quizId) {
    if (!p || !Array.isArray(p.answers) || !p.answers.length) return false;
    const bank = QUIZ_CATALOG[quizId || p.quizId];
    if (!bank) return false;
    const total = bank.questions.length;
    if (typeof p.index !== "number" || p.index >= total) return false;
    // Require a full anti-pattern layout map — never resume bare bank letters
    if (!p.layouts || typeof p.layouts !== "object") return false;
    if (!Array.isArray(p.questionOrder) || p.questionOrder.length !== total) return false;
    const layoutCount = Object.keys(p.layouts).length;
    if (layoutCount < total) return false;
    // Sanity: layouts must include all four correct-letter slots somewhere
    const letters = new Set();
    for (const L of Object.values(p.layouts)) {
      if (L && L.correct) letters.add(L.correct);
    }
    if (letters.size < 3) return false; // short quizzes may miss one letter
    return true;
  }

  function findResumableQuiz() {
    // Prefer most recently saved *enabled* quiz with progress
    let best = null;
    for (const id of Object.keys(QUIZ_CATALOG)) {
      if (QUIZ_CATALOG[id].enabled === false) continue;
      const p = loadProgress(id);
      if (!isResumablePayload(p, id)) continue;
      if (!best || (p.savedAt || 0) > (best.savedAt || 0)) {
        best = { quizId: id, ...p };
      }
    }
    return best;
  }

  function hasResumableProgress() {
    return !!findResumableQuiz();
  }

  function selectQuiz(quizId) {
    const meta = QUIZ_CATALOG[quizId];
    if (!meta || !meta.questions.length) {
      console.error("[QuizMaster] unknown or empty quiz:", quizId);
      return false;
    }
    state.quizId = quizId;
    state.questions = meta.questions;
    return true;
  }

  // ── Sound (Web Audio, no assets) ───────────────────────
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function tone(freq, dur, type = "sine", gain = 0.08, when = 0) {
    if (!state.soundOn) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function playCorrect() {
    tone(523.25, 0.12, "sine", 0.09, 0);
    tone(659.25, 0.14, "sine", 0.08, 0.08);
    tone(783.99, 0.22, "triangle", 0.07, 0.16);
  }

  function playWrong() {
    tone(180, 0.18, "sawtooth", 0.04, 0);
    tone(140, 0.22, "sine", 0.05, 0.05);
  }

  function playCelebrate() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, "triangle", 0.07, i * 0.07));
  }

  function playClick() {
    tone(880, 0.05, "sine", 0.04, 0);
  }

  // ── Starfield ──────────────────────────────────────────
  function initStarfield() {
    const canvas = els.starfield;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let w, h, stars, raf;

    function resize() {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
      stars = Array.from({ length: Math.min(180, Math.floor((w * h) / 9000)) }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.6 + 0.3,
        a: Math.random() * 0.6 + 0.2,
        s: Math.random() * 0.25 + 0.05,
        tw: Math.random() * Math.PI * 2,
      }));
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);
      for (const st of stars) {
        st.y += st.s;
        st.tw += 0.02;
        if (st.y > h) { st.y = 0; st.x = Math.random() * w; }
        const alpha = st.a * (0.6 + 0.4 * Math.sin(st.tw));
        ctx.beginPath();
        ctx.fillStyle = `rgba(248,249,250,${alpha})`;
        ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    }

    resize();
    draw();
    window.addEventListener("resize", resize);
  }

  // ── Knowledge blocks ───────────────────────────────────
  const blockNodes = [];

  /** Place a locked mastery block in the left rail (vertical stack). */
  function placeLockedBlock(el, index) {
    el.style.left = "15%";
    el.style.top = (6 + (index % 12) * 7.5) + "%";
    el.style.width = "70%";
    el.style.height = "28px";
    el.classList.add("locked");
  }

  function initKnowledgeBlocks() {
    const host = els.kBlocks;
    if (!host) return;
    host.innerHTML = "";
    blockNodes.length = 0;
    const count = 14;
    for (let i = 0; i < count; i++) {
      const el = document.createElement("div");
      el.className = "k-block";
      // Smaller blocks, confined to left rail percentages (0–100% of #knowledge-blocks width)
      const size = 28 + Math.random() * 36;
      el.style.width = size + "px";
      el.style.height = size * (0.45 + Math.random() * 0.55) + "px";
      el.style.left = (8 + Math.random() * 70) + "%";
      el.style.top = Math.random() * 88 + "%";
      el.dataset.baseX = Math.random() * 12 - 6;
      el.dataset.baseY = Math.random() * 24 - 12;
      el.dataset.speed = 0.15 + Math.random() * 0.25;
      el.dataset.phase = Math.random() * Math.PI * 2;
      host.appendChild(el);
      blockNodes.push(el);
    }
    let t = 0;
    function anim() {
      t += 0.016;
      for (const el of blockNodes) {
        if (el.classList.contains("locked")) continue;
        const sp = parseFloat(el.dataset.speed);
        const ph = parseFloat(el.dataset.phase);
        const bx = parseFloat(el.dataset.baseX);
        const by = parseFloat(el.dataset.baseY);
        const x = Math.sin(t * sp + ph) * bx;
        const y = Math.cos(t * sp * 0.8 + ph) * by;
        el.style.transform = `translate(${x}px, ${y}px)`;
      }
      requestAnimationFrame(anim);
    }
    anim();
  }

  function lockKnowledgeBlock() {
    const free = blockNodes.filter((b) => !b.classList.contains("locked"));
    if (!free.length) return;
    const el = free[Math.floor(Math.random() * free.length)];
    placeLockedBlock(el, state.lockedBlocks);
    state.lockedBlocks++;
  }

  function resetKnowledgeBlocksVisual() {
    blockNodes.forEach((el) => {
      el.classList.remove("locked");
      el.style.width = "";
      el.style.height = "";
      // re-seed small free-float size/position in left rail
      const size = 28 + Math.random() * 36;
      el.style.width = size + "px";
      el.style.height = size * (0.45 + Math.random() * 0.55) + "px";
      el.style.left = (8 + Math.random() * 70) + "%";
      el.style.top = Math.random() * 88 + "%";
    });
  }

  // ── Confetti ───────────────────────────────────────────
  function burstConfetti() {
    const canvas = els.confetti;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const colors = ["#00f0ff", "#c77dff", "#39ff88", "#ffd60a", "#ff006e", "#f8f9fa"];
    const parts = Array.from({ length: 80 }, () => ({
      x: canvas.width / 2 + (Math.random() - 0.5) * 80,
      y: canvas.height * 0.35,
      vx: (Math.random() - 0.5) * 14,
      vy: Math.random() * -12 - 4,
      g: 0.28 + Math.random() * 0.12,
      s: 4 + Math.random() * 6,
      c: colors[Math.floor(Math.random() * colors.length)],
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      life: 1,
    }));

    let frame = 0;
    function tick() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of parts) {
        p.vy += p.g;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        p.life -= 0.012;
        if (p.life <= 0) continue;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
        ctx.restore();
      }
      frame++;
      if (frame < 90) requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    tick();
  }

  function flashScreen() {
    els.screenFlash.classList.add("on");
    setTimeout(() => els.screenFlash.classList.remove("on"), 180);
  }

  function showTryAgain() {
    els.tryAgain.classList.add("show");
    setTimeout(() => els.tryAgain.classList.remove("show"), 900);
  }

  // ── Quiz flow ──────────────────────────────────────────
  function currentQ() {
    const order = state.questionOrder;
    if (order && order.length === state.questions.length) {
      return state.questions[order[state.index]];
    }
    return state.questions[state.index];
  }

  // ═══════════════════════════════════════════════════════
  // Anti-pattern answer-curve engine (10/10 shuffle)
  // ═══════════════════════════════════════════════════════

  /** Uniform int in [0, n) — crypto + rejection sampling (no modulo bias). */
  function randInt(n) {
    if (typeof crypto !== "undefined" && crypto.getRandomValues && n > 0) {
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

  function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  /** Lower score = less patterned / less exploitable. */
  function scoreCurve(curve) {
    let s = 0;
    const n = curve.length;
    let run = 1;
    for (let i = 1; i < n; i++) {
      if (curve[i] === curve[i - 1]) {
        run++;
        if (run >= 3) s += 100 * (run - 1);
      } else run = 1;
    }
    for (let i = 0; i <= n - 6; i++) {
      const win = curve.slice(i, i + 6);
      const d = new Set(win).size;
      if (d <= 2) s += 120;
      else if (d === 3) s += 4;
    }
    for (let i = 0; i <= n - 10; i++) {
      const win = curve.slice(i, i + 10);
      const counts = { A: 0, B: 0, C: 0, D: 0 };
      for (const L of win) counts[L]++;
      const vals = Object.values(counts);
      if (Math.min.apply(null, vals) === 0) s += 40;
      const pairs = [
        counts.A + counts.B,
        counts.A + counts.C,
        counts.A + counts.D,
        counts.B + counts.C,
        counts.B + counts.D,
        counts.C + counts.D,
      ];
      if (Math.max.apply(null, pairs) >= 8) s += 90;
      else if (Math.max.apply(null, pairs) >= 7) s += 35;
    }
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
    const decades = [
      curve.slice(0, Math.min(10, n)),
      curve.slice(Math.max(0, n - 10)),
    ];
    for (const seg of decades) {
      if (seg.length < 8) continue;
      const counts = { A: 0, B: 0, C: 0, D: 0 };
      for (const L of seg) counts[L]++;
      const vals = Object.values(counts);
      if (Math.min.apply(null, vals) === 0) s += 55;
      if (counts.B + counts.C >= 7) s += 70;
      if (counts.A + counts.D >= 7) s += 70;
      if (Math.max.apply(null, vals) >= 5) s += 40;
    }
    const g = { A: 0, B: 0, C: 0, D: 0 };
    for (const L of curve) g[L]++;
    const gv = Object.values(g);
    if (Math.max.apply(null, gv) - Math.min.apply(null, gv) > 1) s += 30;
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

  function buildAnswerCurve(n) {
    const restarts = 12;
    const stepsPerRestart = 1200;
    const targetScore = 0;
    let globalBest = null;
    let globalBestScore = Infinity;

    for (let r = 0; r < restarts; r++) {
      const base = Math.floor(n / 4);
      const rem = n % 4;
      const extras = new Set(shuffleArray(OPTION_KEYS).slice(0, rem));
      let pool = [];
      for (const L of OPTION_KEYS) {
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
        const j = randInt(n);
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
   * Ignore bank letter entirely — treat options as a bag of texts.
   * Put correct text on `correctSlot`, randomly fill the other three.
   */
  function layoutQuestion(q, correctSlot) {
    const correctText = q.options[q.correct];
    const wrongs = shuffleArray(
      OPTION_KEYS.filter((k) => k !== q.correct).map((k) => q.options[k])
    );
    const options = {};
    let wi = 0;
    for (const k of OPTION_KEYS) {
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
      originalCorrect: q.correct,
      ...(q.sheetRef ? { sheetRef: q.sheetRef } : {}),
    };
  }

  /**
   * Build a full session:
   *  1) shuffle question order
   *  2) build anti-pattern correct-letter curve along that order
   *  3) layout every question so correct text sits on curve letter
   */
  function generateSessionLayouts() {
    const n = state.questions.length;
    if (!n) {
      console.warn("[QuizMaster] generateSessionLayouts: empty question bank");
      return { questionOrder: [], layouts: {}, answerCurve: [], score: 0 };
    }
    const questionOrder = shuffleArray([...Array(n).keys()]);
    // Stronger search for longer banks (extra 50 → 80+ questions)
    const { curve, score } = buildAnswerCurve(n);
    const layouts = {};
    const counts = { A: 0, B: 0, C: 0, D: 0 };
    questionOrder.forEach((qIndex, pos) => {
      const q = state.questions[qIndex];
      const slot = curve[pos];
      layouts[String(q.id)] = layoutQuestion(q, slot);
      counts[slot]++;
    });
    if (typeof console !== "undefined" && console.info) {
      console.info(
        "[QuizMaster] anti-pattern answer curve",
        "score=" + score,
        "counts=",
        counts,
        "BC%=" + Math.round(((counts.B + counts.C) / n) * 100),
        "first15=",
        curve.slice(0, 15).join(" ")
      );
    }
    return { questionOrder, layouts, answerCurve: curve, score };
  }

  function getDisplayQuestion(q) {
    if (!q) return q;
    const layout = state.layouts[String(q.id)];
    if (layout && layout.options && layout.correct) {
      return {
        id: q.id,
        topic: q.topic,
        question: q.question,
        explanation: q.explanation,
        options: layout.options,
        correct: layout.correct,
        originalCorrect: q.correct,
        ...(q.sheetRef ? { sheetRef: q.sheetRef } : {}),
      };
    }
    // Fallback: emergency layout (should not happen mid-session)
    const slot = OPTION_KEYS[randInt(4)];
    const built = layoutQuestion(q, slot);
    state.layouts[String(q.id)] = built;
    return built;
  }

  function currentDisplayQ() {
    return getDisplayQuestion(currentQ());
  }

  function ensureAnswerRecord(q) {
    let rec = state.answers.find((a) => a.id === q.id);
    if (!rec) {
      rec = {
        id: q.id,
        topic: q.topic,
        attempts: 0,
        firstTryCorrect: false,
        timeToFirstClick: null,
        gotIt: null, // true / false / null
        wrongChoices: [],
        accuracyAt: null, // 1 if eventually correct (always)
      };
      state.answers.push(rec);
    }
    return rec;
  }

  function openNameModal(quizId) {
    state.pendingQuizId = quizId;
    if (!els.nameModal) {
      // Fallback if markup missing
      const name = (window.prompt("איך קוראים לך?", state.playerName || "") || "").trim();
      if (name.length >= 2) {
        state.playerName = name.slice(0, 32);
        startQuiz(quizId, false);
      }
      return;
    }
    els.nameModal.hidden = false;
    if (els.nameModalError) els.nameModalError.hidden = true;
    if (els.playerNameInput) {
      els.playerNameInput.value = state.playerName || "";
      requestAnimationFrame(() => els.playerNameInput.focus());
    }
  }

  function closeNameModal() {
    if (els.nameModal) els.nameModal.hidden = true;
    state.pendingQuizId = null;
  }

  function confirmNameAndStart() {
    const raw = (els.playerNameInput?.value || "").trim().replace(/\s+/g, " ");
    if (raw.length < 2) {
      if (els.nameModalError) els.nameModalError.hidden = false;
      els.playerNameInput?.focus();
      return;
    }
    const quizId = state.pendingQuizId;
    state.playerName = raw.slice(0, 32);
    closeNameModal();
    if (quizId) startQuiz(quizId, false);
  }

  function openScoreboard() {
    if (!els.scoreboardModal) return;
    renderScoreboard();
    els.scoreboardModal.hidden = false;
  }

  function closeScoreboard() {
    if (els.scoreboardModal) els.scoreboardModal.hidden = true;
  }

  function renderScoreboard() {
    const list = loadScoreboard();
    if (!els.scoreboardList) return;
    if (!list.length) {
      els.scoreboardList.innerHTML = "";
      if (els.scoreboardEmpty) els.scoreboardEmpty.hidden = false;
      return;
    }
    if (els.scoreboardEmpty) els.scoreboardEmpty.hidden = true;
    els.scoreboardList.innerHTML = list
      .map((e, i) => {
        const rank = i + 1;
        const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : String(rank);
        const when = e.at
          ? new Date(e.at).toLocaleDateString("he-IL", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "";
        const quizLabel =
          (QUIZ_CATALOG[e.quizId] && QUIZ_CATALOG[e.quizId].shortLabel) ||
          e.quizId ||
          "quiz";
        return `
        <li class="rank-${Math.min(rank, 3)}">
          <span class="sb-rank" aria-hidden="true">${medal}</span>
          <div class="sb-body">
            <div class="sb-name">${escapeHtml(e.name || "—")}</div>
            <div class="sb-meta ltr">${e.mastery ?? "—"}% · ${e.firstTry ?? 0}/${e.total ?? 0} · ${escapeHtml(quizLabel)}${when ? " · " + when : ""}</div>
          </div>
          <span class="sb-label tier-${e.tier ?? 0}">${escapeHtml(e.label || "—")}</span>
        </li>`;
      })
      .join("");
  }

  function logScoreboardIfNeeded(analytics) {
    if (state.scoreboardLogged) return null;
    const name = (state.playerName || "").trim();
    if (!name) return null;
    const tierInfo = scoreLabelFromMastery(analytics.overallMastery);
    addScoreboardEntry({
      name,
      label: tierInfo.label,
      tier: tierInfo.tier,
      mastery: analytics.overallMastery,
      firstTry: analytics.firstTryCount,
      total: analytics.totalAnswered,
      quizId: state.quizId,
      at: Date.now(),
    });
    state.scoreboardLogged = true;
    return tierInfo;
  }

  function startQuiz(quizId, fromResume = false) {
    ensureAudio();
    if (!fromResume) {
      if (!selectQuiz(quizId)) return;
      state.index = 0;
      state.score = 0;
      state.streak = 0;
      state.maxStreak = 0;
      state.answers = [];
      state.lockedBlocks = 0;
      state.startedAt = Date.now();
      state.scoreboardLogged = false;
      // Brand-new anti-pattern curve + shuffled question order every run
      // Correct text is placed on curve letters — bank A/B/C/D is ignored.
      const session = generateSessionLayouts();
      state.questionOrder = session.questionOrder;
      state.layouts = session.layouts;
      state.answerCurve = session.answerCurve;
      resetKnowledgeBlocksVisual();
      clearProgress(quizId);
      saveProgress();
    } else {
      const resume = typeof quizId === "object" && quizId
        ? quizId
        : findResumableQuiz();
      if (!resume || !selectQuiz(resume.quizId)) {
        showScreen("landing");
        updateLandingResume();
        return;
      }
      const p = loadProgress(resume.quizId) || resume;
      if (p && p.layouts && p.questionOrder && p.questionOrder.length) {
        state.index = p.index || 0;
        state.score = p.score || 0;
        state.streak = p.streak || 0;
        state.maxStreak = p.maxStreak || 0;
        state.answers = p.answers || [];
        state.lockedBlocks = p.lockedBlocks || 0;
        state.startedAt = p.startedAt || Date.now();
        state.soundOn = p.soundOn !== false;
        state.questionOrder = p.questionOrder;
        state.layouts = p.layouts;
        state.answerCurve = p.answerCurve || [];
        state.playerName = p.playerName || state.playerName || "";
        state.scoreboardLogged = !!p.scoreboardLogged;
        for (let i = 0; i < state.lockedBlocks; i++) {
          const free = blockNodes.filter((b) => !b.classList.contains("locked"));
          if (!free.length) break;
          placeLockedBlock(free[0], i);
        }
      } else {
        // No valid session — start fresh with full shuffle
        const session = generateSessionLayouts();
        state.questionOrder = session.questionOrder;
        state.layouts = session.layouts;
        state.answerCurve = session.answerCurve;
        state.index = 0;
        state.score = 0;
        state.answers = [];
        state.scoreboardLogged = false;
      }
    }
    // Prefetch sheet highlights only for quizzes that use the דף עזר
    if (activeQuizMeta().hasSheet) ensureSheetHighlights();
    updateSoundUI();
    showQuestion();
  }

  function showQuestion() {
    if (state.index >= TOTAL()) {
      finishQuiz();
      return;
    }
    const q = currentDisplayQ();
    showScreen("question");
    state.questionStartedAt = performance.now();

    els.qCount.textContent = `${state.index + 1} / ${TOTAL()}`;
    els.scoreCircle.textContent = String(state.score);
    els.progressFill.style.width = `${(state.index / TOTAL()) * 100}%`;
    els.topicBadge.textContent = `◈ ${q.topic}`;
    els.questionText.textContent = q.question;
    els.focusStreak.textContent = state.streak;
    els.focusFill.style.width = `${Math.min(100, state.streak * 12.5)}%`;

    // Render answers in shuffled order — Hebrew letters for display, Latin keys internally
    const letterMap = { A: "א", B: "ב", C: "ג", D: "ד" };
    const order = ["A", "B", "C", "D"];
    els.answers.innerHTML = "";
    order.forEach((key) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "answer-card";
      btn.dataset.key = key;
      btn.setAttribute("aria-label", `תשובה ${letterMap[key]}`);
      btn.innerHTML = `
        <span class="answer-letter">${letterMap[key]}</span>
        <span class="answer-text">${escapeHtml(q.options[key])}</span>
      `;
      btn.addEventListener("click", () => onAnswer(key, btn));
      els.answers.appendChild(btn);
    });

    // restore wrong attempts on this question if any (stable shuffle keeps keys valid)
    const rec = state.answers.find((a) => a.id === q.id);
    if (rec && rec.wrongChoices.length) {
      $$(".answer-card").forEach((card) => {
        if (rec.wrongChoices.includes(card.dataset.key)) {
          card.classList.add("wrong", "disabled");
          card.disabled = true;
        }
      });
    }

    saveProgress();
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function onAnswer(key, btn) {
    const q = currentDisplayQ();
    const base = currentQ();
    const rec = ensureAnswerRecord(base);

    if (rec.timeToFirstClick == null) {
      rec.timeToFirstClick = Math.round(performance.now() - state.questionStartedAt);
    }
    rec.attempts++;

    if (key === q.correct) {
      // Correct
      if (rec.attempts === 1) {
        rec.firstTryCorrect = true;
        state.score++;
        state.streak++;
        state.maxStreak = Math.max(state.maxStreak, state.streak);
      } else {
        state.streak = 0;
      }
      playCorrect();
      playCelebrate();
      flashScreen();
      burstConfetti();

      btn.classList.add("correct");
      $$(".answer-card").forEach((c) => {
        if (c !== btn) c.classList.add("fade-out");
        c.disabled = true;
      });

      els.scoreCircle.textContent = String(state.score);
      els.focusStreak.textContent = state.streak;
      els.focusFill.style.width = `${Math.min(100, state.streak * 12.5)}%`;

      setTimeout(() => showExplanation(q), 700);
    } else {
      // Wrong — try again
      rec.wrongChoices.push(key);
      state.streak = 0;
      els.focusStreak.textContent = "0";
      els.focusFill.style.width = "0%";
      playWrong();
      showTryAgain();
      btn.classList.add("wrong");
      btn.disabled = true;
      btn.classList.add("disabled");
      saveProgress();
    }
  }

  function showExplanation(q) {
    // q is already display-shuffled (from onAnswer) or we recompute
    const display = q.options && q.correct ? q : currentDisplayQ();
    // sheetRef lives on the bank question (currentQ), not always on display layout
    const bank = currentQ();
    showScreen("explain");
    const letterMap = { A: "א", B: "ב", C: "ג", D: "ד" };
    const correctText = display.options[display.correct];
    els.correctBanner.innerHTML = `
      <div class="check">✓</div>
      <div>
        <div style="font-weight:800;margin-bottom:0.25rem;">תשובה נכונה: ${letterMap[display.correct]}</div>
        <div style="opacity:0.9;font-size:1.02rem;">${escapeHtml(correctText)}</div>
      </div>
    `;
    els.explainText.textContent = display.explanation;
    renderSheetRef(bank.sheetRef || display.sheetRef, bank.id);
    lockKnowledgeBlock();
    saveProgress();
  }

  function sheetConfig() {
    return activeQuizMeta().sheet || null;
  }

  function ensureSheetHighlights() {
    const cfg = sheetConfig();
    const url = cfg && cfg.highlightsUrl;
    if (!url) {
      return Promise.resolve({ highlights: {}, pages: {} });
    }
    if (sheetHighlights && sheetHighlightsKey === url) {
      return Promise.resolve(sheetHighlights);
    }
    if (sheetHighlightsPromise && sheetHighlightsKey === url) {
      return sheetHighlightsPromise;
    }
    sheetHighlightsKey = url;
    sheetHighlights = null;
    sheetHighlightsPromise = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error("highlights missing: " + url);
        return r.json();
      })
      .then((data) => {
        sheetHighlights = data;
        return data;
      })
      .catch((err) => {
        console.warn("[QuizMaster] sheet highlights unavailable", err);
        sheetHighlights = { highlights: {}, pages: {} };
        return sheetHighlights;
      });
    return sheetHighlightsPromise;
  }

  /**
   * Show where this answer appears in the source material (דף עזר / תמסיר).
   * Highlights are painted onto a canvas (NOT inside the raw PDF file).
   *
   * sheetRef shapes:
   *   single-sheet: { page, section, hint }
   *   multi-doc:    { doc, page, section, hint }  // doc = תמסיר number
   */
  function renderSheetRef(sheetRef, questionId) {
    if (!els.sheetRef) return;
    const meta = activeQuizMeta();
    const hasPage = sheetRef && (sheetRef.page || sheetRef.doc);
    if (!meta.hasSheet || !hasPage) {
      els.sheetRef.hidden = true;
      currentHighlight = null;
      return;
    }
    els.sheetRef.hidden = false;
    const page = sheetRef.page;
    const doc = sheetRef.doc;
    const section = sheetRef.section || "";
    const cfg = sheetConfig();
    const docLabel =
      doc && cfg && typeof cfg.docLabel === "function"
        ? cfg.docLabel(doc)
        : doc
          ? `תמסיר ${doc}`
          : "";

    if (docLabel) {
      els.sheetRefTitle.textContent = `${docLabel}${page ? " · עמוד " + page : ""}${section ? " · " + section : ""}`;
    } else {
      els.sheetRefTitle.textContent = `עמוד ${page}${section ? " · " + section : ""}`;
    }

    if (sheetRef.hint) {
      els.sheetRefHint.hidden = false;
      els.sheetRefHint.textContent = sheetRef.hint;
    } else {
      els.sheetRefHint.hidden = true;
      els.sheetRefHint.textContent = "";
    }

    if (els.sheetRefLink && cfg) {
      let pdfHref = "#";
      let linkLabel = "PDF מקורי (בלי סימון)";
      if (cfg.kind === "multi-doc" && doc && typeof cfg.pdfForDoc === "function") {
        pdfHref = `${cfg.pdfForDoc(doc)}#page=${page || 1}`;
        linkLabel = `${docLabel} · PDF עמוד ${page || 1} (בלי סימון)`;
      } else if (cfg.pdf) {
        pdfHref = `${cfg.pdf}#page=${page || 1}`;
        linkLabel = `PDF מקורי עמוד ${page || 1} (בלי סימון)`;
      }
      els.sheetRefLink.href = pdfHref;
      els.sheetRefLink.textContent = linkLabel;
    }

    // Update sheet-ref label for multi-doc quizzes
    const labelEl = els.sheetRef.querySelector(".sheet-ref-label");
    if (labelEl) {
      labelEl.textContent = docLabel ? "מסומן בתמסיר" : "מסומן בדף העזר";
    }

    ensureSheetHighlights().then((data) => {
      const hl = data.highlights && data.highlights[String(questionId)];
      if (!hl) {
        // Still show title/hint/PDF link even without pixel highlight
        if (els.sheetViewer) els.sheetViewer.hidden = true;
        if (els.sheetCropWrap) els.sheetCropWrap.hidden = true;
        currentHighlight = null;
        return;
      }
      currentHighlight = { ...hl, questionId, section };
      loadSheetPageImage(hl).then((img) => {
        currentSheetImg = img;
        paintSheetHighlight(img, hl);
      }).catch((err) => {
        console.warn("[QuizMaster] page image load failed", err);
        if (els.sheetViewer) els.sheetViewer.hidden = true;
        if (els.sheetCropWrap) els.sheetCropWrap.hidden = true;
      });
    });
  }

  /** Cache of loaded page images */
  const sheetImgCache = {};

  /**
   * Load a rendered page image.
   * @param {number|{doc?:number,page:number}} pageOrHl
   */
  function loadSheetPageImage(pageOrHl) {
    const cfg = sheetConfig();
    let src;
    if (typeof pageOrHl === "object" && pageOrHl) {
      const doc = pageOrHl.doc;
      const page = pageOrHl.page;
      if (cfg && cfg.kind === "multi-doc" && doc && typeof cfg.pageFile === "function") {
        src = cfg.pageFile(doc, page);
      } else if (cfg && typeof cfg.pageFile === "function") {
        src = cfg.pageFile(page);
      } else {
        src = `assets/sheet/page-${page}.png`;
      }
    } else {
      const pageNum = pageOrHl;
      if (cfg && cfg.kind === "multi-doc") {
        // fallback — should pass hl object for multi-doc
        src = cfg.pageFile ? cfg.pageFile(1, pageNum) : `assets/sheet/page-${pageNum}.png`;
      } else if (cfg && typeof cfg.pageFile === "function") {
        src = cfg.pageFile(pageNum);
      } else {
        src = `assets/sheet/page-${pageNum}.png`;
      }
    }

    if (sheetImgCache[src] && sheetImgCache[src].complete) {
      return Promise.resolve(sheetImgCache[src]);
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        sheetImgCache[src] = img;
        resolve(img);
      };
      img.onerror = () => reject(new Error("Failed to load " + src));
      img.src = src;
      sheetImgCache[src] = img;
    });
  }

  /**
   * Paint the page onto canvas with a loud yellow highlight + dim outside.
   * The mark is baked into pixels so it cannot be missed.
   */
  function paintSheetHighlight(img, hl) {
    const pageCanvas = els.sheetPageCanvas;
    const cropCanvas = els.sheetCropCanvas;
    if (!pageCanvas) return;

    if (els.sheetViewer) els.sheetViewer.hidden = false;

    const W = img.naturalWidth;
    const H = img.naturalHeight;
    const rx = hl.x * W;
    const ry = hl.y * H;
    const rw = Math.max(8, hl.w * W);
    const rh = Math.max(8, hl.h * H);

    // ── Full page with highlight ──
    pageCanvas.width = W;
    pageCanvas.height = H;
    const ctx = pageCanvas.getContext("2d");
    ctx.drawImage(img, 0, 0);

    // Dim whole page
    ctx.fillStyle = "rgba(10, 12, 24, 0.55)";
    ctx.fillRect(0, 0, W, H);

    // Punch hole: redraw original in highlight rect
    ctx.drawImage(img, rx, ry, rw, rh, rx, ry, rw, rh);

    // Bright yellow marker fill
    ctx.fillStyle = "rgba(255, 220, 0, 0.42)";
    ctx.fillRect(rx, ry, rw, rh);

    // Thick magenta/cyan border
    ctx.lineWidth = Math.max(4, W * 0.006);
    ctx.strokeStyle = "#ff006e";
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.lineWidth = Math.max(2, W * 0.003);
    ctx.strokeStyle = "#00f0ff";
    ctx.strokeRect(rx + 4, ry + 4, rw - 8, rh - 8);

    // Label pill above the highlight
    const label = "★ כאן";
    ctx.font = `bold ${Math.round(W * 0.028)}px Inter, Arial, sans-serif`;
    const tw = ctx.measureText(label).width;
    const pad = 10;
    const lx = Math.min(Math.max(4, rx), W - tw - pad * 2 - 8);
    const ly = Math.max(28, ry - 10);
    ctx.fillStyle = "#ff006e";
    ctx.fillRect(lx, ly - 22, tw + pad * 2, 28);
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    ctx.fillText(label, lx + pad, ly - 8);

    // Scroll so highlight is visible in the viewport
    requestAnimationFrame(() => {
      if (!els.sheetViewport) return;
      const displayH = pageCanvas.getBoundingClientRect().height || pageCanvas.clientHeight;
      const scale = displayH / H;
      const targetY = ry * scale - els.sheetViewport.clientHeight * 0.2;
      els.sheetViewport.scrollTop = Math.max(0, targetY);
    });

    // ── Zoomed crop of the answer region ──
    if (cropCanvas && els.sheetCropWrap) {
      els.sheetCropWrap.hidden = false;
      const padY = rh * 0.35;
      const padX = rw * 0.04;
      const cx = Math.max(0, rx - padX);
      const cy = Math.max(0, ry - padY);
      const cw = Math.min(W - cx, rw + padX * 2);
      const ch = Math.min(H - cy, rh + padY * 2);

      // Render crop at high res for readability
      const outW = 900;
      const outH = Math.round(outW * (ch / cw));
      cropCanvas.width = outW;
      cropCanvas.height = outH;
      const cctx = cropCanvas.getContext("2d");
      cctx.drawImage(img, cx, cy, cw, ch, 0, 0, outW, outH);

      // Map highlight into crop coords
      const sx = ((rx - cx) / cw) * outW;
      const sy = ((ry - cy) / ch) * outH;
      const sw = (rw / cw) * outW;
      const sh = (rh / ch) * outH;

      cctx.fillStyle = "rgba(255, 220, 0, 0.38)";
      cctx.fillRect(sx, sy, sw, sh);
      cctx.lineWidth = 5;
      cctx.strokeStyle = "#ff006e";
      cctx.strokeRect(sx, sy, sw, sh);
      cctx.lineWidth = 2;
      cctx.strokeStyle = "#00f0ff";
      cctx.strokeRect(sx + 3, sy + 3, sw - 6, sh - 6);
    }
  }

  function openSheetLightbox() {
    if (!currentHighlight || !els.sheetLightbox || !els.sheetLightboxInner) return;
    const hl = currentHighlight;
    els.sheetLightbox.hidden = false;
    document.body.style.overflow = "hidden";

    const paint = (img) => {
      const canvas = document.createElement("canvas");
      canvas.className = "sheet-page-canvas lightbox-canvas";
      // Reuse painter into a temp canvas by temporarily swapping refs
      const prevPage = els.sheetPageCanvas;
      const prevCrop = els.sheetCropCanvas;
      const prevWrap = els.sheetCropWrap;
      const prevViewer = els.sheetViewer;
      const prevVp = els.sheetViewport;
      // Manual paint for lightbox
      const W = img.naturalWidth;
      const H = img.naturalHeight;
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      const rx = hl.x * W;
      const ry = hl.y * H;
      const rw = Math.max(8, hl.w * W);
      const rh = Math.max(8, hl.h * H);
      ctx.drawImage(img, 0, 0);
      ctx.fillStyle = "rgba(10, 12, 24, 0.55)";
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(img, rx, ry, rw, rh, rx, ry, rw, rh);
      ctx.fillStyle = "rgba(255, 220, 0, 0.42)";
      ctx.fillRect(rx, ry, rw, rh);
      ctx.lineWidth = Math.max(4, W * 0.006);
      ctx.strokeStyle = "#ff006e";
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.lineWidth = Math.max(2, W * 0.003);
      ctx.strokeStyle = "#00f0ff";
      ctx.strokeRect(rx + 4, ry + 4, rw - 8, rh - 8);

      els.sheetLightboxInner.innerHTML = "";
      const wrap = document.createElement("div");
      wrap.className = "sheet-lightbox-page";
      wrap.appendChild(canvas);
      els.sheetLightboxInner.appendChild(wrap);

      requestAnimationFrame(() => {
        const displayH = canvas.getBoundingClientRect().height || canvas.clientHeight;
        const scale = displayH / H;
        els.sheetLightboxInner.scrollTop = Math.max(0, ry * scale - 60);
      });

      // silence unused
      void prevPage; void prevCrop; void prevWrap; void prevViewer; void prevVp;
    };

    if (currentSheetImg && currentSheetImg.complete) {
      paint(currentSheetImg);
    } else {
      loadSheetPageImage(hl).then(paint).catch(() => {
        els.sheetLightboxInner.innerHTML = "<p style='color:#fff;padding:2rem;'>לא ניתן לטעון את מקור ההסבר</p>";
      });
    }
  }

  function closeSheetLightbox() {
    if (!els.sheetLightbox) return;
    els.sheetLightbox.hidden = true;
    document.body.style.overflow = "";
    if (els.sheetLightboxInner) els.sheetLightboxInner.innerHTML = "";
  }

  function advance(gotIt) {
    playClick();
    const q = currentQ();
    const rec = ensureAnswerRecord(q);
    rec.gotIt = !!gotIt;
    rec.accuracyAt = 1;
    state.index++;
    saveProgress();
    if (state.index >= TOTAL()) {
      finishQuiz();
    } else {
      showQuestion();
    }
  }

  // ── Analytics ──────────────────────────────────────────
  /**
   * Mastery per topic:
   *  first try correct = 100%
   *  second try = 70%
   *  third+ = 40%
   * Confidence: "Got it" boosts, "Still confused" lowers
   * Recommendation: lowest mastery + confused + multi-attempt first
   */
  function computeAnalytics() {
    const byTopic = {};
    const timeline = []; // accuracy series (first-try = 1 else 0)

    for (const a of state.answers) {
      if (!byTopic[a.topic]) {
        byTopic[a.topic] = {
          topic: a.topic,
          items: [],
          masterySum: 0,
          count: 0,
          firstTry: 0,
          confused: 0,
          multiAttempt: 0,
        };
      }
      const t = byTopic[a.topic];
      let mastery = 40;
      if (a.attempts <= 1 && a.firstTryCorrect) mastery = 100;
      else if (a.attempts === 2) mastery = 70;
      else mastery = 40;

      // confidence adjustment
      if (a.gotIt === true) mastery = Math.min(100, mastery + 5);
      if (a.gotIt === false) mastery = Math.max(0, mastery - 15);

      t.items.push({ ...a, mastery });
      t.masterySum += mastery;
      t.count++;
      if (a.firstTryCorrect) t.firstTry++;
      if (a.gotIt === false) t.confused++;
      if (a.attempts >= 2) t.multiAttempt++;

      timeline.push({
        n: timeline.length + 1,
        firstTry: a.firstTryCorrect ? 1 : 0,
        topic: a.topic,
        attempts: a.attempts,
      });
    }

    const topics = Object.values(byTopic).map((t) => ({
      ...t,
      mastery: t.count ? Math.round(t.masterySum / t.count) : 0,
      firstTryRate: t.count ? t.firstTry / t.count : 0,
    }));

    const strongest = topics
      .filter((t) => t.mastery >= 85 && t.confused === 0)
      .sort((a, b) => b.mastery - a.mastery);

    const needsPractice = topics
      .filter((t) => t.confused > 0 || (t.mastery >= 55 && t.mastery < 85))
      .sort((a, b) => a.mastery - b.mastery);

    const focusHere = topics
      .filter((t) => t.multiAttempt > 0 || t.mastery < 55)
      .sort((a, b) => a.mastery - b.mastery || b.multiAttempt - a.multiAttempt);

    // Overall mastery: average of question masteries
    let overallSum = 0;
    let overallN = 0;
    for (const t of topics) {
      overallSum += t.masterySum;
      overallN += t.count;
    }
    const overallMastery = overallN ? Math.round(overallSum / overallN) : 0;

    // Learning velocity: compare first half vs second half first-try rate
    const mid = Math.floor(timeline.length / 2) || 1;
    const firstHalf = timeline.slice(0, mid);
    const secondHalf = timeline.slice(mid);
    const avg = (arr) => (arr.length ? arr.reduce((s, x) => s + x.firstTry, 0) / arr.length : 0);
    const velocity = avg(secondHalf) - avg(firstHalf);

    // Attention: consistency of timeToFirstClick (lower CV = more consistent)
    const times = state.answers.map((a) => a.timeToFirstClick).filter((t) => t != null && t > 0);
    let attention = 70;
    if (times.length >= 3) {
      const mean = times.reduce((a, b) => a + b, 0) / times.length;
      const variance = times.reduce((s, t) => s + (t - mean) ** 2, 0) / times.length;
      const cv = mean ? Math.sqrt(variance) / mean : 1;
      attention = Math.max(20, Math.min(100, Math.round(100 - cv * 50)));
    }

    // Focus recommendations: top 3 weak topics
    const recScore = (t) => t.mastery - t.multiAttempt * 8 - t.confused * 10;
    const recommendations = [...topics].sort((a, b) => recScore(a) - recScore(b)).slice(0, 3);

    // Study plan bullets by topic keywords
    const planTips = buildStudyPlan(focusHere.length ? focusHere : needsPractice);

    return {
      topics,
      strongest,
      needsPractice,
      focusHere,
      overallMastery,
      timeline,
      velocity,
      attention,
      recommendations,
      planTips,
      firstTryCount: state.answers.filter((a) => a.firstTryCorrect).length,
      totalAnswered: state.answers.length,
      maxStreak: state.maxStreak,
    };
  }

  function buildStudyPlan(weakTopics) {
    const tips = {
      "תהליכי למידה": [
        "חזרו על ההבדל בין למידה לא-אסוציאטיבית (הביטואציה/סנסיטיזציה) להתניה.",
        "תרגלו: רכישה, הכחדה, החלמה ספונטנית, הכללה והבחנה — עם דוגמאות.",
        "זכרו את רסקולה: סמיכות זמנים + יכולת ניבוי (Predictability).",
      ],
      "תהליכי זיכרון": [
        "מיפו מודל הזיכרון: חושי → עבודה → ארוך טווח; קידוד / אחסון / שליפה.",
        "הבדילו בין זיכרון אפיזודי, סמנטי ופרוצדורלי.",
        "חזרו על עקומת השכחה של אבינגהאוס והפרעות (פרו/רטרואקטיביות).",
      ],
      "פסיכולוגיה התפתחותית": [
        "שלבי פיאז'ה + מושגי אובייקט קבוע, אגוצנטריות, שימור.",
        "היקשרות (Attachment) — איינסוורת' וסוגי ההיקשרות.",
        "תקופות קריטיות/רגישות והתפתחות מוסרית (קולברג).",
      ],
      "פסיכופתולוגיה": [
        "קריטריונים להפרעה: מצוקה, ליקוי תפקודי, סטייה מהנורמה.",
        "מודלים: ביולוגי, פסיכודינמי, קוגניטיבי-התנהגותי.",
        "הבדלים בין חרדה, דיכאון, סכיזופרניה — סימנים מרכזיים.",
      ],
      "השפעה חברתית ואלטרואיזם": [
        "קונפורמיות (אש), ציות (מילגרם), השפעת המיעוט.",
        "אפקט הצופה מהצד ופיזור אחריות — מתי עוזרים?",
        "אלטרואיזם: אמפתיה, קרבה גנטית, הדדיות — והאם קיים 'אמיתי'.",
      ],
      // SHESAIM topics
      "חברה ישראלית": [
        "חזרו על כור ההיתוך מול מודל רב-תרבותי / שבטים.",
        "נאום השבטים של ריבלין: חילונים, דתיים-לאומיים, חרדים, ערבים.",
        "כתבו דוגמה אחת לכל שבט ולמתח בינו לבין האחרים.",
      ],
      "שסעים וקיטוב": [
        "הבדילו: חברה משוסעת (מבני) מול חברה מקוטבת (רגשי/עוינות).",
        "שסע חופף vs שסע צולב — איזה מסוכן יותר ולמה.",
        "מצאו דוגמה ישראלית לשסע חופף (למשל דת+פוליטיקה+מגורים).",
      ],
      "אסטרטגיות התמודדות": [
        "מטריצת התמודדות: לגיטימיות המערכת × חדירות גבולות.",
        "קבוצה מוחלשת: מוביליות / יצירתיות / מאבק.",
        "קבוצה פריבילגית: הכחשה, הצדקה מריטוקרטית, הרחקה, פירוק.",
      ],
      "שכנוע ושינוי עמדות": [
        "אפקט הבומרנג — למה עובדות בלבד לא תמיד משכנעות.",
        "חשיבה פרדוקסלית (המאירי): הסכמה + הקצנה לאבסורד.",
        "מודל לוין: הפשרה → שינוי → הקפאה מחדש; תיקון מטא-תפיסות.",
        "תרגלו ניסוח מסר פרדוקסלי לעמדה שאתם חולקים עליה.",
      ],
      "מפגש בין קבוצות": [
        "גישת המגע vs גישת הקונפליקט — מטרה, תהליך, ביקורת.",
        "אשליית הרמוניה: מתי מגע 'מרגיש טוב' אבל לא משנה מבנים.",
        "מתי מתאים להדגיש יחסי כוח במפגש יהודים–ערבים.",
      ],
      "תיאוריות חברתיות": [
        "פרדיגמת הקבוצה המינימלית (טאג'פל) — חלוקה שרירותית מספיקה.",
        "הכרה שגויה (טיילור) ≠ התעלמות: דימוי מעוות/מקטין.",
        "קשרו זהות חברתית להעדפת קבוצת פנים ביום-יום.",
      ],
      "פוליטיקה ישראלית": [
        "מלכוד לשון המאזניים: כוח מיקוח של מפלגות סקטוריאליות.",
        "איך זה מעמיק שסעים ומעצב קואליציות.",
        "דוגמה אחת מהשנים האחרונות ללשון מאזניים.",
      ],
      "הטיות קוגניטיביות": [
        "הטיית ייחוס בין-קבוצתית: 'הם' = אופי, 'אנחנו' = נסיבות.",
        "ריאליזם נאיבי + הטיה שפתית (תכונה קבועה vs חריגה).",
        "תרגלו ייחוס הפוך לאירוע חדשותי של קבוצת יריב.",
      ],
      // לוגיקה ב — פול פאוור
      "מדוע PL נחוצה": [
        "חזרו על טיעון נועה/דן: למה אותיות אטומיות ב־SL לא שומרות תוקף.",
        "רשמו: פרדיקטים + מונחים יחידאיים + ביטויי כמות = סיבת התוקף בעברית.",
        "פתחו תמסיר 1 וסמנו את ההגדרה של PL.",
      ],
      "מונחים יחידאיים ופרדיקטים": [
        "שלושה סוגי מונחים יחידאיים: שם פרטי, תיאור מיידע, כינוי גוף.",
        "פרדיקט = משפט לא־שלם עם 'פערים' / עמדות ציון.",
        "כתבו 3 דוגמאות משלכם לפרדיקט חד־מקומי ודו־מקומי.",
      ],
      "תחביר PL": [
        "אוצר סימנים: אותיות פסוקיות, פרדיקטים, a–v / w–z, קשרים, ∀∃.",
        "סעיף 4: כמת־x רק אם x מופיע ואין כבר כמת־x.",
        "תרגלו: זהו אופרטור ראשי ותת־נוסחאות מיידיות.",
      ],
      "פסוקים ומופעים חופשיים": [
        "פסוק = אין משתנים חופשיים; נוסחה יכולה להיות פתוחה.",
        "P(a/x): הצבת קבוע במופעים חופשיים של x.",
        "למה אי אפשר (∀y) על נוסחה שכבר כוללת כמת־y.",
      ],
      "הצרנה בסיסית": [
        "(∃y)P & (∃y)~P ≠ (∃y)(P & ~P) — שני אנשים מול סתירה.",
        "כל מי ש… = (∀x)(P → Q); זכרו 'נכון באופן ריק'.",
        "הבדילו אופרטור ראשי: → מול & בתוך כמת.",
      ],
      "הצרנות מתקדמות": [
        "תרגלו משפטי 'כל…' עם קוניונקציה במסקנה.",
        "שתי פרפראזות לנמרים/זברות: פיצול ∀ מול איחוד עם ∨.",
        "(∀x)(∀y)Lxy מול (∀x)(∃y)Lxy — כל/לפחות אחד.",
      ],
      "כמתים מקוננים": [
        "סדר כמתים משנה משמעות: ∀∃ מול ∃∀.",
        "כל דבר שכבד מכל G ≠ כל דבר שכבד מאיזושהי G.",
        "תרגלו שלילת 'אף…אף' עם ∼∃.",
      ],
      "בחירת פרדיקטים": [
        "למשפט בודד כמה פירוקים אפשריים; לטיעון — הפירוק קובע תוקף.",
        "אל תאחדו מידע שצריך 'לגשר' בין הנחות.",
        "פתחו תמסיר 7: עטלפים / כלבת / עליית גג.",
      ],
      "משפטי I ו־A": [
        "משפט־I מורכב: אדם אחד לשני דברים; קוניונקציית I: אולי שני אנשים.",
        "משפט־A: (∀y)[(Py & …) → …] — זכרו Px כשתחום כולל לא־אנשים.",
        "תרגלו הצרנת 'אף אחד ש…לא…' כשלילת I.",
      ],
      "תיאורים מיידעים וזהות": [
        "r אטומי לא מקודד את תוכן התיאור — עלול לשבור תוקף.",
        "PLE: קיום + יחידות עם = + שאר התכונות.",
        "כתבו את צורת (∃x)[F(x) & (∀y)(F(y)→y=x) & G(x)].",
      ],
      "PLE וסמנטיקה": [
        "PLE = PL + זהות + סימני פונקציה.",
        "מונח סגור/פתוח: האם מופיע משתנה.",
        "פירוש: תחום + אותיות + קבועים + אקסטנציות פרדיקטים.",
      ],
      "תנאי אמת לכמתים": [
        "פסוק פתוח צריך השמה למשתנים, לא רק פירוש.",
        "∀: לכל u, התיקון d[u/x] מספק את Q.",
        "∃: קיים לפחות u אחד כזה.",
      ],
      // Extra formalization bank topics (ids 32–81)
      "קשרים פסוקיים": [
        "תרגלו & ∨ ⊃ ≡ ∼ על קבועים ופרדיקטים.",
        "הבדילו קוניונקציה מול אימפליקציה בניסוח עברי.",
        "פתחו תמסיר 3 — הצרנות דן וחבריו.",
      ],
      "כולל + גרירה": [
        "כל… = (∀x)(P → Q), לא (∀x)(P & Q).",
        "זכרו נכונות ריקה כשהקדמה שקרית.",
      ],
      "ישי + קוניונקציה": [
        "מישהו…וגם… = (∃x)(P & Q).",
        "אל תערבבו עם שני ∃ נפרדים.",
      ],
      "משפט A": [
        "משפט A: כל S הוא P → (∀x)(Sx → Px).",
      ],
      "משפט E": [
        "משפט E: אף S אינו P → (∀x)(Sx → ∼Px) או ∼(∃x)(Sx & Px).",
      ],
      "משפט I": [
        "משפט I: יש S שהוא P → (∃x)(Sx & Px).",
      ],
      "משפט O": [
        "משפט O: יש S שאינו P → (∃x)(Sx & ∼Px).",
      ],
      "שלילת משפט A": [
        "∼(∀x)(Sx → Px) ≡ (∃x)(Sx & ∼Px).",
      ],
      "שלילת משפט I": [
        "∼(∃x)(Sx & Px) ≡ (∀x)(Sx → ∼Px).",
      ],
      "מספרים": [
        "הצרינו יחסי מספרים עם כמתים מקוננים בזהירות.",
        "בדקו סדר ארגומנטים בפרדיקטים דו-מקומיים.",
      ],
      "זהות (לפחות שניים)": [
        "לפחות שניים: (∃x)(∃y)∼(x = y) עם התכונות הרלוונטיות.",
      ],
      "זהות (בדיוק אחד)": [
        "בדיוק אחד = קיום + יחידות עם (∀y)(… → y = x).",
      ],
      "פונקציה (עוקב)": [
        "סימני פונקציה ב-PLE — מונחים מורכבים כמו s(x).",
      ],
      "פונקציה (סכום)": [
        "פונקציה דו-מקומית: f(x,y) כתוך מונח יחידאי.",
      ],
      // סוציולוגיה של החינוך
      "דורקהיים ומבוא לסוציולוגיה של החינוך": [
        "עובדות חברתיות: חיצוניות לפרט + כפייה.",
        "טיפולוגיית התאבדות: אגואיסטית / אלטרואיסטית / אנומית / פטליסטית.",
        "דמיון סוציולוגי (מילס): Troubles ↔ Issues.",
      ],
      "פרדיגמות סוציולוגיות בחינוך": [
        "פונקציונליזם מול קונפליקט: הסכמה מול מאבק ושעתוק.",
        "AGIL של פרסונס; פונקציות גלויות/סמויות (מרטון).",
        "אינטראקציה סימבולית = מיקרו; וובר = מעמד/עוצמה/סטטוס.",
      ],
      "תרבות, אדם ומבנה חברתי": [
        "Mores מול Folkways; אתנוצנטריות מול יחסיות תרבותית.",
        "סטטוס שיוכי מול הישגי; Role Conflict מול Role Strain.",
        "הגמוניה (גראמשי) והיפותזת ספיר-וורף.",
      ],
      "חיברות וכינון זהות": [
        "מיד: I / Me, Play / Game, האחר המוכלל.",
        "קולי: האני במראה; סוכן חיברות ראשוני = משפחה.",
        "גיליגאן מול קוהלברג: Care vs Justice.",
      ],
      "אי-שוויון וריבוד חברתי": [
        "דיוויס ומור מול בורדייה (הון תרבותי, אלימות סימבולית).",
        "ארבעת עקרונות הריבוד; ניעות אנכית בין-דורית.",
        "ליברליזם: חופש מ… / תחרות / אי-התערבות.",
      ],
    };

    return weakTopics.slice(0, 5).map((t, i) => ({
      topic: t.topic,
      mastery: t.mastery,
      order: i + 1,
      bullets: tips[t.topic] || [
        "חזרו על מושגי הליבה מהסיכום.",
        "כתבו 3 דוגמאות משלכם לכל מושג.",
        "ענו שוב על השאלות בנושא הזה מחר בבוקר.",
      ],
    }));
  }

  // ── Results UI ─────────────────────────────────────────
  let charts = [];

  function destroyCharts() {
    charts.forEach((c) => { try { c.destroy(); } catch (_) {} });
    charts = [];
  }

  function finishQuiz() {
    showScreen("results");
    els.progressFill.style.width = "100%";
    const A = computeAnalytics();
    logScoreboardIfNeeded(A);
    // Completed run — drop mid-quiz resume payload (scoreboard lives separately)
    if (state.quizId) clearProgress(state.quizId);
    renderResults(A);
  }

  function renderResults(A) {
    destroyCharts();

    // Hero ring
    const pct = A.overallMastery;
    const circumference = 2 * Math.PI * 80; // r=80
    const offset = circumference - (pct / 100) * circumference;
    const ring = $("#ring-fg");
    if (ring) {
      ring.style.strokeDasharray = String(circumference);
      requestAnimationFrame(() => {
        ring.style.strokeDashoffset = String(offset);
      });
    }
    $("#mastery-pct").textContent = pct + "%";
    $("#results-title").textContent = pct >= 80
      ? "שלטת בחומר! 🚀"
      : pct >= 60
        ? "בדרך הנכונה — עוד דחיפה"
        : "יש תוכנית — נמשיך מהחלש";
    $("#results-sub").textContent =
      `${A.firstTryCount}/${A.totalAnswered} נכונות בניסיון ראשון · רצף מקסימלי: ${A.maxStreak}`;

    // Scoreboard badge on results
    const name = (state.playerName || "").trim();
    const tierInfo = scoreLabelFromMastery(A.overallMastery);
    if (els.resultsScoreBadge && name) {
      els.resultsScoreBadge.hidden = false;
      if (els.resultsScoreName) els.resultsScoreName.textContent = name;
      if (els.resultsScoreLabel) els.resultsScoreLabel.textContent = tierInfo.label;
    } else if (els.resultsScoreBadge) {
      els.resultsScoreBadge.hidden = true;
    }

    // Category cards
    const setCat = (sel, list, totalTopics) => {
      const el = $(sel);
      const n = list.length;
      el.querySelector(".cat-count").textContent = n;
      const fill = el.querySelector(".fill-bar > i");
      const pctFill = totalTopics ? Math.round((n / totalTopics) * 100) : 0;
      requestAnimationFrame(() => { fill.style.width = pctFill + "%"; });
    };
    const tCount = Math.max(A.topics.length, 1);
    setCat(".cat-card.strong", A.strongest, tCount);
    setCat(".cat-card.practice", A.needsPractice, tCount);
    setCat(".cat-card.focus", A.focusHere, tCount);

    // Lists
    renderTopicList("#list-strong", A.strongest, "green", "שליטה");
    renderTopicList("#list-practice", A.needsPractice, "yellow", "לתרגל");
    renderTopicList("#list-focus", A.focusHere, "red", "קריטי");

    // Recommendations
    const recOl = $("#rec-list");
    recOl.innerHTML = A.recommendations
      .map((t, i) => `<li>${escapeHtml(t.topic)} <span class="ltr" style="color:var(--muted);font-weight:500;">(${t.mastery}%)</span></li>`)
      .join("") || "<li>כל הכבוד — אין חולשות בולטות</li>";

    // Study plan
    const plan = $("#study-plan");
    if (!A.planTips.length) {
      plan.innerHTML = `<p class="empty-state">שליטה גבוהה בכל הנושאים. חזרו על 5 שאלות אקראיות לפני המבחן.</p>`;
    } else {
      plan.innerHTML = A.planTips
        .map(
          (p) => `
        <div class="plan-item">
          <h4><span class="order">#${p.order}</span>${escapeHtml(p.topic)} <span class="ltr" style="color:var(--muted);font-weight:500;font-size:0.85rem;">(${p.mastery}%)</span></h4>
          <ul>${p.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>
        </div>`
        )
        .join("");
    }

    // Meta metrics
    $("#metric-velocity").textContent =
      A.velocity > 0.05 ? "עולה 📈" : A.velocity < -0.05 ? "יורדת 📉" : "יציבה ➡️";
    $("#metric-attention").textContent = A.attention + "%";
    $("#metric-score").textContent = `${A.firstTryCount}/${A.totalAnswered}`;

    // Charts
    requestAnimationFrame(() => {
      buildTrendChart(A);
      buildRadarChart(A);
      buildBarChart(A);
    });
  }

  function renderTopicList(sel, list, tagClass, label) {
    const ul = $(sel);
    if (!list.length) {
      ul.innerHTML = `<li class="empty-state" style="border:none;background:transparent;">אין פריטים בקטגוריה</li>`;
      return;
    }
    ul.innerHTML = list
      .map(
        (t) => `
      <li>
        <span>${escapeHtml(t.topic)}</span>
        <span class="tag ${tagClass}">${t.mastery}% · ${label}</span>
      </li>`
      )
      .join("");
  }

  function buildTrendChart(A) {
    const canvas = $("#chart-trend");
    if (!canvas || typeof Chart === "undefined") return;
    const labels = A.timeline.map((t) => t.n);
    // Rolling accuracy (window 5)
    const rolling = A.timeline.map((_, i) => {
      const slice = A.timeline.slice(Math.max(0, i - 4), i + 1);
      return Math.round((slice.reduce((s, x) => s + x.firstTry, 0) / slice.length) * 100);
    });
    const pointColors = A.timeline.map((t) =>
      t.firstTry ? "#39ff88" : t.attempts >= 3 ? "#ff4d6d" : "#ffd60a"
    );

    const chart = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "דיוק מצטבר (חלון 5)",
            data: rolling,
            borderColor: "#00f0ff",
            backgroundColor: "rgba(0,240,255,0.1)",
            fill: true,
            tension: 0.35,
            pointBackgroundColor: pointColors,
            pointRadius: 4,
            pointHoverRadius: 7,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: "#f8f9fa", font: { family: "Inter" } } },
          tooltip: {
            callbacks: {
              afterLabel(ctx) {
                const t = A.timeline[ctx.dataIndex];
                return t ? `נושא: ${t.topic}` : "";
              },
            },
          },
        },
        scales: {
          x: {
            ticks: { color: "rgba(248,249,250,0.55)", maxTicksLimit: 12 },
            grid: { color: "rgba(255,255,255,0.05)" },
            title: { display: true, text: "מספר שאלה", color: "rgba(248,249,250,0.55)" },
          },
          y: {
            min: 0,
            max: 100,
            ticks: { color: "rgba(248,249,250,0.55)", callback: (v) => v + "%" },
            grid: { color: "rgba(255,255,255,0.05)" },
          },
        },
      },
    });
    charts.push(chart);
  }

  function buildRadarChart(A) {
    const canvas = $("#chart-radar");
    if (!canvas || typeof Chart === "undefined") return;
    // 5 topics + overall as 6th "domain" pad if needed
    const labels = A.topics.map((t) => t.topic);
    const data = A.topics.map((t) => t.mastery);
    // Chart.js radar works with 5; if we want 6, add attention as domain
    if (labels.length < 6) {
      labels.push("קשב / עקביות");
      data.push(A.attention);
    }

    const chart = new Chart(canvas, {
      type: "radar",
      data: {
        labels,
        datasets: [
          {
            label: "שליטה (%)",
            data,
            borderColor: "#00f0ff",
            backgroundColor: "rgba(0,240,255,0.18)",
            pointBackgroundColor: "#c77dff",
            pointBorderColor: "#f8f9fa",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: "#f8f9fa" } },
        },
        scales: {
          r: {
            min: 0,
            max: 100,
            ticks: { display: false },
            grid: { color: "rgba(255,255,255,0.08)" },
            angleLines: { color: "rgba(255,255,255,0.08)" },
            pointLabels: {
              color: "rgba(248,249,250,0.8)",
              font: { size: 11 },
            },
          },
        },
      },
    });
    charts.push(chart);
  }

  function buildBarChart(A) {
    const canvas = $("#chart-bar");
    if (!canvas || typeof Chart === "undefined") return;
    const chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: A.topics.map((t) => t.topic),
        datasets: [
          {
            label: "שליטה בנושא",
            data: A.topics.map((t) => t.mastery),
            backgroundColor: A.topics.map((t) =>
              t.mastery >= 85
                ? "rgba(57,255,136,0.7)"
                : t.mastery >= 55
                  ? "rgba(255,214,10,0.7)"
                  : "rgba(255,77,109,0.7)"
            ),
            borderRadius: 8,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
        },
        scales: {
          x: {
            ticks: { color: "rgba(248,249,250,0.7)", maxRotation: 30, minRotation: 0, font: { size: 10 } },
            grid: { display: false },
          },
          y: {
            min: 0,
            max: 100,
            ticks: { color: "rgba(248,249,250,0.55)" },
            grid: { color: "rgba(255,255,255,0.05)" },
          },
        },
      },
    });
    charts.push(chart);
  }

  // ── Export study plan ──────────────────────────────────
  function exportStudyPlan() {
    const A = computeAnalytics();
    const lines = [
      "# תוכנית לימוד אישית — Psychology Quiz Master",
      `תאריך: ${new Date().toLocaleString("he-IL")}`,
      `שליטה כוללת: ${A.overallMastery}%`,
      `נכונות בניסיון ראשון: ${A.firstTryCount}/${A.totalAnswered}`,
      `רצף מקסימלי: ${A.maxStreak}`,
      "",
      "## המלצות מיקוד (הלילה)",
      ...A.recommendations.map((t, i) => `${i + 1}. ${t.topic} (${t.mastery}%)`),
      "",
      "## תוכנית לימוד (מהחלש לחזק)",
    ];
    for (const p of A.planTips) {
      lines.push(`\n### ${p.order}. ${p.topic} (${p.mastery}%)`);
      p.bullets.forEach((b) => lines.push(`- ${b}`));
    }
    lines.push("\n## פירוט לפי נושא");
    for (const t of A.topics.sort((a, b) => a.mastery - b.mastery)) {
      lines.push(
        `- ${t.topic}: שליטה ${t.mastery}% | ניסיון ראשון ${t.firstTry}/${t.count} | בלבול: ${t.confused} | ניסיונות מרובים: ${t.multiAttempt}`
      );
    }
    lines.push("\n---\nנוצר אוטומטית מתוך Quiz Master. בהצלחה במבחן! 💪");

    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = activeQuizMeta().exportName || "study-plan.md";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Keyboard ───────────────────────────────────────────
  function onKey(e) {
    if (e.target.matches("input, textarea")) return;

    // Sheet lightbox takes priority
    if (els.sheetLightbox && !els.sheetLightbox.hidden) {
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        closeSheetLightbox();
      }
      return;
    }

    // Modals steal keyboard first
    if (els.nameModal && !els.nameModal.hidden) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeNameModal();
      }
      return; // let input handle Enter
    }
    if (els.scoreboardModal && !els.scoreboardModal.hidden) {
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        closeScoreboard();
      }
      return;
    }

    if (state.screen === "landing") {
      if (e.key === "1" || e.key === "Enter" || e.key === " ") {
        // Prefer resume; otherwise open name gate for first enabled quiz
        if (e.key === "Enter" || e.key === " ") {
          const resume = findResumableQuiz();
          if (resume) {
            e.preventDefault();
            startQuiz(resume, true);
            return;
          }
        }
        const enabled = enabledQuizzes();
        if (e.key === "1" && enabled[0]) {
          e.preventDefault();
          playClick();
          openNameModal(enabled[0].id);
        }
        if (e.key === "2" && enabled[1]) {
          e.preventDefault();
          playClick();
          openNameModal(enabled[1].id);
        }
        return;
      }
    }

    if (state.screen === "question") {
      const map = { "1": "A", "2": "B", "3": "C", "4": "D",
                    "א": "A", "ב": "B", "ג": "C", "ד": "D" };
      if (map[e.key]) {
        e.preventDefault();
        const card = $(`.answer-card[data-key="${map[e.key]}"]:not(:disabled)`);
        if (card) card.click();
      }
      if (e.key === "Enter") {
        const focused = document.activeElement;
        if (focused && focused.classList.contains("answer-card") && !focused.disabled) {
          focused.click();
        }
      }
    }

    if (state.screen === "explain") {
      if (e.key === "Enter" || e.key === "g" || e.key === "G" || e.key === "ק") {
        e.preventDefault();
        advance(true);
      }
      if (e.key === "?" || e.key === "/" || e.key === "c" || e.key === "C") {
        e.preventDefault();
        advance(false);
      }
    }
  }

  // ── UI helpers ─────────────────────────────────────────
  function updateSoundUI() {
    els.soundBtn.classList.toggle("active", state.soundOn);
    els.soundBtn.textContent = state.soundOn ? "🔊" : "🔇";
    els.soundBtn.title = state.soundOn ? "כבה צלילים" : "הפעל צלילים";
  }

  function updateLandingResume() {
    const resume = findResumableQuiz();
    if (resume && els.resumeBtn) {
      els.resumeBtn.classList.add("visible");
      const meta = QUIZ_CATALOG[resume.quizId];
      const label = meta ? meta.shortLabel : resume.quizId;
      els.resumeBtn.textContent = `▶ המשך ${label} · שאלה ${(resume.index || 0) + 1}`;
    } else if (els.resumeBtn) {
      els.resumeBtn.classList.remove("visible");
    }
  }

  // ── Init ───────────────────────────────────────────────
  function init() {
    initStarfield();
    initKnowledgeBlocks();

    // Landing cards: ask for name, then start
    $$(".quiz-card[data-quiz]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-quiz");
        if (!id || !QUIZ_CATALOG[id] || QUIZ_CATALOG[id].enabled === false) return;
        playClick();
        openNameModal(id);
      });
    });
    els.resumeBtn?.addEventListener("click", () => {
      playClick();
      const resume = findResumableQuiz();
      if (resume) startQuiz(resume, true);
    });

    // Name modal
    els.btnNameStart?.addEventListener("click", () => {
      playClick();
      confirmNameAndStart();
    });
    els.btnNameCancel?.addEventListener("click", () => {
      playClick();
      closeNameModal();
    });
    els.playerNameInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        confirmNameAndStart();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeNameModal();
      }
    });
    els.nameModal?.addEventListener("click", (e) => {
      if (e.target === els.nameModal) closeNameModal();
    });

    // Scoreboard
    els.scoreboardBtn?.addEventListener("click", () => {
      playClick();
      openScoreboard();
    });
    els.btnScoreboardClose?.addEventListener("click", () => {
      playClick();
      closeScoreboard();
    });
    els.btnScoreboardDone?.addEventListener("click", () => {
      playClick();
      closeScoreboard();
    });
    els.btnScoreboardClear?.addEventListener("click", () => {
      if (confirm("לנקות את כל לוח התוצאות במכשיר הזה?")) {
        saveScoreboard([]);
        renderScoreboard();
        playClick();
      }
    });
    els.scoreboardModal?.addEventListener("click", (e) => {
      if (e.target === els.scoreboardModal) closeScoreboard();
    });

    els.soundBtn.addEventListener("click", () => {
      state.soundOn = !state.soundOn;
      updateSoundUI();
      if (state.soundOn) playClick();
      // persist sound preference on whichever quiz has progress, else skip
      if (state.quizId) saveProgress();
    });
    els.resetBtn.addEventListener("click", () => {
      if (confirm("לאפס את כל ההתקדמות (כל המבחנים) ולהתחיל מחדש?")) {
        clearProgress();
        destroyCharts();
        state.quizId = null;
        state.index = 0;
        state.score = 0;
        state.answers = [];
        state.streak = 0;
        state.lockedBlocks = 0;
        resetKnowledgeBlocksVisual();
        showScreen("landing");
        updateLandingResume();
      }
    });

    els.btnGotIt.addEventListener("click", () => advance(true));
    els.btnConfused.addEventListener("click", () => advance(false));

    els.btnSheetExpand?.addEventListener("click", () => {
      playClick();
      openSheetLightbox();
    });
    els.btnSheetOpenHl?.addEventListener("click", () => {
      playClick();
      openSheetLightbox();
    });
    els.btnSheetClose?.addEventListener("click", () => {
      playClick();
      closeSheetLightbox();
    });
    els.sheetLightbox?.addEventListener("click", (e) => {
      if (e.target === els.sheetLightbox) closeSheetLightbox();
    });

    $("#btn-export")?.addEventListener("click", exportStudyPlan);
    $("#btn-restart")?.addEventListener("click", () => {
      if (state.quizId) clearProgress(state.quizId);
      destroyCharts();
      state.quizId = null;
      showScreen("landing");
      updateLandingResume();
    });

    document.addEventListener("keydown", onKey);

    // Landing quiz card stats + hide disabled quizzes
    const elPsychQ = $("#stat-psych-q");
    const elShesaimQ = $("#stat-shesaim-q");
    const elLogicbQ = $("#stat-logicb-q");
    const elSocQ = $("#stat-sociology-q");
    if (elPsychQ && QUIZ_CATALOG.psychology) {
      elPsychQ.textContent = String(QUIZ_CATALOG.psychology.questions.length);
    }
    if (elShesaimQ && QUIZ_CATALOG.shesaim) {
      elShesaimQ.textContent = String(QUIZ_CATALOG.shesaim.questions.length);
    }
    if (elLogicbQ && QUIZ_CATALOG.logicb) {
      elLogicbQ.textContent = String(QUIZ_CATALOG.logicb.questions.length);
    }
    if (elSocQ && QUIZ_CATALOG.sociology) {
      elSocQ.textContent = String(QUIZ_CATALOG.sociology.questions.length);
    }

    // Hide cards for disabled quizzes; show only enabled ones
    $$(".quiz-card[data-quiz]").forEach((btn) => {
      const id = btn.getAttribute("data-quiz");
      const meta = id && QUIZ_CATALOG[id];
      if (!meta || meta.enabled === false) {
        btn.hidden = true;
        btn.setAttribute("aria-hidden", "true");
      } else {
        btn.hidden = false;
        btn.removeAttribute("aria-hidden");
      }
    });

    const enabled = enabledQuizzes();
    const countPill = document.querySelector(".landing-stats .stat-pill strong");
    // Update first stat pill if it shows quiz count
    const pills = $$(".landing-stats .stat-pill");
    if (pills[0]) {
      pills[0].innerHTML = `<strong>${enabled.length}</strong> מבחן${enabled.length === 1 ? "" : "ים"}`;
    }
    const kbd = document.querySelector("#screen-landing .kbd-hint");
    if (kbd) {
      if (enabled.length === 1) {
        kbd.innerHTML = `מקלדת: <kbd>1</kbd> התחל · <kbd>Enter</kbd> המשך אם יש`;
      } else if (enabled.length >= 2) {
        kbd.innerHTML = `מקלדת: <kbd>1</kbd>–<kbd>${Math.min(enabled.length, 9)}</kbd> בחירת מבחן · <kbd>Enter</kbd> המשך`;
      }
    }

    updateSoundUI();
    updateLandingResume();
    showScreen("landing");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
