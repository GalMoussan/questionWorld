#!/usr/bin/env python3
"""
Locate each quiz answer on the remembrance-sheet PDF, render page images,
and write normalized highlight rectangles for the quiz UI.

Usage:
  python3 tools/build-sheet-highlights.py

Outputs:
  assets/sheet/page-1.png … page-4.png
  assets/sheet/highlights.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import fitz  # PyMuPDF

ROOT = Path(__file__).resolve().parents[1]
PDF = ROOT / "assets" / "remembrance-sheet.pdf"
OUT_DIR = ROOT / "assets" / "sheet"
DPI = 160  # crisp enough for mobile/desktop without huge files

# Per-question anchors: first matching line for `find` (any string works),
# optionally clip region with `until` (exclusive). Pads expand the highlight.
# Coordinates are computed from live PDF text — re-run after sheet changes.
#
# page is 1-based.
ANCHORS: dict[int, dict] = {
    # ── תהליכי למידה (page 1) ──
    # Prefer specific phrases; find_y tries needles in order and picks first hit.
    1: {"page": 1, "find": ["למידה: תהליך"], "until": "הביטואציה וסנסיטיזציה", "before": 4, "after": 6},
    2: {"page": 1, "find": ["הביטואציה וסנסיטיזציה"], "until": "פבלוב", "before": 2, "after": 8},
    3: {"page": 1, "find": ["אסימטוטה"], "before": 22, "after": 12},
    4: {"page": 1, "find": ["החלמה ספונטנית"], "until": "הכללה-", "before": 16, "after": 10},
    5: {"page": 1, "find": ["הכללה- כשנוצרת"], "until": "הבחנה-", "before": 2, "after": 8},
    6: {"page": 1, "find": ["הבחנה- תהליך"], "until": "1966", "before": 2, "after": 10},
    7: {"page": 1, "find": ["רסקולה"], "until": "תרונדייק", "before": 6, "after": 12},
    8: {"page": 1, "find": ["תרונדייק", "חוק התוצאה"], "until": "חיזוקים ועונשים", "before": 2, "after": 14},
    9: {"page": 1, "find": ["חפיפת ראש"], "before": 20, "after": 22},
    10: {"page": 1, "find": ["למידת חוסר אונים"], "until": "עיצוב התנהגות", "before": 2, "after": 14},
    # ── זיכרון (page 2) ──
    11: {"page": 2, "find": ["שליפה קידוד-", "קידוד- עיבוד"], "until": "זיכרון חושי-", "before": 2, "after": 12},
    12: {"page": 2, "find": ["זיכרון חושי-"], "until": "ספרלינג", "before": 2, "after": 14},
    13: {"page": 2, "find": ["ספרלינג", "תנאי דיווח מלא"], "until": "לולאה פונולוגית", "before": 4, "after": 12},
    14: {"page": 2, "find": ["לפי באדלי", "לולאה פונולוגית"], "until": "מילר", "before": 2, "after": 18},
    15: {"page": 2, "find": ["Digit span", "מילר מצא"], "until": "אפקט אחרונות", "before": 6, "after": 14},
    16: {"page": 2, "find": ["אפקט אחרונות", "אפקט הראשונות"], "until": "רטרואקטיבית", "before": 2, "after": 18},
    17: {"page": 2, "find": ["רטרואקטיבית:"], "until": "העמקה:", "before": 2, "after": 16},
    18: {"page": 2, "find": ["קופאית שפתאום", "הקשר משמש כרמז"], "until": "עקומת השכחה", "before": 8, "after": 16},
    19: {"page": 2, "find": ["זיכרון אפיזודי:", "זיכרון מוטורי/"], "until": "הטרמה", "before": 14, "after": 36},
    20: {"page": 2, "find": ["לופטוס", "הטיית השאלה", "אפקט המידע המטעה"], "until": "פסיכולוגיה", "before": 4, "after": 20},
    # ── התפתחות (page 2 end + page 3) ──
    21: {"page": 2, "find": ["מחקרי אורך-", "מחקרי רוחב"], "before": 8, "after": 22},
    22: {"page": 2, "find": ["התינוק נולד עם כל תאי"], "before": 6, "after": 24},
    23: {"page": 3, "find": ["השפעה ברחם", "קול האם", "ברחם:"], "until": "פיאז", "before": 4, "after": 18},
    24: {"page": 3, "find": ["הטמעה", "התאמה ="], "until": "סנסורי מוטורי", "before": 6, "after": 16},
    25: {"page": 3, "find": ["קדם אופרציונלי", "אגוצנטר"], "until": "חוק השימור", "before": 4, "after": 18},
    26: {"page": 3, "find": ["הזכוכית, הפטיש", "ניסוי הזכוכית"], "until": "המטוטלת", "before": 6, "after": 18},
    27: {"page": 3, "find": ["המטוטלת"], "until": "ביקורת:", "before": 4, "after": 22},
    28: {"page": 3, "find": ["הצעד האפשרי"], "until": "חוק השימור בשלב", "before": 10, "after": 16},
    29: {"page": 3, "find": ["ג׳ורום כייגן", "כייגן", "מזג"], "until": "היקשרות", "before": 4, "after": 20},
    30: {"page": 3, "find": ["הארי הארלו", "מגע מנחם"], "until": "רוזנהן", "before": 2, "after": 24},
    # ── פסיכופתולוגיה (page 3–4) ──
    31: {"page": 3, "find": ["אי אפשר להיפשט כשפוי", "רוזנהן"], "until": "חשיבות הסיווג", "before": 8, "after": 18},
    32: {"page": 3, "find": ["אגורפוביה-"], "until": "טרדנות כפייתיות", "before": 10, "after": 12},
    33: {"page": 3, "find": ["טרדנות כפייתיות"], "until": "הפרעת דיכאון", "before": 2, "after": 18},
    34: {"page": 3, "find": ["הפרעת דיכאון –", "הפרעת דיכאון"], "until": "הפרעה דו-", "before": 2, "after": 22},
    35: {"page": 3, "find": ["סיכון להתאבדות", "הדבק"], "before": 4, "after": 16},
    36: {"page": 3, "find": ["אפיזודה מאנית:"], "until": "אטיולוגיה", "before": 10, "after": 20},
    37: {"page": 3, "find": ["תאומים זהים: אם אחד"], "until": "הגישה הקוגניטיבית", "before": 12, "after": 14},
    38: {"page": 3, "find": ["הכללה מוגזמת"], "before": 8, "after": 32},
    39: {"page": 4, "find": ["אנטי סוציאליות:"], "until": "הפרעת אישיות גבולית:", "before": 2, "after": 28},
    40: {"page": 4, "find": ["הפרעת אישיות גבולית:", "פיצול-"], "until": "הפרעת סכיזופרניה", "before": 4, "after": 18},
    # ── השפעה חברתית (page 4) ──
    41: {"page": 4, "find": ["זימברדו", "כלא של סטנפורד"], "until": "קונפורמיות-", "before": 4, "after": 28},
    42: {"page": 4, "find": ["ניסוי הנקודה בחושך"], "until": "סולומון אש", "before": 4, "after": 20},
    43: {"page": 4, "find": ["ניסוי הקונפורמיות של סולומון אש", "מה אורך הקו"], "until": "השפעה אינפורמטיבית", "before": 4, "after": 24},
    44: {"page": 4, "find": ["fMRI", "טעות בניבוי תגמול"], "until": "מיליגרם", "before": 8, "after": 24},
    45: {"page": 4, "find": ["מיליגרם-"], "until": "מלכודת הצעד", "before": 2, "after": 28},
    46: {"page": 4, "find": ["מלכודת הצעד", "הסלמה הדרגתית"], "until": "הסבר אבולוציוני", "before": 4, "after": 18},
    47: {"page": 4, "find": ["הסבר אבולוציוני-"], "until": "הדדי:", "before": 2, "after": 12},
    48: {"page": 4, "find": ["נורמות הדדיות:", "הדדי:"], "until": "אלטוראיזם אמיתי", "before": 2, "after": 14},
    49: {"page": 4, "find": ["ניסוי הבחנה לאלטרואיזם"], "until": "חסידי אומות", "before": 10, "after": 20},
    50: {"page": 4, "find": ["חסידי אומות העולם", "אלטוראיזם אמיתי-"], "before": 6, "after": 20},
}


def page_lines(page: fitz.Page) -> list[tuple[float, float, float, float, str]]:
    """Sorted (y0, y1, x0, x1, text) lines."""
    out: list[tuple[float, float, float, float, str]] = []
    for b in page.get_text("dict")["blocks"]:
        if b.get("type") != 0:
            continue
        for line in b.get("lines", []):
            text = "".join(s["text"] for s in line.get("spans", [])).strip()
            if not text:
                continue
            x0, y0, x1, y1 = line["bbox"]
            out.append((y0, y1, x0, x1, text))
    out.sort(key=lambda t: (round(t[0], 1), -t[2]))
    return out


def find_y(lines, needles: list[str]) -> tuple[float, float, str] | None:
    """Try needles in order (most specific first). First hit wins."""
    for n in needles:
        if not n:
            continue
        for y0, y1, _x0, _x1, text in lines:
            if n in text:
                return y0, y1, text
    return None


def locate(page: fitz.Page, cfg: dict) -> fitz.Rect:
    lines = page_lines(page)
    hit = find_y(lines, cfg["find"])
    if not hit:
        raise ValueError(f"no match for find={cfg['find']!r}")

    y_start, y_end, matched = hit
    y_start -= float(cfg.get("before", 6))

    until = cfg.get("until")
    if until:
        # find first line AFTER match that contains until
        for y0, y1, *_rest, text in lines:
            if y0 <= hit[0] + 1:
                continue
            if any(u in text for u in (until if isinstance(until, list) else [until])):
                y_end = y0 - 2
                break
        else:
            y_end = hit[1] + float(cfg.get("after", 40))
    else:
        y_end = hit[1] + float(cfg.get("after", 40))

    # Clamp and enforce minimum height
    pr = page.rect
    margin_x = 18
    y_start = max(pr.y0 + 8, y_start)
    y_end = min(pr.y1 - 8, max(y_start + 28, y_end))
    return fitz.Rect(pr.x0 + margin_x, y_start, pr.x1 - margin_x, y_end), matched


def main() -> int:
    if not PDF.exists():
        print(f"Missing PDF: {PDF}", file=sys.stderr)
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(PDF)

    # Render pages 1–4
    page_meta = {}
    zoom = DPI / 72.0
    mat = fitz.Matrix(zoom, zoom)
    for i in range(min(4, len(doc))):
        page = doc[i]
        pix = page.get_pixmap(matrix=mat, alpha=False)
        out = OUT_DIR / f"page-{i + 1}.png"
        pix.save(out.as_posix())
        page_meta[i + 1] = {
            "width": page.rect.width,
            "height": page.rect.height,
            "imgWidth": pix.width,
            "imgHeight": pix.height,
            "file": f"assets/sheet/page-{i + 1}.png",
        }
        print(f"rendered {out.name} ({pix.width}x{pix.height})")

    highlights = {}
    errors = []
    for qid, cfg in sorted(ANCHORS.items()):
        page_i = cfg["page"] - 1
        if page_i < 0 or page_i >= len(doc):
            errors.append(f"Q{qid}: bad page {cfg['page']}")
            continue
        page = doc[page_i]
        try:
            rect, matched = locate(page, cfg)
        except ValueError as e:
            errors.append(f"Q{qid}: {e}")
            continue

        pw, ph = page.rect.width, page.rect.height
        # normalized 0–1 relative to page (top-left origin, same as CSS %)
        region = {
            "page": cfg["page"],
            "x": round(rect.x0 / pw, 4),
            "y": round(rect.y0 / ph, 4),
            "w": round(rect.width / pw, 4),
            "h": round(rect.height / ph, 4),
            "match": matched[:80],
        }
        highlights[str(qid)] = region
        print(
            f"Q{qid:02d} p{cfg['page']} y={region['y']:.3f}–{region['y']+region['h']:.3f}  «{matched[:50]}»"
        )

    payload = {
        "pdf": "assets/remembrance-sheet.pdf",
        "dpi": DPI,
        "pages": page_meta,
        "highlights": highlights,
    }
    out_json = OUT_DIR / "highlights.json"
    out_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nwrote {out_json} ({len(highlights)}/50)")

    if errors:
        print("\nERRORS:", file=sys.stderr)
        for e in errors:
            print(" ", e, file=sys.stderr)
        return 1
    if len(highlights) != 50:
        print(f"Expected 50 highlights, got {len(highlights)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
