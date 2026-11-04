#!/usr/bin/env python3
"""Independent oracle for src/engine/barcode/validate.ts (SPEC A1, referee R3).

Writes test/fixtures/oracle/validate.json: >= 5,000 generated values per family with the verdict this script computes
on its own (GS1 mod-10, UPC-E expansion, ITF parity, Codabar start/stop, Code 39/93/128 charsets, 2D length and byte capacity), plus the
expected suggestion where the engine must offer one. scripts/referee.mjs and src/engine/barcode/oracle.test.ts run the
engine over the file and count mismatches (target 0). Deterministic (seeded). No dependency.
Usage: python3 referee/python/validate_oracle.py [out.json]
"""
import json
import random
import sys
from pathlib import Path

rng = random.Random(20261016)
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parents[2] / "test/fixtures/oracle/validate.json")


def gs1_check(data: str) -> str:
    total = 0
    for i, ch in enumerate(reversed(data)):
        d = ord(ch) - 48
        total += d * 3 if i % 2 == 0 else d
    return str((10 - total % 10) % 10)


def expand_upce(code8: str) -> str:
    ns, d1, d2, d3, d4, d5, d6, chk = code8
    if d6 in "012":
        body = f"{d1}{d2}{d6}0000{d3}{d4}{d5}"
    elif d6 == "3":
        body = f"{d1}{d2}{d3}00000{d4}{d5}"
    elif d6 == "4":
        body = f"{d1}{d2}{d3}{d4}00000{d5}"
    else:
        body = f"{d1}{d2}{d3}{d4}{d5}0000{d6}"
    return f"{ns}{body}{chk}"


def digits(n):
    return "".join(rng.choice("0123456789") for _ in range(n))


cases = []


def add(fmt, value, expect):
    cases.append({"format": fmt, "value": value, **expect})


def ok(value):
    return {"ok": True, "canonical": value}


def err(error, suggestion=None):
    e = {"ok": False, "error": error}
    if suggestion is not None:
        e["suggestion"] = suggestion
    return e


