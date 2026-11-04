#!/usr/bin/env python3 -I
"""Builds the B1 blind set from the hand-specified tables below (deterministic; run once by the author).

Writes render-cases.json, cases.json and fixtures/. Expected values in this file are written by hand from the
SPEC; the oracle (oracle.py) re-derives them independently and selftest.py fails on any disagreement.
Usage: python3 -I -B build_set.py
"""
import json
import os
import struct
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
import importlib.util  # noqa: E402
_spec = importlib.util.spec_from_file_location('oracle', os.path.join(HERE, 'oracle.py'))
O = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(O)

NBSP, BOM, IDEO_SP, LS = chr(0xA0), chr(0xFEFF), chr(0x3000), chr(0x2028)


class LCG:
    """Tiny deterministic generator (no dependence on Python's random implementation)."""

    def __init__(self, seed):
        self.s = seed

    def next(self, n):
        self.s = (self.s * 6364136223846793005 + 1442695040888963407) % (1 << 64)
        return (self.s >> 33) % n

    def digits(self, k):
        return ''.join(str(self.next(10)) for _ in range(k))


# =====================================================================================================
# 1. RENDER SET (A2) — every value is canonical (normalise(value) == value) and valid for its format
# =====================================================================================================
R = []


def rc(fmt, value, note, adversarial=False):
    exp, sym, pat = O.expect_decoded(fmt, value)
    e = {'id': 'R-%s-%03d' % (fmt.upper(), sum(1 for x in R if x['format'] == fmt) + 1), 'format': fmt,
         'value': value, 'expectDecoded': exp, 'expectSymbology': sym, 'note': note}
    if pat:
        e['expectDecodedPattern'] = pat
    if adversarial:
        e['adversarial'] = True
    R.append(e)


g = LCG(20261016)

# --- Code 128 (32)
PRINTABLE = ''.join(chr(c) for c in range(32, 127))
c128 = [
    ('A', 'minimum length 1'), ('0', 'single digit'), ('x', 'single lower-case'), ('00', 'two digits (one C pair)'),
    ('A1', 'two chars'), (PRINTABLE[1:81], 'maximum length 80: printable ASCII 33..112'),
    (PRINTABLE[14:94], 'maximum length 80: ASCII 46..125 incl. []^_`{|}'),
    ('0123456789' * 8, 'maximum length 80, all digits (pure subset C)'),
    ('0123456789' * 7 + '012345678', '79 digits (odd run: C then a switch)'),
    ('AB12345678CD', 'B -> C -> B switch'), ('12345', 'odd digit run'), ('1234567890', 'even digit run'),
    ('a1b2c3d4', 'alternating case/digits'), ('Ab12345Cd6789eF', 'mixed case with digit runs'),
    ('!"#$%&\'()*+,-./', 'punctuation 33..47'), (':;<=>?@[\\]^_`{|}~', 'punctuation 58..126'),
    ('HELLO WORLD', 'upper case with space'), ('hello world', 'lower case with space'),
    ('0000123456', 'leading zeros kept'), ('AB^123', 'caret is data (parse off, D28)'),
    ('^FNC1', 'literal ^FNC1 text, not a function code'), ('^065^066', 'caret-escape lookalike (would be "AB" if parsed)'),
    ('A  B', 'double inner space'), ('~', 'highest printable 126'), ('CARD-2026/10-16', 'dashes and slashes'),
    ('9780306406157', '13 digits as Code 128 (not EAN)'), ('1234567890' * 4, '40 digits'),
    ('{"a":1}', 'JSON-looking text'), ('Mixed123abc456DEF7890', 'many subset changes'),
    ('DE89370400440532013000', 'IBAN-like'), ('ID#42&Co', 'hash and ampersand'), ('M-1234-5678-9', 'grouped number'),
]
for v, n in c128:
    rc('code128', v, n, adversarial=any(k in n for k in ('caret', 'FNC1', 'subset', 'switch', 'maximum')))

# --- EAN-13 (25): every check-digit outcome at least twice, every first digit (parity pattern)
ean13_fixed = [('4006381333931', 'classic valid'), ('5901234123457', 'GS1 example'), ('9780306406157', 'ISBN-13'),
               ('0000000000000', 'all zeros'), ('0012345678905', 'leading zeros (UPC-A in EAN-13)')]
for v, n in ean13_fixed:
    rc('ean13', v, n)
need = {(f, c): 0 for f in range(10) for c in range(10)}
made = 0
want_checks = [c for c in range(10) for _ in range(2)]
for i, want in enumerate(want_checks):
    first = str(i % 10)
    while True:
        base = first + g.digits(11)
        if O.gs1_check(base) == str(want):
            break
    rc('ean13', base + str(want), 'check digit %d, first digit %s (parity %s)' % (want, first, first))

# --- EAN-8 (20)
for v, n in [('96385074', 'classic valid'), ('73513537', 'valid'), ('00000000', 'all zeros'),
             ('01234565', 'EAN-8/UPC-E twin rendered as EAN-8', ), ('05555598', 'twin rendered as EAN-8')]:
    rc('ean8', v, n, adversarial='twin' in n)
for want in list(range(10)) + [0, 3, 5, 7, 9]:
    while True:
        base = g.digits(7)
        if O.gs1_check(base) == str(want):
            break
    rc('ean8', base + str(want), 'check digit %d' % want)

# --- UPC-A (22): decoded by Vision as EAN-13 with a leading 0
for v, n in [('036000291452', 'classic valid'), ('012345678905', 'valid'), ('000000000000', 'all zeros'),
             ('042100005264', 'expansion of UPC-E 04252614'), ('123456789012', 'number system 1')]:
    rc('upca', v, n)
for i, want in enumerate(list(range(10)) + [1, 2, 4, 6, 8, 0, 9]):
    ns = str((i * 3) % 10)
    while True:
        base = ns + g.digits(10)
        if O.gs1_check(base) == str(want):
            break
    rc('upca', base + str(want), 'check %d, number system %s' % (want, ns))

# --- UPC-E (24): NS 0 and 1 x every expansion pattern (last data digit 0..9), plus known values
for v, n in [('04252614', 'Wikipedia example (pattern 1)'), ('01234565', 'twin with EAN-8, rendered as UPC-E'),
             ('00000000', 'all zeros'), ('12345670', 'number system 1, pattern 7')]:
    rc('upce', v, n, adversarial='twin' in n)
for ns in '01':
    for last in range(10):
        while True:
            mid = g.digits(5) + str(last)
            d7 = ns + mid
            c = O.upce_check(d7)
            v = d7 + c
            if v not in [x['value'] for x in R]:
                break
        rc('upce', v, 'number system %s, expansion pattern %d -> UPC-A %s' % (ns, last, O.upce_expand(v)))

# --- ITF (22)
itf = [('1234', 'minimum 4 digits'), ('0000', 'all zeros, minimum'), ('123456', '6 digits'), ('000123', '6 digits leading zeros'),
       ('12345678', '8'), ('1234567890', '10 (scanner may say itf14)'), ('123456789012', '12'),
       ('12345678901231', '14 with valid ITF-14 check'), ('12345678901234', '14 with WRONG GS1 check: still valid ITF (no check rule)'),
       ('00012345678905', '14, GTIN-14 of a UPC'), ('10012345678902', '14, GTIN-14 indicator 1'),
       ('00000000000000', '14 zeros'), ('1234567890123456', '16'), ('123456789012345678', '18'),
       ('12345678901234567890', '20'), ('987654321098765432109876', '24'),
       ('4006381333931' + '0', '14 digits = EAN-13 + 0'), ('9999', 'all nines'), ('5050', 'repeating'),
       ('0101010101', 'alternating'), ('31117013206375', '14, library-like'), ('8800', 'short')]
for v, n in itf:
    rc('itf', v, n, adversarial='WRONG' in n)

# --- Codabar (26): every start/stop pair (16), body charset, min body, no letters
pairs = [(a, b) for a in 'ABCD' for b in 'ABCD']
bodies = ['40156', '12', '1234567890', '-$:/.+', '31117013206375', '0', '12.50', '$100', '1/2', '12:30',
          '+49-30', '999', '0000', '5.5.5', '7-7', '42']
for (a, b), body in zip(pairs, bodies):
    if len(body) < 2:
        body = body + '1'
    rc('codabar', a + body + b, 'start %s stop %s' % (a, b), adversarial=(body == '12'))
for v, n in [('A' + '1234567890' * 3 + 'B', 'long body 30'), ('A12B', 'minimum body 2 (D30)'),
             ('D-$:/.+A', 'all specials, reversed letters'), ('C40156D', 'C/D classic')]:
    rc('codabar', v, n, adversarial='minimum' in n)
for v, n in [('1234567890', 'no start/stop given: engine adds them; Vision returns them'),
             ('12-34', 'no start/stop, dash'), ('31117013206375', 'no start/stop, 14 digits'),
             ('00', 'no start/stop, minimum body')]:
    rc('codabar', v, n, adversarial=True)
    pass
# trim to 26
codabar_rows = [x for x in R if x['format'] == 'codabar']
assert len(codabar_rows) == 24, len(codabar_rows)
rc('codabar', 'B987654321C', 'B/C')
rc('codabar', 'A0001B', 'leading zeros in body')

