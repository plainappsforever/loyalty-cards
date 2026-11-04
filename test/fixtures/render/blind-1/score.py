#!/usr/bin/env python3 -I
"""Scorer for the loyalty-cards blind set B1 (stdlib only; `python3 -I -B score.py ...`).

  score.py cases  <answers.json> [--json out.json]     score the engine's answers to cases.json
  score.py render <decode.jsonl> [--json out.json]     score Vision decodes of the engine's PNGs (A2)

answers.json = {"engine": "<commit>", "answers": {"<case id>": {...}}}; file paths inside answers are relative to the
answers file. decode.jsonl = one JSON object per PNG: {"file": ".../<case id>__m<2|3|4>__<full|dim>.png",
"results": [{"symbology": "...", "payload": "..."}]} (exactly what decode.swift prints). See README §4.
"""
import importlib.util
import json
import os
import re
import sys
import zipfile
from collections import defaultdict

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('oracle', os.path.join(HERE, 'oracle.py'))
O = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(O)


def load(name):
    with open(os.path.join(HERE, name), encoding='utf-8') as f:
        return json.load(f)['cases']


# ---------------------------------------------------------------------------------------------------- helpers
def eq(exp, act):
    if isinstance(exp, dict) and 'anyOf' in exp:
        return act in exp['anyOf']
    if isinstance(exp, list) and (act is None or isinstance(act, list)):
        return sorted(exp, key=str.lower) == sorted(act or [], key=str.lower)
    if isinstance(exp, bool):
        return act is exp or (type(act) is int and act == int(exp))
    if isinstance(act, bool):
        return False
    return exp == act


def card_problems(exp, act):
    out = []
    for k, v in exp.items():
        if k == 'noteContains':
            for sub in ([v] if isinstance(v, str) else v):
                if sub not in (act.get('note') or ''):
                    out.append('note lacks %r' % sub)
            continue
        if k not in act and v is not None:
            out.append('missing field %s' % k)
        elif k not in act:
            continue
        elif not eq(v, act[k]):
            out.append('%s: expected %r, got %r' % (k, v, act[k]))
    return out


def find_card(exp, cards):
    cands = [c for c in cards if c.get('name') == exp['name'] and c.get('number') == exp['number']]
    if len(cands) > 1 and 'format' in exp:
        cands = [c for c in cands if c.get('format') == exp['format']] or cands
    return cands[0] if cands else None


def import_problems(exp, ans):
    p = []
    if not isinstance(ans, dict):
        return ['no answer object']
    if 'refused' in exp and bool(ans.get('refused')) != exp['refused']:
        p.append('refused: expected %s, got %s' % (exp['refused'], ans.get('refused')))
    for k in ('imported', 'skipped', 'duplicates'):
        if k in exp and ans.get(k) != exp[k]:
            p.append('%s: expected %s, got %s' % (k, exp[k], ans.get(k)))
    if 'reasonClass' in exp:
        txt = ('%s %s' % (ans.get('reasonClass', ''), ans.get('reason', ''))).lower()
        if exp['reasonClass'] not in txt and not (exp['reasonClass'] == 'encrypted' and 'password' in txt):
            p.append('reason should say %s, got %r' % (exp['reasonClass'], txt.strip()))
    if 'categories' in exp and not eq(exp['categories'], ans.get('categories')):
        p.append('categories: expected %r, got %r' % (exp['categories'], ans.get('categories')))
    cards = ans.get('cards') or []
    for ec in exp.get('cards', []):
        ac = find_card(ec, cards)
        if ac is None:
            p.append('card %r / %r not imported' % (ec['name'], ec['number']))
        else:
            p += ['card %r: %s' % (ec['name'], x) for x in card_problems(ec, ac)]
    for nm in exp.get('absentNames', []):
        if any(c.get('name') == nm for c in cards):
            p.append('card named %r should have been skipped' % nm)
    return p


def has_lone_surrogate(s):
    return any(0xD800 <= ord(ch) <= 0xDFFF for ch in s)


