"""Paths used by the converter."""
from pathlib import Path

CONVERTER = Path(__file__).resolve().parent
ACADEMY = CONVERTER.parent
BOOK = ACADEMY.parent / "dbt-bible"
OUT = ACADEMY / "site" / "src" / "generated"
INVENTORY = ACADEMY / "reference" / "content-inventory.json"
RULES = CONVERTER / "rules"
OVERRIDES = CONVERTER / "overrides"
PDF = BOOK / "dbt-bible.pdf"

# Files and folders of OUT written by this converter (other agents own other folders, e.g. dag/, figures/).
OWNED_FILES = ["book.json", "traps.json", "glossary.json", "objectives.json", "coverage.json", "cheatsheets.json",
               "plan.json", "labels.json", "report.json"]
OWNED_DIRS = ["chapters", "questions", "mocks"]
