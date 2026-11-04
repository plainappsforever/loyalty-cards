#!/usr/bin/env python3 -I
"""Independent oracle for the loyalty-cards blind set B1 (Python 3 standard library only; run with `python3 -I`).

Written ONLY from the specification (loyalty-cards docs/SPEC.md §5.1, §5.3, §5.4, §9, §12-13; DECISIONS D26, D29-D31),
Catima's public format documents (EXPORT_FORMAT.md, CARD_FIELDS.md, CARD_SHARING_URL_FORMAT.md; facts copied by
hand) and the public symbology standards (GS1 mod-10, UPC-E zero suppression, Code 39/93/128, Codabar, ITF).
It never read the app's engine, tests or fixtures.

Public API (all pure; no I/O except the *_file helpers):
  js_trim(s)                         ECMAScript String.prototype.trim semantics
  gs1_check(data) / upce_expand(d8)  check digits; UPC-E -> UPC-A (12 digits)
  validate(fmt, value)               -> {ok, normalised, reason, suggestedCheck?, leadingZeroSuggestion?, uppercased?, twins?}
  suggest(value, hint=None)          -> ranked format ids (my reading of §5.1; only first/membership/order-pairs are scored)
  capacity_class(fmt, value)         -> 'fits' | 'exceeds' | 'grey'  (2D symbol capacity, conservative bounds)
  expect_decoded(fmt, value)         -> (expectDecoded, expectSymbology, pattern|None)   macOS Vision conventions
  argb_to_hex(n) / hex_to_argb(h)    Catima headercolor <-> '#rrggbb'
  java_url_encode/decode, catima_share_parse(url), catima_share_make(card)
  catima_read(data: bytes, existing=[], dup='skip')  -> import result (zip or bare CSV)
  generic_csv_read(data: bytes, existing=[], dup='skip')
  backup_read(data: bytes, existing=[], dup='skip')
  lc1_parse(text) / lc1_make(card)   family-share QR payload
  catima_write / backup_write        reference writers (self-test only)
CLI: oracle.py <format> <value>  |  oracle.py batch < queries.jsonl   (A1 cross-check of a generated value set)
"""
import io
import json
import re
import zipfile

FORMATS = ['none', 'code128', 'ean13', 'ean8', 'upca', 'upce', 'itf', 'codabar', 'code39', 'code93',
           'qr', 'aztec', 'pdf417', 'datamatrix']
ONE_D = ['code128', 'ean13', 'ean8', 'upca', 'upce', 'itf', 'codabar', 'code39', 'code93']
TWO_D = ['qr', 'aztec', 'pdf417', 'datamatrix']

CODE39_CHARS = set('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%')
CODABAR_BODY = set('0123456789-$:/.+')
CODABAR_SS = set('ABCD')
CODABAR_MIN_BODY = 2          # D30
CODE128_MAX = 80              # §5.1
TWO_D_MAX = 1000              # §5.1 "UTF-8 ≤ 1,000 chars" (counted in code points; see README ambiguity)
ITF_MIN = 4                   # §5.1

# ECMAScript WhiteSpace + LineTerminator (ECMA-262 §12.2/12.3; Zs category as of Unicode 15)
_JS_WS = set(chr(c) for c in (0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003,
                               0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200A, 0x2028, 0x2029, 0x202F,
                               0x205F, 0x3000, 0xFEFF))


def js_trim(s):
    i, j = 0, len(s)
    while i < j and s[i] in _JS_WS:
        i += 1
    while j > i and s[j - 1] in _JS_WS:
        j -= 1
    return s[i:j]


def _ascii_digits(s):
    return s != '' and all('0' <= c <= '9' for c in s)


def gs1_check(data):
    """GS1 mod-10 check digit over `data` (all digits before the check): weight 3 on the rightmost data digit."""
    total, w = 0, 3
    for ch in reversed(data):
        total += (ord(ch) - 48) * w
        w = 4 - w
    return str((10 - total % 10) % 10)


def upce_expand(d):
    """8-digit UPC-E (NS 0/1 + 6 digits + check) -> 12-digit UPC-A; check digit copied."""
    if len(d) != 8 or not _ascii_digits(d) or d[0] not in '01':
        raise ValueError('UPC-E needs 8 digits with number system 0 or 1')
    x, last = d[1:7], d[6]
    if last in '012':
        body = x[0:2] + last + '0000' + x[2:5]
    elif last == '3':
        body = x[0:3] + '00000' + x[3:5]
    elif last == '4':
        body = x[0:4] + '00000' + x[4]
    else:
        body = x[0:5] + '0000' + last
    return d[0] + body + d[7]


