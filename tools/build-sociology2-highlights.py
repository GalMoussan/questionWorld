#!/usr/bin/env python3
"""
Build highlight rectangles for sociology2 quiz (מבוא לסוציולוגיה - דף 2).

Scanned 2-page landscape sheet (two side-by-side content panels).
Uses Tesseract TSV on rendered page images to locate concept keywords,
then expands each hit cluster into a readable crop (min size enforced).

Usage:
  python3 tools/build-sociology2-highlights.py
"""

from __future__ import annotations

import json
import statistics
import subprocess
import sys
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[1]
PDF = ROOT / "assets" / "sociology2" / "remembrance-sheet.pdf"
OUT_DIR = ROOT / "assets" / "sociology2" / "sheet"
DPI = 130  # match existing page-*.png density

# Per-question search keys + preferred page/panel when OCR is noisy.
# panel: "L" | "R" | None (auto from median x)
# keys: Hebrew/English fragments that appear on the sheet near the answer.
QUESTION_KEYS: dict[int, dict] = {
    # Open + graph teaching items
    1: {  # Bourdieu conflict / symbolic violence
        "page": 1,
        "panel": "L",
        "keys": ["בורדייה", "הון", "תרבותי", "אלימות", "סימבול", "שעתוק", "הביטוס"],
        "pad": 0.06,
        "min_h": 0.32,
    },
    2: {  # Davis-Moore / functionalism
        "page": 1,
        "panel": "R",
        "keys": ["פונקציונל", "מריטוקר", "מיון", "הצבה", "פרסונס", "AGIL", "תפקיד"],
        "pad": 0.05,
        "min_h": 0.30,
    },
    3: {  # ethos / culture
        "page": 1,
        "panel": "L",
        "keys": ["אתוס", "תרבות", "ערכים", "נורמ", "סמל"],
        "pad": 0.05,
        "min_h": 0.28,
    },
    4: {  # stratification definition (Adva)
        "page": 2,
        "panel": "R",
        "keys": ["ריבוד", "שכבות", "ממוסד", "משאבים", "תגמול"],
        "pad": 0.05,
        "min_h": 0.28,
    },
    # Exam MC
    5: {  # Durkheim suicide = social fact
        "page": 1,
        "panel": "R",
        "keys": ["התאבדות", "דורקהיים", "דירקהיים", "לכידות", "פיקוח", "פרוטסטנט", "אגואיסט"],
        "pad": 0.05,
        "min_h": 0.30,
    },
    6: {  # 5 education foci
        "page": 1,
        "panel": "R",
        "keys": ["מוקדים", "מטרות", "מוסדות", "גבולות", "דרכי", "תהליכ", "כתחום"],
        "pad": 0.05,
        "min_h": 0.28,
        "force": {"x": 0.505, "y": 0.32, "w": 0.48, "h": 0.28},
    },
    7: {  # critique of functionalism
        "page": 1,
        "panel": "R",
        "keys": ["ביקורת", "פונקציונל", "שמרנ", "שינוי", "לגיטימצ"],
        "pad": 0.05,
        "min_h": 0.26,
    },
    8: {  # SI definition
        "page": 1,
        "panel": "R",
        "keys": ["אינטראקציה", "סימבולית", "הגדרת", "מצב", "משמעות", "סמלים"],
        "pad": 0.05,
        "min_h": 0.30,
    },
    9: {  # functionalist education
        "page": 1,
        "panel": "R",
        "keys": ["מיון", "הצבה", "מריטוקר", "כישור", "תגמול", "חיברות:"],
        "pad": 0.05,
        "min_h": 0.28,
    },
    10: {  # role conflict
        "page": 2,
        "panel": "R",
        "keys": ["סטטוס", "תפקיד", "קונפליקט", "מתח", "שיוכי", "הישגי"],
        "pad": 0.05,
        "min_h": 0.32,
    },
    11: {  # subculture normative
        "page": 1,
        "panel": "L",
        "keys": ["תת-תרבות", "תת תרבות", "נורמטיבית", "תרבות נגד", "ערכית", "שולטת"],
        "pad": 0.05,
        "min_h": 0.28,
        "force": {"x": 0.015, "y": 0.72, "w": 0.48, "h": 0.26},
    },
    12: {  # postmodernity / values education
        "page": 2,
        "panel": "L",
        "keys": ["ברנשטיין", "יזהר", "ערכים", "אוטונומ", "סמכות"],
        "pad": 0.05,
        "min_h": 0.32,
    },
    13: {  # Bourdieu school reproduction
        "page": 1,
        "panel": "L",
        "keys": ["בורדייה", "שעתוק", "אלימות", "סימבול", "הון", "שדות"],
        "pad": 0.06,
        "min_h": 0.34,
    },
    14: {  # industrial revolution / growth of sociology
        "page": 1,
        "panel": "R",
        "keys": ["מהפכה", "תעשיית", "עיור", "חילון", "מאה"],
        "pad": 0.05,
        "min_h": 0.24,
    },
    15: {  # AGIL goal attainment = political
        "page": 1,
        "panel": "R",
        "keys": ["AGIL", "אגיל", "פרסונס", "פוליט", "מטרות", "שימור"],
        "pad": 0.05,
        "min_h": 0.28,
        "force": {"x": 0.505, "y": 0.42, "w": 0.48, "h": 0.30},
    },
    16: {  # Weber 3 dimensions
        "page": 1,
        "panel": "L",
        "keys": ["ובר", "וובר", "יוקרה", "פוליטי", "מעמד", "ניאו"],
        "pad": 0.05,
        "min_h": 0.28,
        "force": {"x": 0.015, "y": 0.48, "w": 0.48, "h": 0.30},
    },
    17: {  # functionalism on conflict → equilibrium
        "page": 1,
        "panel": "R",
        "keys": ["איזון", "הומאוסט", "קונצנזוס", "יציבות", "פונקציונל"],
        "pad": 0.05,
        "min_h": 0.28,
    },
    18: {  # Marx vs Weber
        "page": 1,
        "panel": "L",
        "keys": ["מרקס", "מארקס", "ובר", "ניאו-מרקס", "כסף", "יוקרה"],
        "pad": 0.05,
        "min_h": 0.30,
        "force": {"x": 0.015, "y": 0.45, "w": 0.48, "h": 0.32},
    },
    19: {  # conflict / elites education
        "page": 1,
        "panel": "L",
        "keys": ["אליט", "שולטת", "קונפליקט", "אינטרס", "מעמדי"],
        "pad": 0.05,
        "min_h": 0.28,
    },
    20: {  # SI education
        "page": 1,
        "panel": "R",
        "keys": ["אינטראקציה", "סימבולית", "הגדרת", "מצב", "משא"],
        "pad": 0.05,
        "min_h": 0.30,
    },
    21: {  # classroom as meanings
        "page": 2,
        "panel": "L",
        "keys": ["כיתה", "משמעות", "אמנה", "מורה", "תלמיד"],
        "pad": 0.05,
        "min_h": 0.30,
    },
    22: {  # ethnocentrism
        "page": 1,
        "panel": "L",
        "keys": ["אתנוצנטר", "יחסיות", "תרבות", "שיפוט"],
        "pad": 0.05,
        "min_h": 0.26,
    },
    23: {  # vertical mobility
        "page": 2,
        "panel": "R",
        "keys": ["ניעות", "מוביליות", "אנכית", "אופקית", "בין-דור"],
        "pad": 0.05,
        "min_h": 0.30,
    },
    24: {  # Bourdieu reproduction
        "page": 1,
        "panel": "L",
        "keys": ["שעתוק", "בורדייה", "מבנה", "הון", "אלימות"],
        "pad": 0.06,
        "min_h": 0.32,
    },
    25: {  # Ayalon
        "page": 2,
        "panel": "L",
        "keys": ["איילון", "מכללות", "מזרח", "אשכנז", "השכלה"],
        "pad": 0.05,
        "min_h": 0.30,
    },
    26: {  # ethnic stratification
        "page": 2,
        "panel": "R",
        "keys": ["ריבוד", "אתנ", "מוצא", "מזרח", "ערבים"],
        "pad": 0.05,
        "min_h": 0.28,
    },
    27: {  # status ascribed/achieved + gender
        "page": 2,
        "panel": "R",
        "keys": ["סטטוס", "שיוכי", "הישגי", "מגדר", "תפקיד"],
        "pad": 0.05,
        "min_h": 0.30,
    },
    28: {  # SI labeling / self-fulfilling prophecy
        "page": 1,
        "panel": "R",
        "keys": ["תיוג", "נבואה", "תווית", "ציפיות", "אינטראקציה"],
        "pad": 0.05,
        "min_h": 0.28,
    },
    29: {  # dysfunction / latent function
        "page": 1,
        "panel": "R",
        "keys": ["דיספונק", "סמויה", "גלויה", "מרטון", "פונקציה"],
        "pad": 0.05,
        "min_h": 0.28,
    },
}


