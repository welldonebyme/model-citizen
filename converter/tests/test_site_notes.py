"""Site edits (overrides/site-edits.yaml) and the site boxes / output notes of os-notes.yaml."""
import copy

import pytest
import yaml

from converter.build import osnotes, siteedits
from converter.check import without_os_notes
from converter.tex.nodes import ConvertError


def chapter():
    lab = {"t": "lab", "id": "ch00-lab1", "title": ["example"], "objectives": [],
           "blocks": [{"t": "p", "c": ["Numbered steps you type yourself."]}]}
    return {"id": "ch00", "objectives": ["1.11", "EXAM"], "labMinutes": 10, "intro": [], "lessons": [{
        "id": "ch00-s1", "title": ["Welcome, Adnane"], "titleText": "Welcome, Adnane", "anchors": [],
        "objectives": ["1.11"], "labs": ["ch00-lab1"], "labMinutes": 10,
        "steps": [{"id": "ch00-s1-0", "title": ["Welcome, Adnane"], "titleText": "Welcome, Adnane", "blocks": [
            {"t": "p", "c": ["Your Mac. Everything runs locally."]},
            {"t": "code", "id": "ch00-c1", "lang": "bash", "text": '$ git config --global user.name "Adnane"'},
            lab]}]}]}


def edits(tmp_path, data):
    p = tmp_path / "site-edits.yaml"
    p.write_text(yaml.safe_dump(data))
    return p


def test_text_edit_replaces_every_counted_string_and_keeps_the_book_code(tmp_path):
    ch = chapter()
    hits = []
    siteedits._strings(ch["lessons"][0], "Welcome, Adnane", hits)
    h = siteedits.sha("\n".join(c[k] for c, k in hits))
    code_h = siteedits.sha('$ git config --global user.name "Adnane"')
    siteedits.apply({"ch00": ch}, {}, edits(tmp_path, {"text": [
        {"id": "t", "in": "ch00-s1", "find": "Welcome, Adnane", "replace": "Welcome", "count": 4, "hash": h},
        {"id": "g", "in": "ch00-s1", "find": '"Adnane"', "replace": '"Your Name"', "hash": code_h}]}))
    les = ch["lessons"][0]
    assert les["title"] == ["Welcome"] and les["titleText"] == "Welcome" and les["steps"][0]["titleText"] == "Welcome"
    code = les["steps"][0]["blocks"][1]
    assert code["text"].endswith('"Your Name"') and code["textBook"].endswith('"Adnane"')


@pytest.mark.parametrize("entry,message", [
    ({"id": "t", "in": "ch00-s1", "find": "Welcome, Adnane", "replace": "Welcome", "count": 4, "hash": "000000000000"},
     "the book text changed"),
    ({"id": "t", "in": "ch00-s1", "find": "Welcome, Adnane", "replace": "Welcome", "hash": "x"}, "expected 1"),
    ({"id": "t", "in": "ch09-s1", "find": "x", "replace": "y", "hash": "x"}, "unknown place"),
])
def test_text_edit_problems_stop_the_build(tmp_path, entry, message):
    with pytest.raises(ConvertError, match=message):
        siteedits.apply({"ch00": chapter()}, {}, edits(tmp_path, {"text": [entry]}))


def test_sample_lab_leaves_the_counts_and_check_turns_it_back(tmp_path):
    ch = chapter()
    lab = ch["lessons"][0]["steps"][0]["blocks"][2]
    siteedits.apply({"ch00": ch}, {}, edits(tmp_path, {
        "not_labs": [{"lab": "ch00-lab1", "title": "Hands-on lab (example)", "hash": siteedits.sha(siteedits.lab_text(lab))}],
        "objectives": [{"lesson": "ch00-s1", "objectives": [], "hash": siteedits.sha("1.11")}]}))
    les = ch["lessons"][0]
    box = les["steps"][0]["blocks"][2]
    assert box["t"] == "callout" and box["sample"]["id"] == "ch00-lab1"
    assert les["labs"] == [] and les["labMinutes"] == 0 and ch["labMinutes"] == 0
    assert les["objectives"] == [] and ch["objectives"] == ["EXAM"]
    back = without_os_notes(copy.deepcopy(ch))["lessons"][0]["steps"][0]["blocks"][2]
    assert back["t"] == "lab" and back["id"] == "ch00-lab1" and back["blocks"] == lab["blocks"]