def upce_check(d7):
    return gs1_check(upce_expand(d7 + '0')[:11])


def _r(ok, normalised, reason=None, **extra):
    out = {'ok': ok, 'normalised': normalised, 'reason': reason}
    out.update(extra)
    return out


def validate(fmt, value):
    """SPEC §5.1 as read by the blind author. Reasons: charset | length | check | numbersystem | startstop |
    capacity | empty | format. `normalised` = normalise(value, fmt) (trim; upper-case 39/93/Codabar)."""
    if fmt not in FORMATS:
        return _r(False, None, 'format')
    v = js_trim(value)
    if fmt == 'none':
        return _r(True, v)
    if v == '':
        return _r(False, v, 'empty')
    if fmt in ('ean13', 'ean8', 'upca', 'upce', 'itf'):
        if not _ascii_digits(v):
            return _r(False, v, 'charset')
    if fmt in ('ean13', 'ean8', 'upca'):
        n = {'ean13': 13, 'ean8': 8, 'upca': 12}[fmt]
        if len(v) == n - 1:
            return _r(False, v, 'length', suggestedCheck=gs1_check(v))
        if len(v) != n:
            return _r(False, v, 'length')
        if gs1_check(v[:-1]) != v[-1]:
            return _r(False, v, 'check', suggestedCheck=gs1_check(v[:-1]))
        extra = {}
        if fmt == 'ean8' and v[0] in '01' and upce_check(v[:7]) == v[7]:
            extra['twins'] = ['upce']
        return _r(True, v, **extra)
    if fmt == 'upce':
        if len(v) != 8:
            return _r(False, v, 'length')
        if v[0] not in '01':
            return _r(False, v, 'numbersystem')
        c = upce_check(v[:7])
        if c != v[7]:
            return _r(False, v, 'check', suggestedCheck=c)
        extra = {'upca': upce_expand(v)}
        if gs1_check(v[:7]) == v[7]:
            extra['twins'] = ['ean8']
        return _r(True, v, **extra)
    if fmt == 'itf':
        if len(v) % 2 == 1:
            return _r(False, v, 'length', leadingZeroSuggestion='0' + v)
        if len(v) < ITF_MIN:
            return _r(False, v, 'length')
        return _r(True, v)
    if fmt == 'codabar':
        u = v.upper() if v.isascii() else v
        up = u != v
        first, last = u[0] in CODABAR_SS, u[-1] in CODABAR_SS
        if first and last and len(u) >= 2:
            body = u[1:-1]
        elif first or last:
            return _r(False, u, 'startstop')
        else:
            body = u
        if any(c not in CODABAR_BODY for c in body):
            return _r(False, u, 'charset')
        if len(body) < CODABAR_MIN_BODY:
            return _r(False, u, 'length')
        return _r(True, u, uppercased=up)
    if fmt in ('code39', 'code93'):
        u = ''.join(c.upper() if 'a' <= c <= 'z' else c for c in v)
        if any(c not in CODE39_CHARS for c in u):
            return _r(False, u, 'charset')
        return _r(True, u, uppercased=(u != v))
    if fmt == 'code128':
        if any(not (32 <= ord(c) <= 126) for c in v):
            return _r(False, v, 'charset')
        if len(v) > CODE128_MAX:
            return _r(False, v, 'length')
        return _r(True, v)
    # 2D
    if len(v) > TWO_D_MAX:
        return _r(False, v, 'length')
    cap = capacity_class(fmt, v)
    if cap == 'exceeds':
        return _r(False, v, 'capacity')
    return _r(True, v, capacity=cap)


# Absolute maximum byte capacities (largest symbol, lowest error correction a generator may use). A value above
# the bound cannot be encoded by ANY conforming encoder -> 'exceeds'. ≤ 1,000 UTF-8 bytes always fits all four
# (QR 40-M 2331; Aztec 32 layers 1914, ~1650 at 23 % EC; PDF417 1108 bytes absolute, and 1,000 bytes = 834 byte-
# compaction codewords <= 863 -> ISO-recommended EC level 5 (64) -> 902 <= 928 codewords; Data Matrix 144x144 1556)
# -> 'fits'. In between depends on the encoder's EC choice -> 'grey' (never scored).
_ABS_MAX_BYTES = {'qr': 2953, 'aztec': 1914, 'pdf417': 1108, 'datamatrix': 1556}
_SAFE_BYTES = {'qr': 2331, 'aztec': 1500, 'pdf417': 1000, 'datamatrix': 1500}


