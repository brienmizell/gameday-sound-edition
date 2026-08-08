#!/usr/bin/env python3
"""Bulk CFBD builder — the right shape.

    python3 tools/build-bulk.py --lines               # 1 call  -> data/lines.json
    python3 tools/build-bulk.py --games --from 1869   # ~158    -> data/series.json
    python3 tools/build-bulk.py --lines --games       # both

WHY THIS EXISTS
---------------
tools/build-series.py asks /teams/matchup once per matchup: ~902 calls for one
season, re-paid every August. On 2026-08-08 that spent an entire monthly quota
and produced 157 durable pairs — 1,101 calls for 157 rows.

/games?year=Y returns a WHOLE SEASON in one call, and its Game object is a
superset of what /teams/matchup returns. Grouping every game by unordered team
pair reconstructs every head-to-head at once. ~158 calls covers 1869-2026, all
time, once — and every future season is one more call.

/lines?year=Y is the same story for betting lines: one call returns the season,
every provider (so a real average, not one book), and both spreadOpen and the
closing spread (so completed games get their closing number).

Series output is written in the SAME schema build-series.py produced, so the
app reads it without changes.
"""
import argparse
import json
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

CFBD = 'https://api.collegefootballdata.com'
SEASON = 2026
DATA = pathlib.Path('data')
PAUSE = 0.4

def load_key():
    """Same contract as build-series.py: env or gitignored .env, never argv."""
    import os
    key = (os.environ.get('CFBD_API_KEY') or '').strip()
    if not key and pathlib.Path('.env').exists():
        for line in pathlib.Path('.env').read_text().splitlines():
            if line.strip().startswith('CFBD_API_KEY='):
                key = line.split('=', 1)[1].strip().strip('"\'')
                break
    if not key or key == 'PASTE_YOUR_KEY_HERE':
        sys.exit('No CFBD key. Run: python3 tools/set-key.py')
    return key


def api(key, path, **params):
    url = f'{CFBD}{path}?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={
        'Authorization': f'Bearer {key}', 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            left = r.headers.get('X-CallLimit-Remaining')
            return json.load(r), (int(left) if left and left.isdigit() else None)
    except urllib.error.HTTPError as e:
        if e.code == 429:
            sys.exit(f'CFBD quota exhausted: {e.read(200).decode(errors="replace").strip()}\n'
                     '  Progress so far is already written. Resume when it resets.')
        if e.code == 401:
            sys.exit('CFBD rejected the key (401).')
        raise


def preflight(key, planned):
    d, _ = api(key, '/info')
    left, limit = d.get('remainingCalls'), d.get('monthlyLimit')
    print(f"CFBD {d.get('tierName')} — {left}/{limit} calls left, resets {d.get('resetAt')}")
    if left == 0:
        sys.exit('  Quota spent. https://collegefootballdata.com/api-tiers')
    if isinstance(left, int) and left < planned:
        print(f'  NOTE: planning ~{planned} calls, {left} remain — will stop cleanly when spent.')
    return left


def espn_index():
    """CFBD school name -> ESPN team id, so output keys match what the app reads."""
    teams = json.loads((DATA / 'teams.json').read_text())['teams']
    norm = lambda s: ''.join(c for c in (s or '').lower() if c.isalnum())        # noqa: E731
    idx = {}
    for t in teams:
        for name in (t.get('location'), t.get('short'), t.get('name')):
            if name:
                idx.setdefault(norm(name), t['id'])
    return idx, norm


# ---------------------------------------------------------------- betting lines

def canon_book(name):
    """CFBD lists the same sportsbook under more than one spelling.

    2025 returns both "DraftKings" and "Draft Kings" — the same shop, and
    averaging both double-weights it. Fold them before doing any arithmetic.
    """
    if not name:
        return None
    squashed = ''.join(c for c in name.lower() if c.isalnum())
    return {'draftkings': 'DraftKings', 'espnbet': 'ESPN Bet', 'bovada': 'Bovada'}.get(squashed, name.strip())