def render_pages(doc: fitz.Document) -> dict:
    zoom = DPI / 72.0
    mat = fitz.Matrix(zoom, zoom)
    page_meta = {}
    for i in range(len(doc)):
        page = doc[i]
        pix = page.get_pixmap(matrix=mat, alpha=False)
        out = OUT_DIR / f"page-{i + 1}.png"
        pix.save(out.as_posix())
        page_meta[str(i + 1)] = {
            "width": page.rect.width,
            "height": page.rect.height,
            "imgWidth": pix.width,
            "imgHeight": pix.height,
            "file": f"assets/sociology2/sheet/page-{i + 1}.png",
        }
        print(f"rendered {out.name} ({pix.width}x{pix.height})")
    return page_meta


def ocr_words(page_num: int, img_w: int, img_h: int) -> list[dict]:
    img = OUT_DIR / f"page-{page_num}.png"
    out_base = Path(f"/tmp/socio2-ocr-p{page_num}")
    subprocess.run(
        ["tesseract", str(img), str(out_base), "-l", "heb+eng", "--psm", "6", "tsv"],
        check=True,
        capture_output=True,
    )
    words = []
    for line in (out_base.with_suffix(".tsv")).read_text(
        encoding="utf-8", errors="replace"
    ).splitlines()[1:]:
        parts = line.split("\t")
        if len(parts) < 12:
            continue
        try:
            conf = float(parts[10])
        except ValueError:
            continue
        text = parts[11].strip()
        if not text or conf < 20:
            continue
        left, top, w, h = map(int, parts[6:10])
        words.append(
            {
                "text": text,
                "x": left / img_w,
                "y": top / img_h,
                "x2": (left + w) / img_w,
                "y2": (top + h) / img_h,
            }
        )
    return words


