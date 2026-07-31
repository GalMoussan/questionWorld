#!/usr/bin/env node
/**
 * Rebalance Logic-B option letters with the anti-pattern answer curve.
 *
 * Same engine as psychology (`tools/answer-curve.mjs`):
 *  - ~equal A/B/C/D counts
 *  - no long same-letter streaks
 *  - no B/C-only or A/D-only monopolies
 *  - no ABAB rhythms
 *
 * Runtime (app.js) re-shuffles again every new quiz session.
 *
 * Usage:
 *   node tools/rebuild-logicb-questions.mjs
 *   node tools/rebuild-logicb-questions.mjs path/to/questions-logicb.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildAnswerCurve, layoutQuestion, LETTERS } from "./answer-curve.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const jsPath = path.resolve(process.argv[2] || path.join(root, "questions-logicb.js"));

function parseBank(src) {
  const m = src.match(/const LOGICB_QUESTIONS\s*=\s*(\[[\s\S]*?\n\]);/);
  if (!m) throw new Error("Could not parse LOGICB_QUESTIONS from " + jsPath);
  return JSON.parse(m[1]);
}

function writeBank(questions) {
  const header = `// לוגיקה ב — פול פאוור
// Auto-balanced option letters via tools/rebuild-logicb-questions.mjs
// Runtime (app.js) re-shuffles again every new quiz with anti-pattern curve.
// Source sheets: assets/logic-b/tamsir-1.pdf … tamsir-11.pdf
// sheetRef.doc = תמסיר number (1–11); page = page inside that PDF.
// Append: node tools/merge-logicb-questions.mjs extra.json  (rebalances automatically)
const LOGICB_QUESTIONS = `;
  const footer = `;

if (typeof window !== "undefined") {
  window.LOGICB_QUESTIONS = LOGICB_QUESTIONS;
}
`;
  fs.writeFileSync(jsPath, header + JSON.stringify(questions, null, 2) + footer, "utf8");
}

function main() {
  const raw = fs.readFileSync(jsPath, "utf8");
  const parsed = parseBank(raw);
  if (!parsed.length) {
    console.error("No questions in", jsPath);
    process.exit(1);
  }

  const before = { A: 0, B: 0, C: 0, D: 0 };
  parsed.forEach((q) => {
    before[q.correct] = (before[q.correct] || 0) + 1;
  });

  // Bank-order curve (runtime will re-curve + re-order every session)
  const { curve, score } = buildAnswerCurve(parsed.length, {
    restarts: 20,
    stepsPerRestart: 2000,
  });

  const laidOut = parsed.map((q, i) => {
    const laid = layoutQuestion(q, curve[i]);
    // layoutQuestion returns id/topic/question/explanation/options/correct
    // preserve sheetRef + any future fields
    if (q.sheetRef) laid.sheetRef = { ...q.sheetRef };
    if (q.topic) laid.topic = q.topic;
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

  const after = { A: 0, B: 0, C: 0, D: 0 };
  laidOut.forEach((q) => {
    after[q.correct]++;
  });
  const sequence = laidOut.map((q) => q.correct).join("");

  writeBank(laidOut);

  console.log(`Rebuilt ${laidOut.length} Logic-B questions → ${path.basename(jsPath)}`);
  console.log(`Before counts:`, before);
  console.log(`After counts: `, after);
  console.log(`Curve score: ${score} (0 = ideal)`);
  console.log(`Sequence: ${sequence}`);
  console.log(`First 15: ${sequence.slice(0, 15).split("").join(" ")}`);
  console.log(
    `BC share: ${(((after.B + after.C) / laidOut.length) * 100).toFixed(1)}% (target ~50%)`
  );
}

main();
