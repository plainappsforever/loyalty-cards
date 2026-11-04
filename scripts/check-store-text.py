#!/usr/bin/env python3
"""Length and ban-list check for the store text blocks of docs/RELEASE_KIT.md (section 3).

Pattern: ~/Developer/pregnancy-tracker/scripts/check-store-text.py (health rules dropped, loyalty-card rules added).

Usage: python3 -I scripts/check-store-text.py [path-to-RELEASE_KIT.md]

Every block opened with ```store <lang> <limit> (limit 100 with a trailing b = UTF-8 bytes) is checked:
  - length in characters <= limit (the 100-limit of the App Store keywords is counted in UTF-8 bytes);
  - none of the store-wide honesty words (no "accurate", "guarantee", "secure", "100 %", "works at every till", ...);
  - no competitor or platform brand names (Stocard, Klarna, SuperCards, Key Ring, Fidme, Pass2U, Apple/Google Wallet);
  - "Catima" only inside a full description (limit 4000) and only together with the not-affiliated sentence of the language;
  - blocks under headings containing "App Store" never mention Android or Google (Apple 2.3.10); blocks under "Google Play"
    never mention iPhone, iOS, Apple or the App Store;
  - every full description names the honest limit of screen codes (some scanners cannot read a phone screen) in its language.
Prints one markdown table row per block and exits 1 if any block fails.
"""
import re
import sys
from pathlib import Path

NOT_AFFILIATED = {"en": "Not affiliated with Catima", "de": "Ohne Verbindung zu Catima"}
SCREEN_LIMIT = {"en": "cannot read a phone screen", "de": "ein Handydisplay nicht lesen"}

BANNED_WORDS = [
    "official", "certified", "accurate", "accurately", "accuracy", "exact", "exactly", "guarantee", "guaranteed", "legally",
    "unlimited", "best", "fastest", "secure", "secured", "encrypted", "proven", "breakthrough", "reliable", "flawless",
    "offiziell", "zertifiziert", "garantiert", "genau", "exakt", "sicher", "verschlüsselt", "unbegrenzt", "zuverlässig", "fehlerfrei",
]
BANNED_REGEX = [
    r"\bworks? (at|in) (every|any|all)\b", r"\b(every|any|all) (till|tills|checkout|checkouts|shop|shops|store|stores|cashier)\b.{0,20}\b(scan|read)s?\b",
    r"\balways (scan|read|work)s?\b", r"\bwill (scan|read)\b", r"\bscans? (every|any|all)\b",
    r"\bin (jedem|allen) (geschäft|laden|supermarkt)\b", r"\bfunktioniert (überall|immer)\b", r"\bwird (immer )?gelesen\b",
]
COMPETITORS = ["Stocard", "Klarna", "SuperCards", "Super Cards", "Key Ring", "Fidme", "Pass2U", "Google Wallet", "Apple Wallet", "Apple Pay", "Wear OS"]
BANNED_EXACT_CASE = ["AI", "KI"]
BANNED_SUBSTRINGS = ["100 %", "100%"]
APPLE_ONLY_BANNED = ["Android", "Google"]
PLAY_ONLY_BANNED = ["iPhone", "iOS", "Apple", "App Store"]


def main() -> int:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "docs" / "RELEASE_KIT.md"
    text = path.read_text(encoding="utf-8")
    heading = ""
    field = ""
    rows = []
    failures = 0
    lines = text.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("### "):
            heading = line
        elif line.strip() and not line.startswith("```"):
            field = line.strip()
        m = re.match(r"^```store (\w+) (\d+)(b?)\s*$", line)
        if m:
            lang, limit, is_bytes = m.group(1), int(m.group(2)), m.group(3) == "b"
            body = []
            i += 1
            while i < len(lines) and not lines[i].startswith("```"):
                body.append(lines[i])
                i += 1
            block = "\n".join(body)
            size = len(block.encode("utf-8")) if is_bytes else len(block)
            problems = []
            if size > limit:
                problems.append(f"too long ({size} > {limit})")
            is_full = limit == 4000 and size > 1000
            if is_full and SCREEN_LIMIT[lang] not in block:
                problems.append("missing the sentence about scanners that cannot read a phone screen")
            lowered = block.lower()
            for w in BANNED_WORDS:
                if re.search(r"(?<![\w])" + re.escape(w.lower()) + r"(?![\w])", lowered):
                    problems.append(f"banned word '{w}'")
            for rx in BANNED_REGEX:
                hit = re.search(rx, block, re.IGNORECASE)
                if hit:
                    problems.append(f"wording rule '{hit.group(0)}'")
            for w in BANNED_EXACT_CASE:
                if re.search(r"\b" + w + r"\b", block):
                    problems.append(f"banned word '{w}'")
            for s in BANNED_SUBSTRINGS:
                if s in block:
                    problems.append(f"banned '{s}'")
            for c in COMPETITORS:
                if c.lower() in lowered:
                    problems.append(f"competitor/brand '{c}'")
            if "catima" in lowered:
                if not is_full:
                    problems.append("'Catima' outside a full description")
                elif NOT_AFFILIATED[lang].lower() not in lowered:
                    problems.append(f"'Catima' without '{NOT_AFFILIATED[lang]}'")
            if "App Store" in heading:
                for w in APPLE_ONLY_BANNED:
                    if w.lower() in lowered:
                        problems.append(f"'{w}' in an App Store block")
            if "Google Play" in heading:
                for w in PLAY_ONLY_BANNED:
                    if re.search(r"\b" + re.escape(w.lower()) + r"\b", lowered):
                        problems.append(f"'{w}' in a Google Play block")
            label = re.sub(r"\s*[—(].*$", "", heading.replace("### ", "").split(",")[0]) + ": " + re.sub(r"\s*\(.*$", "", field.rstrip(":"))[:34]
            unit = "bytes" if is_bytes else "chars"
            status = "OK" if not problems else "FAIL: " + "; ".join(problems)
            if problems:
                failures += 1
            rows.append(f"| {label} | {lang} | {size} {unit} | {limit} | {status} |")
        i += 1
    print("| Section | Lang | Size | Limit | Result |")
    print("|---|---|---|---|---|")
    for r in rows:
        print(r)
    print(f"\n{len(rows)} blocks, {failures} failing.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