def panel_filter(words: list[dict], panel: str | None) -> list[dict]:
    if panel == "L":
        return [w for w in words if w["x"] < 0.52]
    if panel == "R":
        return [w for w in words if w["x"] >= 0.48]
    return words


def cluster_region(hits: list[dict], cfg: dict) -> dict | None:
    if not hits:
        return None
    pad = float(cfg.get("pad", 0.05))
    min_h = float(cfg.get("min_h", 0.24))
    min_w = float(cfg.get("min_w", 0.42))

    xs = [h["x"] for h in hits]
    x2s = [h["x2"] for h in hits]
    ys = [h["y"] for h in hits]
    y2s = [h["y2"] for h in hits]

    # Prefer the densest vertical band: use median ± spread of hits
    y_med = statistics.median([(a + b) / 2 for a, b in zip(ys, y2s)])
    # Drop extreme outliers more than 0.35 from median (wrong panel noise)
    core = [
        h
        for h in hits
        if abs((h["y"] + h["y2"]) / 2 - y_med) <= 0.28
    ] or hits
    xs = [h["x"] for h in core]
    x2s = [h["x2"] for h in core]
    ys = [h["y"] for h in core]
    y2s = [h["y2"] for h in core]

    x0 = max(0.01, min(xs) - pad * 0.4)
    x1 = min(0.99, max(x2s) + pad * 0.4)
    y0 = max(0.01, min(ys) - pad)
    y1 = min(0.99, max(y2s) + pad)

    # Snap to full panel width for readability (two-column sheet)
    mx = statistics.median(xs)
    if mx < 0.5:
        x0, x1 = 0.015, 0.495
    else:
        x0, x1 = 0.505, 0.985

    w = x1 - x0
    h = y1 - y0
    if w < min_w:
        # expand toward panel center
        mid = (x0 + x1) / 2
        x0 = max(0.01, mid - min_w / 2)
        x1 = min(0.99, x0 + min_w)
        w = x1 - x0
    if h < min_h:
        mid = (y0 + y1) / 2
        y0 = max(0.01, mid - min_h / 2)
        y1 = min(0.99, y0 + min_h)
        # if bottom overflow, shift up
        if y1 >= 0.99:
            y1 = 0.99
            y0 = max(0.01, y1 - min_h)
        h = y1 - y0

    # Cap max height so crop stays scannable (~40% page)
    if h > 0.42:
        mid = (y0 + y1) / 2
        y0 = max(0.01, mid - 0.21)
        y1 = min(0.99, mid + 0.21)
        h = y1 - y0

    return {
        "x": round(x0, 4),
        "y": round(y0, 4),
        "w": round(x1 - x0, 4),
        "h": round(y1 - y0, 4),
    }