def capacity_class(fmt, v):
    n = len(v.encode('utf-8')) + (0 if v.isascii() else 4)   # + ECI/mode overhead allowance
    if n > _ABS_MAX_BYTES[fmt]:
        return 'exceeds'
    if n <= _SAFE_BYTES[fmt]:
        return 'fits'
    return 'grey'


def suggest(value, hint=None):
    """Ranked formats per §5.1: hint first (if its rules hold); ean13 | upca | ean8/upce; code128; itf after code128;
    then the other 1D formats whose rules hold; 2D last (qr first)."""
    v = js_trim(value)
    order = []
    if hint and hint in FORMATS and hint != 'none' and validate(hint, v)['ok']:
        order.append(hint)
    for f in ['ean13', 'upca', 'ean8', 'upce', 'code128', 'itf', 'code39', 'code93', 'codabar',
              'qr', 'aztec', 'pdf417', 'datamatrix']:
        if f not in order and validate(f, v)['ok']:
            order.append(f)
    return order


VISION_SYMBOLOGY = {'code128': 'Code128', 'ean13': 'EAN13', 'ean8': 'EAN8', 'upca': 'EAN13', 'upce': 'UPCE',
                    'itf': 'I2of5', 'codabar': 'Codabar', 'code39': 'Code39', 'code93': 'Code93', 'qr': 'QR',
                    'aztec': 'Aztec', 'pdf417': 'PDF417', 'datamatrix': 'DataMatrix'}
# Symbology names that count as the same family when scoring (Vision may use either)
SYMBOLOGY_FAMILY = {'I2of5': {'I2of5', 'ITF14', 'I2of5Checksum'}, 'Code39': {'Code39'},
                    'Code93': {'Code93', 'Code93i'}, 'PDF417': {'PDF417', 'MicroPDF417'}, 'QR': {'QR'}}


def expect_decoded(fmt, value):
    """What macOS Vision's payloadStringValue returns for a correct symbol of the canonical `value` (README §3).
    Returns (expectDecoded, expectSymbology, regex pattern or None)."""
    sym = VISION_SYMBOLOGY[fmt]
    if fmt == 'upca':
        return '0' + value, sym, None
    if fmt == 'codabar' and not (value[0] in CODABAR_SS and value[-1] in CODABAR_SS):
        return value, sym, '^[A-D]' + re.escape(value) + '[A-D]$'
    return value, sym, None


# ---- Catima ---------------------------------------------------------------------------------------------------

CATIMA_TO_FORMAT = {'AZTEC': 'aztec', 'CODABAR': 'codabar', 'CODE_39': 'code39', 'CODE_93': 'code93',
                    'CODE_128': 'code128', 'DATA_MATRIX': 'datamatrix', 'EAN_8': 'ean8', 'EAN_13': 'ean13',
                    'ITF': 'itf', 'PDF_417': 'pdf417', 'QR_CODE': 'qr', 'UPC_A': 'upca', 'UPC_E': 'upce'}
FORMAT_TO_CATIMA = {v: k for k, v in CATIMA_TO_FORMAT.items()}
CATIMA_UNRENDERABLE = ['MAXICODE', 'RSS_14', 'RSS_EXPANDED']


def argb_to_hex(n):
    n = int(n)
    if not (-2 ** 31 <= n < 2 ** 32):
        raise ValueError('not a 32-bit colour')
    return '#%06x' % (n & 0xFFFFFF)


def hex_to_argb(h):
    if not re.fullmatch(r'#[0-9a-fA-F]{6}', h):
        raise ValueError('bad colour')
    u = 0xFF000000 | int(h[1:], 16)
    return u - 2 ** 32


_JAVA_SAFE = set('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-*_')


def java_url_encode(s):
    out = []
    for ch in s:
        if ch in _JAVA_SAFE:
            out.append(ch)
        elif ch == ' ':
            out.append('+')
        else:
            out.extend('%%%02X' % b for b in ch.encode('utf-8'))
    return ''.join(out)


def java_url_decode(s):
    buf, i = bytearray(), 0
    while i < len(s):
        c = s[i]
        if c == '+':
            buf.append(0x20); i += 1
        elif c == '%':
            if i + 3 > len(s):
                raise ValueError('bad escape')
            buf.append(int(s[i + 1:i + 3], 16)); i += 3
        else:
            buf.extend(c.encode('utf-8')); i += 1
    return buf.decode('utf-8')


