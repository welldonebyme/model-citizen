"""Export the two reference repositories (one JSON per tag + one diff JSON per pair of tags).

    uv run --no-project --python 3.12 converter/reference/export_repos.py

Reads (never writes) the git repositories of the book:
  ../dbt-bible/labs/practice-project/jaffle_dbt   tags ch06 .. ch25
  ../dbt-bible/labs/capstone/shopflow_dbt          tags m00 .. m14
with `git show / ls-tree / diff / log` only.

Writes (idempotent, byte-identical on re-runs, no timestamps):
  site/public/reference/<repo>/index.json              tags, commits, messages, stats
  site/public/reference/<repo>/<tag>.json              file tree + text contents at the tag
  site/public/reference/<repo>/diff-<prev>-<tag>.json  per file: added / removed / modified + unified hunks
                                                       (the first tag is diffed against "empty")
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ACADEMY = Path(__file__).resolve().parents[2]
BIBLE = ACADEMY.parent / "dbt-bible"
OUT = ACADEMY / "site" / "public" / "reference"

REPOS = {
    "jaffle": {
        "path": BIBLE / "labs" / "practice-project" / "jaffle_dbt",
        "name": "jaffle_dbt",
        "tags": [f"ch{n:02d}" for n in range(6, 26)],
    },
    "shopflow": {
        "path": BIBLE / "labs" / "capstone" / "shopflow_dbt",
        "name": "shopflow_dbt",
        "tags": [f"m{n:02d}" for n in range(0, 15)],
    },
}

MAX_TEXT_BYTES = 64 * 1024  # bigger text files keep their metadata but no content
EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"  # git's well-known empty tree


def git(repo: Path, *args: str) -> bytes:
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True).stdout


def git_text(repo: Path, *args: str) -> str:
    return git(repo, *args).decode("utf-8")


def is_binary(data: bytes) -> bool:
    if b"\0" in data:
        return True
    try:
        data.decode("utf-8")
    except UnicodeDecodeError:
        return True
    return False


def tree_files(repo: Path, rev: str) -> list[dict]:
    """Every blob of the tree at `rev`: path, mode, size, blob sha, binary flag, content."""
    out = []
    raw = git(repo, "ls-tree", "-r", "-l", "-z", "--full-tree", rev)
    for entry in raw.split(b"\0"):
        if not entry:
            continue
        meta, path = entry.split(b"\t", 1)
        mode, typ, sha, size = meta.decode().split()
        if typ != "blob":
            continue  # submodules (none expected)
        path_s = path.decode("utf-8")
        data = git(repo, "cat-file", "blob", sha)
        binary = is_binary(data)
        f = {"path": path_s, "mode": mode, "size": int(size), "blob": sha, "binary": binary}
        if binary:
            f["content"] = None
            f["omitted"] = "binary"
        elif len(data) > MAX_TEXT_BYTES:
            f["content"] = None
            f["omitted"] = "size"
        else:
            f["content"] = data.decode("utf-8")
        f["lines"] = None if binary else data.decode("utf-8").count("\n") + (0 if data.endswith(b"\n") or not data else 1)
        out.append(f)
    out.sort(key=lambda f: f["path"])
    return out


def dirs_of(paths: list[str]) -> list[str]:
    ds = set()
    for p in paths:
        parts = p.split("/")[:-1]
        for i in range(1, len(parts) + 1):
            ds.add("/".join(parts[:i]))
    return sorted(ds)


def tag_info(repo: Path, tag: str) -> dict:
    commit = git_text(repo, "rev-parse", f"{tag}^{{commit}}").strip()
    tag_obj_type = git_text(repo, "cat-file", "-t", tag).strip()
    message = ""
    if tag_obj_type == "tag":
        message = git_text(repo, "for-each-ref", f"refs/tags/{tag}", "--format=%(contents)").strip()
    subject = git_text(repo, "show", "-s", "--format=%s", commit).strip()
    body = git_text(repo, "show", "-s", "--format=%b", commit).strip()
    return {"tag": tag, "commit": commit, "short": commit[:7], "tag_message": message,
            "subject": subject, "body": body}


HUNK_RE = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$")


def parse_diff(text: str) -> list[dict]:
    """Parse `git diff --no-renames` output into per-file records with hunks."""
    files: list[dict] = []
    cur = None
    hunk = None
    for line in text.split("\n"):
        if line.startswith("diff --git "):
            cur = {"path": None, "status": "modified", "binary": False, "hunks": [],
                   "old_mode": None, "new_mode": None}
            files.append(cur)
            hunk = None
            m = re.match(r"^diff --git a/(.*) b/(.*)$", line)
            if m:
                cur["path"] = m.group(2)
            continue
        if cur is None:
            continue
        if hunk is None:
            if line.startswith("new file mode"):
                cur["status"] = "added"
                cur["new_mode"] = line.split()[-1]
                continue
            if line.startswith("deleted file mode"):
                cur["status"] = "removed"
                cur["old_mode"] = line.split()[-1]
                continue
            if line.startswith("old mode"):
                cur["old_mode"] = line.split()[-1]
                continue
            if line.startswith("new mode"):
                cur["new_mode"] = line.split()[-1]
                continue
            if line.startswith("Binary files"):
                cur["binary"] = True
                continue
            if line.startswith("--- "):
                p = line[4:]
                if p != "/dev/null" and p.startswith("a/"):
                    cur["path"] = p[2:]
                continue
            if line.startswith("+++ "):
                p = line[4:]
                if p != "/dev/null" and p.startswith("b/"):
                    cur["path"] = p[2:]
                continue
            if line.startswith("index "):
                continue
        m = HUNK_RE.match(line)
        if m:
            hunk = {
                "old_start": int(m.group(1)),
                "old_lines": int(m.group(2)) if m.group(2) is not None else 1,
                "new_start": int(m.group(3)),
                "new_lines": int(m.group(4)) if m.group(4) is not None else 1,
                "section": m.group(5).strip(),
                "lines": [],
            }
            cur["hunks"].append(hunk)
            continue
        if hunk is not None and (line[:1] in ("+", "-", " ", "\\")):
            hunk["lines"].append(line)
    for f in files:
        f["insertions"] = sum(1 for h in f["hunks"] for l in h["lines"] if l.startswith("+"))
        f["deletions"] = sum(1 for h in f["hunks"] for l in h["lines"] if l.startswith("-"))
        if f["old_mode"] is None:
            del f["old_mode"]
        if f["new_mode"] is None:
            del f["new_mode"]
    files.sort(key=lambda f: f["path"])
    return files


def dump(path: Path, obj) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n"
    old = path.read_text(encoding="utf-8") if path.exists() else None
    if old != data:
        path.write_text(data, encoding="utf-8")
    return len(data.encode("utf-8"))


def export_repo(key: str, spec: dict) -> dict:
    repo: Path = spec["path"]
    tags: list[str] = spec["tags"]
    outdir = OUT / key
    total = 0
    index_tags = []
    written = set()
    prev = None
    for tag in tags:
        info = tag_info(repo, tag)
        files = tree_files(repo, info["commit"])
        tree = {
            "schema": 1,
            "repo": spec["name"],
            "tag": tag,
            "prev": prev,
            **{k: info[k] for k in ("commit", "short", "tag_message", "subject", "body")},
            "dirs": dirs_of([f["path"] for f in files]),
            "files": files,
        }
        name = f"{tag}.json"
        total += dump(outdir / name, tree)
        written.add(name)

        base_rev = git_text(repo, "rev-parse", f"{prev}^{{commit}}").strip() if prev else EMPTY_TREE
        diff_txt = git_text(repo, "diff", "--no-color", "--no-renames", "--no-ext-diff", "--unified=3",
                            "--src-prefix=a/", "--dst-prefix=b/", base_rev, info["commit"])
        dfiles = parse_diff(diff_txt)
        commits = []
        if prev:
            log = git_text(repo, "log", "--reverse", "--format=%H%x09%s", f"{prev}..{tag}")
            for line in log.splitlines():
                h, s = line.split("\t", 1)
                commits.append({"commit": h, "short": h[:7], "subject": s})
        else:
            log = git_text(repo, "log", "--reverse", "--format=%H%x09%s", tag)
            for line in log.splitlines():
                h, s = line.split("\t", 1)
                commits.append({"commit": h, "short": h[:7], "subject": s})
        stats = {
            "files_changed": len(dfiles),
            "added": sum(1 for f in dfiles if f["status"] == "added"),
            "removed": sum(1 for f in dfiles if f["status"] == "removed"),
            "modified": sum(1 for f in dfiles if f["status"] == "modified"),
            "insertions": sum(f["insertions"] for f in dfiles),
            "deletions": sum(f["deletions"] for f in dfiles),
        }
        diff = {
            "schema": 1,
            "repo": spec["name"],
            "from": prev or "empty",
            "to": tag,
            "from_commit": base_rev if prev else None,
            "to_commit": info["commit"],
            "commits": commits,
            "stats": stats,
            "files": dfiles,
        }
        dname = f"diff-{prev or 'empty'}-{tag}.json"
        total += dump(outdir / dname, diff)
        written.add(dname)
        index_tags.append({
            "tag": tag, "prev": prev, "commit": info["commit"], "short": info["short"],
            "tag_message": info["tag_message"], "subject": info["subject"],
            "files": len(files), "bytes": sum(f["size"] for f in files),
            "tree": name, "diff": dname, "diff_stats": stats,
            "commits_since_prev": len(commits),
        })
        prev = tag
    index = {"schema": 1, "repo": spec["name"], "key": key, "tags": index_tags,
             "notes": "Tree files: text content included up to 64 KiB per file; binary files have content null."}
    total += dump(outdir / "index.json", index)
    written.add("index.json")
    # remove stale files from an earlier run (e.g. a renamed tag)
    for p in outdir.glob("*.json"):
        if p.name not in written:
            p.unlink()
    return {"repo": spec["name"], "files": len(written), "bytes": total}


def main() -> None:
    results = [export_repo(k, v) for k, v in REPOS.items()]
    for r in results:
        print(f"{r['repo']}: {r['files']} JSON files, {r['bytes'] / 1024:.1f} KiB")
    print(f"total: {sum(r['bytes'] for r in results) / 1024:.1f} KiB -> {OUT}")


if __name__ == "__main__":
    sys.exit(main())