# --- Code 39 (22)
for v, n in [('A', 'single char'), ('1', 'single digit'), ('CODE39', 'word'), ('ABC-123', 'dash'),
             ('HELLO WORLD', 'inner space'), ('0123456789', 'digits'), ('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'alphabet'),
             ('-. $/+%', 'all specials'), ('+A', 'full-ASCII lookalike (+A = a)'), ('$M', 'full-ASCII lookalike ($M = CR)'),
             ('%U', 'full-ASCII lookalike (%U = NUL)'), ('/A', 'full-ASCII lookalike (/A = !)'),
             ('A B', 'single inner space'), ('12.50', 'decimal'), ('$100', 'dollar'), ('TEL/123', 'slash'),
             ('%%%', 'percent run'), ('X-Y.Z', 'mixed specials'), ('W', 'single W (mod-43 of CODE39)'),
             ('CODE39W', 'value ending in its own mod-43 check char'), ('1234567890ABCDEFGHIJ1234567890', '30 chars'),
             ('LIB 0042 7', 'library-like')]:
    rc('code39', v, n, adversarial=('lookalike' in n or 'mod-43' in n))

# --- Code 93 (22)
for v, n in [('A', 'single char'), ('1', 'single digit'), ('TEST93', 'word'), ('CODE 93', 'space'),
             ('ABC-123', 'dash'), ('0123456789', 'digits'), ('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'alphabet'),
             ('-. $/+%', 'all specials'), ('+A', 'shift lookalike (literal)'), ('%U', 'shift lookalike (literal)'),
             ('$M', 'lookalike'), ('/A', 'lookalike'), ('A B-C.$/+%', 'mixed specials'), ('12.50', 'decimal'),
             ('00000', 'zeros'), ('ZZZZZZZZZZ', 'repeats'), ('1234567890ABCDEFGHIJ1234567890', '30 chars'),
             ('X', 'single X'), ('99', 'two digits'), ('Q-1/2', 'slash'), ('CARD 7', 'space digit'),
             ('M.N.O', 'dots')]:
    rc('code93', v, n, adversarial='lookalike' in n)

# --- 2D shared material
ASCII1000 = 'X' + ''.join(PRINTABLE[(i * 7) % 95] for i in range(1, 999)) + 'X'   # spaces inside, none at the ends
TEXT1000 = ('Loyalty card member 123456 ' * 40)[:1000]
DIGITS1000 = ''.join(str(i % 10) for i in range(1000))
LC1 = 'LC1:{"n":"Bäckerei","i":"4006381333931","f":"ean13","k":"#67bf74","t":"Kasse 2"}'
common2d = [('A', 'single char'), ('1', 'single digit'), ('Hello, World!', 'ASCII text'),
            ('https://example.com/card?id=12345&x=y', 'URL'), ('4006381333931', 'digits'),
            ('Müller', 'umlaut'), ('Bäckerei Größe ÄÖÜ ß', 'German'), ('こんにちは世界', 'kana + kanji'),
            ('🙂🎉', 'emoji (astral)'), ('Мир 123', 'Cyrillic'), ('مرحبا 42', 'Arabic'), ('中文会员卡 12345', 'Chinese'),
            ('MÃ¼ller', 'mojibake lookalike text (Ã and ¼ are data)'), ('Price ^ 5 €', 'caret with non-ASCII (D31 doubling)'),
            ('ü^065', 'caret-escape lookalike after non-ASCII'), ('^ECI000026Müller', 'literal ECI text with non-ASCII'),
            ('caret ^ only ASCII', 'caret, ASCII path'), (LC1, 'an LC1 share payload'),
            ('Ωmega ✓ naïve café', 'mixed BMP symbols'), ('Tab-free–dash', 'en dash')]
ADV2D = ('mojibake', 'caret', 'ECI', 'emoji')
for fmt, extra in [
    ('qr', [(TEXT1000, '1000 chars ASCII text (maximum)'), (ASCII1000, '1000 chars printable ASCII (maximum)'),
            (DIGITS1000, '1000 digits (numeric mode)'), ('ü' * 1000, '1000 x ü = 2000 UTF-8 bytes (QR only)'),
            ('HELLO WORLD 123', 'alphanumeric mode'), ('0', 'zero'), ('a' * 500, '500 chars'),
            ('Ä1', 'two chars, one non-ASCII'), ('ß', 'single sharp s'), ('ñandú', 'Spanish')]),
    ('aztec', [(TEXT1000, '1000 chars ASCII text (maximum)'), (ASCII1000, '1000 chars printable ASCII'),
               ('🙂' * 250, '250 emoji = 1000 UTF-8 bytes'), ('MEMBER-0001', 'ID'), ('zhxbx', 'Catima example')]),
    ('pdf417', [(TEXT1000, '1000 chars ASCII text (maximum)'), (DIGITS1000, '1000 digits'),
                ('ü' * 400, '400 x ü = 800 UTF-8 bytes'), ('1234567890', 'Catima-like'), ('DL:12345678', 'licence-like')]),
    ('datamatrix', [(TEXT1000, '1000 chars ASCII text (maximum)'), (ASCII1000, '1000 chars printable ASCII'),
                    ('日' * 300, '300 kanji = 900 UTF-8 bytes'), ('DM-42', 'short ID'), ('0123456789' * 5, '50 digits')]),
]:
    for v, n in common2d + extra:
        rc(fmt, v, n, adversarial=any(k in n for k in ADV2D))

# =====================================================================================================
# 2. CASES (validation, suggestion, Catima, share payload, backup, CSV)
# =====================================================================================================
C = []


def case(kind, cid, inp, expect, strength='firm', adversarial=False, note=''):
    e = {'id': cid, 'kind': kind, 'input': inp, 'expect': expect, 'strength': strength, 'note': note}
    if adversarial:
        e['adversarial'] = True
    C.append(e)


def V(cid, fmt, value, ok, normalised=None, reason=None, strength='firm', adv=False, note='', **extra):
    exp = {'ok': ok}
    if ok:
        exp['normalised'] = value if normalised is None else normalised
    else:
        exp['reason'] = reason
    exp.update(extra)
    case('validate', cid, {'format': fmt, 'value': value}, exp, strength, adv, note)


# --- EAN-13
V('V-EAN13-01', 'ean13', '4006381333931', True)
V('V-EAN13-02', 'ean13', '5901234123457', True)
V('V-EAN13-03', 'ean13', '0012345678905', True, note='leading zeros kept')
V('V-EAN13-04', 'ean13', '0000000000000', True)
V('V-EAN13-05', 'ean13', '4012345678901', True)
V('V-EAN13-06', 'ean13', '4006381333932', False, reason='check', suggestedCheck='1', note='§9: "check digit should be 1"; never auto-corrected')
V('V-EAN13-07', 'ean13', '4006381333930', False, reason='check', suggestedCheck='1')
V('V-EAN13-08', 'ean13', '5901234123450', False, reason='check', suggestedCheck='7')
V('V-EAN13-09', 'ean13', '400638133393', False, reason='length', suggestedCheck='1', note='12 digits: check digit SHOWN, never appended (§5.1)')
V('V-EAN13-10', 'ean13', '590123412345', False, reason='length', suggestedCheck='7')
V('V-EAN13-11', 'ean13', '40063813339311', False, reason='length')
V('V-EAN13-12', 'ean13', '4006381333', False, reason='length')
V('V-EAN13-13', 'ean13', '400638133393A', False, reason='charset', note='§9: letters with EAN -> message + Code 128 suggested')
V('V-EAN13-14', 'ean13', '４００６３８１３３３９３１', False, reason='charset', adv=True, note='full-width digits (Unicode \\d trap)')
V('V-EAN13-15', 'ean13', '٤٠٠٦٣٨١٣٣٣٩٣١', False, reason='charset', adv=True, note='Arabic-Indic digits')
V('V-EAN13-16', 'ean13', ' 4006381333931 ', True, normalised='4006381333931', strength='inferred', note='normalise trims')
V('V-EAN13-17', 'ean13', '4006381333931\n', True, normalised='4006381333931', strength='inferred', adv=True, note='pasted trailing newline')
V('V-EAN13-18', 'ean13', '+4006381333931', False, reason='charset', adv=True)
V('V-EAN13-19', 'ean13', '-4006381333931', False, reason='charset', adv=True)
V('V-EAN13-20', 'ean13', '4006381333931.0', False, reason='charset', adv=True, note='spreadsheet float artefact')
V('V-EAN13-21', 'ean13', '4.006381333931e12', False, reason='charset', adv=True, note='spreadsheet exponent')
case('validate', 'V-EAN13-22', {'format': 'ean13', 'value': '4006 3813 3393 1'}, {'note': 'strip spaces or reject: both defensible'},
     'ambiguous', True, 'grouped digits as printed')
V('V-EAN13-23', 'ean13', '', False, reason='empty')
# --- EAN-8
V('V-EAN8-01', 'ean8', '96385074', True)
V('V-EAN8-02', 'ean8', '73513537', True)
V('V-EAN8-03', 'ean8', '00000000', True)
V('V-EAN8-04', 'ean8', '01234565', True, note='also a valid UPC-E (twin)')
V('V-EAN8-05', 'ean8', '96385075', False, reason='check', suggestedCheck='4', strength='inferred')
V('V-EAN8-06', 'ean8', '9638507', False, reason='length', suggestedCheck='4', strength='inferred')
V('V-EAN8-07', 'ean8', '963850741', False, reason='length')
V('V-EAN8-08', 'ean8', '9638507A', False, reason='charset')
# --- UPC-A
V('V-UPCA-01', 'upca', '036000291452', True)
V('V-UPCA-02', 'upca', '012345678905', True)
V('V-UPCA-03', 'upca', '000000000000', True)
V('V-UPCA-04', 'upca', '036000291453', False, reason='check', suggestedCheck='2', strength='inferred')
V('V-UPCA-05', 'upca', '03600029145', False, reason='length', suggestedCheck='2', strength='inferred')
V('V-UPCA-06', 'upca', '0036000291452', False, reason='length', adv=True, note='13 digits (valid EAN-13) is not UPC-A')
V('V-UPCA-07', 'upca', '12345678901A', False, reason='charset')
# --- UPC-E
V('V-UPCE-01', 'upce', '04252614', True)
V('V-UPCE-02', 'upce', '01234565', True, note='twin with EAN-8')
V('V-UPCE-03', 'upce', '12345670', True, note='number system 1')
V('V-UPCE-04', 'upce', '00000000', True)
V('V-UPCE-05', 'upce', '04252615', False, reason='check', suggestedCheck='4', strength='inferred')
V('V-UPCE-06', 'upce', '24252614', False, reason='numbersystem', adv=True, note='number system must be 0/1')
V('V-UPCE-07', 'upce', '0425261', False, reason='length')
V('V-UPCE-08', 'upce', '425261', False, reason='length', adv=True, note='6-digit form: §5.1 says 8 digits; never padded silently')
V('V-UPCE-09', 'upce', '96385074', False, reason='numbersystem', adv=True, note='valid EAN-8 but NS 9 -> not UPC-E')
V('V-UPCE-10', 'upce', '01234566', False, reason='check', suggestedCheck='5', strength='inferred')
# --- ITF
V('V-ITF-01', 'itf', '1234', True, note='minimum')
V('V-ITF-02', 'itf', '0000', True)
V('V-ITF-03', 'itf', '00012345678905', True)
V('V-ITF-04', 'itf', '12345678901234', True, adv=True, note='14 digits with a wrong GS1 check: ITF has no check rule in §5.1')
V('V-ITF-05', 'itf', '12345678901234567890', True, note='20 digits; §5.1 gives no maximum')
V('V-ITF-06', 'itf', '123', False, reason='length', leadingZeroSuggestion='0123', strength='firm',
  note='odd -> "add a leading 0?" suggestion, user confirms; never padded silently')
V('V-ITF-07', 'itf', '12345', False, reason='length', leadingZeroSuggestion='012345')
V('V-ITF-08', 'itf', '1234567890123', False, reason='length', leadingZeroSuggestion='01234567890123')
V('V-ITF-09', 'itf', '12', False, reason='length', adv=True, note='even but shorter than 4')
V('V-ITF-10', 'itf', '12a4', False, reason='charset')
V('V-ITF-11', 'itf', '', False, reason='empty')
# --- Codabar
V('V-CODABAR-01', 'codabar', 'A1234B', True)
V('V-CODABAR-02', 'codabar', 'a1234d', True, normalised='A1234D', note='upper-cased')
V('V-CODABAR-03', 'codabar', '1234', True, note='start/stop optional')
V('V-CODABAR-04', 'codabar', 'A12B', True, note='minimum body 2 (D30)')
V('V-CODABAR-05', 'codabar', '12', True, note='minimum body 2 without letters')
V('V-CODABAR-06', 'codabar', 'A1B', False, reason='length', adv=True, note='D30: body < 2 is rejected (Vision cannot read it)')
V('V-CODABAR-07', 'codabar', '1', False, reason='length', adv=True)
V('V-CODABAR-08', 'codabar', 'AB', False, reason='length', adv=True, note='empty body')
V('V-CODABAR-09', 'codabar', 'D-$:/.+A', True)
V('V-CODABAR-10', 'codabar', 'E1234E', False, reason='charset', adv=True, note='E/T/N/* alternative start/stop not offered')
V('V-CODABAR-11', 'codabar', 'T1234N', False, reason='charset', adv=True)
V('V-CODABAR-12', 'codabar', 'A12 34B', False, reason='charset')
V('V-CODABAR-13', 'codabar', 'A1A2B', False, reason='charset', adv=True, note='letter inside the body')
V('V-CODABAR-14', 'codabar', 'A1234', False, reason='startstop', strength='inferred', adv=True,
  note='start letter without stop letter')
V('V-CODABAR-15', 'codabar', '1234B', False, reason='startstop', strength='inferred', adv=True)
# --- Code 39
V('V-CODE39-01', 'code39', 'ABC-123', True)
V('V-CODE39-02', 'code39', 'abc-123', True, normalised='ABC-123', uppercased=True, note='lower case upper-cased with a visible note')
V('V-CODE39-03', 'code39', 'HELLO WORLD', True)
V('V-CODE39-04', 'code39', '-. $/+%', True)
V('V-CODE39-05', 'code39', 'A*B', False, reason='charset', adv=True, note='* is the start/stop character')
V('V-CODE39-06', 'code39', 'A_B', False, reason='charset')
V('V-CODE39-07', 'code39', 'Müller', False, reason='charset')
V('V-CODE39-08', 'code39', 'straße', False, reason='charset', strength='inferred', adv=True,
  note="JS 'ß'.toUpperCase() = 'SS' would silently change the value")
V('V-CODE39-09', 'code39', 'kılıç', False, reason='charset', strength='inferred', adv=True,
  note="dotless i upper-cases to plain I in JS; ç stays invalid")
V('V-CODE39-10', 'code39', 'ı', False, reason='charset', strength='inferred', adv=True,
  note="'ı'.toUpperCase() = 'I' (valid Code 39) — must not be accepted silently")
V('V-CODE39-11', 'code39', 'ﬁ', False, reason='charset', strength='inferred', adv=True, note="ligature upper-cases to 'FI'")
V('V-CODE39-12', 'code39', '  CODE39 ', True, normalised='CODE39', strength='inferred')
V('V-CODE39-13', 'code39', '', False, reason='empty')
V('V-CODE39-14', 'code39', 'ABC#', False, reason='charset')
# --- Code 93
V('V-CODE93-01', 'code93', 'TEST93', True)
V('V-CODE93-02', 'code93', 'test 93', True, normalised='TEST 93', uppercased=True)
V('V-CODE93-03', 'code93', 'A*B', False, reason='charset', adv=True)
V('V-CODE93-04', 'code93', 'A#B', False, reason='charset', note='full-ASCII mode not offered')
V('V-CODE93-05', 'code93', 'groß', False, reason='charset', strength='inferred', adv=True)
V('V-CODE93-06', 'code93', '+A$M', True, note='literal; full-ASCII not offered')
# --- Code 128
V('V-CODE128-01', 'code128', 'Hello World', True)
V('V-CODE128-02', 'code128', 'A', True)
V('V-CODE128-03', 'code128', PRINTABLE[1:81], True, note='80 chars = maximum')
V('V-CODE128-04', 'code128', PRINTABLE[1:82], False, reason='length', note='81 chars')
V('V-CODE128-05', 'code128', 'Café', False, reason='charset')
V('V-CODE128-06', 'code128', 'A\tB', False, reason='charset', adv=True, note='control char rejected')
V('V-CODE128-07', 'code128', 'AB\x7f', False, reason='charset', adv=True, note='DEL 127')
V('V-CODE128-08', 'code128', '€100', False, reason='charset')
V('V-CODE128-09', 'code128', '0001234', True, note='leading zeros kept')
V('V-CODE128-10', 'code128', '^FNC1', True, adv=True, note='caret text is data (D28 parse off)')
V('V-CODE128-11', 'code128', 'A' + NBSP + 'B', False, reason='charset', adv=True, note='inner no-break space U+00A0')
V('V-CODE128-12', 'code128', BOM + 'ABC', True, normalised='ABC', strength='inferred', adv=True,
  note='leading BOM is whitespace for JS trim()')
V('V-CODE128-13', 'code128', '  ' + PRINTABLE[1:81] + ' ', True, normalised=PRINTABLE[1:81], strength='inferred', adv=True,
  note='80 chars after trim; 83 before')
V('V-CODE128-14', 'code128', 'AB\nCD', False, reason='charset', adv=True)
V('V-CODE128-15', 'code128', '   ', False, reason='empty', strength='inferred')
V('V-CODE128-16', 'code128', '', False, reason='empty')
V('V-CODE128-17', 'code128', '🙂', False, reason='charset')
V('V-CODE128-18', 'code128', 'Ab 12 ' + IDEO_SP, True, normalised='Ab 12', strength='inferred', adv=True,
  note='trailing ideographic space trimmed (JS trim)')
# --- 2D
V('V-QR-01', 'qr', 'A', True)
V('V-QR-02', 'qr', 'Müller ☃ 日本 🙂', True)
V('V-QR-03', 'qr', TEXT1000, True, note='1000 chars = maximum')
V('V-QR-04', 'qr', TEXT1000 + 'x', False, reason='length', note='1001 chars')
V('V-QR-05', 'qr', 'ü' * 1000, True, note='1000 chars, 2000 UTF-8 bytes: fits QR (2331 bytes at level M)')
V('V-QR-06', 'qr', '日' * 1000, False, reason='capacity', strength='inferred', adv=True,
  note='1000 chars but 3000 UTF-8 bytes: no QR symbol can hold it (max 2953); §2: never render a code no scanner accepts')
V('V-QR-07', 'qr', '', False, reason='empty', strength='inferred')
V('V-QR-08', 'qr', '  ', False, reason='empty', strength='inferred')
case('validate', 'V-QR-09', {'format': 'qr', 'value': 'a' * 999 + '🙂'}, {'note': '1000 code points but 1001 UTF-16 units'},
     'ambiguous', True, 'JS .length counts UTF-16 units')
case('validate', 'V-QR-10', {'format': 'qr', 'value': 'Line 1\nLine 2'}, {'note': 'inner newline: UTF-8 allows it; spec silent'},
     'ambiguous', True)
V('V-AZTEC-01', 'aztec', 'zhxbx', True)
V('V-AZTEC-02', 'aztec', TEXT1000, True)
V('V-AZTEC-03', 'aztec', 'ü' * 1000, False, reason='capacity', strength='inferred', adv=True,
  note='2000 UTF-8 bytes > Aztec maximum 1914')
V('V-AZTEC-04', 'aztec', TEXT1000 + 'x', False, reason='length')
V('V-PDF417-01', 'pdf417', '1234567890', True)
V('V-PDF417-02', 'pdf417', TEXT1000, True)
V('V-PDF417-03', 'pdf417', 'ü' * 1000, False, reason='capacity', strength='inferred', adv=True,
  note='2000 UTF-8 bytes > PDF417 maximum ~1108')
V('V-PDF417-04', 'pdf417', 'Кофейня', True)
V('V-DM-01', 'datamatrix', 'DM-42', True)
V('V-DM-02', 'datamatrix', TEXT1000, True)
V('V-DM-03', 'datamatrix', 'ü' * 1000, False, reason='capacity', strength='inferred', adv=True,
  note='2000 UTF-8 bytes > Data Matrix maximum 1556')
V('V-DM-04', 'datamatrix', 'مكتبة 42', True)
# --- none
V('V-NONE-01', 'none', 'Any text ü 🙂 *#', True, note='"none: number only"')
V('V-NONE-02', 'none', '', True, strength='inferred', note='Save allowed when format = none (§7 Edit)')

# --- suggestFormats
def S(cid, value, first, includes=(), excludes=(), order=(), hint=None, strength='firm', adv=False, note=''):
    exp = {'first': first}
    if includes:
        exp['includes'] = list(includes)
    if excludes:
        exp['excludes'] = list(excludes)
    if order:
        exp['order'] = [list(p) for p in order]
    inp = {'value': value}
    if hint:
        inp['hint'] = hint
    case('suggest', cid, inp, exp, strength, adv, note)


S('S-01', '4006381333931', 'ean13', ['code128', 'qr'], ['upca', 'ean8', 'itf'], note='13 digits + valid check -> ean13; odd -> no itf')
S('S-02', '036000291452', 'upca', ['code128', 'itf'], ['ean8'], [('code128', 'itf')], note='12 digits valid UPC-A (ean13-with-check-shown may follow; not scored)')
S('S-03', '96385074', 'ean8', ['code128', 'itf'], ['upce'], [('code128', 'itf')], note='NS 9 -> not UPC-E')
S('S-04', '01234565', 'ean8', ['upce', 'code128', 'itf'], [], [('ean8', 'upce'), ('code128', 'itf')],
  strength='inferred', adv=True, note='twins: both readings offered, ean8 listed first ("ean8/upce")')
S('S-05', '04252614', 'upce', ['code128', 'itf'], ['ean8'], note='valid UPC-E, invalid EAN-8')
S('S-06', 'ABC-123', 'code128', ['code39', 'qr'], ['ean13', 'itf', 'upca'])
S('S-07', 'Müller 42', 'qr', [], ['code128', 'code39'], note='non-ASCII: only 2D fits')
S('S-08', '1234', 'code128', ['itf'], ['ean8', 'ean13'], [('code128', 'itf')], note='even digits -> itf after code128')
S('S-09', '4006381333932', 'code128', [], ['ean13', 'itf'], adv=True, note='13 digits with a WRONG check: not ean13')
S('S-10', '40063813339', 'code128', [], ['itf', 'upca', 'ean13'], note='11 digits odd')
S('S-11', '4006381333931', 'code128', ['ean13'], [], hint='code128', note="scanner's reported type first")
S('S-12', '12345678901231', 'itf', ['code128'], [], hint='itf', note='scanner said ITF')
S('S-13', '0' * 81, 'itf', ['qr'], ['code128'], strength='inferred', adv=True, note='81 digits: too long for Code 128 (80), odd for ITF; first = '
  'whatever 1D fits'.replace('itf', 'itf'))
C[-1]['expect'].pop('first')            # only membership is scored for S-13
C[-1]['note'] = '81 digits: Code 128 excluded (> 80); ITF excluded (odd); first entry not scored'
C[-1]['expect']['excludes'] = ['code128', 'itf']
S('S-14', 'A1234B', 'code128', ['codabar', 'qr'], ['itf'], strength='inferred', note='Codabar fits too; code128 always for printable ASCII')
S('S-15', '590123412345', 'code128', ['itf'], ['upca'], strength='ambiguous', adv=True,
  note='12 digits, invalid UPC-A: whether "ean13 with check 7 shown" ranks first is unspecified')
S('S-16', '00012345678905', 'code128', ['itf'], ['ean13', 'upca'], [('code128', 'itf')], note='14 digits (GTIN-14)')

# --- UPC-E expansion
for cid, e8, a12 in [('X-01', '04252614', '042100005264'), ('X-02', '01234565', '012345000065'),
                     ('X-03', '12345670', '123456000070'), ('X-04', '01234505', '012000003455'),
                     ('X-05', '01234531', '012300000451'), ('X-06', '01234543', '012340000053'),
                     ('X-07', '19876520', '198200007650'), ('X-08', '05555598', '055555000098')]:
    case('upce-expand', 'UPCE-' + cid, {'upce': e8}, {'upca': a12}, 'firm', cid in ('X-03', 'X-07'),
         'expansion pattern %s, number system %s' % (e8[6], e8[0]))

# --- Catima colours
for cid, n, h in [('01', -9977996, '#67bf74'), ('02', -45147, '#ff4fa5'), ('03', -16777216, '#000000'),
                  ('04', -1, '#ffffff'), ('05', -11751600, '#4caf50'), ('06', -16766866, '#00286e'),
                  ('07', -6543440, '#9c27b0')]:
    case('color-to-hex', 'COL-' + cid, {'argb': n}, {'hex': h}, 'firm', n == -1, 'signed ARGB int -> #rrggbb (D29)')
case('color-to-hex', 'COL-08', {'argb': 16711680}, {'hex': '#ff0000'}, 'inferred', True, 'positive int (alpha 0) -> alpha dropped')
for cid, h, n in [('09', '#67bf74', -9977996), ('10', '#000000', -16777216), ('11', '#ffffff', -1)]:
    case('color-to-int', 'COL-' + cid, {'hex': h}, {'int': n}, 'firm', False, 'writer: alpha ff, signed 32-bit')

# --- Catima share URLs
DOC_FRAG = ('https://catima.app/share#store%3DGrocery%2BStore%26note%3DQuite%2Bnecessary%26balance%3D150%26cardid%3Ddhd'
            '%26barcodetype%3DAZTEC%26headercolor%3D-9977996')
DOC_QUERY = ('https://catima.app/share?store=Grocery%20Store&note=Quite%20necessary&balance=150&cardid=dhd'
             '&barcodetype=AZTEC&headercolor=-9977996')
GROCERY = {'name': 'Grocery Store', 'note': 'Quite necessary', 'balance': '150', 'number': 'dhd', 'codeValue': 'dhd',
           'format': 'aztec', 'color': '#67bf74'}


def frag_url(host_path, pairs):
    inner = '&'.join('%s=%s' % (k, O.java_url_encode(v)) for k, v in pairs)
    return 'https://%s#%s' % (host_path, O.java_url_encode(inner))


case('catima-share-parse', 'URL-01', {'url': DOC_FRAG}, {'ok': True, 'card': GROCERY}, 'firm', False,
     'Catima doc example, 2.0 fragment form (double-encoded)')
case('catima-share-parse', 'URL-02', {'url': DOC_QUERY}, {'ok': True, 'card': GROCERY}, 'firm', False,
     'Catima doc example, legacy query form')
case('catima-share-parse', 'URL-03', {'url': DOC_FRAG.replace('catima.app/share', 'thelastproject.github.io/Catima/share')},
     {'ok': True, 'card': GROCERY}, 'firm', False, 'alternative host (D29)')
case('catima-share-parse', 'URL-04', {'url': DOC_QUERY.replace('catima.app/share', 'brarcher.github.io/loyalty-card-locker/share')},
     {'ok': True, 'card': GROCERY}, 'firm', False, 'Loyalty Card Locker host, legacy form')
case('catima-share-parse', 'URL-05', {'url': DOC_FRAG.replace('catima.app', 'catima.app.evil.example')}, {'ok': False},
     'inferred', True, 'look-alike host must not be accepted')
case('catima-share-parse', 'URL-06', {'url': frag_url('catima.app/share', [('store', 'A&B=C+D 100%'), ('note', 'x=1&y=2\nzweite Zeile'),
                                                                       ('cardid', 'X 1/2+3'), ('barcodetype', 'CODE_128')])},
     {'ok': True, 'card': {'name': 'A&B=C+D 100%', 'note': 'x=1&y=2\nzweite Zeile', 'number': 'X 1/2+3', 'codeValue': 'X 1/2+3',
                           'format': 'code128'}}, 'firm', True, '& = + % and newline survive the double encoding')
case('catima-share-parse', 'URL-07', {'url': frag_url('catima.app/share', [('store', 'Bäckerei Müller 🥨'), ('note', ''),
                                                                       ('cardid', '会員-42'), ('barcodetype', 'QR_CODE')])},
     {'ok': True, 'card': {'name': 'Bäckerei Müller 🥨', 'number': '会員-42', 'format': 'qr', 'note': ''}}, 'firm', True,
     'non-ASCII and emoji')
case('catima-share-parse', 'URL-08', {'url': frag_url('catima.app/share', [('store', 'Club'), ('note', 'n'), ('cardid', '12345'),
                                                                       ('barcodeid', 'CLUB-12345-X'), ('barcodetype', 'QR_CODE'),
                                                                       ('balance', '12.50'), ('balancetype', 'EUR'),
                                                                       ('expiry', '1767225600000'), ('validfrom', '1704067200000'),
                                                                       ('headercolor', '-16777216')])},
     {'ok': True, 'card': {'name': 'Club', 'number': '12345', 'codeValue': 'CLUB-12345-X', 'format': 'qr', 'balance': '12.50',
                           'currency': 'EUR', 'expiry': 1767225600000, 'validFrom': 1704067200000, 'color': '#000000'}},
     'firm', True, 'barcode differs from number; balance stays "12.50" (never a float); timestamps in ms (D29)')
case('catima-share-parse', 'URL-09', {'url': frag_url('catima.app/share', [('store', 'Parcel'), ('note', ''), ('cardid', 'M1'),
                                                                       ('barcodetype', 'MAXICODE')])},
     {'ok': True, 'card': {'name': 'Parcel', 'number': 'M1', 'format': 'none', 'noteContains': 'Catima type: MAXICODE'}},
     'inferred', True, 'unknown-to-us type -> none + note (reader rule applied to links)')
case('catima-share-parse', 'URL-10', {'url': 'https://catima.app/share#'}, {'ok': False}, 'inferred', True, 'empty fragment')
case('catima-share-parse', 'URL-11', {'url': frag_url('catima.app/share', [('store', 'No number'), ('note', '')])}, {'ok': False},
     'inferred', True, 'cardid missing (required per CARD_FIELDS)')
MAKE_CARDS = {
    'URL-M1': {'name': 'Grocery Store', 'number': 'dhd', 'codeValue': 'dhd', 'format': 'aztec', 'color': '#67bf74',
               'note': 'Quite necessary', 'balance': '150', 'currency': ''},
    'URL-M2': {'name': 'A&B=C+D 100% Müller 🥨', 'number': 'X 1/2+3', 'codeValue': 'https://e.example/?a=1&b=2', 'format': 'qr',
               'color': '#000000', 'note': 'Zeile 1\nZeile 2 "q"', 'balance': '0.10', 'currency': 'USD',
               'expiry': 1767225600000, 'validFrom': 1704067200000},
    'URL-M3': {'name': 'Number only', 'number': '7788 9900', 'codeValue': '7788 9900', 'format': 'none', 'color': '#757575',
               'note': '', 'balance': '', 'currency': ''},
}
for cid, card in MAKE_CARDS.items():
    exp = {k: v for k, v in card.items() if k not in ('balance',)}
    if card['balance'] == '':
        exp['balance'] = {'anyOf': ['', '0']}
    else:
        exp['balance'] = card['balance']
    case('catima-share-make', cid, {'card': card}, {'host': 'catima.app/share', 'form': 'fragment', 'card': exp}, 'firm',
         cid == 'URL-M2', 'generated link parsed by the oracle: 2.0 fragment form, every shared field equal')

# =====================================================================================================
# 3. FIXTURES
# =====================================================================================================
FIX = os.path.join(HERE, 'fixtures')
for sub in ('catima', 'csv', 'backup', 'images'):
    os.makedirs(os.path.join(FIX, sub), exist_ok=True)


def png_bytes(w=4, h=4, gray=128):
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
    raw = b''.join(b'\x00' + bytes([gray]) * w for _ in range(h))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 0, 0, 0, 0)) +
            chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