SHARE_HOSTS = {('catima.app', '/share'), ('thelastproject.github.io', '/Catima/share'),
               ('brarcher.github.io', '/loyalty-card-locker/share')}


def _catima_fields_to_card(p):
    """Catima key=value params (or CSV row dict) -> card dict in the scoring vocabulary."""
    card = {'name': p.get('store', ''), 'number': p.get('cardid', ''), 'note': p.get('note', '') or ''}
    bt = (p.get('barcodetype') or '').strip()
    if bt == '':
        card['format'] = 'none'
    elif bt in CATIMA_TO_FORMAT:
        card['format'] = CATIMA_TO_FORMAT[bt]
    else:
        card['format'] = 'none'
        card['note'] = (card['note'] + '\n' if card['note'] else '') + 'Catima type: ' + bt
    bid = p.get('barcodeid') or ''
    card['codeValue'] = bid if bid != '' else card['number']
    hc = (p.get('headercolor') or '').strip()
    if hc != '':
        card['color'] = argb_to_hex(int(hc))
    bal = (p.get('balance') or '').strip()
    card['balance'] = '' if bal in ('', '0') else bal
    card['currency'] = (p.get('balancetype') or '').strip()
    for src, dst in (('validfrom', 'validFrom'), ('expiry', 'expiry')):
        t = (p.get(src) or '').strip()
        card[dst] = int(t) if t != '' else None
    if 'lastused' in p:
        t = (p.get('lastused') or '').strip()
        card['lastUsedAt'] = int(t) * 1000 if t not in ('', '0') else None
    if 'starstatus' in p:
        card['favourite'] = (p.get('starstatus') or '0').strip() == '1'
    if 'archive' in p:
        card['archived'] = (p.get('archive') or '0').strip() == '1'
    return card


def catima_share_parse(url):
    m = re.fullmatch(r'https?://([^/?#]+)(/[^?#]*)(?:\?([^#]*))?(?:#(.*))?', url.strip())
    if not m:
        return {'ok': False}
    host, path, query, frag = m.group(1).lower(), m.group(2), m.group(3), m.group(4)
    if (host, path) not in SHARE_HOSTS:
        return {'ok': False}
    if frag:
        inner = java_url_decode(frag)
    elif query:
        inner = query
    else:
        return {'ok': False}
    p = {}
    for part in inner.split('&'):
        if part:
            k, _, val = part.partition('=')
            p[java_url_decode(k)] = java_url_decode(val)
    if not p.get('store') or not p.get('cardid'):
        return {'ok': False}
    card = _catima_fields_to_card(p)
    for k in ('lastUsedAt', 'favourite', 'archived'):
        card.pop(k, None)
    return {'ok': True, 'card': card}


def catima_share_make(card):
    p = [('store', card['name']), ('note', card.get('note', '')), ('cardid', card['number'])]
    if card.get('codeValue') and card['codeValue'] != card['number']:
        p.append(('barcodeid', card['codeValue']))
    if card.get('format', 'none') != 'none':
        p.append(('barcodetype', FORMAT_TO_CATIMA[card['format']]))
    if card.get('color'):
        p.append(('headercolor', str(hex_to_argb(card['color']))))
    if card.get('balance'):
        p.append(('balance', card['balance']))
    if card.get('currency'):
        p.append(('balancetype', card['currency']))
    if card.get('expiry') is not None:
        p.append(('expiry', str(card['expiry'])))
    if card.get('validFrom') is not None:
        p.append(('validfrom', str(card['validFrom'])))
    inner = '&'.join('%s=%s' % (k, java_url_encode(v)) for k, v in p)
    return 'https://catima.app/share#' + java_url_encode(inner)


def parse_csv(text, delim=','):
    """RFC 4180 parser: quoted fields may contain delimiters, CR/LF and doubled quotes. Returns list of rows;
    a physically empty line yields [] (used as Catima's table separator)."""
    rows, row, field, i, n = [], [], [], 0, len(text)
    in_q, had_any = False, False
    while i < n:
        c = text[i]
        if in_q:
            if c == '"':
                if i + 1 < n and text[i + 1] == '"':
                    field.append('"'); i += 2; continue
                in_q = False; i += 1; continue
            field.append(c); i += 1; continue
        if c == '"':
            in_q = True; had_any = True; i += 1; continue
        if c == delim:
            row.append(''.join(field)); field = []; had_any = True; i += 1; continue
        if c in '\r\n':
            if c == '\r' and i + 1 < n and text[i + 1] == '\n':
                i += 1
            i += 1
            if had_any or field:
                row.append(''.join(field))
                rows.append(row)
            else:
                rows.append([])
            row, field, had_any = [], [], False
            continue
        field.append(c); had_any = True; i += 1
    if had_any or field or row:
        row.append(''.join(field))
        rows.append(row)
    return rows


