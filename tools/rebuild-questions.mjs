#!/usr/bin/env node
/**
 * Rebuild question bank from questions.md with anti-pattern answer layouts.
 *
 * Usage:
 *   node tools/rebuild-questions.mjs
 *   node tools/rebuild-questions.mjs path/to/questions.md
 *
 * When you add new questions to questions.md, run this script.
 * It will:
 *   1. Parse every ## Question N block
 *   2. Build an anti-pattern correct-letter curve (no B/C then A/D rhythms)
 *   3. Place correct + wrongs into A–D slots per that curve
 *   4. Write questions.json, questions.js, and overwrite questions.md cleanly
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildAnswerCurve, layoutQuestion, shuffleArray, LETTERS } from "./answer-curve.mjs";
import { SHEET_REFS } from "./sheet-refs.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const mdPath = path.resolve(process.argv[2] || path.join(root, "questions.md"));

/** Parse "עמוד 1 · section · hint" or structured sheetRef */
function parseSheetLine(line) {
  if (!line) return null;
  const m = line.match(/עמוד\s*(\d+)\s*·\s*([^·]+?)(?:\s*·\s*(.+))?$/);
  if (!m) return null;
  return {
    page: parseInt(m[1], 10),
    section: m[2].trim(),
    hint: (m[3] || "").trim() || undefined,
  };
}

function formatSheetLine(ref) {
  if (!ref || !ref.page) return null;
  let s = `עמוד ${ref.page} · ${ref.section || ""}`;
  if (ref.hint) s += ` · ${ref.hint}`;
  return s;
}

function parseMarkdown(text) {
  const blocks = text.split(/^## Question\s+(\d+)\s*$/m);
  const questions = [];
  for (let i = 1; i < blocks.length; i += 2) {
    const id = parseInt(blocks[i], 10);
    const body = blocks[i + 1];
    const topicM = body.match(/\*\*Topic:\*\*\s*(.+)/);
    const sheetM = body.match(/\*\*Sheet:\*\*\s*(.+)/);
    const qM = body.match(/\*\*Question:\*\*\s*(.+)/);
    const correctM = body.match(/\*\*Correct Answer:\*\*\s*([ABCD])/i);
    const explM = body.match(/\*\*Explanation:\*\*\s*([\s\S]+?)(?=\n## Question|\n*$)/);
    if (!topicM || !qM || !correctM || !explM) {
      console.warn(`Skipping Q${id}: missing fields`);
      continue;
    }
    const options = {};
    for (const k of LETTERS) {
      const m = body.match(new RegExp(`^${k}\\.\\s*(.+)$`, "m"));
      if (!m) throw new Error(`Q${id}: missing option ${k}`);
      options[k] = m[1].trim();
    }
    // Prefer explicit markdown sheet line; fall back to tools/sheet-refs.mjs
    const sheetRef =
      parseSheetLine(sheetM?.[1]?.trim()) ||
      (SHEET_REFS[id] ? { ...SHEET_REFS[id] } : null);

    questions.push({
      id,
      topic: topicM[1].trim(),
      question: qM[1].trim(),
      options,
      correct: correctM[1].toUpperCase(),
      explanation: explM[1].trim().split(/\n## Question/)[0].trim(),
      ...(sheetRef ? { sheetRef } : {}),
    });
  }
  questions.sort((a, b) => a.id - b.id);
  return questions;
}

function writeMarkdown(questions) {
  const lines = [
    "# Psychology Quiz Questions",
    "# מבחן סימולציה",
    "",
    "> Options are anti-pattern shuffled. Re-run `node tools/rebuild-questions.mjs` after edits.",
    "> **Sheet:** points to the remembrance sheet (דף עזר) — page + section to review.",
    "",
  ];
  for (const q of questions) {
    lines.push(`## Question ${q.id}`);
    lines.push(`**Topic:** ${q.topic}`);
    const sheetLine = formatSheetLine(q.sheetRef || SHEET_REFS[q.id]);
    if (sheetLine) lines.push(`**Sheet:** ${sheetLine}`);
    lines.push(`**Question:** ${q.question}`);
    lines.push("");
    for (const k of LETTERS) lines.push(`${k}. ${q.options[k]}`);
    lines.push("");
    lines.push(`**Correct Answer:** ${q.correct}`);
    lines.push(`**Explanation:** ${q.explanation}`);
    lines.push("");
  }
  return lines.join("\n");
}

function main() {
  if (!fs.existsSync(mdPath)) {
    console.error("Missing", mdPath);
    process.exit(1);
  }
  const raw = fs.readFileSync(mdPath, "utf8");
  const parsed = parseMarkdown(raw);
  if (!parsed.length) {
    console.error("No questions parsed from", mdPath);
    process.exit(1);
  }

  // Independent of quiz order: apply curve to bank order 1..N
  // (runtime will re-curve + re-order again each session)
  const { curve, score } = buildAnswerCurve(parsed.length);
  const laidOut = parsed.map((q, i) => {
    const laid = layoutQuestion(q, curve[i]);
    // Preserve sheetRef through option reshuffle
    if (q.sheetRef) laid.sheetRef = q.sheetRef;
    else if (SHEET_REFS[q.id]) laid.sheetRef = { ...SHEET_REFS[q.id] };
    return laid;
  });
  const withSheet = laidOut.filter((q) => q.sheetRef).length;
  console.log(`Sheet refs: ${withSheet}/${laidOut.length}`);

  // Extra chaos: also shuffle wrong option texts order is already done in layoutQuestion
  // Shuffle question IDs? Keep stable IDs; only option letters move.

  const counts = { A: 0, B: 0, C: 0, D: 0 };
  laidOut.forEach((q) => counts[q.correct]++);
  const sequence = laidOut.map((q) => q.correct).join("");

  fs.writeFileSync(
    path.join(root, "questions.json"),
    JSON.stringify(laidOut, null, 2),
    "utf8"
  );
  fs.writeFileSync(
    path.join(root, "questions.js"),
    "// Auto-generated by tools/rebuild-questions.mjs — do not hand-edit option letters.\n" +
      "// Runtime re-shuffles every quiz with anti-pattern curve.\n" +
      "const QUIZ_QUESTIONS = " +
      JSON.stringify(laidOut, null, 2) +
      ";\n",
    "utf8"
  );
  fs.writeFileSync(path.join(root, "questions.md"), writeMarkdown(laidOut), "utf8");

  console.log(`Rebuilt ${laidOut.length} questions from ${path.basename(mdPath)}`);
  console.log(`Curve score: ${score} (lower = more random / less patterned)`);
  console.log(`Counts:`, counts);
  console.log(`Sequence: ${sequence}`);
  console.log(`First 15: ${sequence.slice(0, 15).split("").join(" ")}`);
}

main();
