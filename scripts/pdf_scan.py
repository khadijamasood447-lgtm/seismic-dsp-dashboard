import json
import re
from dataclasses import dataclass
from pathlib import Path

import pdfplumber
from pypdf import PdfReader


@dataclass(frozen=True)
class PageHit:
    page: int
    keyword: str
    context: str
    table_count: int


def _normalize_space(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def scan_pdf(pdf_path: Path, keywords: list[str], max_hits: int = 20) -> dict:
    key_re = re.compile("|".join(re.escape(k) for k in keywords), re.IGNORECASE)
    hits: list[PageHit] = []
    matched_pages: list[int] = []
    reader = PdfReader(str(pdf_path))
    page_count = len(reader.pages)

    for page_index, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        match = key_re.search(text)
        if match:
            matched_pages.append(page_index)
            if len(hits) < max_hits:
                start = max(0, match.start() - 120)
                end = min(len(text), match.start() + 220)
                ctx = _normalize_space(text[start:end])
                hits.append(PageHit(page=page_index, keyword=match.group(0), context=ctx, table_count=0))

    table_counts: dict[int, int] = {}
    if matched_pages:
        with pdfplumber.open(str(pdf_path)) as pdf:
            for page_index in matched_pages:
                page = pdf.pages[page_index - 1]
                tables = page.extract_tables() or []
                table_counts[page_index] = len(tables)

    hits = [
        PageHit(page=h.page, keyword=h.keyword, context=h.context, table_count=table_counts.get(h.page, 0))
        for h in hits
    ]

    return {
        "file": pdf_path.name,
        "pages": page_count,
        "matched_pages": len(set(matched_pages)),
        "hits": [h.__dict__ for h in hits],
        "tables_on_matched_pages": sum(table_counts.values()),
    }


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    pdfs = sorted(root.glob("*.pdf"))
    keywords = [
        "cyclic triaxial",
        "undrained cyclic",
        "cyclic stress ratio",
        "CSR",
        "pore pressure",
        "excess pore",
        "ru",
        "liquefaction",
        "deviator",
        "triaxial",
        "axial strain",
        "hysteresis",
    ]

    payload = {"pdf_count": len(pdfs), "results": [scan_pdf(p, keywords=keywords) for p in pdfs]}
    out_path = root / "pdf_scan_results.json"
    out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(str(out_path))


if __name__ == "__main__":
    main()
