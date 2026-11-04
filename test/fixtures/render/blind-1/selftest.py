#!/usr/bin/env python3 -I
"""Self-test of the B1 blind set (stdlib only). Proves that the set, the oracle and the scorer agree and that the
scorer catches wrong answers. Writes only into WORKDIR (default: a new temp folder).

  python3 -I -B selftest.py [--workdir DIR]
  python3 -I -B selftest.py --vision DECODE_BIN PROBE_BIN [--workdir DIR]
      additionally renders the render set with the author's OWN encoders (refrender.py for 1D, CoreImage via
      probe.swift for QR/Aztec/PDF417, dmprobe.py for Data Matrix) and decodes them with Vision (decode.swift),
      proving the expectDecoded conventions on symbols whose content is known (README section 3).
"""
import copy
import hashlib
import importlib.util
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import zipfile
from collections import Counter

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))


def load_module(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, name + '.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


O, SC = load_module('oracle'), load_module('score')
FAIL = []


def check(cond, msg):
    if not cond:
        FAIL.append(msg)
    return cond


def fixture(rel):
    with open(os.path.join(HERE, rel), 'rb') as f:
        return f.read()


PNG_STUB = b'\x89PNG\r\n\x1a\n'
JPG = fixture('fixtures/images/tiny.jpg')


def apply_tamper(zbytes, ops):
    z = zipfile.ZipFile(io.BytesIO(zbytes))
    files = {n: z.read(n) for n in z.namelist()}
    doc = json.loads(files['backup.json'])
    for op in ops:
        if op['op'] == 'set-top':
            doc[op['key']] = op['value']
        elif op['op'] == 'set-card':
            doc['cards'][op['index']][op['column']] = op['value']
        elif op['op'] == 'delete-file':
            files.pop(op['path'], None)
    if 'backup.json' in files:
        files['backup.json'] = json.dumps(doc, ensure_ascii=False).encode('utf-8')
    return O.zip_bytes(list(files.items()))


def oracle_answer(c, work):
    k, i = c['kind'], c['input']
    if k == 'validate':
        r = O.validate(i['format'], i['value'])
        return {kk: r.get(kk) for kk in ('ok', 'normalised', 'reason', 'suggestedCheck', 'leadingZeroSuggestion',
                                         'uppercased') if kk in r}
    if k == 'suggest':
        return {'formats': O.suggest(i['value'], i.get('hint'))}
    if k == 'upce-expand':
        return {'upca': O.upce_expand(i['upce'])}
    if k == 'color-to-hex':
        return {'hex': O.argb_to_hex(i['argb'])}
    if k == 'color-to-int':
        return {'int': O.hex_to_argb(i['hex'])}
    if k == 'catima-share-parse':
        return O.catima_share_parse(i['url'])
    if k == 'catima-share-make':
        return {'url': O.catima_share_make(i['card'])}
    if k == 'lc1-parse':
        return O.lc1_parse(i['text'])
    if k == 'lc1-make':
        return O.lc1_make(i['card'])
    if k in ('catima-import', 'csv-import', 'backup-import'):
        fn = {'catima-import': O.catima_read, 'csv-import': O.generic_csv_read, 'backup-import': O.backup_read}[k]
        return fn(fixture(i['file']), i.get('existing', []), i.get('duplicateRule', 'skip'))
    if k == 'catima-export':
        name = c['id'] + '.zip'
        with open(os.path.join(work, name), 'wb') as f:
            f.write(O.catima_write(i['cards'], PNG_STUB))
        return {'zip': name}
    if k == 'backup-roundtrip':
        name = c['id'] + '.zip'
        data = O.backup_write(i['cards'], JPG)
        with open(os.path.join(work, name), 'wb') as f:
            f.write(data)
        return {'zip': name, 'readBack': O.backup_read(data)}
    if k == 'backup-tamper':
        return O.backup_read(apply_tamper(O.backup_write(i['cards'], JPG), i['tamper']))
    raise ValueError(k)


def mutate(c, a, work):
    """A plausible wrong engine answer for case c (the scorer must reject it)."""
    k, e = c['kind'], c['expect']
    a = copy.deepcopy(a)
    if k == 'validate':
        a['ok'] = not a['ok']
    elif k == 'suggest':
        f = a['formats']
        if 'first' in e:
            a['formats'] = [x for x in f if x != e['first']] + [e['first']]
        elif e.get('excludes'):
            a['formats'] = f + [e['excludes'][0]]
        else:
            a['formats'] = [x for x in f if x != e['includes'][0]]
    elif k == 'upce-expand':
        a['upca'] = a['upca'][:-1] + str((int(a['upca'][-1]) + 1) % 10)
    elif k == 'color-to-hex':
        a['hex'] = '#%06x' % ((int(a['hex'][1:], 16) + 1) & 0xFFFFFF)
    elif k == 'color-to-int':
        a['int'] = a['int'] + 1
    elif k in ('catima-share-parse', 'lc1-parse'):
        a = {'ok': not a['ok'], 'card': a.get('card')}
    elif k == 'catima-share-make':
        a['url'] = a['url'].replace('#', '?', 1)
    elif k == 'lc1-make':
        if e['truncated']:
            a['truncated'] = False
        else:
            a['text'] = a['text'].replace('"n":"', '"n":"X', 1)
    elif k in ('catima-import', 'csv-import', 'backup-import', 'backup-tamper'):
        a['imported'] = a['imported'] + 1
    elif k == 'catima-export':
        cards = copy.deepcopy(c['input']['cards'])
        cards[0]['name'] += ' (changed)'
        name = c['id'] + '-mut.zip'
        with open(os.path.join(work, name), 'wb') as f:
            f.write(O.catima_write(cards, PNG_STUB))
        a['zip'] = name
    elif k == 'backup-roundtrip':
        rb = a['readBack']
        rb['cards'][0]['useCount'] = rb['cards'][0]['useCount'] + 1
    return a


def check_hashes():
    readme = os.path.join(HERE, 'README.md')
    if not os.path.exists(readme):
        check(False, 'README.md missing')
        return
    listed = {}
    for line in open(readme, encoding='utf-8'):
        m = re.fullmatch(r'([0-9a-f]{64})  (\S+)\n?', line)
        if m:
            listed[m.group(2)] = m.group(1)
    actual = set()
    for root, dirs, files in os.walk(HERE):
        dirs[:] = [d for d in dirs if d != '__pycache__']
        for fn in files:
            rel = os.path.relpath(os.path.join(root, fn), HERE)
            if rel != 'README.md' and not fn.startswith('.'):
                actual.add(rel)
    check(set(listed) == actual, 'README hash list != files: missing %s extra %s' % (sorted(actual - set(listed)),
                                                                                   sorted(set(listed) - actual)))
    for rel, h in listed.items():
        if rel in actual:
            check(hashlib.sha256(fixture(rel)).hexdigest() == h, 'hash mismatch ' + rel)


def structural(cases, render):
    ids = [c['id'] for c in cases] + [r['id'] for r in render]
    check(len(ids) == len(set(ids)), 'duplicate ids')
    check(100 <= len(cases) <= 200, '%d cases (100-200 required)' % len(cases))
    check(sum(1 for c in cases if c.get('adversarial')) >= 30, 'fewer than 30 adversarial cases')
    check(len(render) >= 300, 'render set < 300')
    per = Counter(r['format'] for r in render)
    check(set(per) == set(O.ONE_D + O.TWO_D) and min(per.values()) >= 20, 'render: every format >= 20 values %s' % per)
    for c in cases:
        check(c['strength'] in ('firm', 'inferred', 'ambiguous'), 'strength ' + c['id'])
        if 'file' in c['input']:
            check(os.path.exists(os.path.join(HERE, c['input']['file'])), 'fixture missing ' + c['input']['file'])
    for r in render:
        v = O.validate(r['format'], r['value'])
        check(v['ok'] and v['normalised'] == r['value'], 'render value not canonical/valid: %s %r' % (r['id'], v))
        check(v.get('capacity', 'fits') == 'fits', 'render value not surely encodable: ' + r['id'])
        exp, sym, pat = O.expect_decoded(r['format'], r['value'])
        check(exp == r['expectDecoded'] and sym == r['expectSymbology'] and pat == r.get('expectDecodedPattern'),
              'expectDecoded mismatch ' + r['id'])


def render_scoring(render, work):
    variants = [(px, con) for px in (2, 3, 4) for con in ('full', 'dim')]
    good, bad = [], []
    for n, r in enumerate(render):
        payload = r['expectDecoded'] if 'expectDecodedPattern' not in r else 'A' + r['value'] + 'B'
        for px, con in variants:
            fn = '/x/%s__m%d__%s.png' % (r['id'], px, con)
            good.append({'file': fn, 'results': [{'symbology': 'VNBarcodeSymbology' + r['expectSymbology'],
                                                  'payload': payload}]})
            if n % 50 == 0 and (px, con) == (3, 'full'):
                bad.append({'file': fn, 'results': [{'symbology': 'X', 'payload': payload + '1'}]})
            elif n % 50 == 1 and (px, con) == (3, 'full'):
                bad.append({'file': fn, 'results': []})
            else:
                bad.append(good[-1])
    for name, rows in (('good', good), ('bad', bad)):
        with open(os.path.join(work, name + '.jsonl'), 'w', encoding='utf-8') as f:
            f.write('\n'.join(json.dumps(x, ensure_ascii=False) for x in rows) + '\n')
    g = SC.score_render(os.path.join(work, 'good.jsonl'), quiet=True)
    check(g['total']['n'] == 6 * len(render) and g['total'].get('exact', 0) == 6 * len(render) and not g['gateFailures'],
          'synthetic perfect decode not scored 100%% exact: %s' % g['total'])
    b = SC.score_render(os.path.join(work, 'bad.jsonl'), quiet=True)
    nwrong = sum(1 for i in range(len(render)) if i % 50 == 0)
    nmiss = sum(1 for i in range(len(render)) if i % 50 == 1)
    check(len(b['different']) == nwrong and b['total'].get('missed', 0) == nmiss,
          'mutated decode not caught: %s' % b['total'])
    return len(render) * 6


def code128_png(rr, v, out, px, con):
    # own Code 128 with subset-C digit runs (keeps 80-digit values a sane width)
    bits, ql, qz = rr.enc_code128(v, 'C-runs')
    dark, light = (0, 255) if con == 'full' else (0x33, 0xBB)
    mods = '0' * ql + bits + '0' * qz
    w = len(mods) * px
    row = bytes((dark if m == '1' else light) for m in mods for _ in range(px))
    h = max(25, len(mods) // 4) * px
    rows = [bytes([light]) * w] * (10 * px) + [row] * h + [bytes([light]) * w] * (10 * px)
    rr.write_png_gray(out, w, len(rows), rows)


def vision(render, decode_bin, probe_bin, work):
    rr = load_module('refrender')
    dmx = load_module('dmprobe')
    jobs, skipped = [], []
    os.makedirs(os.path.join(work, 'png'), exist_ok=True)
    for r in render:
        f, v = r['format'], r['value']
        for px, con in ((3, 'full'), (3, 'dim'), (2, 'full')):
            out = os.path.join(work, 'png', '%s__m%d__%s.png' % (r['id'], px, con))
            try:
                if f == 'code128':
                    code128_png(rr, v, out, px, con)
                elif f in O.ONE_D:
                    vv = ('A' + v + 'B') if (f == 'codabar' and 'expectDecodedPattern' in r) else v
                    rr.render_1d(f, vv, out, px, con)
                elif f == 'datamatrix':
                    dmx.write_png(out, dmx.symbol(v.encode('utf-8'), None if v.isascii() else 26), max(px, 3), con)
                else:
                    if f != 'qr' and not v.isascii():
                        raise ValueError('CoreImage writes no ECI: non-ASCII %s not self-renderable' % f)
                    tf = os.path.join(work, 'png', r['id'] + '.txt')
                    with open(tf, 'w', encoding='utf-8') as fh:
                        fh.write(v)
                    p = subprocess.run([probe_bin, f, '@' + tf, out, str(max(px, 3)), con],
                                       capture_output=True, text=True)
                    if p.returncode != 0:
                        raise ValueError('CoreImage refused: ' + p.stderr.strip()[:60])
                jobs.append(out)
            except Exception as ex:
                skipped.append((r['id'], px, con, str(ex)[:70]))
                break
    lst = os.path.join(work, 'png-list.txt')
    with open(lst, 'w') as f:
        f.write('\n'.join(jobs) + '\n')
    dec = subprocess.run([decode_bin, '@' + lst], capture_output=True, text=True).stdout
    with open(os.path.join(work, 'self-decode.jsonl'), 'w', encoding='utf-8') as f:
        f.write(dec)
    res = SC.score_render(os.path.join(work, 'self-decode.jsonl'), quiet=False,
                          variants=[(3, 'full'), (3, 'dim'), (2, 'full')])
    rendered = {os.path.basename(j).split('__')[0] for j in jobs}
    print('\nself-rendered values: %d of %d (not self-renderable: %d)' % (len(rendered), len(render), len(skipped)))
    for s in skipped:
        print('  skipped %s %dpx %s: %s' % s)
    check(not res['different'], 'Vision decoded a self-rendered symbol as a DIFFERENT value: %s' % res['different'][:5])
    exact_ids = set()
    for line in dec.splitlines():
        d = json.loads(line)
        m = SC.NAME_RE.search(d['file'])
        if m and m.group('px') == '3' and m.group('con') == 'full':
            r = next(x for x in render if x['id'] == m.group('id'))
            if SC.classify(r, d['results'])[0].startswith('exact'):
                exact_ids.add(r['id'])
    not_exact = sorted(rendered - exact_ids)
    print('self-rendered at 3 px full but not decoded exactly: %s' % (not_exact or 'none'))
    return res, not_exact


# Vision conventions, each proven on a symbol the author rendered with his own encoder (README section 3).
# (id, how to render, expected Vision results as a sorted list of (symbology, payload))
CONVENTIONS = [
    ('C01 UPC-A is reported as EAN-13 with a leading 0', ('1d', 'upca', '036000291452'), [('EAN13', '0036000291452')]),
    ('C02 UPC-E is reported as UPC-E, 8 digits, NOT expanded', ('1d', 'upce', '04252614'), [('UPCE', '04252614')]),
    ('C03 twin 01234565 drawn as EAN-8 -> EAN8', ('1d', 'ean8', '01234565'), [('EAN8', '01234565')]),
    ('C04 twin 01234565 drawn as UPC-E -> UPCE', ('1d', 'upce', '01234565'), [('UPCE', '01234565')]),
    ('C05 ITF-14 (valid GS1 check) is reported as I2of5, leading zeros kept', ('1d', 'itf', '00012345678905'),
     [('I2of5', '00012345678905')]),
    ('C06 ITF with 2 digits is not read', ('1d', 'itf', '12'), []),
    ('C07 Codabar start/stop letters are INCLUDED in the payload', ('1d', 'codabar', 'C40156D'), [('Codabar', 'C40156D')]),
    ('C08 Codabar with a 1-character body is not read (D30)', ('1d', 'codabar', 'A0B'), []),
    ('C09 Code 39 mod-43 check character is NOT stripped', ('c39check', 'CODE39'), [('Code39', 'CODE39W')]),
    ('C10 Code 39 full-ASCII pairs come back literally', ('1d', 'code39', '+A$M%U'), [('Code39', '+A$M%U')]),
    ('C11 Code 93 check characters C/K are stripped', ('1d', 'code93', 'TEST93'), [('Code93', 'TEST93')]),
    ('C12 Code 128 keeps leading/trailing spaces', ('c128', ' ABC '), [('Code128', ' ABC ')]),
    ('C13 EAN-13 with a wrong check digit is not read', ('1d', 'ean13', '4006381333932'), []),
    ('C14 UPC-E with a wrong check digit is not read', ('1d', 'upce', '01234566'), []),
    ('C15 QR, UTF-8 bytes without ECI -> correct text', ('ci', 'qr', 'Müller ☃ 日本 🙂', 'utf8'),
     [('QR', 'Müller ☃ 日本 🙂')]),
    ('C16 QR, short UTF-8 "é" without ECI -> correct (no Shift-JIS guess)', ('ci', 'qr', 'é', 'utf8'), [('QR', 'é')]),
    ('C17 Aztec, UTF-8 bytes without ECI -> Latin-1 MOJIBAKE (D31 hazard)', ('ci', 'aztec', 'Müller', 'utf8'),
     [('Aztec', 'MÃ¼ller')]),
    ('C18 Aztec, Latin-1 bytes without ECI -> correct', ('ci', 'aztec', 'Müller ÄÖÜ ß', 'latin1'),
     [('Aztec', 'Müller ÄÖÜ ß')]),
    ('C19 PDF417, UTF-8 bytes without ECI -> Latin-1 MOJIBAKE', ('ci', 'pdf417', 'Müller', 'utf8'), [('PDF417', 'MÃ¼ller')]),
    ('C20 Data Matrix, UTF-8 bytes without ECI -> Latin-1 MOJIBAKE', ('dm', 'Müller ☃ 日本 🙂', 'utf8', None),
     [('DataMatrix', 'MÃ¼ller â\x98\x83 æ\x97¥æ\x9c¬ ð\x9f\x99\x82')]),
    ('C21 Data Matrix, UTF-8 with ECI 26 -> correct (D31 remedy)', ('dm', 'Müller ☃ 日本 🙂', 'utf8', 26),
     [('DataMatrix', 'Müller ☃ 日本 🙂')]),
    ('C22 Data Matrix, caret after non-ASCII with ECI 26 -> literal caret', ('dm', 'ü^065', 'utf8', 26),
     [('DataMatrix', 'ü^065')]),
    ('C23 dim contrast #333 on #bbb, 2 px modules: EAN-13 still read', ('1d2dim', 'ean13', '4006381333931'),
     [('EAN13', '4006381333931')]),
    ('C24 a MALFORMED Codabar (wrong pattern for 9) is reported as a valid EAN-13 of another value',
     ('badcodabar', 'C+49-30C'), [('EAN13', '5511466239200')]),
]


def conventions(decode_bin, probe_bin, work):
    rr = load_module('refrender')
    dmx = load_module('dmprobe')
    d = os.path.join(work, 'conv')
    os.makedirs(d, exist_ok=True)
    files = []
    for n, (title, how, _) in enumerate(CONVENTIONS):
        out = os.path.join(d, 'c%02d.png' % n)
        kind = how[0]
        if kind == '1d':
            rr.render_1d(how[1], how[2], out, 3, 'full')
        elif kind == '1d2dim':
            rr.render_1d(how[1], how[2], out, 2, 'dim')
        elif kind == 'c39check':
            bits = rr.enc_code39(how[1], check=True)[0]
            _bits_png(rr, bits, out)
        elif kind == 'c128':
            _bits_png(rr, rr.enc_code128(how[1])[0], out)
        elif kind == 'badcodabar':
            saved = rr.CODABAR['9']
            rr.CODABAR['9'] = '1010000'
            try:
                rr.render_1d('codabar', how[1], out, 3, 'full')
            finally:
                rr.CODABAR['9'] = saved
        elif kind == 'ci':
            tf = out + '.txt'
            with open(tf, 'w', encoding='utf-8') as fh:
                fh.write(how[2])
            args = [probe_bin, how[1], '@' + tf, out, '4', 'full'] + (['latin1'] if how[3] == 'latin1' else [])
            subprocess.run(args, capture_output=True, text=True, check=True)
        elif kind == 'dm':
            dmx.write_png(out, dmx.symbol(how[1].encode('utf-8' if how[2] == 'utf8' else 'latin-1'), how[3]), 4, 'full')
        files.append(out)
    dec = subprocess.run([decode_bin] + files, capture_output=True, text=True).stdout.splitlines()
    print('\nVision conventions on the author\'s own symbols:')
    for (title, how, expected), line in zip(CONVENTIONS, dec):
        got = sorted((r['symbology'].replace('VNBarcodeSymbology', ''), r['payload']) for r in json.loads(line)['results'])
        ok = got == sorted(expected)
        check(ok, 'convention %s: got %r' % (title, got))
        print('  %s  %s%s' % ('ok  ' if ok else 'FAIL', title, '' if ok else '   got %r' % got))


def _bits_png(rr, bits, out, px=3):
    mods = '0' * 10 + bits + '0' * 10
    w = len(mods) * px
    row = bytes((0 if m == '1' else 255) for m in mods for _ in range(px))
    rows = [bytes([255]) * w] * 30 + [row] * max(75, w // 4) + [bytes([255]) * w] * 30
    rr.write_png_gray(out, w, len(rows), rows)


def main():
    a = sys.argv[1:]
    work = a[a.index('--workdir') + 1] if '--workdir' in a else tempfile.mkdtemp(prefix='loyalty-b1-selftest-')
    os.makedirs(work, exist_ok=True)
    cases, render = SC.load('cases.json'), SC.load('render-cases.json')
    structural(cases, render)
    check_hashes()
    answers = {}
    for c in cases:
        if c['strength'] == 'ambiguous':
            continue
        try:
            answers[c['id']] = oracle_answer(c, work)
        except Exception as ex:
            check(False, 'oracle crashed on %s: %r' % (c['id'], ex))
    with open(os.path.join(work, 'oracle-answers.json'), 'w', encoding='utf-8') as f:
        json.dump({'engine': 'ORACLE (self-test)', 'answers': answers}, f, ensure_ascii=False, indent=1)
    res = SC.score_cases(os.path.join(work, 'oracle-answers.json'), quiet=True)
    for cid, st, lvl, pr in res['failures']:
        check(False, 'oracle disagrees with hand-written expectation %s: %s' % (cid, '; '.join(pr)[:400]))
    mutants = {c['id']: mutate(c, answers[c['id']], work) for c in cases if c['id'] in answers}
    with open(os.path.join(work, 'mutated-answers.json'), 'w', encoding='utf-8') as f:
        json.dump({'engine': 'MUTANT', 'answers': mutants}, f, ensure_ascii=False, indent=1)
    mres = SC.score_cases(os.path.join(work, 'mutated-answers.json'), quiet=True)
    caught = {cid for cid, st, lvl, pr in mres['failures'] if lvl == 'CORE'}
    uncaught = sorted(set(mutants) - caught)
    check(not uncaught, 'mutations NOT caught: %s' % uncaught)
    nvar = render_scoring(render, work)
    scored = len(answers)
    print('cases: %d (%d scored, %d ambiguous), adversarial %d; render values %d' % (
        len(cases), scored, len(cases) - scored, sum(1 for c in cases if c.get('adversarial')), len(render)))
    print('oracle vs hand-written expectations: %d/%d agree' % (scored - len(res['failures']), scored))
    print('mutations caught by the scorer: %d/%d' % (len(caught & set(mutants)), len(mutants)))
    print('synthetic render decodes scored: %d variants' % nvar)
    if '--vision' in a:
        i = a.index('--vision')
        vision(render, a[i + 1], a[i + 2], work)
        conventions(a[i + 1], a[i + 2], work)
    print('workdir:', work)
    if FAIL:
        print('\nSELFTEST FAIL (%d):' % len(FAIL))
        for msg in FAIL:
            print('  -', msg)
        sys.exit(1)
    print('\nSELFTEST PASS')


if __name__ == '__main__':
    main()