def build_lines(key, year):
    """One call. Every provider, opening and closing, for the whole season."""
    print(f'\n/lines?year={year} — one call for the season')
    games, left = api(key, '/lines', year=year, seasonType='both')
    print(f'  {len(games)} games returned' + (f' ({left} calls left)' if left is not None else ''))

    idx, norm = espn_index()
    path = DATA / 'lines.json'
    prev = json.loads(path.read_text())['games'] if path.exists() else {}
    out, books, unkeyed = dict(prev), set(), 0

    for g in games:
        lines = g.get('lines') or []
        if not lines:
            continue

        # One entry per BOOK, so a duplicate spelling cannot vote twice.
        by_book = {}
        for l in lines:
            b = canon_book(l.get('provider'))
            if b:
                by_book.setdefault(b, l)
                books.add(b)
        picked = list(by_book.values())

        spreads = [l['spread'] for l in picked if l.get('spread') is not None]
        totals = [l['overUnder'] for l in picked if l.get('overUnder') is not None]
        opens = [l['spreadOpen'] for l in picked if l.get('spreadOpen') is not None]
        if not spreads and not totals:
            continue

        # Key the way the APP can look it up: it knows ESPN ids, not CFBD game ids.
        a_id, h_id = idx.get(norm(g.get('awayTeam'))), idx.get(norm(g.get('homeTeam')))
        if not a_id or not h_id:
            unkeyed += 1
            continue

        avg = lambda xs: round(sum(xs) / len(xs), 2) if xs else None             # noqa: E731
        completed = g.get('homeScore') is not None and g.get('awayScore') is not None
        out[f"{g.get('season')}-w{g.get('week')}-{a_id}-{h_id}"] = {
            'season': g.get('season'), 'week': g.get('week'),
            'books': len(picked),
            'providers': sorted(by_book),
            'spread': avg(spreads),          # negative = home favoured, CFBD's convention
            'overUnder': avg(totals),
            'spreadOpen': avg(opens),
            # A completed game's number never moves again — that IS the closing line.
            'closing': completed,
        }

    path.write_text(json.dumps({
        '_note': 'Average betting lines, one vote per sportsbook. Keyed '
                 '"<season>-w<week>-<awayEspnId>-<homeEspnId>". closing:true means the game '
                 'is final, so the number is the closing line. Built by tools/build-bulk.py.',
        'source': 'CollegeFootballData /lines',
        'books': sorted(books),
        'games': out,
    }, indent=0))
    closed = sum(1 for v in out.values() if v['closing'])
    print(f'  -> {path}: {len(out)} games total, {closed} closing, '
          f'books: {", ".join(sorted(books))}'
          + (f' ({unkeyed} skipped: non-FBS opponent)' if unkeyed else ''))


# ------------------------------------------------------------- head-to-head

def build_series(key, first, last, season):
    """One call per season-year; every head-to-head pair falls out at once."""
    idx, norm = espn_index()
    pairs = {}          # frozenset{schoolA, schoolB} -> aggregate
    years = list(range(first, last + 1))
    print(f'\n/games for {len(years)} seasons ({first}-{last}) — one call each')

    for y in years:
        try:
            games, left = api(key, '/games', year=y, seasonType='both')
        except SystemExit:
            print('  stopping early; writing what we have')
            break
        if not games:
            continue
        for g in games:
            h, a = g.get('homeTeam'), g.get('awayTeam')
            hp, ap = g.get('homePoints'), g.get('awayPoints')
            if not h or not a or hp is None or ap is None:
                continue
            k = frozenset((h, a))
            rec = pairs.setdefault(k, {'w': {h: 0, a: 0}, 'ties': 0, 'n': 0, 'last': None})
            rec['w'].setdefault(h, 0); rec['w'].setdefault(a, 0)
            rec['n'] += 1
            if hp > ap:
                rec['w'][h] += 1
            elif ap > hp:
                rec['w'][a] += 1
            else:
                rec['ties'] += 1
            if not rec['last'] or (g.get('season') or 0) >= (rec['last'].get('season') or 0):
                rec['last'] = {'season': g.get('season'), 'date': g.get('startDate'),
                               'homeTeam': h, 'homeScore': hp, 'awayTeam': a, 'awayScore': ap,
                               'winner': h if hp > ap else (a if ap > hp else None)}
        if y % 10 == 0 or y == years[-1]:
            print(f'  {y}: {len(games):>4} games · {len(pairs):>6} pairs so far'
                  + (f' · {left} calls left' if left is not None else ''), flush=True)
        time.sleep(PAUSE)

    # Cache the expensive part. 158 calls produced this; never pay for it twice
    # just because the emit step needs changing.
    cache = DATA / 'pairs-alltime.json'
    cache.write_text(json.dumps({
        '_note': 'All-time head-to-head aggregates by school-name pair, derived from bulk '
                 '/games. The costly artifact — re-emit series.json from this for free.',
        'built': f'{first}-{last}',
        'pairs': [{'a': list(k)[0], 'b': list(k)[1] if len(k) == 2 else list(k)[0],
                   'w': v['w'], 'ties': v['ties'], 'n': v['n'], 'last': v['last']}
                  for k, v in pairs.items() if len(k) == 2],
    }, indent=0))
    print(f'  cached {len(pairs)} all-time pairs -> {cache}')

    emit_series(pairs, idx, norm, season)


