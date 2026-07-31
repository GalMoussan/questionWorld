#!/usr/bin/env node
/**
 * Merge additional Logic-B questions from a JSON array into questions-logicb.js
 * Then anti-pattern rebalance all option letters (same as psychology rebuild).
 *
 * Usage:
 *   node tools/merge-logicb-questions.mjs path/to/extra-questions.json
 *
 * JSON format: array of question objects (see questions-logicb.append.example.json)
 * Required: id, topic, question, explanation, options{A,B,C,D}, correct
 * Optional: sheetRef { doc, page, section, hint }
 *
 * After merge:
 *   - option letters are rebalanced (A/B/C/D anti-pattern curve)
 *   - for pixel highlights on new ids, add ANCHORS in tools/build-logicb-highlights.py
 *     then: python3 tools/build-logicb-highlights.py
 *
 * Note: app.js also re-shuffles every NEW quiz session at runtime.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildAnswerCurve, layoutQuestion } from "./answer-curve.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const jsPath = path.join(root, "questions-logicb.js");
const extraPath = process.argv[2];

if (!extraPath) {
  console.error("Usage: node tools/merge-logicb-questions.mjs <extra.json>");
  process.exit(1);
}

const extra = JSON.parse(fs.readFileSync(path.resolve(extraPath), "utf8"));
if (!Array.isArray(extra)) {
  console.error("Expected a JSON array of questions");
  process.exit(1);
}

const src = fs.readFileSync(jsPath, "utf8");
const m = src.match(/const LOGICB_QUESTIONS\s*=\s*(\[[\s\S]*?\n\]);/);
if (!m) {
  console.error("Could not parse LOGICB_QUESTIONS from questions-logicb.js");
  process.exit(1);
}
const existing = JSON.parse(m[1]);
const byId = new Map(existing.map((q) => [q.id, q]));

let added = 0;
let replaced = 0;
for (const q of extra) {
  if (!q.id || !q.topic || !q.question || !q.explanation || !q.options || !q.correct) {
    console.warn("Skipping invalid question:", q?.id);
    continue;
  }
  for (const k of ["A", "B", "C", "D"]) {
    if (!q.options[k]) console.warn(`Q${q.id}: missing option ${k}`);
  }
  if (byId.has(q.id)) replaced++;
  else added++;
  byId.set(q.id, {
    id: q.id,
    topic: q.topic,
    question: q.question,
    explanation: q.explanation,
    options: q.options,
    correct: String(q.correct).toUpperCase(),
    ...(q.sheetRef ? { sheetRef: q.sheetRef } : {}),
  });
}

const merged = [...byId.values()].sort((a, b) => a.id - b.id);

// ── Anti-pattern rebalance (ignore source letters entirely) ──
const { curve, score } = buildAnswerCurve(merged.length, {
  restarts: 20,
  stepsPerRestart: 2000,
});

const balanced = merged.map((q, i) => {
  const laid = layoutQuestion(q, curve[i]);
  return {
    id: q.id,
    topic: q.topic,
    question: q.question,
    explanation: q.explanation,
    options: laid.options,
    correct: laid.correct,
    ...(q.sheetRef ? { sheetRef: { ...q.sheetRef } } : {}),
  };
});

const counts = { A: 0, B: 0, C: 0, D: 0 };
balanced.forEach((q) => counts[q.correct]++);
const sequence = balanced.map((q) => q.correct).join("");

const header = `// לוגיקה ב — פול פאוור
// Auto-balanced option letters via tools/merge-logicb-questions.mjs
// Runtime (app.js) re-shuffles again every new quiz with anti-pattern curve.
// Source sheets: assets/logic-b/tamsir-1.pdf … tamsir-11.pdf
// sheetRef.doc = תמסיר number (1–11); page = page inside that PDF.
const LOGICB_QUESTIONS = `;
const footer = `;

if (typeof window !== "undefined") {
  window.LOGICB_QUESTIONS = LOGICB_QUESTIONS;
}
`;

fs.writeFileSync(
  jsPath,
  header + JSON.stringify(balanced, null, 2) + footer,
  "utf8"
);

console.log(
  `Merged: +${added} new, ${replaced} replaced, total ${balanced.length} → ${jsPath}`
);
console.log(`Anti-pattern curve score: ${score} (0 = ideal)`);
console.log(`Letter counts:`, counts);
console.log(`Sequence: ${sequence}`);
console.log(
  `BC share: ${(((counts.B + counts.C) / balanced.length) * 100).toFixed(1)}% (target ~50%)`
);
console.log(
  "Next (optional highlights): add ANCHORS in tools/build-logicb-highlights.py for new ids, then run that script."
);
