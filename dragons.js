/* ═══════════════════════════════════════════════════════════
   Quiz Realm — Dragon Summon Engine
   Dragons emerge from UI nests (cards, brand, buttons…)
   and fly across the full viewport. Variable spectacle each time.
   ═══════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  const STORAGE_KEY = "quizRealm_dragonSummons_v1";
  const PREFERS_REDUCED =
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;

  const PALETTES = [
    { name: "ember", body: "#ff4d00", wing: "#ffb703", glow: "rgba(255, 107, 53, 0.75)", trail: "#ff6b35" },
    { name: "violet", body: "#9b5de5", wing: "#c77dff", glow: "rgba(199, 125, 255, 0.75)", trail: "#c77dff" },
    { name: "cyan", body: "#00d4ff", wing: "#7dfff0", glow: "rgba(0, 240, 255, 0.7)", trail: "#00f0ff" },
    { name: "jade", body: "#00c896", wing: "#39ff88", glow: "rgba(57, 255, 136, 0.65)", trail: "#39ff88" },
    { name: "rose", body: "#ff006e", wing: "#ff8fa3", glow: "rgba(255, 0, 110, 0.7)", trail: "#ff4d6d" },
    { name: "gold", body: "#ffb703", wing: "#ffe566", glow: "rgba(255, 214, 10, 0.75)", trail: "#ffd60a" },
  ];

  const STATUS_LINES = [
    "The realm opens…",
    "Dragons rising from the interface…",
    "They remember who summoned them.",
    "Flight path: your entire screen.",
    "Wonder first. Quiz second.",
    "Variable reward engaged.",
  ];

  let active = false;
  let animFrame = 0;
  let emberFrame = 0;
  let dragons = [];
  let embers = [];
  let endTimer = 0;
  let audioCtx = null;

  const $ = (sel) => document.querySelector(sel);

  function loadCount() {
    try {
      return Math.max(0, parseInt(localStorage.getItem(STORAGE_KEY) || "0", 10) || 0);
    } catch (_) {
      return 0;
    }
  }

  function saveCount(n) {
    try {
      localStorage.setItem(STORAGE_KEY, String(n));
    } catch (_) { /* ignore */ }
  }

  function updateCountUI() {
    const el = $("#summon-count");
    if (el) el.textContent = String(loadCount());
  }

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  /** Collect spawn points from real UI items — dragons emerge THROUGH the interface */
  function collectNests() {
    const nodes = Array.from(document.querySelectorAll("[data-dragon-nest]"));
    const nests = [];
    for (const node of nodes) {
      if (node.hidden) continue;
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const r = node.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      nests.push({
        id: node.getAttribute("data-dragon-nest") || "item",
        el: node,
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        w: r.width,
        h: r.height,
      });
    }
    // Always have fallbacks so summon works mid-quiz too
    if (!nests.length) {
      const brand = $(".brand");
      if (brand) {
        const r = brand.getBoundingClientRect();
        nests.push({ id: "brand", el: brand, x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height });
      }
      nests.push({
        id: "viewport",
        el: document.body,
        x: window.innerWidth * 0.5,
        y: window.innerHeight * 0.35,
        w: 40,
        h: 40,
      });
    }
    return nests;
  }

  function dragonSVG(palette, scale) {
    const id = "d" + Math.random().toString(36).slice(2, 9);
    // Stylized side-view dragon — wings are separate for flap animation
    return `
<svg class="dragon-svg" viewBox="0 0 160 90" width="${Math.round(140 * scale)}" height="${Math.round(80 * scale)}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="${id}-body" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${palette.wing}"/>
      <stop offset="55%" stop-color="${palette.body}"/>
      <stop offset="100%" stop-color="#1a0a12"/>
    </linearGradient>
    <linearGradient id="${id}-wing" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${palette.wing}" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="${palette.body}" stop-opacity="0.55"/>
    </linearGradient>
    <filter id="${id}-glow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="2.2" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <g filter="url(#${id}-glow)">
    <!-- lower wing -->
    <g class="dragon-wing dragon-wing-back">
      <path d="M62 42 C48 18, 28 10, 12 22 C28 24, 40 34, 48 48 C40 44, 52 44, 62 42 Z" fill="url(#${id}-wing)" opacity="0.75"/>
    </g>
    <!-- body + neck + head -->
    <path d="M48 48
      C58 40, 78 36, 96 40
      C108 42, 120 40, 132 36
      C138 34, 146 32, 150 36
      C146 40, 140 42, 134 44
      C128 52, 118 58, 104 60
      C90 62, 74 60, 60 56
      C52 54, 46 52, 48 48 Z" fill="url(#${id}-body)"/>
    <!-- belly scales hint -->
    <path d="M72 52 C86 54, 100 54, 114 50" stroke="${palette.wing}" stroke-width="1.2" fill="none" opacity="0.45"/>
    <!-- horns -->
    <path d="M136 34 L140 22 L142 34" fill="${palette.wing}"/>
    <path d="M130 36 L132 26 L135 36" fill="${palette.body}"/>
    <!-- eye -->
    <circle cx="140" cy="38" r="2.2" fill="#fff"/>
    <circle cx="140.6" cy="38" r="1" fill="#0a0a0f"/>
    <!-- snout flame pocket -->
    <ellipse class="dragon-muzzle-glow" cx="150" cy="36" rx="4" ry="2.5" fill="${palette.trail}" opacity="0.55"/>
    <!-- tail -->
    <path d="M52 50 C36 56, 24 62, 14 74 C28 66, 40 60, 54 54" fill="url(#${id}-body)"/>
    <path d="M16 72 L8 68 L12 78 L20 76 Z" fill="${palette.wing}"/>
    <!-- upper wing (flaps) -->
    <g class="dragon-wing dragon-wing-front">
      <path d="M68 44 C58 8, 30 0, 8 16 C30 14, 48 28, 58 46 C50 40, 60 42, 68 44 Z" fill="url(#${id}-wing)"/>
      <path d="M30 18 L42 36 M22 22 L38 40 M16 28 L34 44" stroke="${palette.body}" stroke-width="1" opacity="0.35"/>
    </g>
    <!-- legs tucked -->
    <path d="M88 58 L92 70 L86 68 M102 60 L108 72 L100 70" stroke="${palette.body}" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="0.85"/>
  </g>
</svg>`;
  }

  function makeDragon(nest, index, total) {
    const palette = pick(PALETTES);
    const scale = rand(0.72, 1.35);
    const stage = $("#dragon-stage");
    const wrap = document.createElement("div");
    wrap.className = "dragon-entity";
    wrap.dataset.palette = palette.name;
    wrap.style.setProperty("--dragon-glow", palette.glow);
    wrap.style.setProperty("--dragon-trail", palette.trail);
    wrap.innerHTML = dragonSVG(palette, scale);
    stage.appendChild(wrap);

    // Burst ring from the nest
    if (nest.el && nest.el !== document.body) {
      nest.el.classList.add("dragon-nest-burst");
      setTimeout(() => nest.el.classList.remove("dragon-nest-burst"), 900);
    }

    const w = window.innerWidth;
    const h = window.innerHeight;
    const startX = nest.x;
    const startY = nest.y;

    // Exit toward random edges — full computer screen flight
    const exits = [
      { x: -180, y: rand(-40, h + 40) },
      { x: w + 180, y: rand(-40, h + 40) },
      { x: rand(-40, w + 40), y: -160 },
      { x: rand(-40, w + 40), y: h + 160 },
    ];
    const exit = pick(exits);

    // Control points for a sweeping cubic curve
    const cx1 = startX + rand(-w * 0.2, w * 0.35) + (index - total / 2) * 40;
    const cy1 = startY + rand(-h * 0.45, h * 0.2);
    const cx2 = exit.x + rand(-w * 0.25, w * 0.25);
    const cy2 = exit.y + rand(-h * 0.3, h * 0.3);

    const duration = rand(5200, 9800);
    const delay = index * rand(120, 280);
    const spin = rand(-18, 18);

    return {
      el: wrap,
      palette,
      startX,
      startY,
      cx1,
      cy1,
      cx2,
      cy2,
      endX: exit.x,
      endY: exit.y,
      duration,
      delay,
      t0: performance.now() + delay,
      scale,
      spin,
      lastX: startX,
      lastY: startY,
      alive: true,
      emerged: false,
    };
  }

  function cubic(t, p0, p1, p2, p3) {
    const u = 1 - t;
    return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
  }

  function easeInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function spawnEmber(x, y, color) {
    embers.push({
      x,
      y,
      vx: rand(-1.2, 1.2),
      vy: rand(-2.8, -0.4),
      life: rand(0.4, 1),
      decay: rand(0.008, 0.02),
      size: rand(1.5, 4.5),
      color,
    });
  }

  function resizeEmbers() {
    const canvas = $("#dragon-embers");
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawEmbers() {
    const canvas = $("#dragon-embers");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (let i = embers.length - 1; i >= 0; i--) {
      const p = embers[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy -= 0.02;
      p.life -= p.decay;
      if (p.life <= 0) {
        embers.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = clamp(p.life, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function tick(now) {
    if (!active) return;

    let anyAlive = false;
    for (const d of dragons) {
      if (!d.alive) continue;
      const raw = (now - d.t0) / d.duration;
      if (raw < 0) {
        anyAlive = true;
        d.el.style.opacity = "0";
        continue;
      }
      if (raw >= 1) {
        d.alive = false;
        d.el.remove();
        continue;
      }
      anyAlive = true;
      const t = easeInOut(clamp(raw, 0, 1));
      const x = cubic(t, d.startX, d.cx1, d.cx2, d.endX);
      const y = cubic(t, d.startY, d.cy1, d.cy2, d.endY);

      // Face flight direction
      const dx = x - d.lastX;
      const dy = y - d.lastY;
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI + d.spin;
      d.lastX = x;
      d.lastY = y;

      // Emerge: scale from 0.15 → full, then slight breathe
      let emerge = 1;
      if (raw < 0.08) {
        emerge = easeInOut(raw / 0.08);
        if (!d.emerged) {
          d.emerged = true;
          // portal burst particles at nest
          for (let i = 0; i < 14; i++) spawnEmber(d.startX, d.startY, d.palette.trail);
        }
      }
      const breathe = 1 + Math.sin(now / 180 + d.delay) * 0.03;
      const opacity = raw < 0.06 ? emerge : raw > 0.88 ? (1 - raw) / 0.12 : 1;

      d.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${angle}deg) scale(${d.scale * emerge * breathe})`;
      d.el.style.opacity = String(clamp(opacity, 0, 1));

      // Trail embers
      if (Math.random() < 0.55) {
        spawnEmber(x - dx * 2, y - dy * 2, d.palette.trail);
      }
    }

    drawEmbers();

    if (anyAlive || embers.length) {
      animFrame = requestAnimationFrame(tick);
    } else {
      finishSummon();
    }
  }

  function playSummonSound() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === "suspended") audioCtx.resume();
      const now = audioCtx.currentTime;

      // Deep whoosh
      const bufferSize = audioCtx.sampleRate * 0.9;
      const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 1.8);
      }
      const noise = audioCtx.createBufferSource();
      noise.buffer = buffer;
      const filter = audioCtx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(180, now);
      filter.frequency.exponentialRampToValueAtTime(1200, now + 0.6);
      filter.Q.value = 0.7;
      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.18, now + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(audioCtx.destination);
      noise.start(now);
      noise.stop(now + 0.95);

      // Crystal chord pings
      [392, 523.25, 659.25, 783.99].forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(0.06, now + 0.05 + i * 0.07);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 1.2 + i * 0.1);
        osc.connect(g);
        g.connect(audioCtx.destination);
        osc.start(now + i * 0.06);
        osc.stop(now + 1.4 + i * 0.1);
      });
    } catch (_) { /* audio optional */ }
  }

  function setStatus(text) {
    const el = $("#dragon-status");
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("visible", Boolean(text));
  }

  function finishSummon() {
    active = false;
    cancelAnimationFrame(animFrame);
    cancelAnimationFrame(emberFrame);
    clearTimeout(endTimer);
    dragons = [];
    embers = [];
    const stage = $("#dragon-stage");
    if (stage) stage.innerHTML = "";
    const canvas = $("#dragon-embers");
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    document.body.classList.remove("dragons-active");
    const realm = $("#dragon-realm");
    if (realm) {
      realm.classList.remove("active");
      realm.setAttribute("aria-hidden", "true");
    }
    setStatus("");
    $$btn().forEach((b) => {
      b.classList.remove("summoning");
      b.disabled = false;
    });
  }

  function $$btn() {
    return Array.from(document.querySelectorAll("#btn-summon-dragons, #btn-summon-chrome"));
  }

  function summon() {
    if (active) return;
    if (PREFERS_REDUCED) {
      // Still give a gentle moment — honor reduced motion without full flight
      document.body.classList.add("dragons-active", "dragons-reduced");
      setStatus("Dragons nod from the mist (reduced motion).");
      const n = loadCount() + 1;
      saveCount(n);
      updateCountUI();
      setTimeout(() => {
        document.body.classList.remove("dragons-active", "dragons-reduced");
        setStatus("");
      }, 2200);
      return;
    }

    active = true;
    const nests = collectNests();
    // Prefer real UI nests; shuffle for variety
    const shuffled = nests.slice().sort(() => Math.random() - 0.5);
    const count = clamp(Math.floor(rand(4, 8)), 3, Math.max(3, shuffled.length + 2));
    const chosen = [];
    for (let i = 0; i < count; i++) {
      chosen.push(shuffled[i % shuffled.length]);
    }

    resizeEmbers();
    document.body.classList.add("dragons-active");
    const realm = $("#dragon-realm");
    if (realm) {
      realm.classList.add("active");
      realm.setAttribute("aria-hidden", "false");
    }

    $$btn().forEach((b) => {
      b.classList.add("summoning");
      b.disabled = true;
    });

    const n = loadCount() + 1;
    saveCount(n);
    updateCountUI();
    setStatus(pick(STATUS_LINES));
    playSummonSound();

    const stage = $("#dragon-stage");
    if (stage) stage.innerHTML = "";
    dragons = chosen.map((nest, i) => makeDragon(nest, i, chosen.length));

    // Safety end
    endTimer = setTimeout(() => {
      if (active) finishSummon();
    }, 14000);

    animFrame = requestAnimationFrame(tick);

    // Rotate status mid-flight
    setTimeout(() => {
      if (active) setStatus(pick(STATUS_LINES));
    }, 2800);
  }

  function init() {
    updateCountUI();
    resizeEmbers();
    window.addEventListener("resize", () => {
      if (active) resizeEmbers();
    });

    const mainBtn = $("#btn-summon-dragons");
    const chromeBtn = $("#btn-summon-chrome");
    mainBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      summon();
    });
    chromeBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      summon();
    });

    document.addEventListener("keydown", (e) => {
      if (e.defaultPrevented) return;
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable) return;
      if (e.key === "d" || e.key === "D") {
        // Don't steal when typing Hebrew etc. — single letter ok on landing/quiz
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        e.preventDefault();
        summon();
      }
      if (e.key === "Escape" && active) {
        finishSummon();
      }
    });
  }

  // Public API
  window.QuizDragons = {
    summon,
    dismiss: finishSummon,
    getCount: loadCount,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
