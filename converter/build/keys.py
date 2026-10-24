"""Answer keys: parse the regular forms written in the book; anything else is NOT guessed.

A parser returns KeyResult(key, status, reason):
    status "ok"    the key was parsed from a regular form and validates
    status "todo"  not certain: the question goes to converter/overrides/keys-todo.yaml (key may be a
                   proposal, e.g. the primary fill-in value when the book mentions alternatives)
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from ..render.inline import plain

LETTER = r"[A-Z]"


@dataclass
class KeyResult:
    key: object | None
    status: str                 # ok | todo
    reason: str = ""
    proposal: object | None = None


def ok(key) -> KeyResult:
    return KeyResult(key, "ok")


def todo(reason: str, proposal=None, key=None) -> KeyResult:
    return KeyResult(key, "todo", reason, proposal)


# ---------------------------------------------------------------------------------------------- helpers
def first_paragraph(blocks: list) -> list:
    if not blocks or blocks[0].get("t") != "p":
        return []
    return blocks[0]["c"]


def lead(inl: list) -> tuple[dict | None, list]:
    """The leading bold node of a paragraph (the key in "\\textbf{B.} because ...") and the rest."""
    if inl and isinstance(inl[0], dict) and inl[0].get("t") == "b":
        return inl[0], inl[1:]
    return None, inl


def text_of(node_or_list) -> str:
    if isinstance(node_or_list, dict):
        return plain(node_or_list.get("c", []))
    return plain(node_or_list)


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.replace(" ", " ")).strip()


def first_sentence_tail(rest: list) -> str:
    """Text right after the lead, up to the end of its sentence (used to spot 'or ...' alternatives)."""
    t = norm(plain(rest))
    m = re.match(r"^(\([^)]*\)|[^.;]*)", t)
    return m.group(0) if m else ""


# ---------------------------------------------------------------------------------------------- per format
def parse_mc(lead_text: str, options: list[str]) -> KeyResult:
    m = re.fullmatch(r"([A-Z])(?: \([^)]*\))?\.", lead_text)
    if not m:
        return todo(f"multiple choice key not in a regular form: {lead_text!r}")
    k = m.group(1)
    if k not in options:
        return todo(f"key {k} is not an option ({''.join(options)})")
    return ok(k)


def parse_ms(lead_text: str, options: list[str], choose: int) -> KeyResult:
    t = lead_text[:-1] if lead_text.endswith(".") else lead_text
    if not (re.fullmatch(r"[A-Z](?:, [A-Z])*,? and [A-Z]", t) or re.fullmatch(r"[A-Z](?:, [A-Z])+", t)):
        return todo(f"multiple select key not in a regular form: {lead_text!r}")
    letters = re.findall(r"[A-Z]", t)
    if len(letters) != choose or len(set(letters)) != len(letters) or any(x not in options for x in letters):
        return todo(f"multiple select key {letters} does not match choose={choose} / options {''.join(options)}")
    return ok(sorted(letters))


def parse_order(lead_text: str, options: list[str]) -> KeyResult:
    t = lead_text.rstrip(".")
    if not re.fullmatch(r"[A-Za-z](?:, ?[A-Za-z])+", t):
        return todo(f"build-list key not in a regular form: {lead_text!r}")
    letters = [x.upper() for x in re.findall(r"[A-Za-z]", t)]
    if sorted(letters) != sorted(options) or len(set(letters)) != len(letters):
        return todo(f"build-list key {letters} is not a permutation of the options {''.join(options)}")
    return ok(letters)


def parse_order_words(par: list, options: list[dict]) -> KeyResult:
    """Build list whose options are written as words: the key repeats the option texts in order
    ("Read, Do, Test, Review." or "Import CTEs -> logical CTEs -> ..."). Exact (case-insensitive) matches only."""
    ld, rest = lead(par)
    text = norm(text_of(ld)) if ld is not None else norm(plain(par))
    m = re.match(r"^(.*?\.)(?:\s|$)", text + " ") if ld is None else None
    if ld is None:
        # the whole first sentence
        text = re.split(r"(?<=[a-z)])\.\s", text + " ", maxsplit=1)[0].strip().rstrip(".")
    else:
        text = text.rstrip(".")
    seps = [s for s in ("\u2192", ";", ",") if s in text]
    if not seps:
        return todo(f"build-list key not in a regular form: {text!r}")
    words = [norm(w) for w in text.split(seps[0])]
    names = {norm(plain(o["c"])).lower(): o["id"] for o in options}
    if len(names) != len(options):
        return todo("build-list options are not distinct")
    key = []
    for w in words:
        oid = names.get(w.lower())
        if oid is None:
            return todo(f"build-list key item {w!r} matches no option exactly")
        key.append(oid)
    if sorted(key) != sorted(o["id"] for o in options) or len(set(key)) != len(key):
        return todo(f"build-list key {key} is not a permutation of the options")
    return ok(key)


def parse_hotspot(lead_text: str) -> KeyResult:
    m = re.fullmatch(r"Line (\d+)\.?", lead_text)
    if not m:
        return todo(f"hotspot key not in a regular form: {lead_text!r}")
    return ok(int(m.group(1)))


def parse_match(text: str, left: list[str], right: list[str]) -> KeyResult:
    t = norm(text).rstrip(".")
    pairs = re.findall(r"(\d+)\s*[-–]+\s*([A-Za-z])", t)
    rebuilt = re.sub(r"(\d+)\s*[-–]+\s*([A-Za-z])", "#", t)
    if not pairs or not re.fullmatch(r"#(?:,? #)*", rebuilt):
        return todo(f"matching key not in a regular form: {text!r}")
    rmap = {r.lower(): r for r in right}
    key = {}
    for a, b in pairs:
        if a in key:
            return todo(f"matching key gives item {a} twice")
        if b.lower() not in rmap:
            return todo(f"matching key uses {b!r}, not a right-hand item ({''.join(right)})")
        key[a] = rmap[b.lower()]
    if sorted(key, key=int) != sorted(left, key=int):
        return todo(f"matching key covers {sorted(key)} but the left items are {left}")
    return ok(key)


def parse_domc_text(text: str, options: list[str]) -> KeyResult:
    t = norm(text)
    # "YES, NO, YES, NO." (in option order)
    if re.fullmatch(r"(?:YES|NO)(?:, (?:YES|NO))*\.?", t):
        vals = re.findall(r"YES|NO", t)
        if len(vals) != len(options):
            return todo(f"DOMC key has {len(vals)} values for {len(options)} options")
        return ok({o: v == "YES" for o, v in zip(options, vals)})
    # "A: YES, B: NO." / "A: YES. B: NO." / "A-YES, B-NO" / "A YES, B NO" / "A:N B:Y"
    pat = r"([A-Z])\s*(?::|-|\s)\s*(YES|NO|Y|N)\b"
    pairs = re.findall(pat, t)
    rebuilt = re.sub(pat, "#", t)
    if pairs and re.fullmatch(r"#(?:[,.;]? #)*[.]?", rebuilt):
        key = {}
        for o, v in pairs:
            if o in key:
                return todo(f"DOMC key gives option {o} twice")
            key[o] = v in ("YES", "Y")
        if sorted(key) != sorted(options):
            return todo(f"DOMC key covers {sorted(key)} but the options are {options}")
        return ok({o: key[o] for o in options})
    return todo(f"DOMC key not in a regular form: {text!r}")


def parse_domc_bolds(par: list, options: list[str]) -> KeyResult:
    """Chapter 0 form: \\textbf{A: NO} (why). \\textbf{B: YES} (why) ..."""
    bolds = [norm(text_of(x)) for x in par if isinstance(x, dict) and x.get("t") == "b"]
    pairs = [re.fullmatch(r"([A-Z]): (YES|NO)\.?", b) for b in bolds]
    pairs = [p for p in pairs if p]
    if not pairs:
        return todo("DOMC key not found")
    key = {p.group(1): p.group(2) == "YES" for p in pairs}
    if sorted(key) != sorted(options) or len(pairs) != len(options):
        return todo(f"DOMC key covers {sorted(key)} but the options are {options}")
    return ok({o: key[o] for o in options})


ALT_HINT = re.compile(r"\b(or|short form|works too|both answers)\b")


def fill_values(lead_node: dict) -> list[str]:
    """Split the bold lead of a fill-in answer into values: one per code node, else comma / 'and' split."""
    c = lead_node.get("c", [])
    codes = [x["v"] for x in c if isinstance(x, dict) and x.get("t") == "code"]
    others = norm("".join(x for x in c if isinstance(x, str)))
    if codes and re.fullmatch(r"[\s,.;:]*(?:(?:,|and|or|;)[\s,.;]*)*", others):
        return codes
    if codes:
        return []
    t = norm(plain(c)).rstrip(".")
    return [v.strip() for v in re.split(r",\s*|\s+and\s+|\s*;\s*", t) if v.strip()]


def parse_fill(par: list, blanks: int) -> KeyResult:
    ld, rest = lead(par)
    if ld is None:
        return todo("fill-in answer does not start with a bold value")
    bolds = [ld]
    # "\textbf{3} and \textbf{2}." / "\textbf{now} (...), \textbf{dictionary} (...)": several bold values
    for x in rest:
        if isinstance(x, dict) and x.get("t") == "b":
            bolds.append(x)
    lead_text = norm(text_of(ld))
    tail = first_sentence_tail(rest)
    if len(bolds) > 1:
        values = [fill_values(b) for b in bolds]
        if any(len(v) != 1 for v in values):
            return todo("several bold values in a fill-in answer, not in a regular form")
        values = [v[0] for v in values]
    else:
        values = fill_values(ld)
    if not values:
        return todo(f"fill-in value not in a regular form: {lead_text!r}")
    if ALT_HINT.search(lead_text):
        return todo(f"the key lists alternatives: {lead_text!r}", proposal={"accepted": values})
    if len(values) == 1:
        if blanks != 1:
            return todo(f"1 value for {blanks} blanks in the stem", proposal={"accepted": values})
        if ALT_HINT.search(tail):
            return todo(f"alternative answers mentioned after the key: {tail!r}",
                        proposal={"accepted": values}, key={"accepted": values})
        return ok({"accepted": values})
    if len(values) != blanks:
        return todo(f"{len(values)} values for {blanks} blanks in the stem", proposal={"blanks": [[v] for v in values]})
    return ok({"blanks": [[v] for v in values]})


def parse_mock_fill(key_inl: list, blanks: int) -> KeyResult:
    codes = [x["v"] for x in key_inl if isinstance(x, dict) and x.get("t") == "code"]
    others = norm("".join(x for x in key_inl if isinstance(x, str)))
    if codes:
        if not re.fullmatch(r"[\s,;]*", others):
            return todo(f"mock fill-in key not in a regular form: {plain(key_inl)!r}")
        values = codes
    else:
        if any(not isinstance(x, str) for x in key_inl):
            return todo(f"mock fill-in key not in a regular form: {plain(key_inl)!r}")
        values = [v.strip() for v in re.split(r"\s*;\s*|,\s+", others) if v.strip()]
    if len(values) == 1:
        if blanks != 1:
            return todo(f"1 value for {blanks} blanks in the stem", proposal={"accepted": values})
        return ok({"accepted": values})
    if len(values) != blanks:
        return todo(f"{len(values)} values for {blanks} blanks", proposal={"blanks": [[v] for v in values]})
    return ok({"blanks": [[v] for v in values]})


# ---------------------------------------------------------------------------------------------- validation
def validate(q: dict) -> str | None:
    """SCHEMA.md validation rules. Returns an error message or None."""
    f = q["format"]
    k = q.get("key")
    opts = [o["id"] for o in q.get("options", [])]
    if f == "mc":
        return None if isinstance(k, str) and k in opts else f"mc key {k!r} not one valid letter"
    if f == "ms":
        if not (isinstance(k, list) and len(k) == q.get("choose") and len(set(k)) == len(k) and all(x in opts for x in k)):
            return f"ms key {k!r} is not exactly {q.get('choose')} valid letters"
        return None
    if f == "order":
        if not (isinstance(k, list) and sorted(k) == sorted(opts) and len(set(k)) == len(k)):
            return f"order key {k!r} is not a permutation of {opts}"
        return None
    if f == "match":
        m = q.get("match") or {}
        left = [x["id"] for x in m.get("left", [])]
        right = [x["id"] for x in m.get("right", [])]
        if not (isinstance(k, dict) and sorted(k, key=str) == sorted(left, key=str) and all(v in right for v in k.values())):
            return f"match key {k!r} does not map every left item to a right item"
        if len(left) == len(right) and len(set(k.values())) != len(k):
            return f"match key {k!r} is not a bijection"
        if len(right) < len(left) and not q.get("match", {}).get("reuse"):
            return "match has fewer right items than left items but reuse is not set"
        return None
    if f == "domc":
        if not (isinstance(k, dict) and sorted(k) == sorted(opts) and all(isinstance(v, bool) for v in k.values())):
            return f"domc key {k!r} is not a YES/NO for every option"
        return None
    if f == "hotspot":
        h = q.get("hotspot")
        if not (isinstance(k, int) and h):
            return f"hotspot key {k!r} or hotspot data missing"
        lo = h.get("firstLine", 1)
        if not (lo <= k < lo + h["lines"]):
            return f"hotspot line {k} outside {lo}..{lo + h['lines'] - 1}"
        return None
    if f == "fill":
        if isinstance(k, dict) and "accepted" in k:
            return None if k["accepted"] and all(isinstance(v, str) and v for v in k["accepted"]) else "fill: no accepted value"
        if isinstance(k, dict) and "blanks" in k:
            if q.get("blanks") != len(k["blanks"]):
                return f"fill: {len(k['blanks'])} values for {q.get('blanks')} blanks"
            return None if all(b and all(isinstance(v, str) and v for v in b) for b in k["blanks"]) else "fill: empty blank"
        return f"fill key {k!r} has no accepted value"
    return f"unknown format {f}"