PNG = png_bytes()
with open(os.path.join(FIX, 'images', 'tiny.jpg'), 'rb') as f:   # made once with macOS `sips` from a 4x4 PNG
    JPG = f.read()


def write(rel, data):
    with open(os.path.join(FIX, rel), 'wb') as f:
        f.write(data)
    return 'fixtures/' + rel


def crlf(records):
    return ('\r\n'.join(records) + '\r\n').encode('utf-8')


HDR = ','.join(O.CATIMA_COLUMNS)

# --- C2: the full hand-written Catima 2.0 export (A4 "hand-written Catima export fixture from the blind agent")
C2_ROWS = [
    '1,Clothing Store,Note about store,,,0,,qw,,,ISO-8859-1,-45147,1,1730493938,0',
    '2,Supermarkt Müller,"Kundennummer an der Kasse sagen\nZweite Zeile, mit Komma",,,0,,4006381333931,,EAN_13,UTF-8,-11751600,0,1730493369,0',
    '3,Pâtisserie Élise,"Says ""hello"", then leaves",,1767225600000,12.50,EUR,96385074,,EAN_8,UTF-8,-16766866,0,1730000000,0',
    '4,Panadería Niño,,1704067200000,,150,,036000291452,,UPC_A,ISO-8859-1,-6543440,0,1729000000,1',
    '5,Padaria São João,,,,0,,04252614,,UPC_E,UTF-8,-9977996,0,1728000000,0',
    '6,Ferramenta Italia,,,,0,,00012345678905,,ITF,UTF-8,-16777216,0,1727000000,0',
    '7,Kütüphane,Library card,,,0,,A40156B,,CODABAR,UTF-8,-1,0,1726000000,0',
    '8,Хозтовары,,,,0,,ABC-123,,CODE_39,UTF-8,-1499549,0,1725000000,0',
    '9,Toko Buku,,,,0,,TEST93,,CODE_93,UTF-8,-10902850,0,1724000000,0',
    '10,Restaurant,Note about restaurant here,,,0,,98765432,,CODE_128,UTF-8,-10902850,0,1730493357,0',
    '11,会員カード 東京,日本語のメモ,,,0,,MEMBER-0001,https://example.com/m/0001,QR_CODE,UTF-8,-45147,1,1723000000,0',
    '12,Shoe Store,,,,0,,zhxbx,,AZTEC,ISO-8859-1,-6543440,0,1684347744,0',
    '13,Кофейня,Скидка 10%,,,7,,1234567890,,PDF_417,UTF-8,-11751600,0,1722000000,0',
    '14,مكتبة,,,,0,,DM-42,,DATA_MATRIX,UTF-8,-16766866,0,1721000000,0',
    '15,MaxiCode Store,Parcel card,,,0,,MAXI123,,MAXICODE,UTF-8,-9977996,0,1720000000,0',
    '16,도서관,,,,0,,0101234567890128,,RSS_14,UTF-8,-9977996,0,1719000000,0',
    '17,पुस्तकालय,,,,0,,(01)98898765432106,,RSS_EXPANDED,UTF-8,-9977996,0,1718000000,0',
    '18,Café Olé 🙂,,,,0.10,USD,CAFE-1,,CODE_128,UTF-8,-45147,0,1717000000,0',
    '19,中文超市,,,,0,,5901234123457,,EAN_13,UTF-8,,0,1716000000,0',
    '20,Thư viện,"Line one\nLine two\nLine three",,,0,,01234565,,UPC_E,UTF-8,-1499549,0,1715000000,0',
]
C2_CSV = crlf(['2', '', '_id', 'Health', 'Food', 'Fashion', 'Bücher & Medien', '', HDR] + C2_ROWS +
              ['', 'cardId,groupId', '1,Fashion', '2,Food', '2,Health', '3,Health', '11,Bücher & Medien', '18,Food'])
