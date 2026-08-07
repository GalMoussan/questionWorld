#!/usr/bin/env python3
"""
Render תמסיר PDFs to page images and compute highlight rects for Logic-B quiz.

Usage:
  python3 tools/build-logicb-highlights.py

Outputs:
  assets/logic-b/sheet/t{N}-p{M}.png
  assets/logic-b/sheet/highlights.json
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import fitz  # PyMuPDF

ROOT = Path(__file__).resolve().parents[1]
DOC_DIR = ROOT / "assets" / "logic-b"
OUT_DIR = DOC_DIR / "sheet"
DPI = 160
ZOOM = DPI / 72.0

# Per-question anchors: doc is tamsir number (1–11), page is 1-based.
# find: needles tried in order; until: exclusive end needle on same page.
# before/after: pad in PDF points around the match block.
ANCHORS: dict[int, dict] = {
    # Hand-tuned overrides (optional). Prefer sheetRef.lines from the question bank.
    # Auto anchors + line-based rects are built from questions-logicb.js.
}


def find_y(page: fitz.Page, needles: list[str]) -> float | None:
    for n in needles:
        n = (n or "").strip()
        if len(n) < 2:
            continue
        hits = page.search_for(n)
        if hits:
            return min(h.y0 for h in hits)
    return None


def rect_for_anchor(page: fitz.Page, anchor: dict) -> fitz.Rect | None:
    y0 = find_y(page, anchor["find"])
    if y0 is None:
        return None
    y0 = max(0, y0 - float(anchor.get("before", 4)))
    y1 = None
    until = anchor.get("until")
    if until:
        needles = until if isinstance(until, list) else [until]
        uy = find_y(page, needles)
        if uy is not None and uy > y0 + 10:
            y1 = uy
    if y1 is None:
        y1 = y0 + float(anchor.get("after", 56))
    else:
        # Prefer the until boundary, but keep a readable band
        y1 = max(y1, y0 + float(anchor.get("after", 48)))
    # clamp to page — minimum ~9% of page height so the yellow box is obvious
    h = page.rect.height
    w = page.rect.width
    min_band = max(56.0, h * 0.09)
    y0 = max(0, min(y0, h - min_band - 8))
    y1 = max(y0 + min_band, min(y1, h - 8))
    # full content width with small side margins
    return fitz.Rect(w * 0.04, y0, w * 0.96, y1)


def load_questions_bank() -> list[dict]:
    """Parse questions-logicb.js for sheetRef-driven auto anchors."""
    js_path = ROOT / "questions-logicb.js"
    if not js_path.exists():
        return []
    text = js_path.read_text(encoding="utf-8")
    import re

    m = re.search(r"const LOGICB_QUESTIONS\s*=\s*(\[[\s\S]*?\n\]);", text)
    if not m:
        return []
    return json.loads(m.group(1))


def needles_from_sheet_ref(sr: dict) -> list[str]:
    """Build search needles from section + hint (longest first)."""
    raw: list[str] = []
    section = (sr.get("section") or "").strip()
    hint = (sr.get("hint") or "").strip()
    if section:
        raw.append(section)
    if hint:
        # hints often use ; or · separators
        for part in re.split(r"[;·|/]", hint):
            part = part.strip()
            if part:
                raw.append(part)
    # unique preserve order, prefer longer phrases first for search_for
    seen = set()
    out: list[str] = []
    for n in sorted(raw, key=len, reverse=True):
        key = n.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(n)
    return out or ["תמסיר"]



def line_number_positions(page: fitz.Page) -> dict[int, float]:
    """Map printed line numbers on a page to y0 (PDF points)."""
    mapping: dict[int, float] = {}
    x_map: dict[int, float] = {}
    for w in page.get_text("words"):
        token = (w[4] or "").strip()
        if not re.fullmatch(r"\d{1,3}", token):
            continue
        n = int(token)
        if not (1 <= n <= 300):
            continue
        x0, y0 = float(w[0]), float(w[1])
        # Prefer leftmost occurrence (margin line numbers)
        if n not in x_map or x0 < x_map[n]:
            x_map[n] = x0
            mapping[n] = y0
    return mapping


def rect_for_lines(page: fitz.Page, lines: list[int], pad_before: float = 4, pad_after: float = 14) -> fitz.Rect | None:
    """Highlight band covering the given printed line numbers on this page."""
    if not lines:
        return None
    pos = line_number_positions(page)
    ys = [pos[n] for n in lines if n in pos]
    if not ys:
        return None
    y0 = max(0.0, min(ys) - pad_before)
    # Approximate line height from consecutive numbers, else ~14pt
    sorted_pos = sorted(pos.items())
    gaps = []
    for i in range(1, len(sorted_pos)):
        dy = sorted_pos[i][1] - sorted_pos[i - 1][1]
        if 8 < dy < 28:
            gaps.append(dy)
    line_h = (sum(gaps) / len(gaps)) if gaps else 14.0
    y1 = max(ys) + line_h + pad_after
    h = page.rect.height
    w = page.rect.width
    min_band = max(48.0, h * 0.07)
    y0 = max(0, min(y0, h - min_band - 8))
    y1 = max(y0 + min_band, min(y1, h - 8))
    return fitz.Rect(w * 0.04, y0, w * 0.96, y1)


def auto_anchors_from_bank() -> dict[int, dict]:
    """Build anchors from each question's sheetRef (lines preferred for highlight)."""
    bank = load_questions_bank()
    auto: dict[int, dict] = {}
    for q in bank:
        qid = int(q["id"])
        if qid in ANCHORS:
            continue
        sr = q.get("sheetRef") or {}
        if not sr.get("doc") or not sr.get("page"):
            continue
        find = needles_from_sheet_ref(sr)
        entry: dict = {
            "doc": int(sr["doc"]),
            "page": int(sr["page"]),
            "find": find,
            "before": 6,
            "after": 52,
        }
        lines = sr.get("lines")
        if isinstance(lines, list) and lines:
            entry["lines"] = [int(x) for x in lines]
        auto[qid] = entry
    return auto