def _decode_text(data):
    if data.startswith(b'\xef\xbb\xbf'):
        data = data[3:]
    return data.decode('utf-8')


def _summary(cards, skipped, dups, categories, refused=False, reason=None):
    return {'refused': refused, 'reason': reason, 'imported': len(cards), 'skipped': skipped,
            'duplicates': dups, 'cards': cards, 'categories': sorted(categories, key=str.lower)}


def _admit(raw_cards, existing, dup):
    """Shared import rules: skip empty name / empty number; duplicate = same number + format (existing wallet
    or earlier in the same file); default rule 'skip'."""
    seen = {(e['number'], e['format']) for e in existing}
    out, skipped, dups = [], 0, 0
    for c in raw_cards:
        if js_trim(c['name']) == '' or c['number'] == '':
            skipped += 1
            continue
        key = (c['number'], c['format'])
        if key in seen and dup == 'skip':
            dups += 1
            continue
        seen.add(key)
        out.append(c)
    return out, skipped, dups


def _is_encrypted_zip(data):
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        return False
    return any((i.flag_bits & 1) or i.compress_type == 99 for i in z.infolist())


def catima_read(data, existing=(), dup='skip'):
    images = {}
    if data[:4] == b'PK\x03\x04':
        if _is_encrypted_zip(data):
            return _summary([], 0, 0, [], True, 'encrypted')
        z = zipfile.ZipFile(io.BytesIO(data))
        names = z.namelist()
        if 'catima.csv' not in names:
            return _summary([], 0, 0, [], True, 'no-catima-csv')
        text = _decode_text(z.read('catima.csv'))
        for nm in names:
            m = re.fullmatch(r'card_(\d+)_(front|back|icon)\.png', nm)
            if m:
                images.setdefault(m.group(1), set()).add(m.group(2))
    else:
        text = _decode_text(data)
    rows = parse_csv(text)
    groups, links, card_rows = [], [], []
    if rows and rows[0] == ['2']:
        # version 2: blank-separated tables: groups, cards, links
        tables, cur = [], []
        for r in rows[1:]:
            if r == []:
                if cur:
                    tables.append(cur)
                cur = []
            else:
                cur.append(r)
        if cur:
            tables.append(cur)
        for t in tables:
            h = t[0]
            if h == ['_id']:
                groups = [r[0] for r in t[1:]]
            elif h[:1] == ['_id'] and 'cardid' in h:
                card_rows = [dict(zip(h, r)) for r in t[1:]]
            elif h == ['cardId', 'groupId']:
                links = [(r[0], r[1]) for r in t[1:]]
    else:
        nonempty = [r for r in rows if r != []]
        if not nonempty or 'cardid' not in nonempty[0]:
            return _summary([], 0, 0, [], True, 'not-catima')
        h = nonempty[0]
        card_rows = [dict(zip(h, r)) for r in nonempty[1:]]
    # categories: case-insensitive merge (D26)
    canon = {}
    for g in groups:
        canon.setdefault(g.lower(), g)
    raw = []
    for r in card_rows:
        c = _catima_fields_to_card(r)
        cid = r.get('_id', '')
        cats = sorted({canon.get(g.lower(), g) for (cardid, g) in links if cardid == cid}, key=str.lower)
        c['categories'] = cats
        sides = images.get(cid, set())
        c['hasFront'] = 'front' in sides
        c['hasBack'] = 'back' in sides
        raw.append(c)
    cards, skipped, dups = _admit(raw, existing, dup)
    return _summary(cards, skipped, dups, list(canon.values()))


# ---- generic CSV (§5.4) -----------------------------------------------------------------------------------------

_HEADER = {'name': 'name', 'store': 'name', 'number': 'number', 'cardid': 'number', 'id': 'number',
           'format': 'format', 'barcodetype': 'format', 'type': 'format', 'note': 'note'}


def format_alias(s):
    k = re.sub(r'[\s_\-]', '', s.strip().lower())
    table = {f: f for f in FORMATS}
    table.update({'qrcode': 'qr', 'pdf417': 'pdf417', 'datamatrix': 'datamatrix', 'itf14': 'itf',
                  'interleaved2of5': 'itf'})
    return table.get(k)


