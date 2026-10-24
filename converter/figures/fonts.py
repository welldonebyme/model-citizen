"""The book's fonts, taken from tectonic's cache (the same files tectonic used to build the PDFs).

Used for glyph advances (svgpost: where TeX placed a glyph further than its natural advance, the SVG keeps an
explicit x) and by the contact sheet (@font-face). Copies live in build/fonts/ (not committed).
"""
from __future__ import annotations

import os
import shutil
from functools import lru_cache
from pathlib import Path

import pymupdf

import figsrc

# tectonic's cache: ~/Library/Caches/Tectonic on macOS, ~/.cache/Tectonic on Linux; override with TECTONIC_CACHE_DIR
TECTONIC_CACHE = Path(os.environ.get("TECTONIC_CACHE_DIR") or (
    Path.home() / "Library/Caches/Tectonic" if (Path.home() / "Library/Caches/Tectonic").exists()
    else Path.home() / ".cache/Tectonic"))
DEST = figsrc.HERE / "build/fonts"

FILES = {
    "FiraSans-Regular": "FiraSans-Regular.otf",
    "FiraSans-SemiBold": "FiraSans-SemiBold.otf",
    "FiraSans-Italic": "FiraSans-Italic.otf",
    "FiraSans-SemiBoldItalic": "FiraSans-SemiBoldItalic.otf",
    "FiraMono-Regular": "FiraMono-Regular.otf",
    "FiraMono-Bold": "FiraMono-Bold.otf",
    "TeXGyrePagella-Regular": "texgyrepagella-regular.otf",
}


@lru_cache(maxsize=None)
def _index() -> dict[str, str]:
    index = {}
    for man in sorted((TECTONIC_CACHE / "manifests").glob("*.txt")):
        for line in man.read_text().splitlines():
            parts = line.split()
            if len(parts) == 3:
                index[parts[0]] = parts[2]
    return index


def font_file(name: str) -> Path | None:
    """Path of a font file (by PostScript-like name, see FILES), copied out of tectonic's cache."""
    fname = FILES.get(name)
    if not fname:
        return None
    target = DEST / fname
    if not target.exists():
        digest = _index().get(fname)
        if not digest:
            return None
        src = TECTONIC_CACHE / "files" / digest[:2] / digest[2:]
        if not src.exists():
            return None
        DEST.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, target)
    return target


@lru_cache(maxsize=None)
def _font(name: str):
    p = font_file(name)
    if p is None:
        raise SystemExit(f"font {name} not found in tectonic's cache ({TECTONIC_CACHE}); build the book once "
                         f"with tectonic so the bundle files are cached")
    return pymupdf.Font(fontfile=str(p))


def advance(name: str, ch: str) -> float | None:
    """Natural advance of `ch` in em, or None if the font has no glyph for it."""
    f = _font(name)
    if not f.has_glyph(ord(ch)):
        return None
    return f.glyph_advance(ord(ch))