# ---------------------------------------------------------------------------------------------------- per kind
def score_case(c, ans, base):
    """Returns (core_ok, strict_ok, problems)."""
    k, e, i = c['kind'], c['expect'], c['input']
    if ans is None:
        return False, False, ['no answer']
    if k == 'validate':
        p, strict = [], []
        if bool(ans.get('ok')) != e['ok']:
            p.append('ok: expected %s, got %s' % (e['ok'], ans.get('ok')))
        elif e['ok'] and ans.get('normalised') != e['normalised']:
            p.append('normalised: expected %r, got %r' % (e['normalised'], ans.get('normalised')))
        if not p:
            if not e['ok'] and ans.get('reason') != e['reason']:
                strict.append('reason: expected %s, got %s' % (e['reason'], ans.get('reason')))
            for key in ('suggestedCheck', 'leadingZeroSuggestion', 'uppercased'):
                if key in e and ans.get(key) != e[key]:
                    strict.append('%s: expected %r, got %r' % (key, e[key], ans.get(key)))
        return not p, not p and not strict, p + strict
    if k == 'suggest':
        f, p = ans.get('formats') or [], []
        if 'first' in e and (not f or f[0] != e['first']):
            p.append('first: expected %s, got %s' % (e['first'], f[:1]))
        p += ['missing %s' % x for x in e.get('includes', []) if x not in f]
        p += ['should not offer %s' % x for x in e.get('excludes', []) if x in f]
        for a, b in e.get('order', []):
            if a in f and b in f and f.index(a) > f.index(b):
                p.append('%s should rank before %s' % (a, b))
        return not p, not p, p
    if k == 'upce-expand':
        ok = ans.get('upca') == e['upca']
        return ok, ok, [] if ok else ['expected %s, got %s' % (e['upca'], ans.get('upca'))]
    if k == 'color-to-hex':
        ok = str(ans.get('hex', '')).lower() == e['hex']
        return ok, ok, [] if ok else ['expected %s, got %s' % (e['hex'], ans.get('hex'))]
    if k == 'color-to-int':
        ok = ans.get('int') == e['int']
        return ok, ok, [] if ok else ['expected %s, got %s' % (e['int'], ans.get('int'))]
    if k in ('catima-share-parse', 'lc1-parse'):
        p = []
        if bool(ans.get('ok')) != e['ok']:
            p.append('ok: expected %s, got %s' % (e['ok'], ans.get('ok')))
        elif e['ok']:
            p += card_problems(e['card'], ans.get('card') or {})
        return not p, not p, p
    if k == 'catima-share-make':
        url, p = ans.get('url') or '', []
        if not url.startswith('https://%s#' % e['host']):
            p.append('not the 2.0 fragment form on %s: %r' % (e['host'], url[:60]))
        r = O.catima_share_parse(url)
        if not r['ok']:
            p.append('oracle cannot parse the link')
        else:
            p += card_problems(e['card'], r['card'])
        return not p, not p, p
    if k == 'lc1-make':
        t, p = ans.get('text') or '', []
        n = len(t.encode('utf-8', 'surrogatepass'))
        if n > e['maxBytes']:
            p.append('payload %d bytes > %d' % (n, e['maxBytes']))
        r = O.lc1_parse(t)
        if not r['ok']:
            p.append('oracle rejects the payload')
            return False, False, p
        p += card_problems(e['card'], r['card'])
        note, orig = r['card'].get('note', ''), i['card'].get('note', '')
        if e['truncated']:
            if ans.get('truncated') is not True:
                p.append('truncation not reported')
            if not note.endswith('…') or not orig.startswith(note[:-1]):
                p.append('cut note must be a prefix of the original + "…"')
            if has_lone_surrogate(note):
                p.append('cut inside a surrogate pair (lone surrogate)')
        else:
            if note != orig:
                p.append('note changed although it fits')
            if ans.get('truncated'):
                p.append('reports truncation although none was needed')
        return not p, not p, p
    if k in ('catima-import', 'csv-import', 'backup-import', 'backup-tamper'):
        p = import_problems(e, ans)
        return not p, not p, p
    if k == 'catima-export':
        path = os.path.join(base, ans.get('zip') or '')
        try:
            data = open(path, 'rb').read()
            z = zipfile.ZipFile(path)
            first = z.read('catima.csv').decode('utf-8-sig').splitlines()[0]
        except Exception as ex:
            return False, False, ['cannot read export: %s' % ex]
        p = []
        if first != e['firstLine']:
            p.append('first line %r, expected %r' % (first, e['firstLine']))
        r = O.catima_read(data)
        p += import_problems({'refused': False, 'imported': e['imported'], 'cards': e['cards']}, r)
        for nm, sides in e.get('imagesFor', {}).items():
            rc = next((c for c in r['cards'] if c['name'] == nm), None)
            if rc is None:
                continue
            for side, key in (('front', 'hasFront'), ('back', 'hasBack')):
                if (side in sides) != rc[key]:
                    p.append('%r: card_<n>_%s.png %s' % (nm, side, 'missing' if side in sides else 'unexpected'))
        return not p, not p, p
    if k == 'backup-roundtrip':
        p = []
        try:
            z = zipfile.ZipFile(os.path.join(base, ans.get('zip') or ''))
            names = set(z.namelist())
            doc = json.loads(z.read('backup.json').decode('utf-8'))
        except Exception as ex:
            return False, False, ['cannot read backup zip: %s' % ex]
        p += ['zip lacks %s' % f for f in e['zipHas'] if f not in names]
        p += ['backup.json lacks key %s' % kk for kk in e['jsonKeys'] if kk not in doc]
        p += ['backup.json %s != %r' % (kk, v) for kk, v in e['jsonTop'].items() if doc.get(kk) != v]
        for nm, sides in e['photoFiles'].items():
            row = next((x for x in doc.get('cards', []) if isinstance(x, dict) and x.get('name') == nm), None)
            if row is None:
                p.append('backup.json has no card %r' % nm)
                continue
            for side in sides:
                if 'cards/%s/%s.jpg' % (row.get('id'), side) not in names:
                    p.append('%r: cards/<id>/%s.jpg missing' % (nm, side))
        p += import_problems(e['readBack'], ans.get('readBack'))
        return not p, not p, p
    return False, False, ['unknown kind %s' % k]


