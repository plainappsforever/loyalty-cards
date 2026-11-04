#!/usr/bin/env python3 -I
"""Reference renderer for the blind-set author's OWN probes (stdlib only). NOT the engine, NOT evidence.

Encodes EAN-13, EAN-8, UPC-A, UPC-E, ITF, Codabar, Code 39, Code 93 and Code 128 from the public
symbology tables into a module string ('1' = bar) and writes 8-bit greyscale PNGs at an integer module
width with a quiet zone, at full contrast (0/255) or the SPEC §13 dim proxy (#333 on #bbb = 51/187).
Purpose: observe how macOS Vision REPORTS each symbology (payload conventions) on symbols whose content
is known with certainty, so that render-cases.json carries the right `expectDecoded`.

Provenance: written by the first (cut-off) B1 author; reviewed and kept by the second. One bug found by the
self-test and fixed 2026-10-16: the Codabar pattern for '9' was 1010000 (correct: 1001000, the ISO/ZXing table);
with the wrong pattern Vision read one symbol as EAN-13 5511466239200 (convention C24 in selftest.py).

Usage: refrender.py <fmt> <value> <out.png> [module_px=3] [contrast=full|dim] [height_modules]
"""
import struct
import sys
import zlib

# ---- EAN/UPC --------------------------------------------------------------------------------------------------
L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
R = [''.join('1' if c == '0' else '0' for c in p) for p in L]
G = [p[::-1] for p in R]   # G = R reversed (NOT L reversed)
EAN13_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']
# UPC-E parity for number system 0, indexed by check digit (E = even = G pattern, O = odd = L pattern)
UPCE_PARITY_NS0 = ['EEEOOO', 'EEOEOO', 'EEOOEO', 'EEOOOE', 'EOEEOO', 'EOOEEO', 'EOOOEE', 'EOEOEO', 'EOEOOE', 'EOOEOE']


def enc_ean13(v):
    assert len(v) == 13 and v.isdigit()
    par = EAN13_PARITY[int(v[0])]
    s = '101'
    for i, ch in enumerate(v[1:7]):
        s += (L if par[i] == 'L' else G)[int(ch)]
    s += '01010'
    for ch in v[7:13]:
        s += R[int(ch)]
    return s + '101', 11, 7


def enc_ean8(v):
    assert len(v) == 8 and v.isdigit()
    s = '101' + ''.join(L[int(c)] for c in v[:4]) + '01010' + ''.join(R[int(c)] for c in v[4:]) + '101'
    return s, 7, 7


def enc_upca(v):
    assert len(v) == 12 and v.isdigit()
    s = '101' + ''.join(L[int(c)] for c in v[:6]) + '01010' + ''.join(R[int(c)] for c in v[6:]) + '101'
    return s, 9, 9


def enc_upce(v):
    assert len(v) == 8 and v.isdigit() and v[0] in '01'
    par = UPCE_PARITY_NS0[int(v[7])]
    if v[0] == '1':
        par = ''.join('E' if c == 'O' else 'O' for c in par)
    s = '101'
    for i, ch in enumerate(v[1:7]):
        s += (G if par[i] == 'E' else L)[int(ch)]
    return s + '010101', 9, 7


# ---- ITF ------------------------------------------------------------------------------------------------------
ITF = ['NNWWN', 'WNNNW', 'NWNNW', 'WWNNN', 'NNWNW', 'WNWNN', 'NWWNN', 'NNNWW', 'WNNWN', 'NWNWN']
WIDE = 3


def enc_itf(v):
    assert len(v) % 2 == 0 and v.isdigit()
    s = '1010'
    for i in range(0, len(v), 2):
        a, b = ITF[int(v[i])], ITF[int(v[i + 1])]
        for j in range(5):
            s += '1' * (WIDE if a[j] == 'W' else 1)
            s += '0' * (WIDE if b[j] == 'W' else 1)
    s += '1' * WIDE + '0' + '1'
    return s, 10, 10