c2 = write('catima/catima-v2-full.zip', O.zip_bytes([('catima.csv', C2_CSV), ('card_1_front.png', PNG),
                                                     ('card_1_back.png', PNG), ('card_2_front.png', PNG),
                                                     ('card_11_icon.png', PNG), ('card_99_front.png', PNG)]))


def card(name, number, fmt, **kw):
    d = {'name': name, 'number': number, 'format': fmt}
    d.update(kw)
    return d


NOCAT = []
C2_EXPECT = [
    card('Clothing Store', 'qw', 'none', note='Note about store', color='#ff4fa5', favourite=True, archived=False,
         lastUsedAt=1730493938000, categories=['Fashion'], hasFront=True, hasBack=True, balance={'anyOf': ['', '0']}, currency=''),
    card('Supermarkt Müller', '4006381333931', 'ean13', note='Kundennummer an der Kasse sagen\nZweite Zeile, mit Komma',
         color='#4caf50', categories=['Food', 'Health'], hasFront=True, hasBack=False, lastUsedAt=1730493369000),
    card('Pâtisserie Élise', '96385074', 'ean8', note='Says "hello", then leaves', expiry=1767225600000, validFrom=None,
         balance='12.50', currency='EUR', color='#00286e', categories=['Health']),
    card('Panadería Niño', '036000291452', 'upca', validFrom=1704067200000, expiry=None, balance='150', currency='',
         archived=True, color='#9c27b0', categories=NOCAT),
    card('Padaria São João', '04252614', 'upce', color='#67bf74'),
    card('Ferramenta Italia', '00012345678905', 'itf', color='#000000'),
    card('Kütüphane', 'A40156B', 'codabar', note='Library card', color='#ffffff'),
    card('Хозтовары', 'ABC-123', 'code39', color=O.argb_to_hex(-1499549)),
    card('Toko Buku', 'TEST93', 'code93'),
    card('Restaurant', '98765432', 'code128', note='Note about restaurant here', lastUsedAt=1730493357000),
    card('会員カード 東京', 'MEMBER-0001', 'qr', codeValue='https://example.com/m/0001', note='日本語のメモ', favourite=True,
         categories=['Bücher & Medien'], hasFront=False, hasBack=False),
    card('Shoe Store', 'zhxbx', 'aztec', lastUsedAt=1684347744000),
    card('Кофейня', '1234567890', 'pdf417', note='Скидка 10%', balance='7', currency=''),
    card('مكتبة', 'DM-42', 'datamatrix'),
    card('MaxiCode Store', 'MAXI123', 'none', noteContains=['Parcel card', 'Catima type: MAXICODE']),
    card('도서관', '0101234567890128', 'none', noteContains=['Catima type: RSS_14']),
    card('पुस्तकालय', '(01)98898765432106', 'none', noteContains=['Catima type: RSS_EXPANDED']),
    card('Café Olé 🙂', 'CAFE-1', 'code128', balance='0.10', currency='USD', categories=['Food']),
    card('中文超市', '5901234123457', 'ean13'),
    card('Thư viện', '01234565', 'upce', note='Line one\nLine two\nLine three', color=O.argb_to_hex(-1499549)),
]
case('catima-import', 'CAT-01', {'file': c2, 'existing': [], 'duplicateRule': 'skip'},
     {'refused': False, 'imported': 20, 'skipped': 0, 'duplicates': 0,
      'categories': ['Bücher & Medien', 'Fashion', 'Food', 'Health'], 'cards': C2_EXPECT}, 'firm', True,
     'A4 hand-written export: all 16 Catima types (MAXICODE/RSS_14/RSS_EXPANDED -> none + note), empty type -> none, '
     'negative colours, ms expiry/validfrom, SECONDS lastused, multi-line + quoted notes, groups, images incl. icon and '
     'an orphan image, 12 scripts')