def score_cases(answers_path, out_json=None, quiet=False):
    cases = load('cases.json')
    with open(answers_path, encoding='utf-8') as f:
        doc = json.load(f)
    answers, base = doc.get('answers', {}), os.path.dirname(os.path.abspath(answers_path))
    tally = defaultdict(lambda: [0, 0, 0])      # kind/strength -> [n, core, strict]
    fails, info = [], []
    for c in cases:
        a = answers.get(c['id'])
        if c['strength'] == 'ambiguous':
            info.append((c['id'], c['note'] or c['expect'].get('note', ''), a))
            continue
        core, strict, probs = score_case(c, a, base)
        for key in (('kind', c['kind']), ('strength', c['strength']), ('all', 'all')) + \
                ((('adversarial', 'adversarial'),) if c.get('adversarial') else ()):
            t = tally[key]
            t[0] += 1
            t[1] += core
            t[2] += strict
        if not strict:
            fails.append((c['id'], c['strength'], 'CORE' if not core else 'strict', probs))
    lines = ['B1 cases — engine %s' % doc.get('engine', '?'), '',
             '%-28s %5s %6s %8s' % ('group', 'n', 'core', 'strict')]
    for key in sorted(tally, key=lambda k: (k[0] != 'all', k[0], k[1])):
        n, core, strict = tally[key]
        lines.append('%-28s %5d %6d %8d   %5.1f%%' % ('%s=%s' % key, n, core, strict, 100.0 * core / n))
    lines += ['', 'FAILURES (CORE = wrong verdict/value; strict = right verdict, wrong reason/suggestion):']
    lines += ['  %-14s %-9s %-6s %s' % (cid, st, lvl, '; '.join(pr)[:300]) for cid, st, lvl, pr in fails] or ['  none']
    lines += ['', 'AMBIGUOUS (not scored; engine behaviour for the record):']
    lines += ['  %-14s %s\n                 engine: %s' % (cid, note[:120], json.dumps(a, ensure_ascii=False)[:200])
              for cid, note, a in info]
    if not quiet:
        print('\n'.join(lines))
    res = {'tally': {'%s=%s' % k: v for k, v in tally.items()}, 'failures': fails}
    if out_json:
        with open(out_json, 'w', encoding='utf-8') as f:
            json.dump(res, f, ensure_ascii=False, indent=1)
    return res


# ---------------------------------------------------------------------------------------------------- render
NAME_RE = re.compile(r'(?P<id>R-[A-Z0-9]+-\d{3})__m(?P<px>\d)__(?P<con>full|dim)\.png$')
GATES = {'1d': 99.5, 'qr': 99.5, '2d': 99.0, 'dim': 97.0}


def classify(case, results):
    vals = [(r.get('symbology', '').replace('VNBarcodeSymbology', ''), r.get('payload')) for r in results]
    vals = [(s, v) for s, v in vals if v is not None]
    if not vals:
        return 'missed', None
    pat = case.get('expectDecodedPattern')

    def hit(v):
        return v == case['expectDecoded'] or (pat is not None and re.fullmatch(pat, v) is not None)
    hits = [x for x in vals if hit(x[1])]
    others = [x for x in vals if not hit(x[1])]
    if hits and not others:
        fam = O.SYMBOLOGY_FAMILY.get(case['expectSymbology'], {case['expectSymbology']})
        return ('exact' if any(s in fam for s, _ in hits) else 'exact-other-symbology'), hits[0]
    if hits:
        return 'mixed', others[0]
    return 'wrong', others[0]