# ---- Codabar (7 elements b s b s b s b, 1 = wide) --------------------------------------------------------------
CODABAR = {'0': '0000011', '1': '0000110', '2': '0001001', '3': '1100000', '4': '0010010', '5': '1000010',
           '6': '0100001', '7': '0100100', '8': '0110000', '9': '1001000', '-': '0001100', '$': '0011000',
           ':': '1000101', '/': '1010001', '.': '1010100', '+': '0010101',
           'A': '0011010', 'B': '0101001', 'C': '0001011', 'D': '0001110'}


def enc_codabar(v):
    """v must include start and stop letters, e.g. 'A1234B'."""
    s = ''
    for i, ch in enumerate(v):
        pat = CODABAR[ch]
        for j in range(7):
            w = WIDE if pat[j] == '1' else 1
            s += ('1' if j % 2 == 0 else '0') * w
        if i < len(v) - 1:
            s += '0'
    return s, 10, 10


# ---- Code 39 (9 elements b s b s b s b s b, 1 = wide; 3 wide per char) --------------------------------------------
CODE39 = {'0': 0x034, '1': 0x121, '2': 0x061, '3': 0x160, '4': 0x031, '5': 0x130, '6': 0x070, '7': 0x025, '8': 0x124,
          '9': 0x064, 'A': 0x109, 'B': 0x049, 'C': 0x148, 'D': 0x019, 'E': 0x118, 'F': 0x058, 'G': 0x00D, 'H': 0x10C,
          'I': 0x04C, 'J': 0x01C, 'K': 0x103, 'L': 0x043, 'M': 0x142, 'N': 0x013, 'O': 0x112, 'P': 0x052, 'Q': 0x007,
          'R': 0x106, 'S': 0x046, 'T': 0x016, 'U': 0x181, 'V': 0x0C1, 'W': 0x1C0, 'X': 0x091, 'Y': 0x190, 'Z': 0x0D0,
          '-': 0x085, '.': 0x184, ' ': 0x0C4, '$': 0x0A8, '/': 0x0A2, '+': 0x08A, '%': 0x02A, '*': 0x094}


def enc_code39(v, check=False):
    chars = '*' + v + (code39_check_char(v) if check else '') + '*'
    s = ''
    for i, ch in enumerate(chars):
        pat = CODE39[ch]
        for j in range(9):
            wide = (pat >> (8 - j)) & 1
            s += ('1' if j % 2 == 0 else '0') * (WIDE if wide else 1)
        if i < len(chars) - 1:
            s += '0'
    return s, 10, 10


CODE39_ORDER = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%'


def code39_check_char(v):
    return CODE39_ORDER[sum(CODE39_ORDER.index(c) for c in v) % 43]


# ---- Code 93 (9 modules per char, 1 = bar) -----------------------------------------------------------------------
CODE93_ORDER = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%abcd*'
CODE93 = [0x114, 0x148, 0x144, 0x142, 0x128, 0x124, 0x122, 0x150, 0x112, 0x10A,
          0x1A8, 0x1A4, 0x1A2, 0x194, 0x192, 0x18A, 0x168, 0x164, 0x162, 0x134, 0x11A, 0x158, 0x14C, 0x146, 0x12C,
          0x116, 0x1B4, 0x1B2, 0x1AC, 0x1A6, 0x196, 0x19A, 0x16C, 0x166, 0x136, 0x13A,
          0x12E, 0x1D4, 0x1D2, 0x1CA, 0x16E, 0x176, 0x1AE, 0x126, 0x1DA, 0x1D6, 0x132, 0x15E]


def code93_checks(v):
    vals = [CODE93_ORDER.index(c) for c in v]
    c = sum(val * ((len(vals) - i - 1) % 20 + 1) for i, val in enumerate(vals)) % 47
    vals2 = vals + [c]
    k = sum(val * ((len(vals2) - i - 1) % 15 + 1) for i, val in enumerate(vals2)) % 47
    return CODE93_ORDER[c] + CODE93_ORDER[k]


def enc_code93(v):
    chars = '*' + v + code93_checks(v) + '*'
    s = ''
    for ch in chars:
        pat = CODE93[CODE93_ORDER.index(ch)]
        s += format(pat, '09b')
    return s + '1', 10, 10