# --- C1: A13 summary fixture: 12 valid, 2 invalid, 1 duplicate
C1_ROWS = [
    '1,Bakery One,,,,0,,1001,,CODE_128,UTF-8,-45147,0,1730000001,0',
    '2,Book Shop,,,,0,,9780306406157,,EAN_13,UTF-8,-45147,0,1730000002,0',
    '3,Cinema,,,,0,,CIN-77,,QR_CODE,UTF-8,-45147,0,1730000003,0',
    '4,Dry Cleaner,,,,0,,2002,,,UTF-8,-45147,0,1730000004,0',
    '5,,no store name,,,0,,3003,,CODE_128,UTF-8,-45147,0,1730000005,0',
    '6,Fuel Station,,,,0,,4006381333931,,EAN_13,UTF-8,-45147,0,1730000006,0',
    '7,Gym,,,,0,,GYM 555,,CODE_39,UTF-8,-45147,0,1730000007,0',
    '8,Hotel Club,,,,0,,HC-123456,,CODE_128,UTF-8,-45147,0,1730000008,0',
    '9,Ice Cream,no number,,,0,,,,CODE_128,UTF-8,-45147,0,1730000009,0',
    '10,Juice Bar,,,,0,,96385074,,EAN_8,UTF-8,-45147,0,1730000010,0',
    '11,Kiosk,,,,0,,036000291452,,UPC_A,UTF-8,-45147,0,1730000011,0',
    '12,Book Shop (copy),,,,0,,9780306406157,,EAN_13,UTF-8,-45147,0,1730000012,0',
    '13,Laundry,,,,0,,12345678,,ITF,UTF-8,-45147,0,1730000013,0',
    '14,Market,,,,0,,A1234B,,CODABAR,UTF-8,-45147,0,1730000014,0',
    '15,Newsagent,,,,0,,NEWS-1,,AZTEC,UTF-8,-45147,0,1730000015,0',
]
C1_CSV = crlf(['2', '', '_id', 'Shops', 'Travel', '', HDR] + C1_ROWS + ['', 'cardId,groupId', '1,Shops', '2,Shops', '12,Shops', '8,Travel'])
c1 = write('catima/catima-v2-a13.zip', O.zip_bytes([('catima.csv', C1_CSV), ('card_3_front.png', PNG)]))
C1_NAMES = ['Bakery One', 'Book Shop', 'Cinema', 'Dry Cleaner', 'Fuel Station', 'Gym', 'Hotel Club', 'Juice Bar', 'Kiosk',
            'Laundry', 'Market', 'Newsagent']
C1_FMT = ['code128', 'ean13', 'qr', 'none', 'ean13', 'code39', 'code128', 'ean8', 'upca', 'itf', 'codabar', 'aztec']
C1_NUM = ['1001', '9780306406157', 'CIN-77', '2002', '4006381333931', 'GYM 555', 'HC-123456', '96385074', '036000291452',
          '12345678', 'A1234B', 'NEWS-1']
C1_EXPECT = [card(n, num, f) for n, num, f in zip(C1_NAMES, C1_NUM, C1_FMT)]
C1_EXPECT[1]['categories'] = ['Shops']
C1_EXPECT[2]['hasFront'] = True
C1_EXPECT[6]['categories'] = ['Travel']
case('catima-import', 'CAT-02', {'file': c1, 'existing': [], 'duplicateRule': 'skip'},
     {'refused': False, 'imported': 12, 'skipped': 2, 'duplicates': 1, 'cards': C1_EXPECT, 'absentNames': ['Book Shop (copy)'],
      'categories': ['Shops', 'Travel']}, 'firm', False,
     'A13: "12 imported, 2 skipped, 1 duplicate skipped"; the FIRST of two equal number+format rows is kept')
case('catima-import', 'CAT-03', {'file': c1, 'existing': [{'name': 'Mine', 'number': '1001', 'format': 'code128'}],
                                 'duplicateRule': 'skip'},
     {'refused': False, 'imported': 11, 'skipped': 2, 'duplicates': 2, 'absentNames': ['Bakery One', 'Book Shop (copy)']},
     'inferred', True, 'duplicate against the existing wallet + one inside the file')
case('catima-import', 'CAT-04', {'file': c1, 'existing': [], 'duplicateRule': 'keep'},
     {'refused': False, 'imported': 13, 'skipped': 2, 'duplicates': 0}, 'inferred', False, '"keep both" rule')

# --- C3: pre-2.0 bare CSV (Loyalty Card Keychain era), LF line endings, extra unknown column, missing columns
C3_TEXT = ('_id,store,note,cardid,barcodetype,headercolor,headertextcolor,starstatus\n'
           '1,Old Bakery,,12345,CODE_128,-45147,-1,0\n'
           '2,Old Pharmacy,"Two\nlines",4006381333931,EAN_13,-11751600,-1,1\n'
           '3,Old Library,,A40156B,CODABAR,,,0\n'
           '4,Old Club,,CLUB 9,,,,0\n'
           '5,Old Garage,,9780306406157,EAN_13,-16777216,-1,0\n')
c3 = write('catima/catima-v1.csv', C3_TEXT.encode('utf-8'))
case('catima-import', 'CAT-05', {'file': c3, 'existing': [], 'duplicateRule': 'skip'},
     {'refused': False, 'imported': 5, 'skipped': 0, 'duplicates': 0,
      'cards': [card('Old Bakery', '12345', 'code128', color='#ff4fa5', favourite=False),
                card('Old Pharmacy', '4006381333931', 'ean13', note='Two\nlines', color='#4caf50', favourite=True),
                card('Old Library', 'A40156B', 'codabar'), card('Old Club', 'CLUB 9', 'none'),
                card('Old Garage', '9780306406157', 'ean13', color='#000000')]},
     'firm', True, 'bare pre-2.0 CSV: no version line, no groups, missing columns, unknown headertextcolor column')

# --- C4: bare version-2 CSV with BOM + CRLF, empty group and link tables
C4_CSV = b'\xef\xbb\xbf' + crlf(['2', '', '_id', '', HDR,
                                 '1,BOM Shop,,,,0,,111222,,CODE_128,UTF-8,-45147,0,1730000000,0',
                                 '2,BOM Mart,,,,0,,5901234123457,,EAN_13,UTF-8,-45147,0,1730000000,0',
                                 '3,BOM Club,,,,0,,ZZ-9,,QR_CODE,UTF-8,-45147,0,1730000000,0',
                                 '', 'cardId,groupId'])
c4 = write('catima/catima-v2-bom-crlf.csv', C4_CSV)
case('catima-import', 'CAT-06', {'file': c4, 'existing': [], 'duplicateRule': 'skip'},
     {'refused': False, 'imported': 3, 'skipped': 0, 'duplicates': 0, 'categories': [],
      'cards': [card('BOM Shop', '111222', 'code128', categories=[]), card('BOM Mart', '5901234123457', 'ean13'),
                card('BOM Club', 'ZZ-9', 'qr')]},
     'inferred', True, 'UTF-8 BOM before the version line; empty tables have no data lines')