def lenient_codabar(case, results):
    if case['format'] != 'codabar':
        return False
    body = case['value'].strip('ABCD') if case['value'][0] in 'ABCD' else case['value']
    return any((r.get('payload') or '')[1:-1] == body for r in results)


def score_render(decode_path, out_json=None, quiet=False, variants=None):
    cases = {c['id']: c for c in load('render-cases.json')}
    seen = {}
    with open(decode_path, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            d = json.loads(line)
            m = NAME_RE.search(d['file'])
            if m and m.group('id') in cases:
                seen[(m.group('id'), int(m.group('px')), m.group('con'))] = d.get('results', [])
    if variants is None:
        variants = sorted({(px, con) for (_, px, con) in seen}) or [(3, 'full')]
    table = defaultdict(lambda: defaultdict(int))
    bad, lenient = [], defaultdict(int)
    for cid, c in cases.items():
        for px, con in variants:
            res = seen.get((cid, px, con))
            if res is None:
                cls, got = 'absent', None
            else:
                cls, got = classify(c, res)
            t = table[(c['format'], px, con)]
            t['n'] += 1
            t[cls] += 1
            if cls in ('wrong', 'mixed'):
                bad.append((cid, px, con, cls, c['expectDecoded'][:60], got))
            if cls in ('exact', 'exact-other-symbology') or (res and lenient_codabar(c, res)):
                lenient[(c['format'], px, con)] += 1
    lines = ['B1 render round trip (Vision) — %d values x %d variants' % (len(cases), len(variants)), '',
             '%-11s %3s %-4s %4s %7s %6s %6s %6s %6s' % ('format', 'px', 'con', 'n', 'exact%', 'exact', 'missed',
                                                        'WRONG', 'absent')]
    gate_fail = []
    for (fmt, px, con), t in sorted(table.items()):
        ex = t['exact'] + t['exact-other-symbology']
        pct = 100.0 * ex / t['n']
        lines.append('%-11s %3d %-4s %4d %6.1f%% %6d %6d %6d %6d' % (fmt, px, con, t['n'], pct, ex, t['missed'],
                                                                    t['wrong'] + t['mixed'], t['absent']))
        if px == 3:
            gate = GATES['dim'] if con == 'dim' else (GATES['qr'] if fmt == 'qr' else GATES['1d'] if fmt in O.ONE_D
                                                      else GATES['2d'])
            if pct < gate:
                gate_fail.append('%s %dpx %s %.1f%% < %.1f%%' % (fmt, px, con, pct, gate))
    tot = defaultdict(int)
    for t in table.values():
        for k, v in t.items():
            tot[k] += v
    lines += ['', 'TOTAL n=%d exact=%d (other symbology %d) missed=%d WRONG=%d mixed=%d absent=%d' % (
        tot['n'], tot['exact'] + tot['exact-other-symbology'], tot['exact-other-symbology'], tot['missed'], tot['wrong'],
        tot['mixed'], tot['absent'])]
    lines += ['A2 gates (3 px): ' + ('all met' if not gate_fail else 'MISSED: ' + '; '.join(gate_fail)),
              'A2 "decoded as a different value" = %d (target 0)' % (tot['wrong'] + tot['mixed'])]
    if bad:
        lines += ['', 'DIFFERENT VALUE (dangerous):'] + ['  %s %dpx %s %s expected %r got %r' % b for b in bad[:200]]
    cod = [(k, v) for k, v in lenient.items() if k[0] == 'codabar']
    if cod:
        lines += ['', 'Codabar lenient (start/stop letters ignored, informational): ' +
                  ', '.join('%dpx %s %d/%d' % (px, con, v, table[('codabar', px, con)]['n']) for (f, px, con), v in sorted(cod))]
    if not quiet:
        print('\n'.join(lines))
    res = {'table': {'%s|%d|%s' % k: dict(v) for k, v in table.items()}, 'total': dict(tot), 'gateFailures': gate_fail,
           'different': bad}
    if out_json:
        with open(out_json, 'w', encoding='utf-8') as f:
            json.dump(res, f, ensure_ascii=False, indent=1)
    return res


if __name__ == '__main__':
    a = sys.argv[1:]
    if len(a) < 2 or a[0] not in ('cases', 'render'):
        print(__doc__)
        sys.exit(2)
    out = a[a.index('--json') + 1] if '--json' in a else None
    if a[0] == 'cases':
        r = score_cases(a[1], out)
        sys.exit(0 if not r['failures'] else 1)
    r = score_render(a[1], out)
    sys.exit(0 if not r['different'] and not r['gateFailures'] else 1)
