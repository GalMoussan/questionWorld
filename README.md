# Psychology Quiz Master

Interactive, dark-themed, ADHD-friendly quiz app for cramming academic sim exams (Hebrew).

**Two quizzes on the start menu:**

| Quiz | Questions | Sheet (דף עזר) |
|------|-----------|----------------|
| **Psychology** | 50 | Yes — remembrance sheet with highlights |
| **SHESAIM** | 14 | No — explanations only |

Space game-show vibes + real learning analytics. Built to run **locally in the browser** with no build step.

## Quick start

1. Open the project folder.
2. Double-click **`index.html`**, or from a terminal:

```bash
cd /Users/galmoussan/projects/claude/grok-projects/questionWorld
open index.html
# or: python3 -m http.server 8765  →  http://localhost:8765
```

3. Pick a quiz card: **Psychology** or **SHESAIM**. Optional: resume from localStorage if you refresh mid-run.

## Deploy to Vercel (mobile)

Static site — no build step.

```bash
# once: log in (opens browser)
vercel login

# from project root
vercel --prod
```

Or import the GitHub repo at [vercel.com/new](https://vercel.com/new):
- **Framework Preset:** Other
- **Root Directory:** `.` (repo root)
- **Build Command:** leave empty
- **Output Directory:** `.` (or leave default)

After deploy, open the `*.vercel.app` URL on your phone. On iOS Safari: Share → **Add to Home Screen** for app-like use.

**Files you need:**

| File | Role |
|------|------|
| `index.html` | App shell |
| `styles.css` | Theme, motion, layout |
| `app.js` | Game flow, analytics, sound, storage |
| `questions.js` | Psychology question bank |
| `questions-shesaim.js` | SHESAIM (שסעים חברתיים) bank — no sheet refs |
| `questions.md` | Human-editable psychology source |
| `questions-shesaim.md` | Human-editable SHESAIM source |
| `questions.json` | Machine-readable psychology bank |
| `assets/remembrance-sheet.pdf` | דף עזר — Psychology explanations only |
| `tools/sheet-refs.mjs` | Page + section map for each question |

Chart.js is loaded from a CDN for the results charts. Everything else is offline-capable once fonts/CDN are cached.

---

## Where to put / update questions

### Format (`questions.md`)

```markdown
## Question 1
**Topic:** תהליכי למידה
**Sheet:** עמוד 1 · הגדרת למידה · optional scan hint
**Question:** Full question text?

A. Option 1
B. Option 2
C. Option 3
D. Option 4

**Correct Answer:** B
**Explanation:** 2–4 sentences why correct + why others are wrong.
```

After each correct answer, the explain screen shows **איפה בדף העזר?** with:

- page number + section title + scan hint
- a **live page image** of the דף עזר with the answer region **highlighted** (dimmed surroundings + cyan box)
- expand (fullscreen) and open full PDF links

### Regenerating page highlights

```bash
python3 tools/build-sheet-highlights.py
```

This reads `assets/remembrance-sheet.pdf`, finds text anchors per question, writes:

- `assets/sheet/page-1.png` … `page-4.png`
- `assets/sheet/highlights.json` (normalized highlight rectangles)

Edit section labels in `tools/sheet-refs.mjs` and pixel anchors in `tools/build-sheet-highlights.py`.

Letter of the correct answer in the file does **not** matter long-term — the rebuild + runtime engines re-place every correct text onto an anti-pattern A/B/C/D curve.

### After adding or editing questions

```bash
cd /Users/galmoussan/projects/claude/grok-projects/questionWorld
node tools/rebuild-questions.mjs
```

This parses `questions.md`, builds a balanced anti-pattern correct-letter sequence, rewrites:

- `questions.json`
- `questions.js` (loaded by the app)
- `questions.md` (cleaned + reshuffled options)

Then hard-refresh the browser and click **START THE QUIZ** (not resume).

### Runtime shuffle (every new quiz)

On **START THE QUIZ** the app also:

1. **Shuffles question order** (topics no longer appear in fixed chapter blocks)
2. Builds a new **anti-pattern answer curve** (no B/C-then-A/D blocks, no streaks ≥ 3, no ABAB rhythms, first/last 10 always use all 4 letters)
3. Places each correct text onto that curve and randomly fills the three wrongs

So even if two people use the same bank, their correct-letter sequences differ every run.

The original Word file was imported from:

`/Users/galmoussan/Downloads/psychology_sim_exam.docx`

Raw pandoc extract (optional): `psychology_questions_raw.md`

---

## How analytics recommendations work

Per **question** the app tracks:

| Signal | Meaning |
|--------|---------|
| `attempts` | 1 = perfect first try; 2+ = struggled |
| `timeToFirstClick` | ms until first answer (attention consistency) |
| `gotIt` | ✓ הבנתי vs ? עדיין מבולבל/ת |
| `topic` | From question metadata |

### Mastery score (per question → averaged per topic)

| Attempts | Base mastery |
|----------|----------------|
| First try correct | **100%** |
| Correct on 2nd try | **70%** |
| Correct on 3rd+ try | **40%** |

Then adjusted by self-assessment:

- **Got it** → +5 (capped at 100)
- **Still confused** → −15 (floored at 0)

### Buckets on the results screen

- **Strongest** — high mastery (≥85%) and no “still confused”
- **Needs practice** — “still confused” clicks or mid mastery (55–85%)
- **Focus here** — multi-attempt questions or mastery &lt; 55%

### Focus Recommendation (top 3 tonight)

Topics sorted by weakest score:

```
score = mastery − (multiAttempt × 8) − (confused × 10)
```

Lowest scores rise to the top of the study list.

### Other metrics

- **Learning velocity** — first-try rate in second half of the quiz minus first half
- **Attention / consistency** — lower variability in time-to-first-click → higher score
- **Study plan** — weakest topics first, with 2–3 review bullets each (exportable `.md`)

---

## Controls

| Input | Action |
|-------|--------|
| `1`–`4` or `א`–`ד` | Select answer |
| `Enter` | Start / “Got it” / activate focused answer |
| `?` | Still confused (explanation screen) |
| 🔊 | Toggle sound (Web Audio chimes — no files) |
| ↺ | Reset progress |

Progress auto-saves to **localStorage** (`psychQuizMaster_v1`) so a refresh mid-quiz can resume.

---

## Design notes

- Palette: deep space `#0a0a0f`, cyan `#00f0ff`, magenta `#ff006e`, lavender `#c77dff`
- RTL Hebrew UI, large question type, 48px+ targets
- Wrong answers: shake + try again (no shame, card disabled, keep going)
- Correct: confetti, cyan flash, knowledge-block “snap”
- Results: ring mastery %, radar, trend, bars, exportable study plan

בהצלחה במבחן. You've got this.