# --- C5: zip without catima.csv
c5 = write('catima/catima-no-csv.zip', O.zip_bytes([('card_1_front.png', PNG), ('readme.txt', b'not a Catima export')]))
case('catima-import', 'CAT-07', {'file': c5, 'existing': [], 'duplicateRule': 'skip'}, {'refused': True, 'imported': 0},
     'firm', False, '§9: zip without catima.csv -> refused with a reason, nothing imported')


# --- C6: password-protected (zip4j AES) export: method 99 + AES extra field, encryption flag set
def aes_zip(name, payload):
    name_b = name.encode()
    extra = struct.pack('<HHH2sBH', 0x9901, 7, 2, b'AE', 3, 8)
    crc, comp, size = 0, len(payload), 1000
    local = struct.pack('<IHHHHHIIIHH', 0x04034b50, 51, 0x0001, 99, 0, 0x5d50, crc, comp, size, len(name_b), len(extra))
    local += name_b + extra + payload
    central = struct.pack('<IHHHHHHIIIHHHHHII', 0x02014b50, 51, 51, 0x0001, 99, 0, 0x5d50, crc, comp, size,
                          len(name_b), len(extra), 0, 0, 0, 0o644 << 16, 0) + name_b + extra
    eocd = struct.pack('<IHHHHIIH', 0x06054b50, 0, 0, 1, 1, len(central), len(local), 0)
    return local + central + eocd


pseudo = bytes((i * 73 + 41) % 256 for i in range(16 + 300 + 2 + 10))   # salt + "ciphertext" + verifier + MAC
c6 = write('catima/catima-encrypted.zip', aes_zip('catima.csv', pseudo))
case('catima-import', 'CAT-08', {'file': c6, 'existing': [], 'duplicateRule': 'skip'}, {'refused': True, 'imported': 0,
                                                                                       'reasonClass': 'encrypted'},
     'firm', True, 'D29: zip4j AES export -> "password-protected Catima export" message, nothing imported')

# --- C8: groups differing only in case (D26 case-insensitive categories)
C8_CSV = crlf(['2', '', '_id', 'Food', 'food', 'Drinks', '', HDR,
               '1,Alpha,,,,0,,A-1,,CODE_128,UTF-8,-45147,0,1730000000,0',
               '2,Beta,,,,0,,B-2,,CODE_128,UTF-8,-45147,0,1730000000,0',
               '3,Gamma,,,,0,,C-3,,CODE_128,UTF-8,-45147,0,1730000000,0',
               '', 'cardId,groupId', '1,Food', '1,food', '2,food', '3,Drinks'])
c8 = write('catima/catima-v2-group-case.zip', O.zip_bytes([('catima.csv', C8_CSV)]))
case('catima-import', 'CAT-09', {'file': c8, 'existing': [], 'duplicateRule': 'skip'},
     {'refused': False, 'imported': 3, 'skipped': 0, 'duplicates': 0, 'categories': ['Drinks', 'Food'],
      'cards': [card('Alpha', 'A-1', 'code128', categories=['Food']), card('Beta', 'B-2', 'code128', categories=['Food']),
                card('Gamma', 'C-3', 'code128', categories=['Drinks'])]},
     'inferred', True, 'D26: "Food" and "food" are one category (first spelling kept); a card in both is in it once')

# --- C9: > 2,000 cards
big_rows = ['%d,Card %04d,,,,0,,L%06d,,CODE_128,UTF-8,-45147,0,1730000000,0' % (i, i, i) for i in range(1, 2101)]
c9 = write('catima/catima-v2-2100.zip', O.zip_bytes([('catima.csv', crlf(['2', '', '_id', '', HDR] + big_rows + ['', 'cardId,groupId']))]))
case('catima-import', 'CAT-10', {'file': c9, 'existing': [], 'duplicateRule': 'skip'},
     {'refused': False, 'imported': 2100, 'skipped': 0, 'duplicates': 0,
      'cards': [card('Card 0001', 'L000001', 'code128'), card('Card 2100', 'L002100', 'code128')]},
     'firm', False, '§9: > 2,000 cards still import')

# --- C11: same number, different format -> not a duplicate
C11_CSV = crlf(['2', '', '_id', '', HDR, '1,Same A,,,,0,,555,,CODE_128,UTF-8,-45147,0,1730000000,0',
                '2,Same B,,,,0,,555,,QR_CODE,UTF-8,-45147,0,1730000000,0',
                '3,Same C,,,,0,,555,,CODE_128,UTF-8,-45147,0,1730000000,0', '', 'cardId,groupId'])
c11 = write('catima/catima-v2-same-number.zip', O.zip_bytes([('catima.csv', C11_CSV)]))
case('catima-import', 'CAT-11', {'file': c11, 'existing': [], 'duplicateRule': 'skip'},
     {'refused': False, 'imported': 2, 'skipped': 0, 'duplicates': 1, 'absentNames': ['Same C'],
      'cards': [card('Same A', '555', 'code128'), card('Same B', '555', 'qr')]},
     'firm', True, 'duplicate = same number AND format; same number with another format is kept')

# --- C10: informational (values Catima accepts but our validator would not)
C10_CSV = crlf(['2', '', '_id', '', HDR, '1,Bad Check,,,,0,,4006381333932,,EAN_13,UTF-8,-45147,0,1730000000,0',
                '2,' + 'L' * 100 + ',,,,0,,LONGNAME,,CODE_128,UTF-8,-45147,0,1730000000,0',
                '3,Odd ITF,,,,0,,12345,,ITF,UTF-8,-45147,0,1730000000,0', '', 'cardId,groupId'])
c10 = write('catima/catima-v2-invalid-values.zip', O.zip_bytes([('catima.csv', C10_CSV)]))
case('catima-import', 'CAT-12', {'file': c10, 'existing': [], 'duplicateRule': 'skip'},
     {'note': 'EAN-13 with a wrong check, a 100-char store name (our CHECK is 1..80), odd-length ITF: skip with reason, '
              'import as none/code128 with a note, or keep the format? Spec silent. Must NOT render an unreadable code '
              'silently (§2). Reported, not scored.'}, 'ambiguous', True)

# --- Catima export (engine writer -> oracle reader)
RT = [
    {'name': 'Bakery', 'number': '1001', 'codeValue': '1001', 'format': 'code128', 'color': '#e53935', 'note': 'Fresh bread',
     'balance': '3.50', 'currency': 'EUR', 'validFrom': None, 'expiry': 1798761600000, 'favourite': True, 'archived': False,
     'lastUsedAt': 1760000000000, 'categories': ['Food'], 'hasFront': True, 'hasBack': False, 'tile': 'photo',
     'chainId': None, 'useCount': 12, 'sortIndex': 0},
    {'name': 'Bücherei 📚', 'number': 'A40156B', 'codeValue': 'A40156B', 'format': 'codabar', 'color': '#1e88e5',
     'note': 'Zeile 1\nZeile 2, "zitiert"', 'balance': '', 'currency': '', 'validFrom': 1704067200000, 'expiry': None,
     'favourite': False, 'archived': False, 'lastUsedAt': None, 'categories': ['Bücher', 'Food'], 'hasFront': False,
     'hasBack': True, 'tile': 'initials', 'chainId': None, 'useCount': 0, 'sortIndex': 1},
    {'name': '会員 QR', 'number': 'M-1', 'codeValue': 'https://example.com/m/1?x=1&y=2', 'format': 'qr', 'color': '#43a047',
     'note': '', 'balance': '120', 'currency': '', 'validFrom': None, 'expiry': None, 'favourite': False, 'archived': True,
     'lastUsedAt': 1750000000000, 'categories': [], 'hasFront': False, 'hasBack': False, 'tile': 'initials',
     'chainId': None, 'useCount': 3, 'sortIndex': 2},
    {'name': 'Number only', 'number': '7788 9900', 'codeValue': '7788 9900', 'format': 'none', 'color': '#757575',
     'note': 'a,b;c\td', 'balance': '', 'currency': '', 'validFrom': None, 'expiry': None, 'favourite': False,
     'archived': False, 'lastUsedAt': None, 'categories': [], 'hasFront': False, 'hasBack': False, 'tile': 'initials',
     'chainId': None, 'useCount': 0, 'sortIndex': 3},
    {'name': 'EAN card', 'number': '4006381333931', 'codeValue': '4006381333931', 'format': 'ean13', 'color': '#000000',
     'note': '', 'balance': '0.10', 'currency': 'USD', 'validFrom': None, 'expiry': None, 'favourite': True,
     'archived': False, 'lastUsedAt': None, 'categories': ['Food'], 'hasFront': True, 'hasBack': True, 'tile': 'photo',
     'chainId': None, 'useCount': 99, 'sortIndex': 4},
]
CATIMA_FIELDS = ['name', 'number', 'codeValue', 'format', 'color', 'note', 'balance', 'currency', 'validFrom', 'expiry',
                 'favourite', 'archived', 'lastUsedAt', 'categories']


def catima_view(c):
    d = {k: c[k] for k in CATIMA_FIELDS}
    if d['balance'] == '':
        d['balance'] = {'anyOf': ['', '0']}
    return d


case('catima-export', 'CEX-01', {'cards': RT},
     {'imported': 5, 'cards': [catima_view(c) for c in RT], 'firstLine': '2', 'imagesFor': {'Bakery': ['front'],
                                                                                         'Bücherei 📚': ['back'],
                                                                                         'EAN card': ['front', 'back']}},
     'firm', True, 'engine writer -> ORACLE reader: version-2 zip, every Catima-known field, groups/links, numeric image '
                   'ids (D29); lastused written in SECONDS (ms/1000)')
case('catima-export', 'CEX-02', {'cards': [RT[1], RT[3]]},
     {'imported': 2, 'cards': [catima_view(RT[1]), catima_view(RT[3])], 'firstLine': '2'}, 'firm', True,
     'quotes, commas, tab, newline and emoji survive RFC 4180 quoting')

# --- LC1 share payload: parse
LC1_FULL = {'n': 'Bäckerei Müller', 'i': '4006381333931', 'f': 'ean13', 'k': '#67bf74', 't': 'Kasse 2\nbitte scannen',
            'b': '12.50', 'u': 'EUR', 'e': 1767225600000}


def lc1(obj):
    return 'LC1:' + json.dumps(obj, ensure_ascii=False, separators=(',', ':'))


def P(cid, text, ok, cardx=None, strength='firm', adv=False, note=''):
    exp = {'ok': ok}
    if ok:
        exp['card'] = cardx
    case('lc1-parse', cid, {'text': text}, exp, strength, adv, note)


P('LC1-P01', 'LC1:{"n":"Bakery","i":"1001","f":"code128"}', True,
  {'name': 'Bakery', 'number': '1001', 'codeValue': '1001', 'format': 'code128'})
P('LC1-P02', lc1(LC1_FULL), True, {'name': 'Bäckerei Müller', 'number': '4006381333931', 'codeValue': '4006381333931',
                                   'format': 'ean13', 'color': '#67bf74', 'note': 'Kasse 2\nbitte scannen',
                                   'balance': '12.50', 'currency': 'EUR', 'expiry': 1767225600000})