def emit_series(pairs, idx, norm, season):
    """Write series.json for every matchup on THIS season's schedule.

    The earlier version only refreshed pairs already in the file, so a run that
    found 19,217 pairs still wrote 157 — it could improve what was there but
    never add what was missing. The schedule, not the existing file, decides
    which pairs the app needs.
    """
    import urllib.request as _u
    wanted = {}
    for wk in range(1, 16):
        url = ('https://site.api.espn.com/apis/site/v2/sports/football/college-football'
               f'/scoreboard?dates={season}&seasontype=2&week={wk}&groups=80&limit=300')
        try:
            with _u.urlopen(url, timeout=30) as r:
                data = json.load(r)
        except Exception:
            continue
        for ev in data.get('events', []):
            c = ev['competitions'][0]
            h = next(x for x in c['competitors'] if x['homeAway'] == 'home')['team']
            a = next(x for x in c['competitors'] if x['homeAway'] == 'away')['team']
            wanted[f"{a['id']}-{h['id']}"] = (a['id'], h['id'], a.get('location'), h.get('location'))
    print(f'  {len(wanted)} matchups on the {season} schedule (ESPN, free)')

    # school-name pair -> aggregate, for lookup by name
    by_names = {}
    for k, v in pairs.items():
        if len(k) == 2:
            by_names[k] = v
    # CFBD school name for each ESPN team, so aggregates can be looked up.
    cfbd_of = {}
    for k in by_names:
        for school in k:
            eid = idx.get(norm(school))
            if eid:
                cfbd_of.setdefault(eid, school)

    out, missing = {}, 0
    for pk, (away_id, home_id, away_loc, home_loc) in wanted.items():
        away = cfbd_of.get(away_id) or away_loc
        home = cfbd_of.get(home_id) or home_loc
        rec = by_names.get(frozenset((away, home)))
        if not rec:
            # Both teams exist but no game between them appears anywhere in
            # 1869-2026: a genuine first meeting.
            out[pk] = {'awayId': away_id, 'homeId': home_id, 'resolved': True,
                       'awayWins': 0, 'homeWins': 0, 'ties': 0, 'meetings': 0,
                       'startYear': None, 'endYear': None, 'summary': 'First meeting', 'last': None}
            missing += 1
            continue
        aw, hw, ties = rec['w'].get(away, 0), rec['w'].get(home, 0), rec['ties']
        if aw > hw:
            summary = f'{away} leads {aw}-{hw}' + (f'-{ties}' if ties else '')
        elif hw > aw:
            summary = f'{home} leads {hw}-{aw}' + (f'-{ties}' if ties else '')
        else:
            summary = f'Series tied {aw}-{hw}' + (f'-{ties}' if ties else '')
        out[pk] = {'awayId': away_id, 'homeId': home_id, 'resolved': True,
                   'awayWins': aw, 'homeWins': hw, 'ties': ties,
                   'meetings': rec['n'], 'startYear': None, 'endYear': None,
                   'summary': summary if rec['n'] else 'First meeting',
                   'last': rec['last']}

    path = DATA / 'series.json'
    path.write_text(json.dumps({
        '_note': 'All-time head-to-head, keyed "<awayEspnId>-<homeEspnId>". '
                 'Derived from bulk /games by tools/build-bulk.py; the key never ships.',
        'source': 'CollegeFootballData /games (bulk, grouped by pair)',
        'season': season, 'series': out,
    }, indent=0))
    print(f'  -> {path}: {len(out)} pairs written, {missing} with no meeting on record')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--lines', action='store_true', help='average + closing lines (1 call)')
    ap.add_argument('--games', action='store_true', help='derive all head-to-head (1 call per year)')
    ap.add_argument('--from', dest='first', type=int, default=1869)
    ap.add_argument('--to', dest='last', type=int, default=SEASON)
    ap.add_argument('--season', type=int, default=SEASON)
    ap.add_argument('--emit-only', dest='emit_only', action='store_true',
                    help='rebuild series.json from data/pairs-alltime.json — costs ZERO CFBD calls')
    args = ap.parse_args()
    if args.emit_only:
        cache = DATA / 'pairs-alltime.json'
        if not cache.exists():
            sys.exit('No data/pairs-alltime.json — run --games once to build it.')
        raw = json.loads(cache.read_text())['pairs']
        pairs = {frozenset((r['a'], r['b'])): {'w': r['w'], 'ties': r['ties'],
                                               'n': r['n'], 'last': r['last']} for r in raw}
        print(f"{len(pairs)} all-time pairs from cache ({cache}) — no CFBD calls needed")
        idx, norm = espn_index()
        emit_series(pairs, idx, norm, args.season)
        return

    if not (args.lines or args.games):
        ap.error('give --lines and/or --games')

    key = load_key()
    planned = (1 if args.lines else 0) + ((args.last - args.first + 1) if args.games else 0)
    preflight(key, planned + 1)

    if args.lines:
        build_lines(key, args.season)
    if args.games:
        build_series(key, args.first, args.last, args.season)


if __name__ == '__main__':
    main()