def test_inline_links_bold_and_code():
    out = osnotes.inline("Get [the kit](/kits/x.zip), see [docs](https://example.com) and **this** `cd ~`")
    assert {"t": "ref", "href": "/kits/x.zip", "text": "the kit", "site": True} in out
    assert {"t": "link", "href": "https://example.com", "c": ["docs"]} in out
    assert {"t": "b", "c": ["this"]} in out and {"t": "code", "v": "cd ~"} in out


def note_files(code_text, win, extra_blocks=()):
    blocks = [{"t": "p", "c": ["Look:"]},
              {"t": "code", "id": "ch02-c2", "lang": "bash", "text": code_text, "variants": {"win": win}},
              *extra_blocks]
    return {"chapters/ch02.json": {"id": "ch02", "intro": [], "lessons": [{"id": "ch02-s1", "anchors": [], "steps": [
        {"id": "ch02-s1-0", "blocks": blocks}]}]}}


def notes_yaml(tmp_path, notes):
    p = tmp_path / "os-notes.yaml"
    p.write_text(yaml.safe_dump({"notes": notes}))
    return p


def test_box_before_a_code_block_with_anchor_and_hide(tmp_path):
    files = note_files("$ pwd\n/Users/you", "PS> pwd\n/Users/you",
                       [{"t": "callout", "kind": "tip", "blocks": [{"t": "p", "c": ["Windows users: use WSL."]}]}])
    blk = files["chapters/ch02.json"]["lessons"][0]["steps"][0]["blocks"]
    h_code = osnotes.code_hash(blk[1])
    h_tip = osnotes.para_hash(blk[2]["blocks"][0])
    osnotes.apply(files, notes_yaml(tmp_path, [
        {"id": "all-box", "os": ["mac", "win", "wsl"], "step": "ch02-s1-0", "code": "ch02-c2", "hash": h_code,
         "where": "before", "anchor": "the-box", "title": "Box", "text": "Hi",
         "blocks": [{"code": {"id": "ch02-box-c1", "text": "$ ls", "win": "PS> Get-ChildItem"}}]},
        {"id": "win-tip", "os": ["win"], "step": "ch02-s1-0", "starts": "Windows users", "hash": h_tip,
         "level": "callout", "hide": ["win"], "text": "Use PowerShell."}]))
    lesson = files["chapters/ch02.json"]["lessons"][0]
    blk = lesson["steps"][0]["blocks"]
    assert [b.get("osNote") for b in blk] == [None, "all-box", None, None, "win-tip"]
    assert blk[1]["anchor"] == "the-box" and "the-box" in lesson["anchors"]
    assert blk[1]["blocks"][1]["osNote"] == "all-box" and blk[1]["blocks"][1]["variants"]["win"] == "PS> Get-ChildItem"
    assert blk[3]["os"] == ["mac", "wsl"]                                    # the book's tip, hidden on Windows


def test_output_notes_home_is_automatic_other_details_need_a_note(tmp_path):
    files = note_files("$ pwd\n/Users/you", "PS> pwd\n/Users/you")
    rep = osnotes.apply(files, notes_yaml(tmp_path, []))
    blk = files["chapters/ch02.json"]["lessons"][0]["steps"][0]["blocks"]
    assert rep["autoOutputNotes"]["auto"] == 1 and blk[2]["osNote"] == osnotes.AUTO_PREFIX + "ch02-c2"
    files = note_files("$ echo $SHELL\n/bin/zsh", "PS> echo $PSVersionTable.PSVersion\n/bin/zsh")
    with pytest.raises(ConvertError, match="needs an explicit note"):
        osnotes.apply(files, notes_yaml(tmp_path, []))