def render_pages(docs_meta: dict) -> dict:
    """Render every page of every tamsir; return pages map for highlights.json."""
    pages: dict[str, dict] = {}
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for doc_i in range(1, 12):
        pdf_path = DOC_DIR / f"tamsir-{doc_i}.pdf"
        if not pdf_path.exists():
            print(f"WARN missing {pdf_path}", file=sys.stderr)
            continue
        doc = fitz.open(pdf_path)
        docs_meta[str(doc_i)] = {
            "pdf": f"assets/logic-b/tamsir-{doc_i}.pdf",
            "title": f"תמסיר {doc_i}",
            "pages": len(doc),
        }
        mat = fitz.Matrix(ZOOM, ZOOM)
        for pno, page in enumerate(doc):
            key = f"{doc_i}-{pno + 1}"
            fname = f"t{doc_i}-p{pno + 1}.png"
            out = OUT_DIR / fname
            pix = page.get_pixmap(matrix=mat, alpha=False)
            pix.save(out.as_posix())
            pages[key] = {
                "doc": doc_i,
                "page": pno + 1,
                "width": page.rect.width,
                "height": page.rect.height,
                "imgWidth": pix.width,
                "imgHeight": pix.height,
                "file": f"assets/logic-b/sheet/{fname}",
            }
            print(f"  rendered {fname} ({pix.width}x{pix.height})")
        doc.close()
    return pages


def main() -> int:
    print("Rendering Logic-B תמסיר pages…")
    docs_meta: dict = {}
    pages = render_pages(docs_meta)

    # Merge hand-tuned anchors with auto sheetRef anchors from the question bank
    auto = auto_anchors_from_bank()
    all_anchors: dict[int, dict] = {**auto, **ANCHORS}  # hand-tuned wins
    print(f"Anchors: {len(ANCHORS)} hand-tuned + {len(auto)} auto = {len(all_anchors)} total")

    highlights: dict[str, dict] = {}
    open_docs: dict[int, fitz.Document] = {}

    def get_doc(n: int) -> fitz.Document:
        if n not in open_docs:
            open_docs[n] = fitz.open(DOC_DIR / f"tamsir-{n}.pdf")
        return open_docs[n]

    matched = 0
    fallback = 0
    for qid, anchor in sorted(all_anchors.items()):
        doc_i = int(anchor["doc"])
        page_i = int(anchor["page"])
        doc = get_doc(doc_i)
        if page_i < 1 or page_i > len(doc):
            print(f"Q{qid}: bad page {page_i}", file=sys.stderr)
            page_i = 1
        page = doc[page_i - 1]
        used_page = page_i
        rect = None
        lines = anchor.get("lines")
        if isinstance(lines, list) and lines:
            rect = rect_for_lines(page, lines)
            if rect is None:
                # line numbers may live on another page of the same תמסיר
                for pno in range(len(doc)):
                    r = rect_for_lines(doc[pno], lines)
                    if r is not None:
                        rect = r
                        used_page = pno + 1
                        print(f"Q{qid}: lines relocated tamsir {doc_i} p{page_i}→p{used_page}")
                        break
        if rect is None:
            page = doc[used_page - 1] if used_page != page_i else page
            rect = rect_for_anchor(page, anchor)
            used_page = page_i if rect is not None and used_page == page_i else used_page
            # If needle missing on declared page, scan whole תמסיר
            if rect is None:
                for pno in range(len(doc)):
                    if pno + 1 == page_i:
                        continue
                    r = rect_for_anchor(doc[pno], anchor)
                    if r is not None:
                        rect = r
                        used_page = pno + 1
                        print(f"Q{qid}: relocated tamsir {doc_i} p{page_i}→p{used_page}")
                        break
        if rect is None:
            fallback += 1
            print(f"Q{qid}: no match for {anchor['find'][:3]} — content-band fallback", file=sys.stderr)
            # fallback: mid-upper content band on declared page
            page = doc[page_i - 1]
            used_page = page_i
            rect = fitz.Rect(
                page.rect.width * 0.04,
                page.rect.height * 0.14,
                page.rect.width * 0.96,
                page.rect.height * 0.30,
            )
        else:
            matched += 1
            page = doc[used_page - 1]

        pw, ph = page.rect.width, page.rect.height
        highlights[str(qid)] = {
            "doc": doc_i,
            "page": used_page,
            "x": round(rect.x0 / pw, 4),
            "y": round(rect.y0 / ph, 4),
            "w": round(rect.width / pw, 4),
            "h": round(rect.height / ph, 4),
            "match": " | ".join(str(x) for x in anchor["find"][:2]),
        }
        print(
            f"Q{qid}: tamsir {doc_i} p{used_page} "
            f"y={highlights[str(qid)]['y']:.3f} h={highlights[str(qid)]['h']:.3f}"
        )

    for d in open_docs.values():
        d.close()

    payload = {
        "kind": "logic-b-multi-doc",
        "dpi": DPI,
        "docs": docs_meta,
        "pages": pages,
        "highlights": highlights,
    }
    out_json = OUT_DIR / "highlights.json"
    out_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"Wrote {out_json} ({len(highlights)} highlights, {len(pages)} pages; "
        f"matched={matched}, fallback={fallback})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