# ---- Code 128 (widths b s b s b s) -------------------------------------------------------------------------------
CODE128 = [
    [2, 1, 2, 2, 2, 2], [2, 2, 2, 1, 2, 2], [2, 2, 2, 2, 2, 1], [1, 2, 1, 2, 2, 3], [1, 2, 1, 3, 2, 2], [1, 3, 1, 2, 2, 2],
    [1, 2, 2, 2, 1, 3], [1, 2, 2, 3, 1, 2], [1, 3, 2, 2, 1, 2], [2, 2, 1, 2, 1, 3], [2, 2, 1, 3, 1, 2], [2, 3, 1, 2, 1, 2],
    [1, 1, 2, 2, 3, 2], [1, 2, 2, 1, 3, 2], [1, 2, 2, 2, 3, 1], [1, 1, 3, 2, 2, 2], [1, 2, 3, 1, 2, 2], [1, 2, 3, 2, 2, 1],
    [2, 2, 3, 2, 1, 1], [2, 2, 1, 1, 3, 2], [2, 2, 1, 2, 3, 1], [2, 1, 3, 2, 1, 2], [2, 2, 3, 1, 1, 2], [3, 1, 2, 1, 3, 1],
    [3, 1, 1, 2, 2, 2], [3, 2, 1, 1, 2, 2], [3, 2, 1, 2, 2, 1], [3, 1, 2, 2, 1, 2], [3, 2, 2, 1, 1, 2], [3, 2, 2, 2, 1, 1],
    [2, 1, 2, 1, 2, 3], [2, 1, 2, 3, 2, 1], [2, 3, 2, 1, 2, 1], [1, 1, 1, 3, 2, 3], [1, 3, 1, 1, 2, 3], [1, 3, 1, 3, 2, 1],
    [1, 1, 2, 3, 1, 3], [1, 3, 2, 1, 1, 3], [1, 3, 2, 3, 1, 1], [2, 1, 1, 3, 1, 3], [2, 3, 1, 1, 1, 3], [2, 3, 1, 3, 1, 1],
    [1, 1, 2, 1, 3, 3], [1, 1, 2, 3, 3, 1], [1, 3, 2, 1, 3, 1], [1, 1, 3, 1, 2, 3], [1, 1, 3, 3, 2, 1], [1, 3, 3, 1, 2, 1],
    [3, 1, 3, 1, 2, 1], [2, 1, 1, 3, 3, 1], [2, 3, 1, 1, 3, 1], [2, 1, 3, 1, 1, 3], [2, 1, 3, 3, 1, 1], [2, 1, 3, 1, 3, 1],
    [3, 1, 1, 1, 2, 3], [3, 1, 1, 3, 2, 1], [3, 3, 1, 1, 2, 1], [3, 1, 2, 1, 1, 3], [3, 1, 2, 3, 1, 1], [3, 3, 2, 1, 1, 1],
    [3, 1, 4, 1, 1, 1], [2, 2, 1, 4, 1, 1], [4, 3, 1, 1, 1, 1], [1, 1, 1, 2, 2, 4], [1, 1, 1, 4, 2, 2], [1, 2, 1, 1, 2, 4],
    [1, 2, 1, 4, 2, 1], [1, 4, 1, 1, 2, 2], [1, 4, 1, 2, 2, 1], [1, 1, 2, 2, 1, 4], [1, 1, 2, 4, 1, 2], [1, 2, 2, 1, 1, 4],
    [1, 2, 2, 4, 1, 1], [1, 4, 2, 1, 1, 2], [1, 4, 2, 2, 1, 1], [2, 4, 1, 2, 1, 1], [2, 2, 1, 1, 1, 4], [4, 1, 3, 1, 1, 1],
    [2, 4, 1, 1, 1, 2], [1, 3, 4, 1, 1, 1], [1, 1, 1, 2, 4, 2], [1, 2, 1, 1, 4, 2], [1, 2, 1, 2, 4, 1], [1, 1, 4, 2, 1, 2],
    [1, 2, 4, 1, 1, 2], [1, 2, 4, 2, 1, 1], [4, 1, 1, 2, 1, 2], [4, 2, 1, 1, 1, 2], [4, 2, 1, 2, 1, 1], [2, 1, 2, 1, 4, 1],
    [2, 1, 4, 1, 2, 1], [4, 1, 2, 1, 2, 1], [1, 1, 1, 1, 4, 3], [1, 1, 1, 3, 4, 1], [1, 3, 1, 1, 4, 1], [1, 1, 4, 1, 1, 3],
    [1, 1, 4, 3, 1, 1], [4, 1, 1, 1, 1, 3], [4, 1, 1, 3, 1, 1], [1, 1, 3, 1, 4, 1], [1, 1, 4, 1, 3, 1], [3, 1, 1, 1, 4, 1],
    [4, 1, 1, 1, 3, 1], [2, 1, 1, 4, 1, 2], [2, 1, 1, 2, 1, 4], [2, 1, 1, 2, 3, 2], [2, 3, 3, 1, 1, 1, 2]]
