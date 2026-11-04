#!/usr/bin/env python3 -I
"""Minimal Data Matrix ECC200 encoder (stdlib only) for the blind-set author's OWN Vision probes.
NOT the engine, NOT evidence. ASCII encodation with digit pairs, upper shift (235) for bytes > 127, optional ECI
(241 + ECI+1), square single-region symbols 10x10 .. 26x26, Reed-Solomon GF(256)/0x12D, ISO 16022 Annex F
placement. Written from the public standard's algorithm description.

Usage: dmprobe.py <text|@file> <out.png> [module_px=4] [full|dim] [utf8|latin1] [eci]
"""
import sys
import struct
import zlib

SIZES = [(10, 3, 5), (12, 5, 7), (14, 8, 10), (16, 12, 12), (18, 18, 14), (20, 22, 18), (22, 30, 20),
         (24, 36, 24), (26, 44, 28)]

EXP = [0] * 512
LOG = [0] * 256
_x = 1
for _i in range(255):
    EXP[_i] = _x
    LOG[_x] = _i
    _x <<= 1
    if _x & 0x100:
        _x ^= 0x12D
for _i in range(255, 512):
    EXP[_i] = EXP[_i - 255]


def gmul(a, b):
    return 0 if a == 0 or b == 0 else EXP[LOG[a] + LOG[b]]


def rs(data, n):
    g = [1]
    for i in range(1, n + 1):
        ng = [0] * (len(g) + 1)
        for j, c in enumerate(g):
            ng[j] ^= c
            ng[j + 1] ^= gmul(c, EXP[i])
        g = ng
    rem = [0] * n
    for d in data:
        f = d ^ rem[0]
        rem = rem[1:] + [0]
        for j in range(n):
            rem[j] ^= gmul(f, g[j + 1])
    return rem


def encode_ascii(b, eci=None):
    cw = []
    if eci is not None:
        cw += [241, eci + 1]
    i = 0
    while i < len(b):
        if i + 1 < len(b) and 48 <= b[i] <= 57 and 48 <= b[i + 1] <= 57:
            cw.append(130 + (b[i] - 48) * 10 + (b[i + 1] - 48))
            i += 2
        elif b[i] < 128:
            cw.append(b[i] + 1)
            i += 1
        else:
            cw += [235, b[i] - 127]
            i += 1
    return cw


def place(nrow, ncol):
    a = [[None] * ncol for _ in range(nrow)]

    def module(r, c, ch, bit):
        if r < 0:
            r += nrow
            c += 4 - ((nrow + 4) % 8)
        if c < 0:
            c += ncol
            r += 4 - ((ncol + 4) % 8)
        a[r][c] = (ch, bit)

    def utah(r, c, ch):
        for dr, dc, bit in ((-2, -2, 1), (-2, -1, 2), (-1, -2, 3), (-1, -1, 4), (-1, 0, 5), (0, -2, 6), (0, -1, 7),
                            (0, 0, 8)):
            module(r + dr, c + dc, ch, bit)

    def corner(ch, pts):
        for bit, (r, c) in enumerate(pts, 1):
            module(r, c, ch, bit)

    ch, row, col = 1, 4, 0
    while True:
        if row == nrow and col == 0:
            corner(ch, [(nrow - 1, 0), (nrow - 1, 1), (nrow - 1, 2), (0, ncol - 2), (0, ncol - 1), (1, ncol - 1),
                        (2, ncol - 1), (3, ncol - 1)]); ch += 1
        if row == nrow - 2 and col == 0 and ncol % 4:
            corner(ch, [(nrow - 3, 0), (nrow - 2, 0), (nrow - 1, 0), (0, ncol - 4), (0, ncol - 3), (0, ncol - 2),
                        (0, ncol - 1), (1, ncol - 1)]); ch += 1
        if row == nrow - 2 and col == 0 and ncol % 8 == 4:
            corner(ch, [(nrow - 3, 0), (nrow - 2, 0), (nrow - 1, 0), (0, ncol - 2), (0, ncol - 1), (1, ncol - 1),
                        (2, ncol - 1), (3, ncol - 1)]); ch += 1
        if row == nrow + 4 and col == 2 and not ncol % 8:
            corner(ch, [(nrow - 1, 0), (nrow - 1, ncol - 1), (0, ncol - 3), (0, ncol - 2), (0, ncol - 1),
                        (1, ncol - 3), (1, ncol - 2), (1, ncol - 1)]); ch += 1
        while True:
            if row < nrow and col >= 0 and a[row][col] is None:
                utah(row, col, ch); ch += 1
            row -= 2; col += 2
            if not (row >= 0 and col < ncol):
                break
        row += 1; col += 3
        while True:
            if row >= 0 and col < ncol and a[row][col] is None:
                utah(row, col, ch); ch += 1
            row += 2; col -= 2
            if not (row < nrow and col >= 0):
                break
        row += 3; col += 1
        if not (row < nrow or col < ncol):
            break
    if a[nrow - 1][ncol - 1] is None:
        a[nrow - 1][ncol - 1] = a[nrow - 2][ncol - 2] = 'on'
        a[nrow - 1][ncol - 2] = a[nrow - 2][ncol - 1] = 'off'
    return a