def locate(page_words: dict[int, list[dict]], qid: int, cfg: dict) -> dict:
    page = int(cfg["page"])
    words = panel_filter(page_words[page], cfg.get("panel"))
    keys = cfg["keys"]
    hits = [w for w in words if any(k in w["text"] for k in keys)]
    # fallback: whole page words
    if len(hits) < 2:
        hits = [w for w in page_words[page] if any(k in w["text"] for k in keys)]
    if cfg.get("force"):
        region = {k: cfg["force"][k] for k in ("x", "y", "w", "h")}
        match = "force:" + ",".join(cfg["keys"][:3])
    else:
        region = cluster_region(hits, cfg)
        if not region:
            # hard fallback: full preferred panel middle band
            if cfg.get("panel") == "L":
                region = {"x": 0.015, "y": 0.15, "w": 0.48, "h": 0.35}
            else:
                region = {"x": 0.505, "y": 0.15, "w": 0.48, "h": 0.35}
            match = "fallback-panel"
        else:
            match = ",".join(sorted({h["text"][:18] for h in hits[:6]}))
    return {
        "page": page,
        **region,
        "match": match[:90],
    }


def main() -> int:
    if not PDF.exists():
        print(f"Missing PDF: {PDF}", file=sys.stderr)
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(PDF)
    page_meta = render_pages(doc)

    page_words: dict[int, list[dict]] = {}
    for i in range(len(doc)):
        pn = i + 1
        page_words[pn] = ocr_words(
            pn, page_meta[str(pn)]["imgWidth"], page_meta[str(pn)]["imgHeight"]
        )
        print(f"OCR page {pn}: {len(page_words[pn])} words")

    highlights = {}
    for qid, cfg in sorted(QUESTION_KEYS.items()):
        hl = locate(page_words, qid, cfg)
        highlights[str(qid)] = hl
        print(
            f"Q{qid:02d} p{hl['page']} "
            f"y={hl['y']:.2f}–{hl['y']+hl['h']:.2f} h={hl['h']:.2f} "
            f"x={hl['x']:.2f} «{hl['match'][:40]}»"
        )

    payload = {
        "pdf": "assets/sociology2/remembrance-sheet.pdf",
        "dpi": DPI,
        "pages": page_meta,
        "highlights": highlights,
        "version": 3,
    }
    out_json = OUT_DIR / "highlights.json"
    out_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nwrote {out_json} ({len(highlights)} highlights)")

    missing = [i for i in range(1, 30) if str(i) not in highlights]
    if missing:
        print("MISSING", missing, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