P('LC1-P03', lc1({'n': 'Club', 'i': '12345', 'c': 'CLUB-12345-X', 'f': 'qr', 'k': '#000000'}), True,
  {'name': 'Club', 'number': '12345', 'codeValue': 'CLUB-12345-X', 'format': 'qr', 'color': '#000000'})
P('LC1-P04', lc1({'n': '会員カード 🙂', 'i': 'ü-42', 'f': 'datamatrix', 't': 'مرحبا'}), True,
  {'name': '会員カード 🙂', 'number': 'ü-42', 'format': 'datamatrix', 'note': 'مرحبا'}, adv=True)
P('LC1-P05', 'LC1:{"n":"Esc\\u00e4ped \\"q\\"","i":"1","f":"code128"}', True,
  {'name': 'Escäped "q"', 'number': '1', 'format': 'code128'}, adv=True, note='JSON \\u escapes and quotes')
P('LC1-P06', 'LC2:{"n":"Bakery","i":"1001","f":"code128"}', False, note='other version prefix')
P('LC1-P07', 'lc1:{"n":"Bakery","i":"1001","f":"code128"}', False, strength='inferred', adv=True, note='prefix is case-sensitive')
P('LC1-P08', 'LC1:{"n":"Bakery","i":"1001","f":"code128"', False, note='truncated JSON')
P('LC1-P09', 'LC1:[1,2,3]', False, adv=True, note='JSON but not an object')
P('LC1-P10', 'LC1:{"i":"1001","f":"code128"}', False, note='no name (CHECK length 1..80)')
P('LC1-P11', 'LC1:{"n":"Bakery","i":"1001","f":"ean14"}', False, strength='inferred', adv=True, note='unknown format id')
P('LC1-P12', 'LC1:{"n":123,"i":"1001","f":"code128"}', False, strength='inferred', adv=True, note='name not a string')
P('LC1-P13', '', False, note='empty scan')
P('LC1-P14', DOC_FRAG, False, note='a Catima link is not an LC1 payload (it is handled by share-url.ts)')
P('LC1-P15', lc1({'n': 'N' * 81, 'i': '1', 'f': 'code128'}), False, strength='inferred', adv=True, note='81-char name')
P('LC1-P16', 'LC1:{"n":"Bakery","i":"1001","f":"code128"}xyz', False, adv=True, note='trailing garbage after the JSON')
P('LC1-P17', 'LC1:{"n":"Bakery","i":"1001","f":"code128","k":"red"}', False, strength='inferred', adv=True,
  note='colour must be #rrggbb')
P('LC1-P18', 'LC1:"just a string"', False, adv=True)
case('lc1-parse', 'LC1-P19', {'text': 'LC1:{"n":"Bakery","i":"1001","f":"code128","z":1}'},
     {'note': 'unknown extra key: strict reject vs forward-compatible ignore'}, 'ambiguous', True)
case('lc1-parse', 'LC1-P20', {'text': 'LC1:{"n":"Bad","i":"4006381333932","f":"ean13"}'},
     {'note': 'well-formed payload whose number fails its format rule: reject, or import as code128/none?'}, 'ambiguous', True)

# --- LC1 make
MK = {
    'LC1-M01': ({'name': 'Bakery', 'number': '1001', 'codeValue': '1001', 'format': 'code128', 'color': '#e53935',
                 'note': 'Fresh bread', 'balance': '3.50', 'currency': 'EUR', 'expiry': 1798761600000}, False, 'firm'),
    'LC1-M02': ({'name': 'Club', 'number': '12345', 'codeValue': 'CLUB-12345-X', 'format': 'qr', 'color': '#43a047',
                 'note': '', 'balance': '', 'currency': '', 'expiry': None}, False, 'firm'),
    'LC1-M03': ({'name': 'Long note', 'number': '1', 'codeValue': '1', 'format': 'code128', 'color': '#000000',
                 'note': 'Lorem ipsum ' * 300, 'balance': '', 'currency': '', 'expiry': None}, True, 'firm'),
    'LC1-M04': ({'name': '長いメモ', 'number': '2', 'codeValue': '2', 'format': 'qr', 'color': '#000000',
                 'note': 'お得なカード情報' * 200, 'balance': '', 'currency': '', 'expiry': None}, True, 'firm'),
    'LC1-M05': ({'name': 'Emoji', 'number': '3', 'codeValue': '3', 'format': 'qr', 'color': '#000000',
                 'note': '🙂🎉' * 400, 'balance': '', 'currency': '', 'expiry': None}, True, 'firm'),
    'LC1-M06': ({'name': 'Fits', 'number': '4', 'codeValue': '4', 'format': 'code128', 'color': '#000000',
                 'note': 'x' * 900, 'balance': '', 'currency': '', 'expiry': None}, False, 'firm'),
    'LC1-M07': ({'name': 'Big QR', 'number': 'Q', 'codeValue': TEXT1000[:900], 'format': 'qr', 'color': '#000000',
                 'note': 'n' * 600, 'balance': '', 'currency': '', 'expiry': None}, True, 'inferred'),
}
for cid, (cd, trunc, st) in MK.items():
    case('lc1-make', cid, {'card': cd}, {'maxBytes': 1200, 'truncated': trunc, 'card': {k: v for k, v in cd.items()
                                                                                         if k != 'note' or not trunc}},
         st, cid in ('LC1-M04', 'LC1-M05', 'LC1-M07'),
         'parsed back by the oracle; ≤ 1,200 bytes incl. "LC1:"; a cut note ends with "…", is a prefix of the original, '
         'valid Unicode (no lone surrogate), and truncated=true is reported' if trunc else
         'parsed back by the oracle; every field equal; no truncation')
case('lc1-make', 'LC1-M08', {'card': {'name': 'Huge', 'number': 'H', 'codeValue': 'ü' * 1000, 'format': 'qr',
                                       'color': '#000000', 'note': '', 'balance': '', 'currency': '', 'expiry': None}},
     {'note': 'code value alone is 2000 UTF-8 bytes > 1200: refuse to share by QR, or send a different payload? Spec silent'},
     'ambiguous', True)

# --- own backup: hand-written fixtures (SQL column names as JSON keys — README ambiguity A9)
def brow(i, name, number, fmt, color, **kw):
    r = {'id': 'card-%04d' % i, 'name': name, 'number': number, 'code_value': '', 'format': fmt, 'color': color,
         'tile': 'initials', 'chain_id': None, 'note': '', 'balance': '', 'balance_currency': '', 'valid_from': None,
         'expiry': None, 'favourite': 0, 'archived': 0, 'has_front': 0, 'has_back': 0, 'use_count': 0,
         'last_used_at': None, 'sort_index': i, 'created_at': 1760572800000, 'updated_at': 1760572800000}
    r.update(kw)
    return r


def backup_zip(doc, files=()):
    return O.zip_bytes([('backup.json', json.dumps(doc, ensure_ascii=False, indent=1).encode('utf-8'))] + list(files))


B_CARDS = [brow(1, 'Bakery', '1001', 'code128', '#e53935', note='Fresh bread', balance='3.50', balance_currency='EUR',
                expiry=1798761600000, favourite=1, has_front=1, use_count=12, last_used_at=1760000000000, tile='photo'),
           brow(2, 'Bücherei 📚', 'A40156B', 'codabar', '#1e88e5', note='Zeile 1\nZeile 2', valid_from=1704067200000),
           brow(3, 'Member QR', 'M-1', 'qr', '#43a047', code_value='https://example.com/m/1', archived=1, use_count=3),
           brow(4, 'Number only', '', 'none', '#757575')]
B_DOC = {'version': 1, 'exportedAt': 1760572800000, 'cards': B_CARDS,
         'categories': [{'id': 'cat-01', 'name': 'Food', 'sort_index': 0, 'created_at': 1760572800000},
                        {'id': 'cat-02', 'name': 'Bücher', 'sort_index': 1, 'created_at': 1760572800000}],
         'links': [{'card_id': 'card-0001', 'category_id': 'cat-01'}, {'card_id': 'card-0002', 'category_id': 'cat-02'},
                   {'card_id': 'card-0003', 'category_id': 'cat-01'}]}
b1 = write('backup/backup-valid.zip', backup_zip(B_DOC, [('cards/card-0001/front.jpg', JPG)]))
case('backup-import', 'BAK-01', {'file': b1, 'existing': [], 'duplicateRule': 'skip'},
     {'refused': False, 'imported': 4, 'skipped': 0, 'duplicates': 0, 'categories': ['Bücher', 'Food'],
      'cards': [card('Bakery', '1001', 'code128', color='#e53935', note='Fresh bread', balance='3.50', currency='EUR',
                     expiry=1798761600000, favourite=True, hasFront=True, hasBack=False, useCount=12,
                     lastUsedAt=1760000000000, tile='photo', categories=['Food']),
                card('Bücherei 📚', 'A40156B', 'codabar', note='Zeile 1\nZeile 2', validFrom=1704067200000, categories=['Bücher']),
                card('Member QR', 'M-1', 'qr', codeValue='https://example.com/m/1', archived=True, useCount=3, categories=['Food']),
                card('Number only', '', 'none', color='#757575', categories=[])]},
     'inferred', False, 'hand-written backup; keys = SQL column names (ambiguity A9)')
bad_rows = [brow(5, '', '5', 'code128', '#000000'), brow(6, 'N' * 81, '6', 'code128', '#000000'),
            brow(7, 'Bad colour', '7', 'code128', '#GGGGGG'), brow(8, 'Bad format', '8', 'ean14', '#000000'),
            brow(9, 'Bad flag', '9', 'code128', '#000000', favourite=2), brow(10, 'Bad tile', '10', 'code128', '#000000', tile='logo')]
B2_DOC = dict(B_DOC, cards=B_CARDS[:3] + bad_rows, links=B_DOC['links'])
b2 = write('backup/backup-skip.zip', backup_zip(B2_DOC))
case('backup-import', 'BAK-02', {'file': b2, 'existing': [], 'duplicateRule': 'skip'},
     {'refused': False, 'imported': 3, 'skipped': 6, 'duplicates': 0, 'absentNames': ['', 'Bad colour', 'Bad format', 'Bad flag', 'Bad tile']},
     'inferred', True, 'reader validates every field by the CHECK rules: empty / 81-char name, #GGGGGG, ean14, favourite 2, tile logo')
b3 = write('backup/backup-no-json.zip', O.zip_bytes([('cards/card-0001/front.jpg', JPG)]))
case('backup-import', 'BAK-03', {'file': b3, 'existing': [], 'duplicateRule': 'skip'}, {'refused': True, 'imported': 0}, 'firm', False,
     'no backup.json')
b4 = write('backup/backup-bad-json.zip', O.zip_bytes([('backup.json', b'{"version": 1, "cards": [ {"id": "x",')]))
case('backup-import', 'BAK-04', {'file': b4, 'existing': [], 'duplicateRule': 'skip'}, {'refused': True, 'imported': 0}, 'firm', True,
     'truncated JSON')