def symbol(data_bytes, eci=None):
    cw = encode_ascii(data_bytes, eci)
    for size, nd, ne in SIZES:
        if len(cw) <= nd:
            break
    else:
        raise ValueError('too long for a single-region probe symbol')
    pads = []
    for pos in range(len(cw) + 1, nd + 1):
        if pos == len(cw) + 1:
            pads.append(129)
        else:
            p = 129 + ((149 * pos) % 253) + 1
            pads.append(p - 254 if p > 254 else p)
    cw = cw + pads
    allcw = cw + rs(cw, ne)
    n = size - 2
    m = place(n, n)
    grid = [[0] * size for _ in range(size)]
    for r in range(size):
        grid[r][0] = 1
        grid[size - 1][r] = 1
    for c in range(size):
        grid[0][c] = 1 if c % 2 == 0 else 0
    for r in range(size):
        grid[r][size - 1] = 1 if r % 2 == 1 else 0
    for r in range(n):
        for c in range(n):
            v = m[r][c]
            if v == 'on':
                bit = 1
            elif v == 'off' or v is None:
                bit = 0
            else:
                ch, b = v
                bit = (allcw[ch - 1] >> (8 - b)) & 1
            grid[r + 1][c + 1] = bit
    return grid


def write_png(path, grid, mpx=4, contrast='full', quiet=4):
    dark, light = (0, 255) if contrast == 'full' else (0x33, 0xBB)
    size = len(grid) + 2 * quiet
    w = size * mpx
    rows = []
    for r in range(size):
        gr = r - quiet
        row = bytes((dark if 0 <= gr < len(grid) and 0 <= c - quiet < len(grid) and grid[gr][c - quiet] else light)
                    for c in range(size) for _ in range(mpx))
        rows += [row] * mpx

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
    raw = b''.join(b'\x00' + r for r in rows)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, w, 8, 0, 0, 0, 0)) +
                chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


if __name__ == '__main__':
    a = sys.argv[1:]
    if len(a) < 2:
        print(__doc__)
        sys.exit(2)
    text = a[0]
    if text.startswith('@'):
        with open(text[1:], encoding='utf-8') as f:
            text = f.read()
    mpx = int(a[2]) if len(a) > 2 else 4
    con = a[3] if len(a) > 3 else 'full'
    enc = a[4] if len(a) > 4 else 'utf8'
    eci = 26 if (len(a) > 5 and a[5] == 'eci') else None
    b = text.encode('utf-8' if enc == 'utf8' else 'latin-1')
    if eci is not None and enc == 'latin1':
        eci = 3
    write_png(a[1], symbol(b, eci), mpx, con)