def generic_csv_read(data, existing=(), dup='skip'):
    text = _decode_text(data)
    first = text.split('\n', 1)[0]
    delim = max([',', ';', '\t'], key=lambda d: first.count(d))
    rows = [r for r in parse_csv(text, delim) if r != []]
    if not rows:
        return _summary([], 0, 0, [], True, 'empty')
    cols = {}
    for i, h in enumerate(rows[0]):
        key = _HEADER.get(js_trim(h).lower())
        if key and key not in cols:
            cols[key] = i
    if 'name' not in cols or 'number' not in cols:
        return _summary([], 0, 0, [], True, 'no-header')
    raw = []
    for r in rows[1:]:
        get = lambda k: js_trim(r[cols[k]]) if k in cols and cols[k] < len(r) else ''
        number = get('number')
        fmt_raw = get('format')
        fmt = format_alias(fmt_raw) if fmt_raw else None
        if fmt is None:
            s = suggest(number)
            fmt = s[0] if s else 'none'
        raw.append({'name': get('name'), 'number': number, 'format': fmt, 'note': get('note') if 'note' in cols
                    else '', 'codeValue': number})
    cards, skipped, dups = _admit(raw, existing, dup)
    return _summary(cards, skipped, dups, [])


# ---- own backup (§5.4; key names = SQL column names, README ambiguity) --------------------------------------------

_COLOR_RE = re.compile(r'#[0-9a-f]{6}')


def _backup_row_ok(c):
    try:
        if not isinstance(c.get('id'), str) or c['id'] == '':
            return False
        if not isinstance(c.get('name'), str) or not (1 <= len(c['name']) <= 80):
            return False
        if c.get('format') not in FORMATS:
            return False
        if not isinstance(c.get('color'), str) or not _COLOR_RE.fullmatch(c['color']):
            return False
        if c.get('tile', 'initials') not in ('initials', 'photo'):
            return False
        for k in ('favourite', 'archived'):
            if c.get(k, 0) not in (0, 1) or isinstance(c.get(k, 0), bool):
                return False
        for k in ('number', 'code_value', 'note', 'balance', 'balance_currency'):
            if not isinstance(c.get(k, ''), str):
                return False
        return True
    except Exception:
        return False


def backup_read(data, existing=(), dup='skip'):
    if data[:4] != b'PK\x03\x04':
        return _summary([], 0, 0, [], True, 'not-zip')
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        return _summary([], 0, 0, [], True, 'not-zip')
    if 'backup.json' not in z.namelist():
        return _summary([], 0, 0, [], True, 'no-backup-json')
    try:
        doc = json.loads(z.read('backup.json').decode('utf-8'))
    except Exception:
        return _summary([], 0, 0, [], True, 'bad-json')
    if not isinstance(doc, dict) or doc.get('version') != 1 or not isinstance(doc.get('cards'), list):
        return _summary([], 0, 0, [], True, 'version')
    names = set(z.namelist())
    cats = {c['id']: c['name'] for c in doc.get('categories', []) if isinstance(c, dict)}
    links = [(l.get('card_id'), l.get('category_id')) for l in doc.get('links', []) if isinstance(l, dict)]
    raw, bad = [], 0
    for c in doc['cards']:
        if not isinstance(c, dict) or not _backup_row_ok(c):
            bad += 1
            continue
        out = {'name': c['name'], 'number': c.get('number', ''), 'format': c['format'],
               'codeValue': c.get('code_value') or c.get('number', ''), 'color': c['color'],
               'note': c.get('note', ''), 'balance': c.get('balance', ''), 'currency': c.get('balance_currency', ''),
               'validFrom': c.get('valid_from'), 'expiry': c.get('expiry'),
               'favourite': c.get('favourite', 0) == 1, 'archived': c.get('archived', 0) == 1,
               'tile': c.get('tile', 'initials'), 'chainId': c.get('chain_id'), 'useCount': c.get('use_count', 0),
               'lastUsedAt': c.get('last_used_at'), 'sortIndex': c.get('sort_index', 0),
               'categories': sorted({cats[g] for (cid, g) in links if cid == c['id'] and g in cats}, key=str.lower),
               'hasFront': ('cards/%s/front.jpg' % c['id']) in names,
               'hasBack': ('cards/%s/back.jpg' % c['id']) in names}
        raw.append(out)
    # backup rows have a name by CHECK; a '' number is a legal card (format none) -> no number rule here
    seen = {(e['number'], e['format']) for e in existing}
    cards, dups = [], 0
    for c in raw:
        key = (c['number'], c['format'])
        if existing and key in seen and dup == 'skip':
            dups += 1
            continue
        cards.append(c)
    return _summary(cards, bad, dups, list(cats.values()))