b5 = write('backup/backup-version2.zip', backup_zip(dict(B_DOC, version=2)))
case('backup-import', 'BAK-05', {'file': b5, 'existing': [], 'duplicateRule': 'skip'}, {'refused': True, 'imported': 0}, 'inferred', True,
     'unknown future version must not be half-read')
b6 = write('backup/backup-not-a-zip.zip', 'name,number\nA,1\n'.encode())
case('backup-import', 'BAK-06', {'file': b6, 'existing': [], 'duplicateRule': 'skip'}, {'refused': True, 'imported': 0}, 'firm', True,
     'CSV bytes with a .zip name')
case('backup-import', 'BAK-07', {'file': c1, 'existing': [], 'duplicateRule': 'skip'}, {'refused': True, 'imported': 0}, 'inferred', True,
     'a Catima zip given to the backup reader (no backup.json) is refused, not mis-read')
case('backup-import', 'BAK-08', {'file': b1, 'existing': [{'name': 'Mine', 'number': '1001', 'format': 'code128'}],
                                 'duplicateRule': 'skip'},
     {'refused': False, 'imported': 3, 'skipped': 0, 'duplicates': 1, 'absentNames': ['Bakery']}, 'inferred', False,
     'duplicate against the wallet')
b9 = write('backup/backup-upper-colour.zip', backup_zip(dict(B_DOC, cards=[brow(1, 'Upper', '1', 'code128', '#ABCDEF')], links=[])))
case('backup-import', 'BAK-09', {'file': b9, 'existing': [], 'duplicateRule': 'skip'},
     {'note': '#ABCDEF violates the lower-case CHECK: skip, or lower-case it? Spec silent'}, 'ambiguous', True)

# --- own backup: engine round trip and tamper (key-name independent)
RT_FULL = [dict(c) for c in RT]
case('backup-roundtrip', 'BAK-RT1', {'cards': RT_FULL},
     {'zipHas': ['backup.json'], 'jsonTop': {'version': 1}, 'jsonKeys': ['version', 'exportedAt', 'cards', 'categories', 'links'],
      'photoFiles': {'Bakery': ['front'], 'Bücherei 📚': ['back'], 'EAN card': ['front', 'back']},
      'readBack': {'refused': False, 'imported': 5, 'skipped': 0, 'duplicates': 0, 'cards': RT_FULL,
                   'categories': ['Bücher', 'Food']}},
     'firm', True, 'backup keeps EVERY field incl. tile, chain, use_count, sort (§5.3/§5.4), balance strings exact')
case('backup-tamper', 'BAK-T1', {'cards': RT_FULL, 'tamper': [{'op': 'set-top', 'key': 'version', 'value': 2}]},
     {'refused': True, 'imported': 0}, 'inferred', True, 'engine backup with version 2 -> refused')
case('backup-tamper', 'BAK-T2', {'cards': RT_FULL, 'tamper': [{'op': 'set-card', 'index': 1, 'column': 'name', 'value': ''}]},
     {'refused': False, 'imported': 4, 'skipped': 1, 'absentNames': ['Bücherei 📚']}, 'firm', True,
     'one row breaks CHECK(name) -> that row skipped with a reason, the rest imported')
case('backup-tamper', 'BAK-T3', {'cards': RT_FULL, 'tamper': [{'op': 'set-card', 'index': 0, 'column': 'format', 'value': 'EAN13'}]},
     {'refused': False, 'imported': 4, 'skipped': 1, 'absentNames': ['Bakery']}, 'inferred', True,
     'format outside the CHECK list (case matters) -> row skipped')
case('backup-tamper', 'BAK-T4', {'cards': RT_FULL, 'tamper': [{'op': 'delete-file', 'path': 'backup.json'}]},
     {'refused': True, 'imported': 0}, 'firm', False, 'backup.json removed')

# --- generic CSV
def gcsv(cid, rel, data, expect, strength='firm', adv=False, note=''):
    p = write('csv/' + rel, data)
    case('csv-import', cid, {'file': p, 'existing': [], 'duplicateRule': 'skip'}, expect, strength, adv, note)


gcsv('CSV-01', 'generic-comma.csv', b'name,number,format,note\nBakery,1001,code128,\nBooks,9780306406157,ean13,Paperbacks\n'
     b'Cinema,CIN-77,qr,\nClub,2002,none,Number only\nDiner,96385074,ean8,\n',
     {'refused': False, 'imported': 5, 'skipped': 0, 'duplicates': 0,
      'cards': [card('Bakery', '1001', 'code128'), card('Books', '9780306406157', 'ean13', note='Paperbacks'),
                card('Cinema', 'CIN-77', 'qr'), card('Club', '2002', 'none', note='Number only'), card('Diner', '96385074', 'ean8')]},
     note='our format ids')
gcsv('CSV-02', 'generic-semicolon.csv', 'Store;CardID;Type;Note\nApotheke;4006381333931;EAN_13;Rabatt 3%\nBaumarkt;ABC-123;CODE_39;\n'
     'Café;"12;34";CODE_128;Semicolon inside\n'.encode('utf-8'),
     {'refused': False, 'imported': 3, 'skipped': 0,
      'cards': [card('Apotheke', '4006381333931', 'ean13', note='Rabatt 3%'), card('Baumarkt', 'ABC-123', 'code39'),
                card('Café', '12;34', 'code128', note='Semicolon inside')]},
     adv=True, note='semicolon delimiter, aliased headers, Catima type names, quoted delimiter')
gcsv('CSV-03', 'generic-tab-bom-crlf.csv', b'\xef\xbb\xbf' + 'Name\tNumber\tBarcodeType\r\nGrocer\t5901234123457\tEAN13\r\n'
     'Hardware\tHW-0099\tCode 128\r\nMuseum\tMUSEUM-PASS-1\tQR\r\nPool\t04252614\tUPC-E\r\n'.encode('utf-8'),
     {'refused': False, 'imported': 4, 'skipped': 0,
      'cards': [card('Grocer', '5901234123457', 'ean13'), card('Hardware', 'HW-0099', 'code128'),
                card('Museum', 'MUSEUM-PASS-1', 'qr'), card('Pool', '04252614', 'upce')]},
     adv=True, note='tab, BOM, CRLF, aliases "EAN13", "Code 128", "QR", "UPC-E"; BOM must not stick to the first header')
gcsv('CSV-04', 'generic-unknown-format.csv', 'name,number,type\nAlpha,4006381333931,\nBeta,ABC-123,Fancy\nGamma,96385074,\n'
     'Delta,Ü-1234,\nEpsilon,036000291452,\n'.encode('utf-8'),
     {'refused': False, 'imported': 5, 'skipped': 0,
      'cards': [card('Alpha', '4006381333931', 'ean13'), card('Beta', 'ABC-123', 'code128'), card('Gamma', '96385074', 'ean8'),
                card('Delta', 'Ü-1234', 'qr'), card('Epsilon', '036000291452', 'upca')]},
     note='unknown/empty format -> suggestFormats, first match (§5.4)')
gcsv('CSV-05', 'generic-skips.csv', b'name,number\nValid One,111\n,222\nNo Number,\nValid Two,333\n',
     {'refused': False, 'imported': 2, 'skipped': 2, 'duplicates': 0, 'absentNames': ['', 'No Number'],
      'cards': [card('Valid One', '111', 'code128'), card('Valid Two', '333', 'code128')]},
     note='empty name / no number -> skipped with reason; no format column -> suggestFormats')
gcsv('CSV-06', 'generic-quoted.csv', b'name,number,format,note\r\n"Smith, John",SJ-1,code128,"He said ""hi""\nsecond line"\r\n',
     {'refused': False, 'imported': 1, 'cards': [card('Smith, John', 'SJ-1', 'code128', note='He said "hi"\nsecond line')]},
     'inferred', True, 'RFC 4180 quoting: comma, doubled quote, newline inside a field')
gcsv('CSV-07', 'generic-reordered.csv', b'Note,Type,Number,Name,Balance\nmemo,ean13,4006381333931,Reordered,5\n',
     {'refused': False, 'imported': 1, 'cards': [card('Reordered', '4006381333931', 'ean13', note='memo')]},
     note='columns in another order; unknown column ignored')
gcsv('CSV-08', 'generic-duplicates.csv', b'name,number,format\nFirst,777,code128\nSecond,777,code128\nThird,777,qr\n',
     {'refused': False, 'imported': 2, 'skipped': 0, 'duplicates': 1, 'absentNames': ['Second'],
      'cards': [card('First', '777', 'code128'), card('Third', '777', 'qr')]},
     'inferred', True, 'duplicate rule inside one CSV')
gcsv('CSV-09', 'generic-no-header.csv', b'Bakery,1001,code128\nBooks,9780306406157,ean13\n',
     {'note': 'no header row: refuse, or guess columns? "header detection" is specified, a header-less file is not'},
     'ambiguous', True)

# Trimmed to the orchestrator's 100-200 case budget (the specs above stay readable; these ids are not emitted)
DROP = {'V-EAN13-02', 'V-EAN13-04', 'V-EAN13-05', 'V-EAN13-07', 'V-EAN13-10', 'V-EAN13-11', 'V-EAN13-12', 'V-EAN13-19',
        'V-EAN13-23', 'V-EAN8-02', 'V-EAN8-03', 'V-UPCA-02', 'V-UPCA-03', 'V-UPCE-04', 'V-UPCE-07', 'V-ITF-02',
        'V-ITF-07', 'V-ITF-11', 'V-CODABAR-09', 'V-CODABAR-11', 'V-CODABAR-12', 'V-CODABAR-15', 'V-CODE39-03',
        'V-CODE39-04', 'V-CODE39-06', 'V-CODE39-14', 'V-CODE93-04', 'V-CODE128-02', 'V-CODE128-08', 'V-CODE128-09',
        'V-CODE128-14', 'V-CODE128-16', 'V-CODE128-17', 'V-QR-01', 'V-QR-08', 'V-AZTEC-01', 'V-AZTEC-04',
        'V-PDF417-01', 'V-DM-01', 'LC1-P08', 'LC1-P13', 'LC1-P18', 'URL-03', 'URL-10', 'S-10', 'S-12', 'S-16',
        'COL-03', 'COL-05', 'COL-10', 'UPCE-X-02', 'UPCE-X-08'}
assert DROP <= {c['id'] for c in C}, DROP - {c['id'] for c in C}
C = [c for c in C if c['id'] not in DROP]
assert len({c['id'] for c in C}) == len(C)

# =====================================================================================================
with open(os.path.join(HERE, 'render-cases.json'), 'w', encoding='utf-8') as f:
    json.dump({'set': 'loyalty-b1', 'version': 1, 'cases': R}, f, ensure_ascii=False, indent=1)
    f.write('\n')
with open(os.path.join(HERE, 'cases.json'), 'w', encoding='utf-8') as f:
    json.dump({'set': 'loyalty-b1', 'version': 1, 'cases': C}, f, ensure_ascii=False, indent=1)
    f.write('\n')
from collections import Counter  # noqa: E402
print('render', len(R), dict(Counter(x['format'] for x in R)))
print('cases', len(C), dict(Counter(x['kind'] for x in C)))
print('strength', dict(Counter(x['strength'] for x in C)), 'adversarial', sum(1 for x in C if x.get('adversarial')),
      'render adversarial', sum(1 for x in R if x.get('adversarial')))
