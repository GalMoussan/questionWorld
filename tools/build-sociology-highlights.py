#!/usr/bin/env python3
"""
Locate each sociology quiz answer on the remembrance-sheet PDF (4-column landscape),
render page images, and write normalized highlight rectangles for the quiz UI.

Usage:
  python3 tools/build-sociology-highlights.py

Outputs:
  assets/sociology/sheet/page-1.png
  assets/sociology/sheet/page-2.png
  assets/sociology/sheet/highlights.json

Coordinates are computed from live PDF text — re-run after sheet or question changes.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import fitz  # PyMuPDF

ROOT = Path(__file__).resolve().parents[1]
PDF = ROOT / "assets" / "sociology" / "remembrance-sheet.pdf"
OUT_DIR = ROOT / "assets" / "sociology" / "sheet"
DPI = 160

# Approximate column x-bounds (PDF points) for landscape 4-col sheet
COLS = {
    1: (10.0, 217.0),
    2: (216.0, 422.0),
    3: (420.0, 627.0),
    4: (625.0, 838.0),
}

# Per-question anchors. page is 1-based. col is 1–4 (left→right on the PDF).
# find: needles tried in order; until: exclusive end marker after the hit.
# before/after: padding in PDF points around the match block.
#
# Notes on OCR/typos in the sheet: "דירקהיים", "אתונצטריות", "קולניס", "אגיל", etc.
ANCHORS: dict[int, dict] = {
    # ── Col1 p1: 1.1–1.4 ──
    1: {
        "page": 1,
        "col": 1,
        "find": ["הגדרה) חברה זה מושג", "חברה זה מושג המתאר"],
        "until": "לכן, התנהגות חברתית",
        "before": 4,
        "after": 28,
    },
    2: {
        "page": 1,
        "col": 1,
        "find": ["לכן, התנהגות חברתית זה", "התנהגות חברתית זה כלל"],
        "until": "1.2חקר",
        "before": 2,
        "after": 24,
    },
    3: {
        "page": 1,
        "col": 1,
        "find": ["1.2חקר החברה", "סוציולוגיה היא תחום אחד"],
        "until": "סקרנות",
        "before": 2,
        "after": 36,
    },
    4: {
        "page": 1,
        "col": 1,
        "find": ["הפרספקטיבה הסוציולגית מחולקת", "פרספקטיבה הסוציולגית"],
        "until": "1.3רקע",
        "before": 8,
        "after": 40,
    },
    5: {
        "page": 1,
        "col": 1,
        "find": ["דמיון סוציולוגי (מילס)", "דמיון סוציולוגי"],
        "until": "הפרספקטיבה הסוציולגית מחולקת",
        "before": 4,
        "after": 12,
    },
    6: {
        "page": 1,
        "col": 1,
        "find": ["1.3רקע לצמיחת", "בתקופת הרנסנס"],
        "until": "1.4דירקהיים",
        "before": 2,
        "after": 80,
    },
    7: {
        "page": 1,
        "col": 1,
        "find": ["עובדות חברתיות", "1.4דירקהיים"],
        "until": "צירים פיקוח",
        "before": 10,
        "after": 20,
    },
    8: {
        "page": 1,
        "col": 1,
        "find": ["צירים פיקוח חברתי", "לכידות חברתית4 סוגים"],
        "before": 4,
        "after": 22,
    },
    # Suicide types continue top of col2
    9: {
        "page": 1,
        "col": 2,
        "find": ["התאבדות פאטליסטית", "טירונים בצבא"],
        "until": "התאבדות אנומית",
        "before": 2,
        "after": 18,
    },
    10: {
        "page": 1,
        "col": 2,
        "find": ["התאבדות אנומית", "מהגרים פרימיטיבים"],
        "until": "התאבדות אלטרואיסטית",
        "before": 2,
        "after": 16,
    },
    11: {
        "page": 1,
        "col": 2,
        "find": ["התאבדות אלטרואיסטית", "טייסי קמיקזה"],
        "until": "התאבדות אגואיסטית",
        "before": 2,
        "after": 16,
    },
    12: {
        "page": 1,
        "col": 2,
        "find": ["התאבדות אגואיסטית", "אהבה נכזבת"],
        "until": "ממצא נוסף הוא שיהודים",
        "before": 2,
        "after": 14,
    },
    13: {
        "page": 1,
        "col": 2,
        "find": ["פרוטסטנטים זה זרם", "ממצא נוסף הוא שיהודים"],
        "until": "1.5חינוך",
        "before": 8,
        "after": 28,
    },
    14: {
        "page": 1,
        "col": 2,
        "find": ["1.5חינוך כתחום ידע", "חמישה מוקדים"],
        "until": "1.6סוציולוגיה",
        "before": 2,
        "after": 40,
    },
    15: {
        "page": 1,
        "col": 2,
        "find": ["1.6סוציולוגיה של החינוך", "בשלושה נושאים מרכזיים"],
        "until": "2פרדיגמות",
        "before": 2,
        "after": 48,
    },
    16: {
        "page": 1,
        "col": 2,
        "find": ["2.1סוציולוגיה כמדע", "מהימנות"],
        "until": "2.2הגדרה לפרדיגמה",
        "before": 2,
        "after": 36,
    },
    17: {
        "page": 1,
        "col": 2,
        "find": ["2.2הגדרה לפרדיגמה", "תאוריה צומח מתוך דגם", "תומס קולט"],
        "until": "רצפים: פוזיטיבסטית",
        "before": 2,
        "after": 28,
    },
    18: {
        "page": 1,
        "col": 2,
        "find": ["רצפים: פוזיטיבסטית מול פרשנית", "לכל אחד יש פרשנות"],
        "until": "2.3 )פונקציונלית",
        "before": 2,
        "after": 48,
    },
    19: {
        "page": 1,
        "col": 2,
        "find": ["2.3 )פונקציונלית", "סטרוקטאלית= מבנה"],
        "until": "המודל אגיל",
        "before": 2,
        "after": 28,
    },
    20: {
        "page": 1,
        "col": 2,
        "find": ["המודל אגיל של פרסונס", "שימור דפוסים"],
        "until": "רוברט מרטון",
        "before": 2,
        "after": 48,
    },
    21: {
        "page": 1,
        "col": 3,
        "find": ["פונקציה גלויה", "פוקנציה סמויה"],
        "until": "לטענת מרטון צריך להיות איזון",
        "before": 2,
        "after": 16,
    },
    22: {
        "page": 1,
        "col": 3,
        "find": ["בית חרושת לציונים ומרבד", "דינספונקציות", "פונקציה השלילית"],
        "until": "האמין שזה כמו באבולוציה",
        "before": 12,
        "after": 22,
    },
    23: {
        "page": 1,
        "col": 3,
        "find": ["ביקורות לגישה", "הסבר מעגלי"],
        "until": "2.4 )גישת הקונפליקט",
        "before": 4,
        "after": 48,
    },
    24: {
        "page": 1,
        "col": 3,
        "find": ["2.4 )גישת הקונפליקט", "מתבסס על מאבקים"],
        "until": "אמצעי יצור",
        "before": 2,
        "after": 36,
    },
    25: {
        "page": 1,
        "col": 3,
        "find": ["בניין העל", "אמצעי יצור", "המודל לפי פרמידה"],
        "until": "מקס וובר",
        "before": 4,
        "after": 40,
    },
    26: {
        "page": 1,
        "col": 3,
        "find": ["מקס וובר", "שלושה צירים מעמדות"],
        "until": "2.5האינטרקציה",
        "before": 2,
        "after": 48,
    },
    27: {
        "page": 1,
        "col": 3,
        "find": ["2.5האינטרקציה הסימבולית", "הפרט מפרש סמלים"],
        "before": 2,
        "after": 56,
    },
    # Culture col4 p1
    28: {
        "page": 1,
        "col": 4,
        "find": ["3תרבות הגדרה", "תרבות היא נלמדת מונחלת"],
        "until": "4מרכיבי תרבות",
        "before": 2,
        "after": 48,
    },
    29: {
        "page": 1,
        "col": 4,
        "find": ["תרבות חומרית שזה עצמים", "תרבות לא"],
        "until": "4מרכיבי תרבות",
        "before": 4,
        "after": 12,
    },
    30: {
        "page": 1,
        "col": 4,
        "find": ["מורס חמורה", "פולקוויס זה כללי נימוס"],
        "until": "סמלים",
        "before": 2,
        "after": 22,
    },
    31: {
        "page": 1,
        "col": 4,
        "find": ["-ערכים . אמות מידה", "אמונות"],
        "until": "סיווג נורמות",
        "before": 2,
        "after": 48,
    },
    32: {
        "page": 1,
        "col": 4,
        "find": ["כל דבר שמייצג משהו אחר", "סמל הוא יחידת משמעות"],
        "until": "ספיר וורוף",
        "before": 6,
        "after": 28,
    },
    33: {
        "page": 1,
        "col": 4,
        "find": ["ספיר וורוף", "השפה נותנת לנו כלים"],
        "until": "4.1מבנה חברתי",
        "before": 4,
        "after": 16,
    },
    34: {
        "page": 1,
        "col": 4,
        "find": ["סטטוס שיוכי שניתן", "סטטוס הישגי"],
        "until": "תפקידי זה מצב",
        "before": 4,
        "after": 28,
    },
    35: {
        "page": 1,
        "col": 4,
        "find": ["תפקידי זה מצב", "מתח תפקידי"],
        "before": 2,
        "after": 28,
    },
    # Ethnocentrism p2 col1 (typo: אתונצטריות)
    36: {
        "page": 2,
        "col": 1,
        "find": ["אתונצטריות", "יחסיות תרבותית"],
        "until": "רב תרבותיות",
        "before": 2,
        "after": 28,
    },
    37: {
        "page": 2,
        "col": 1,
        "find": ["5חיברות הגדרה", "פוטנציאל מולד ללמידה"],
        "until": "5.1בידוד",
        "before": 2,
        "after": 48,
    },
    38: {
        "page": 2,
        "col": 1,
        "find": ["5.1בידוד חברתי", "הארלו בדקו קופים"],
        "until": "5.2חשיבות",
        "before": 2,
        "after": 100,
    },
    39: {
        "page": 2,
        "col": 1,
        "find": ["5.2חשיבות החיברות", "חשיבות לחברה"],
        "before": 2,
        "after": 56,
    },
    # Mead / Cooley p2 col2
    40: {
        "page": 2,
        "col": 2,
        "find": ["ג׳ורג׳ מיד", "משחק פשוט", "אחר משמעותי"],
        "until": "5.5סוכני",
        "before": 8,
        "after": 80,
    },
    41: {
        "page": 2,
        "col": 2,
        "find": ["מתחילה באיי", "העצמי (סלף)"],
        "until": "5.5סוכני",
        "before": 4,
        "after": 36,
    },
    42: {
        "page": 2,
        "col": 2,
        "find": ["קולי ״אני במראה״", "אני במראה"],
        "before": 6,
        "after": 18,
    },
    43: {
        "page": 2,
        "col": 2,
        "find": ["משפחה", "סוכן חיברות"],
        "until": "בית ספר- סוכן",
        "before": 2,
        "after": 28,
    },
    44: {
        "page": 2,
        "col": 2,
        "find": ["תוכנית לימודים סמויה", "בית ספר- סוכן חיברות"],
        "until": "קולניס",
        "before": 2,
        "after": 48,
    },
    45: {
        "page": 2,
        "col": 2,
        "find": ["דריבין", "קולמן"],
        "before": 2,
        "after": 36,
    },
    46: {
        "page": 2,
        "col": 2,
        "find": ["קולניס", "תארים ותעודות"],
        "until": "דריבין",
        "before": 2,
        "after": 24,
    },
    # Media p2 col3 top
    59: {
        "page": 2,
        "col": 3,
        "find": ["תקשורת ההמונים", "חיברות מטרים"],
        "until": "6ריבוד",
        "before": 4,
        "after": 48,
    },
    47: {
        "page": 2,
        "col": 3,
        "find": ["6ריבוד רקע והגדרות", "ריבוד זה אי שוויון ממוסד"],
        "until": "6.1מערכות",
        "before": 2,
        "after": 64,
    },
    48: {
        "page": 2,
        "col": 3,
        "find": ["6.1מערכות ריבוד", "חברה סגורה לפתוחה"],
        "until": "6.2סוגי מוביליות",
        "before": 2,
        "after": 48,
    },
    49: {
        "page": 2,
        "col": 3,
        "find": ["מוביליות אנכית למוביליות אופקית", "אנכית מלמעלה"],
        "until": "6.3רצף",
        "before": 2,
        "after": 36,
    },
    50: {
        "page": 2,
        "col": 3,
        "find": ["מורה שהופך לעו״ס", "מורה שהופך", "למובליות אופקית זה באותה"],
        "until": "תוך דורית",
        "before": 10,
        "after": 18,
    },
    51: {
        "page": 2,
        "col": 3,
        "find": ["ברית עולי", "עולי המועצות", "מוסדות חינוך, תקשורת, ומפלגות"],
        "until": "אבחנה בין מוביליות אנכית",
        "before": 14,
        "after": 10,
    },
    52: {
        "page": 2,
        "col": 3,
        "find": ["קאסטות", "6.3רצף של מערכות"],
        "until": "השדרות",
        "before": 8,
        "after": 28,
    },
    53: {
        "page": 2,
        "col": 4,
        "find": ["דיוויס ומור", "6.4ריבוד לפי הגישות"],
        "until": "מקס וובר אומר תחרות",
        "before": 8,
        "after": 64,
    },
    54: {
        "page": 2,
        "col": 4,
        "find": ["הון תרבותי", "פייר בורדייה"],
        "until": "אלימות סימבולית",
        "before": 4,
        "after": 28,
    },
    55: {
        "page": 2,
        "col": 4,
        "find": ["אלימות סימבולית"],
        "before": 2,
        "after": 36,
    },
    56: {
        "page": 2,
        "col": 4,
        "find": ["הביטוס"],
        "until": "אלימות סימבולית",
        "before": 2,
        "after": 20,
    },
    # Capitalist ideology (closest on-sheet to liberal/capitalist education ideology)
    57: {
        "page": 2,
        "col": 4,
        "find": ["תפיסה קפיטליסטית", "הכסף הוא המנוע"],
        "until": "6.4ריבוד לפי הגישות",
        "before": 2,
        "after": 22,
    },
    # Hegemony not named — dominant culture / ideology systems (closest teaching locus)
    58: {
        "page": 2,
        "col": 1,
        "find": ["התרבות השולטת מעבירה ערכים", "מערכות אידאולוגיות"],
        "before": 2,
        "after": 28,
    },
}


def page_lines(page: fitz.Page) -> list[tuple[float, float, float, float, str]]:
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
    out.sort(key=lambda t: (round(t[0], 1), t[2]))
    return out


def filter_col(
    lines: list[tuple[float, float, float, float, str]], col: int | None
) -> list[tuple[float, float, float, float, str]]:
    if not col:
        return lines
    cx0, cx1 = COLS[col]
    filtered = []
    for y0, y1, x0, x1, text in lines:
        # keep if line overlaps column meaningfully
        mid = (x0 + x1) / 2
        if cx0 - 4 <= mid <= cx1 + 4:
            filtered.append((y0, y1, x0, x1, text))
    return filtered


def find_y(
    lines: list[tuple[float, float, float, float, str]], needles: list[str]
) -> tuple[float, float, str] | None:
    for n in needles:
        if not n:
            continue
        for y0, y1, _x0, _x1, text in lines:
            if n in text:
                return y0, y1, text
    return None


def locate(page: fitz.Page, cfg: dict) -> tuple[fitz.Rect, str]:
    all_lines = page_lines(page)
    col = cfg.get("col")
    lines = filter_col(all_lines, col)
    hit = find_y(lines, cfg["find"])
    if not hit:
        # fallback: search whole page
        hit = find_y(all_lines, cfg["find"])
        if not hit:
            raise ValueError(f"no match for find={cfg['find']!r} col={col}")
        # if found outside col, still use col x bounds if given
        lines = all_lines

    y_start, y_end, matched = hit
    y_start -= float(cfg.get("before", 4))

    until = cfg.get("until")
    if until:
        markers = until if isinstance(until, list) else [until]
        for y0, y1, _x0, _x1, text in lines:
            if y0 <= hit[0] + 0.5:
                continue
            if any(u in text for u in markers):
                y_end = y0 - 1.5
                break
        else:
            y_end = hit[1] + float(cfg.get("after", 36))
    else:
        y_end = hit[1] + float(cfg.get("after", 36))

    pr = page.rect
    if col:
        cx0, cx1 = COLS[col]
        x0, x1 = cx0 + 2, cx1 - 2
    else:
        x0, x1 = pr.x0 + 12, pr.x1 - 12

    y_start = max(pr.y0 + 4, y_start)
    y_end = min(pr.y1 - 4, max(y_start + 22, y_end))
    return fitz.Rect(x0, y_start, x1, y_end), matched


def main() -> int:
    if not PDF.exists():
        print(f"Missing PDF: {PDF}", file=sys.stderr)
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(PDF)

    zoom = DPI / 72.0
    mat = fitz.Matrix(zoom, zoom)
    page_meta: dict[str, dict] = {}
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
            "file": f"assets/sociology/sheet/page-{i + 1}.png",
        }
        print(f"rendered {out.name} ({pix.width}x{pix.height})")

    highlights: dict[str, dict] = {}
    errors: list[str] = []
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
        region = {
            "page": cfg["page"],
            "x": round(rect.x0 / pw, 4),
            "y": round(rect.y0 / ph, 4),
            "w": round(rect.width / pw, 4),
            "h": round(rect.height / ph, 4),
            "match": matched[:90],
        }
        if cfg.get("col"):
            region["col"] = cfg["col"]
        highlights[str(qid)] = region
        print(
            f"Q{qid:02d} p{cfg['page']}c{cfg.get('col','?')} "
            f"y={region['y']:.3f}–{region['y']+region['h']:.3f}  «{matched[:48]}»"
        )

    payload = {
        "pdf": "assets/sociology/remembrance-sheet.pdf",
        "dpi": DPI,
        "pages": page_meta,
        "highlights": highlights,
    }
    out_json = OUT_DIR / "highlights.json"
    out_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nwrote {out_json} ({len(highlights)}/{len(ANCHORS)} anchors)")

    if errors:
        print("\nERRORS:", file=sys.stderr)
        for e in errors:
            print(" ", e, file=sys.stderr)
        return 1

    expected = 59
    if len(highlights) != expected:
        print(f"Expected {expected} highlights, got {len(highlights)}", file=sys.stderr)
        missing = sorted(set(range(1, expected + 1)) - {int(k) for k in highlights})
        print(" missing ids:", missing, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
