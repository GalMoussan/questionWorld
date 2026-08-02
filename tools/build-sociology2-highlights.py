#!/usr/bin/env python3
"""
Build highlight rectangles for sociology2 quiz (מבוא לסוציולוגיה - דף 2).

The remembrance sheet is a scanned 2-page landscape PDF (two content panels
per page). Text extraction is unreliable, so anchors use normalized panel
regions refined from OCR topic layout.

Usage:
  python3 tools/build-sociology2-highlights.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[1]
PDF = ROOT / "assets" / "sociology2" / "remembrance-sheet.pdf"
OUT_DIR = ROOT / "assets" / "sociology2" / "sheet"
DPI = 160

# Normalized panel regions on landscape pages (two side-by-side content panels).
# x,y,w,h in 0–1 page space.
# page1 left: society / Durkheim / education intro / SI
# page1 right: culture / functionalism / conflict / Bourdieu / Weber
# page2 left: socialization / agents / Mead / status intro
# page2 right: stratification / mobility / Ayalon / Bernstein / Durkheim education

REGIONS = {
    # Q1 open conflict Bourdieu
    1: {"page": 1, "x": 0.52, "y": 0.48, "w": 0.46, "h": 0.28, "section": "בורדייה · אלימות סימבולית"},
    # Q2 open Davis-Moore functionalism
    2: {"page": 1, "x": 0.52, "y": 0.28, "w": 0.46, "h": 0.22, "section": "פונקציונליזם · מריטוקרטיה"},
    # Q3 open ethos culture
    3: {"page": 1, "x": 0.52, "y": 0.02, "w": 0.46, "h": 0.20, "section": "תרבות · אתוס"},
    # Q4 open Adva pyramid
    4: {"page": 2, "x": 0.52, "y": 0.02, "w": 0.46, "h": 0.22, "section": "ריבוד חברתי · הגדרה"},
    # 5 Durkheim suicide (exam 1)
    5: {"page": 1, "x": 0.02, "y": 0.42, "w": 0.46, "h": 0.22, "section": "מחקר התאבדות דורקהיים"},
    # 6 five foci education
    6: {"page": 1, "x": 0.02, "y": 0.62, "w": 0.46, "h": 0.14, "section": "חינוך כתחום ידע · 5 מוקדים"},
    # 7 critique functionalism
    7: {"page": 1, "x": 0.52, "y": 0.72, "w": 0.46, "h": 0.14, "section": "ביקורת על פונקציונליזם"},
    # 8 SI definition
    8: {"page": 1, "x": 0.02, "y": 0.78, "w": 0.46, "h": 0.18, "section": "אינטראקציה סימבולית"},
    # 9 functionalist education rewards
    9: {"page": 1, "x": 0.52, "y": 0.28, "w": 0.46, "h": 0.18, "section": "תפקיד החינוך · מיון"},
    # 10 role conflict
    10: {"page": 2, "x": 0.02, "y": 0.55, "w": 0.46, "h": 0.20, "section": "סטטוס ותפקיד · קונפליקט תפקידי"},
    # 11 subculture normative
    11: {"page": 1, "x": 0.52, "y": 0.82, "w": 0.46, "h": 0.14, "section": "תת-תרבויות"},
    # 12 postmodernity
    12: {"page": 2, "x": 0.52, "y": 0.55, "w": 0.46, "h": 0.22, "section": "חינוך לערכים · ברנשטיין/יזהר"},
    # 13 Bourdieu school
    13: {"page": 1, "x": 0.52, "y": 0.48, "w": 0.46, "h": 0.26, "section": "בורדייה · שעתוק"},
    # 14 industrial revolution
    14: {"page": 1, "x": 0.02, "y": 0.28, "w": 0.46, "h": 0.14, "section": "צמיחת הסוציולוגיה במאה ה-19"},
    # 15 AGIL political
    15: {"page": 1, "x": 0.52, "y": 0.30, "w": 0.46, "h": 0.16, "section": "מודל AGIL · פרסונס"},
    # 16 Weber three dimensions
    16: {"page": 1, "x": 0.52, "y": 0.58, "w": 0.46, "h": 0.16, "section": "מקס ובר · שלושה ממדים"},
    # 17 functionalism conflicts
    17: {"page": 1, "x": 0.52, "y": 0.30, "w": 0.46, "h": 0.18, "section": "פונקציונליזם · איזון"},
    # 18 Marx vs Weber
    18: {"page": 1, "x": 0.52, "y": 0.50, "w": 0.46, "h": 0.22, "section": "מארקס מול ובר"},
    # 19 conflict elites education
    19: {"page": 1, "x": 0.52, "y": 0.08, "w": 0.46, "h": 0.18, "section": "קונפליקט · אליטות וחינוך"},
    # 20 SI education
    20: {"page": 1, "x": 0.02, "y": 0.78, "w": 0.46, "h": 0.18, "section": "SI · מערכת החינוך"},
    # 21 classroom meanings
    21: {"page": 2, "x": 0.52, "y": 0.35, "w": 0.46, "h": 0.22, "section": "הכיתה כמערכת משמעויות"},
    # 22 ethnocentrism
    22: {"page": 1, "x": 0.52, "y": 0.70, "w": 0.46, "h": 0.14, "section": "אתנוצנטריות"},
    # 23 vertical mobility
    23: {"page": 2, "x": 0.02, "y": 0.28, "w": 0.46, "h": 0.22, "section": "ניעות חברתית"},
    # 24 Bourdieu reproduction
    24: {"page": 1, "x": 0.52, "y": 0.48, "w": 0.46, "h": 0.22, "section": "שעתוק הסדר החברתי"},
    # 25 Ayalon
    25: {"page": 2, "x": 0.52, "y": 0.72, "w": 0.46, "h": 0.20, "section": "איילון · מי לומד מה"},
    # 26 ethnic stratification
    26: {"page": 2, "x": 0.52, "y": 0.02, "w": 0.46, "h": 0.18, "section": "ריבוד אתני"},
    # 27 Taub gender graph
    27: {"page": 2, "x": 0.02, "y": 0.55, "w": 0.46, "h": 0.18, "section": "סטטוס שיוכי/הישגי · מגדר"},
    # 28 SI dropout labeling
    28: {"page": 1, "x": 0.02, "y": 0.82, "w": 0.46, "h": 0.14, "section": "תיוג · נבואה שמגשימה עצמה"},
    # 29 dysfunction / hidden
    29: {"page": 1, "x": 0.02, "y": 0.62, "w": 0.46, "h": 0.16, "section": "דיספונקציה · פונקציה סמויה"},
}


def main() -> int:
    if not PDF.exists():
        print(f"Missing PDF: {PDF}", file=sys.stderr)
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(PDF)
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

    highlights = {}
    for qid, r in sorted(REGIONS.items()):
        highlights[str(qid)] = {
            "page": r["page"],
            "x": r["x"],
            "y": r["y"],
            "w": r["w"],
            "h": r["h"],
            "match": r.get("section", ""),
        }
        print(f"Q{qid:02d} p{r['page']} {r.get('section','')}")

    payload = {
        "pdf": "assets/sociology2/remembrance-sheet.pdf",
        "dpi": DPI,
        "pages": page_meta,
        "highlights": highlights,
    }
    out_json = OUT_DIR / "highlights.json"
    out_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nwrote {out_json} ({len(highlights)} highlights)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