assert all(sum(p) == 11 for p in CODE128[:106]) and sum(CODE128[106]) == 13
START_B, START_C, CODE_B, CODE_C, STOP = 104, 105, 100, 99, 106


def enc_code128(v, mode='B'):
    """Naive subset-B encoding (digit runs of 4+ are NOT switched to C unless mode='C-runs'); for probes only."""
    assert all(32 <= ord(c) <= 126 for c in v)
    codes = [START_B]
    i = 0
    in_c = False
    if mode == 'C-runs':
        while i < len(v):
            run = 0
            while i + run < len(v) and v[i + run].isdigit():
                run += 1
            if run >= 4:
                run -= run % 2
                if not in_c:
                    codes.append(CODE_C)
                    in_c = True
                for j in range(0, run, 2):
                    codes.append(int(v[i + j:i + j + 2]))
                i += run
            else:
                if in_c:
                    codes.append(CODE_B)
                    in_c = False
                codes.append(ord(v[i]) - 32)
                i += 1
    else:
        codes += [ord(c) - 32 for c in v]
    chk = codes[0] + sum(c * (k + 1) for k, c in enumerate(codes[1:]))
    codes.append(chk % 103)
    codes.append(STOP)
    s = ''
    for c in codes:
        for j, w in enumerate(CODE128[c]):
            s += ('1' if j % 2 == 0 else '0') * w
    return s, 10, 10


ENCODERS = {'ean13': enc_ean13, 'ean8': enc_ean8, 'upca': enc_upca, 'upce': enc_upce, 'itf': enc_itf,
            'codabar': enc_codabar, 'code39': enc_code39, 'code93': enc_code93, 'code128': enc_code128}


# ---- PNG --------------------------------------------------------------------------------------------------------
def write_png_gray(path, width, height, rows):
    """rows: list of bytes objects, one per row, each `width` bytes (0 = black)."""
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
    raw = b''.join(b'\x00' + r for r in rows)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 0, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


def render_1d(fmt, value, path, module_px=3, contrast='full', height_modules=None):
    bits, qz_l, qz_r = ENCODERS[fmt](value)
    dark, light = (0, 255) if contrast == 'full' else (0x33, 0xBB)
    mods = '0' * qz_l + bits + '0' * qz_r
    width = len(mods) * module_px
    if height_modules is None:
        height_modules = max(25, len(mods) // 4)
    row = bytes((dark if m == '1' else light) for m in mods for _ in range(module_px))
    rows = [bytes([light]) * width] * (10 * module_px) + [row] * (height_modules * module_px) + \
           [bytes([light]) * width] * (10 * module_px)
    write_png_gray(path, width, len(rows), rows)
    return len(mods)


if __name__ == '__main__':
    a = sys.argv[1:]
    if len(a) < 3:
        print(__doc__)
        sys.exit(2)
    fmt, value, out = a[0], a[1], a[2]
    mpx = int(a[3]) if len(a) > 3 else 3
    con = a[4] if len(a) > 4 else 'full'
    hm = int(a[5]) if len(a) > 5 else None
    print(render_1d(fmt, value, out, mpx, con, hm), 'modules')
