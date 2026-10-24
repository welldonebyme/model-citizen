"""The whole pipeline: book -> in-memory outputs (no file writing here)."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import yaml

from ..render.context import Ctx
from .chapters import BookState, ChapterBuilder, ChapterResult
from .objectives import all_ids, load_objectives
from .structure import register_labels, segment


@dataclass
class BuildResult:
    chapters: list[ChapterResult]
    labels: dict
    state: BookState
    objectives: list
    figure_alts: dict
    warnings: list = field(default_factory=list)


def load_figure_alts(overrides: Path) -> dict:
    p = overrides / "figures.yaml"
    if not p.exists():
        return {}
    data = yaml.safe_load(p.read_text()) or {}
    return {k: v for k, v in data.items()}


def run(book: Path, overrides: Path) -> BuildResult:
    segs = segment(book)
    labels = register_labels(segs)
    objectives = load_objectives(book)
    ids = all_ids(objectives)
    alts = load_figure_alts(overrides)
    state = BookState()
    results: list[ChapterResult] = []
    for seg in segs:
        ctx = Ctx(chapter_id=seg.id, chapter_number=seg.number, chapter_label=seg.printed, labels=labels,
                  objective_ids=ids, term_ids={}, figure_alts=alts)
        b = ChapterBuilder(seg, ctx, state)
        chapter = b.build()
        results.append(ChapterResult(seg, chapter, b.drafts, ctx))
    return BuildResult(results, labels, state, objectives, alts)