# --- GS1 family: ean13 / upca / ean8 (valid, wrong check, one short, letters, separators) -----------------------------
for fmt, length in (("ean13", 13), ("upca", 12), ("ean8", 8)):
    for _ in range(1700):
        body = digits(length - 1)
        good = body + gs1_check(body)
        kind = rng.random()
        if kind < 0.45:
            add(fmt, good, ok(good))
        elif kind < 0.65:
            bad = body + str((int(gs1_check(body)) + rng.randint(1, 9)) % 10)
            add(fmt, bad, err("checkDigit", good))
        elif kind < 0.80:
            add(fmt, body, err("length", good))
        elif kind < 0.88:
            # separators are removed before checking
            spaced = " ".join([good[: length // 2], good[length // 2 :]])
            add(fmt, spaced, ok(good))
        elif kind < 0.94:
            add(fmt, good[:-1] + rng.choice("ABx*"), err("chars"))  # hyphens/spaces are separators (SPEC §5.1 normalise), not errors
        else:
            add(fmt, digits(length + rng.choice([1, 2, -2, -3])), err("length"))

# --- UPC-E: number system 0/1, check via expansion --------------------------------------------------------------------
for _ in range(5200):
    ns = rng.choice("01")
    body = digits(6)
    expanded = expand_upce(ns + body + "0")[:11]
    good = ns + body + gs1_check(expanded)
    kind = rng.random()
    if kind < 0.5:
        add("upce", good, ok(good))
    elif kind < 0.7:
        bad = ns + body + str((int(good[-1]) + rng.randint(1, 9)) % 10)
        add("upce", bad, err("checkDigit", good))
    elif kind < 0.8:
        add("upce", ns + body, err("length", good))
    elif kind < 0.9:
        add("upce", rng.choice("23456789") + body + good[-1], err("numberSystem"))
    else:
        add("upce", digits(rng.choice([5, 9, 10])), err("length"))

# --- ITF: digits, even length 4..40 ------------------------------------------------------------------------------------
for _ in range(5200):
    n = rng.randint(1, 44)
    v = digits(n)
    if n > 40:
        add("itf", v, err("tooLong"))
    elif n % 2 == 1:
        add("itf", v, err("length", "0" + v))
    elif n < 4:
        add("itf", v, err("length"))
    else:
        add("itf", v, ok(v))
for _ in range(300):
    v = digits(rng.randint(4, 12))
    pos = rng.randrange(len(v))
    bad = v[:pos] + rng.choice("aZ/*") + v[pos + 1 :]  # spaces/hyphens are separators, not errors
    add("itf", bad, err("chars"))

# --- Codabar: optional A-D start/stop (both or none), body 0-9 - $ : / . + ----------------------------------------------
CODABAR_BODY = "0123456789-$:/.+"
for _ in range(5200):
    body = "".join(rng.choice(CODABAR_BODY) for _ in range(rng.randint(1, 20)))
    kind = rng.random()
    if len(body) < 2 and kind < 0.7:
        add("codabar", rng.choice("ABCD") + body + rng.choice("ABCD") if kind < 0.35 else body, err("length"))  # 1-char body: readers cannot decode it (D30)
    elif kind < 0.35:
        s, e = rng.choice("ABCD"), rng.choice("ABCD")
        add("codabar", s + body + e, ok(s + body + e))
    elif kind < 0.5:
        s, e = rng.choice("abcd"), rng.choice("abcd")
        add("codabar", s + body + e, ok((s + body + e).upper()))
    elif kind < 0.7:
        add("codabar", body, ok(body))
    elif kind < 0.85:
        add("codabar", rng.choice("ABCD") + body, err("startStop"))
    elif kind < 0.95:
        pos = rng.randrange(len(body))
        add("codabar", "A" + body[:pos] + rng.choice("EZ#") + body[pos + 1 :] + "B", err("chars"))
    else:
        add("codabar", "A" + "".join(rng.choice(CODABAR_BODY) for _ in range(41)) + "B", err("tooLong"))

# --- Code 39 / 93: 0-9 A-Z - . $ / + % space; lower case is upper-cased -------------------------------------------------
C39 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%"
for fmt in ("code39", "code93"):
    for _ in range(2600):
        n = rng.randint(1, 52)
        v = "".join(rng.choice(C39) for _ in range(n)).strip() or "A"
        kind = rng.random()
        if len(v) > 48:
            add(fmt, v, err("tooLong"))
        elif kind < 0.55:
            add(fmt, v, ok(v))
        elif kind < 0.8:
            add(fmt, v.lower(), ok(v))
        else:
            pos = rng.randrange(len(v))
            add(fmt, v[:pos] + rng.choice("*!?ü,") + v[pos + 1 :], err("chars"))

# --- Code 128: printable ASCII 32-126, 1..80 ---------------------------------------------------------------------------
for _ in range(5200):
    n = rng.randint(1, 84)
    v = "".join(chr(rng.randint(32, 126)) for _ in range(n))
    v = v.strip() or "x"
    kind = rng.random()
    if len(v) > 80:
        add("code128", v, err("tooLong"))
    elif kind < 0.8:
        add("code128", v, ok(v))
    else:
        pos = rng.randrange(len(v))
        ch = rng.choice("ü€\t日")
        if ch == "\t" and (pos == 0 or pos == len(v) - 1):
            ch = "ü"  # a tab at an edge is whitespace that trim() removes (SPEC §5.1), not an encoding error
        add("code128", v[:pos] + ch + v[pos + 1 :], err("chars"))

# --- 2D: any text, 1..1000 characters (code points) AND within the symbol's byte capacity (D32) -------------------------
# Byte-mode capacity of the largest symbol, from the symbology standards (not from bwip-js): QR version 40 level M
# 2,331 bytes (ISO/IEC 18004 Table 7); Aztec 32 layers 1,914 bytes (ISO/IEC 24778); PDF417 1,108 bytes (ISO/IEC 15438,
# 925 data codewords in byte compaction); Data Matrix 144x144 1,556 bytes (ISO/IEC 16022 Table 7).
# The oracle only emits cases whose verdict is CERTAIN without an encoder: > 1,000 code points -> tooLong; UTF-8 bytes
# <= half the capacity -> ok; text made only of multi-byte characters (forced into byte mode) with more bytes than the
# capacity -> capacity (D33 Q8). Everything between is decided by the encoder's real capacity (trial encode in the engine) and is
# covered by the Jest property tests (independent-review.test.ts M3), not here.
CAPACITY = {"qr": 2331, "aztec": 1914, "pdf417": 1108, "datamatrix": 1556}
ALPHA = "abcXYZ019 äöüß日本語🙂-_/:."
MULTI = "äöüßé日本語中🙂👍"


def utf8_len(v: str) -> int:
    return len(v.encode("utf-8"))


for fmt in ("qr", "aztec", "pdf417", "datamatrix"):
    cap = CAPACITY[fmt]
    for _ in range(1300):
        n = rng.choice([1, 2, 10, 50, 120] * 20 + [300, 999, 1000, 1001, 1200])  # mostly short: the fixture stays small
        v = "".join(rng.choice(ALPHA) for _ in range(n)).strip() or "x"
        if len(v) > 1000:
            add(fmt, v, err("tooLong"))
        elif utf8_len(v) <= cap // 2:
            add(fmt, v, ok(v))
    for _ in range(400):
        v = "".join(rng.choice(MULTI) for _ in range(rng.randint(cap // 4, 1000)))
        if utf8_len(v) > cap:
            add(fmt, v, err("capacity"))  # D33 Q8: its own reason, distinct from "more than 1,000 characters"
        elif utf8_len(v) <= cap // 2:
            add(fmt, v, ok(v))

# --- orchestrator decisions 2026-10-17 (D33) and B1 N2 -------------------------------------------------------------------
# Q6: only spaces and hyphens separate EAN/UPC/ITF digits; '.' (a spreadsheet "4006381333931.0") is a charset error
for fmt, good in (("ean13", "4006381333931"), ("ean8", "96385074"), ("upca", "036000291452"), ("itf", "12345678")):
    for _ in range(25):
        pos = rng.randrange(1, len(good))
        add(fmt, good[:pos] + "." + good[pos:], err("chars"))
        add(fmt, good[:pos] + "-" + good[pos:], ok(good))
# Q7: Codabar start/stop letters without data -> length
for s_ in "ABCD":
    for e_ in "ABCD":
        add("codabar", s_ + e_, err("length"))
# N2: upper-casing is ASCII a-z only; letters whose Unicode upper case is ASCII (ß -> SS, ı -> I, ﬁ -> FI, ſ -> S) are refused
for fmt in ("code39", "code93"):
    for trap in ("straße", "ı", "ﬁ", "groß", "ſ", "ﬀ1", "ǆ"):
        add(fmt, trap, err("chars"))

# --- empty for every format ---------------------------------------------------------------------------------------------
for fmt in ("ean13", "ean8", "upca", "upce", "itf", "codabar", "code39", "code93", "code128", "qr", "aztec", "pdf417", "datamatrix"):
    add(fmt, "", err("empty"))
    add(fmt, "   ", err("empty"))

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(cases, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
by = {}
for c in cases:
    by[c["format"]] = by.get(c["format"], 0) + 1
print(f"validate_oracle: {len(cases)} cases → {OUT}")
print(" ".join(f"{k}={v}" for k, v in sorted(by.items())))
