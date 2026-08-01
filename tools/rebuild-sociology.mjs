#!/usr/bin/env node
/**
 * Rebuild sociology question bank from questions-sociology.raw.json
 * with anti-pattern answer layouts (balanced A/B/C/D, no easy patterns).
 *
 * Usage:
 *   node tools/rebuild-sociology.mjs
 *
 * How to append questions the user prepares later:
 *   1. Open questions-sociology.raw.json
 *   2. Add an object:
 *      {
 *        "topic": "…",
 *        "sheetSection": "1.4 דירקהיים",   // heading from remembrance sheet
 *        "page": 1,                        // PDF page (1 or 2)
 *        "question": "…?",
 *        "correct": "the right answer text",
 *        "wrong": ["distractor1", "distractor2", "distractor3"],
 *        "explanation": "why — ties back to the sheet"
 *      }
 *   3. Run this script — it re-ids, re-layouts options, writes questions-sociology.js
 *
 * sheetSection should match a heading in assets/sociology/remembrance-sheet.pdf
 * (e.g. "1.1 חברה", "2.3 הגישה הסטרוקטורלית-פונקציונלית", "6.4 ריבוד לפי הגישות").
 *
 * Runtime note: app.js shuffles option letters again every new quiz session.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildAnswerCurve, layoutQuestion } from "./answer-curve.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const rawPath = path.join(root, "questions-sociology.raw.json");
const outPath = path.join(root, "questions-sociology.js");

function main() {
  const raw = JSON.parse(fs.readFileSync(rawPath, "utf8"));
  if (!Array.isArray(raw) || raw.length < 1) {
    console.error("Empty or invalid raw bank:", rawPath);
    process.exit(1);
  }

  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    if (!r.question || !r.correct || !Array.isArray(r.wrong) || r.wrong.length < 3) {
      console.error(`Invalid item at index ${i} (need question, correct, wrong[3]):`, r);
      process.exit(1);
    }
  }

  const { curve, score } = buildAnswerCurve(raw.length, {
    restarts: 24,
    stepsPerRestart: 2000,
  });
  const counts = { A: 0, B: 0, C: 0, D: 0 };
  curve.forEach((L) => counts[L]++);

  const questions = raw.map((r, i) => {
    const provisional = {
      id: i + 1,
      topic: r.topic || "כללי",
      question: r.question,
      explanation: r.explanation || "",
      options: {
        A: r.correct,
        B: r.wrong[0],
        C: r.wrong[1],
        D: r.wrong[2],
      },
      correct: "A",
    };
    const laid = layoutQuestion(provisional, curve[i]);
    const sheetSection = r.sheetSection || r.sourceId || "";
    const page = r.page || 1;
    return {
      id: i + 1,
      topic: provisional.topic,
      question: provisional.question,
      explanation: provisional.explanation,
      options: laid.options,
      correct: laid.correct,
      sourceId: sheetSection,
      ...(sheetSection
        ? { sheetRef: { page, section: sheetSection } }
        : {}),
    };
  });

  // Keep raw ids sequential after rebuild
  const normalizedRaw = raw.map((r, i) => ({
    id: i + 1,
    topic: r.topic || "כללי",
    sheetSection: r.sheetSection || r.sourceId || "",
    page: r.page || 1,
    question: r.question,
    correct: r.correct,
    wrong: r.wrong.slice(0, 3),
    explanation: r.explanation || "",
  }));
  fs.writeFileSync(rawPath, JSON.stringify(normalizedRaw, null, 2) + "\n", "utf8");

  const header = `// מבוא לסוציולוגיה של החינוך
// Built from questions-sociology.raw.json + tools/rebuild-sociology.mjs
// sourceId / sheetRef.section → headings in assets/sociology/remembrance-sheet.pdf
// Runtime (app.js) re-shuffles option letters every new session.
// Append: edit questions-sociology.raw.json → node tools/rebuild-sociology.mjs
const SOCIOLOGY_QUESTIONS = `;

  const footer = `;

if (typeof window !== "undefined") {
  window.SOCIOLOGY_QUESTIONS = SOCIOLOGY_QUESTIONS;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { SOCIOLOGY_QUESTIONS };
}
`;

  fs.writeFileSync(outPath, header + JSON.stringify(questions, null, 2) + footer, "utf8");

  console.log(`✓ ${questions.length} sociology questions → ${path.relative(root, outPath)}`);
  console.log(`  curve score=${score}  counts=`, counts);
  console.log(`  first 16 slots: ${curve.slice(0, 16).join(" ")}`);
}

main();
