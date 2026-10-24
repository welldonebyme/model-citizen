"""Shared state while rendering one chapter (counters, labels, statistics, warnings)."""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field

from ..tex.nodes import ConvertError, Node


@dataclass
class LabelInfo:
    label: str
    kind: str          # ch | app | sec | subsec | lab | fig | tab | quiz
    number: str        # "4", "A", "4.3", "4.3.2", "22.1", "14.1"
    href: str
    chapter: str       # chapter id
    lesson: str | None = None
    anchor: str | None = None


REF_WORDS = {"Chapter", "Chapters", "Section", "Sections", "Appendix", "Lab", "Figure", "Table", "Ch."}


def anchor_of(label: str) -> str:
    """Stable HTML anchor for a LaTeX label: "sec:msd-dag" -> "sec-msd-dag"."""
    a = re.sub(r"[^A-Za-z0-9_-]+", "-", label).strip("-")
    if not a:
        raise ConvertError(f"empty anchor for label {label!r}")
    return a


@dataclass
class Ctx:
    chapter_id: str
    chapter_number: int            # inventory numbering (appendices 34, 35, 36)
    chapter_label: str             # "4" or "A" (printed)
    labels: dict[str, LabelInfo]
    objective_ids: set[str]
    term_ids: dict                 # raw-key -> term id (filled by the glossary pass)
    local_styles: dict[str, str] = field(default_factory=dict)
    code_n: int = 0
    fig_n: int = 0
    lab_n: int = 0
    stats: Counter = field(default_factory=Counter)
    warnings: list[str] = field(default_factory=list)
    figures: list[dict] = field(default_factory=list)
    term_occurrences: list[dict] = field(default_factory=list)
    lesson: str | None = None      # current lesson id (None in intro / quiz / summary)
    step: str | None = None        # current step id or a pseudo anchor ("intro", "quiz", "summary")
    series: dict[str, int] = field(default_factory=dict)  # enumitem series counters
    figure_alts: dict = field(default_factory=dict)
    obj_tags: list[str] = field(default_factory=list)      # every \objective{..} rendered (in order)
    lab_records: list[dict] = field(default_factory=list)

    def error(self, node: Node | None, msg: str) -> None:
        where = node.where() if node is not None else self.chapter_id
        raise ConvertError(f"{where}: {msg}")

    def warn(self, node: Node | None, msg: str) -> None:
        where = node.where() if node is not None else self.chapter_id
        self.warnings.append(f"{where}: {msg}")

    def next_code_id(self) -> str:
        self.code_n += 1
        return f"{self.chapter_id}-c{self.code_n}"

    def next_fig_id(self) -> tuple[str, int]:
        self.fig_n += 1
        return f"{self.chapter_id}-fig{self.fig_n}", self.fig_n

    def next_lab_id(self) -> str:
        self.lab_n += 1
        return f"{self.chapter_id}-lab{self.lab_n}"
