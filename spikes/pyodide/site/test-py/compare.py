"""Text comparison tiers used by the parity runners (CPython and Pyodide)."""
import re


def _strip_lines(text):
    return [l.strip() for l in text.replace("\t", " ").split("\n") if l.strip()]


def _collapse(text):
    return re.sub(r"\s+", " ", text).strip()


def _contiguous(needle, hay):
    n = len(needle)
    return any(hay[i:i + n] == needle for i in range(len(hay) - n + 1)) if n else True


def compare(book, got, mode="equal"):
    """mode 'equal': the whole text must match; 'within': the book shows a contiguous excerpt of `got`.

    exact = byte for byte (for 'within': substring), lines = same lines after stripping each line and
    dropping blank lines, ws = same text after collapsing every run of whitespace.
    """
    if got is None:
        return {"exact": False, "lines": False, "ws": False}
    if mode == "segments":  # the book elides parts with a line '...': every segment, in order
        segs = [s.strip("\n") for s in re.split(r"(?m)^\.\.\.$", book) if s.strip()]
        res = {"exact": True, "lines": True, "ws": True}
        pos = {"exact": 0, "ws": 0}
        hay_lines = _strip_lines(got)
        line_pos = 0
        for s in segs:
            i = got.find(s, pos["exact"])
            res["exact"] &= i >= 0
            pos["exact"] = i + len(s) if i >= 0 else pos["exact"]
            cg, cs = _collapse(got), _collapse(s)
            j = cg.find(cs, pos["ws"])
            res["ws"] &= j >= 0
            pos["ws"] = j + len(cs) if j >= 0 else pos["ws"]
            sl = _strip_lines(s)
            found = next((k for k in range(line_pos, len(hay_lines) - len(sl) + 1)
                          if hay_lines[k:k + len(sl)] == sl), None)
            res["lines"] &= found is not None
            line_pos = found + len(sl) if found is not None else line_pos
        return res
    if mode == "within":
        return {"exact": book in got,
                "lines": _contiguous(_strip_lines(book), _strip_lines(got)),
                "ws": _collapse(book) in _collapse(got)}
    return {"exact": book == got,
            "lines": _strip_lines(book) == _strip_lines(got),
            "ws": _collapse(book) == _collapse(got)}