# ---- LC1 family-share payload (§5.4) ------------------------------------------------------------------------------

LC1_KEYS = {'n': 'name', 'i': 'number', 'c': 'codeValue', 'f': 'format', 'k': 'color', 't': 'note',
            'b': 'balance', 'u': 'currency', 'e': 'expiry'}
LC1_MAX_BYTES = 1200


def lc1_parse(text):
    if not isinstance(text, str) or not text.startswith('LC1:'):
        return {'ok': False}
    try:
        obj = json.loads(text[4:])
    except Exception:
        return {'ok': False}
    if not isinstance(obj, dict):
        return {'ok': False}
    n = obj.get('n')
    if not isinstance(n, str) or not (1 <= len(js_trim(n)) <= 80):
        return {'ok': False}
    f = obj.get('f', 'none')
    if f not in FORMATS:
        return {'ok': False}
    for k in ('i', 'c', 't', 'b', 'u'):
        if k in obj and not isinstance(obj[k], str):
            return {'ok': False}
    if 'k' in obj and (not isinstance(obj['k'], str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', obj['k'])):
        return {'ok': False}
    if 'e' in obj and obj['e'] is not None and (not isinstance(obj['e'], int) or isinstance(obj['e'], bool)):
        return {'ok': False}
    card = {'name': n, 'number': obj.get('i', ''), 'format': f, 'note': obj.get('t', ''),
            'balance': obj.get('b', ''), 'currency': obj.get('u', ''), 'expiry': obj.get('e')}
    card['codeValue'] = obj['c'] if obj.get('c') else card['number']
    if 'k' in obj:
        card['color'] = obj['k'].lower()
    return {'ok': True, 'card': card}


def lc1_make(card):
    """Reference generator: compact JSON, raw UTF-8; the note is cut at a code-point boundary and ends with '…'
    when the whole payload would exceed 1,200 bytes."""
    obj = {'n': card['name'], 'i': card['number']}
    if card.get('codeValue') and card['codeValue'] != card['number']:
        obj['c'] = card['codeValue']
    obj['f'] = card['format']
    if card.get('color'):
        obj['k'] = card['color']
    for src, k in (('note', 't'), ('balance', 'b'), ('currency', 'u')):
        if card.get(src):
            obj[k] = card[src]
    if card.get('expiry') is not None:
        obj['e'] = card['expiry']

    def enc(o):
        return 'LC1:' + json.dumps(o, ensure_ascii=False, separators=(',', ':'))
    s = enc(obj)
    truncated = False
    if len(s.encode('utf-8')) > LC1_MAX_BYTES and obj.get('t'):
        note = obj['t']
        lo, hi = 0, len(note)
        while lo < hi:
            mid = (lo + hi + 1) // 2
            obj['t'] = note[:mid] + '…'
            if len(enc(obj).encode('utf-8')) <= LC1_MAX_BYTES:
                lo = mid
            else:
                hi = mid - 1
        obj['t'] = note[:lo] + '…'
        s = enc(obj)
        truncated = True
    return {'text': s, 'truncated': truncated}


# ---- reference writers (used by the self-test to prove the scorer accepts a correct export) ------------------

ZIP_DATE = (2026, 10, 16, 0, 0, 0)


def zip_bytes(entries):
    """Deterministic zip: entries = [(name, bytes)], DEFLATE, fixed timestamp."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        for name, data in entries:
            zi = zipfile.ZipInfo(name, ZIP_DATE)
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            z.writestr(zi, data)
    return buf.getvalue()


def csv_field(v):
    v = '' if v is None else str(v)
    if any(c in v for c in ',"\r\n'):
        return '"' + v.replace('"', '""') + '"'
    return v


CATIMA_COLUMNS = ['_id', 'store', 'note', 'validfrom', 'expiry', 'balance', 'balancetype', 'cardid', 'barcodeid',
                  'barcodetype', 'barcodeencoding', 'headercolor', 'starstatus', 'lastused', 'archive']


def catima_write(cards, png=b''):
    """cards in the scoring vocabulary (+ 'categories'); returns zip bytes (version 2, CRLF, numeric ids)."""
    lines = ['2', '', '_id']
    groups = sorted({g for c in cards for g in c.get('categories', [])}, key=str.lower)
    lines += [csv_field(g) for g in groups]
    lines += ['', ','.join(CATIMA_COLUMNS)]
    links, files = [], []
    for i, c in enumerate(cards, 1):
        row = {'_id': i, 'store': c['name'], 'note': c.get('note', ''), 'validfrom': c.get('validFrom'),
               'expiry': c.get('expiry'), 'balance': c.get('balance') or '0', 'balancetype': c.get('currency', ''),
               'cardid': c['number'],
               'barcodeid': c['codeValue'] if c.get('codeValue') and c['codeValue'] != c['number'] else '',
               'barcodetype': FORMAT_TO_CATIMA.get(c.get('format', 'none'), ''), 'barcodeencoding': 'UTF-8',
               'headercolor': hex_to_argb(c['color']) if c.get('color') else '',
               'starstatus': 1 if c.get('favourite') else 0,
               'lastused': (c['lastUsedAt'] // 1000) if c.get('lastUsedAt') else '',
               'archive': 1 if c.get('archived') else 0}
        lines.append(','.join(csv_field(row[k]) for k in CATIMA_COLUMNS))
        links += [(i, g) for g in c.get('categories', [])]
        if c.get('hasFront'):
            files.append(('card_%d_front.png' % i, png))
        if c.get('hasBack'):
            files.append(('card_%d_back.png' % i, png))
    lines += ['', 'cardId,groupId'] + ['%d,%s' % (i, csv_field(g)) for i, g in links]
    text = '\r\n'.join(lines) + '\r\n'
    return zip_bytes([('catima.csv', text.encode('utf-8'))] + files)


SNAKE = {'name': 'name', 'number': 'number', 'codeValue': 'code_value', 'format': 'format', 'color': 'color',
         'tile': 'tile', 'chainId': 'chain_id', 'note': 'note', 'balance': 'balance', 'currency': 'balance_currency',
         'validFrom': 'valid_from', 'expiry': 'expiry', 'favourite': 'favourite', 'archived': 'archived',
         'useCount': 'use_count', 'lastUsedAt': 'last_used_at', 'sortIndex': 'sort_index'}


def backup_write(cards, jpg=b''):
    """Reference backup writer with SQL column names (README ambiguity A9)."""
    out_cards, cats, links, files = [], {}, [], []
    for i, c in enumerate(cards, 1):
        cid = 'card-%04d' % i
        row = {'id': cid, 'created_at': 1760572800000, 'updated_at': 1760572800000}
        for k, col in SNAKE.items():
            v = c.get(k)
            if k == 'codeValue':
                v = '' if (v is None or v == c['number']) else v
            if k in ('favourite', 'archived'):
                v = 1 if v else 0
            if v is None and k in ('tile',):
                v = 'initials'
            if v is None and k in ('note', 'balance', 'currency'):
                v = ''
            if v is None and k in ('useCount', 'sortIndex'):
                v = 0
            row[col] = v
        row['has_front'] = 1 if c.get('hasFront') else 0
        row['has_back'] = 1 if c.get('hasBack') else 0
        out_cards.append(row)
        for g in c.get('categories', []):
            gid = cats.setdefault(g, 'cat-%02d' % (len(cats) + 1))
            links.append({'card_id': cid, 'category_id': gid})
        if c.get('hasFront'):
            files.append(('cards/%s/front.jpg' % cid, jpg))
        if c.get('hasBack'):
            files.append(('cards/%s/back.jpg' % cid, jpg))
    doc = {'version': 1, 'exportedAt': 1760572800000, 'cards': out_cards,
           'categories': [{'id': gid, 'name': g, 'sort_index': n, 'created_at': 1760572800000}
                          for n, (g, gid) in enumerate(cats.items())],
           'links': links}
    return zip_bytes([('backup.json', json.dumps(doc, ensure_ascii=False, indent=1).encode('utf-8'))] + files)


if __name__ == '__main__':
    import sys
    if sys.argv[1:] == ['batch']:
        # A1 cross-check: stdin JSON lines {"format": ..., "value": ...} -> stdout the oracle's verdict per line
        for line in sys.stdin:
            if line.strip():
                q = json.loads(line)
                print(json.dumps(dict(q, oracle=validate(q['format'], q['value'])), ensure_ascii=False))
        sys.exit(0)
    if len(sys.argv) == 3:
        print(json.dumps(validate(sys.argv[1], sys.argv[2]), ensure_ascii=False))
    else:
        print(__doc__)
