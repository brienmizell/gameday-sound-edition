#!/usr/bin/env python3
"""All-time head-to-head records -> data/series.json

    cd ~/GameDay
    python3 tools/build-series.py --week 1        # just that week's matchups
    python3 tools/build-series.py --weeks 1-4     # a range
    python3 tools/build-series.py --all           # the whole season (slow)

WHY THIS IS A BUILD STEP, NOT A RUNTIME CALL
--------------------------------------------
A series record does not change during a week, and CollegeFootballData needs a
key. Calling it from the browser would put that key in the shipped source —
which is the exact mistake the 2018 version made, and the reason a Google key
sat in a public repo for eight years. So the key is used here, on your machine,
and only static JSON is committed. The deployed site stays keyless.

THE KEY
-------
Never passed on the command line (it would land in shell history) and never
printed. Provide it either way:

    export CFBD_API_KEY='...'          # in your shell
    echo "CFBD_API_KEY=..." > .env     # or a file, which .gitignore excludes

Get a free one at https://collegefootballdata.com/key

Results accumulate: pairs already in data/series.json are skipped, so running
it again after a few weeks only fetches what is new.
"""
import argparse
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

CFBD = 'https://api.collegefootballdata.com'
ESPN = ('https://site.api.espn.com/apis/site/v2/sports/football/college-football'
        '/scoreboard?dates={y}&seasontype=2&week={w}&groups=80&limit=300')
OUT = pathlib.Path('data/series.json')
SEASON = 2026
PAUSE = 0.35  # be a good citizen on a free tier


PLACEHOLDER = 'PASTE_YOUR_KEY_HERE'


def load_key():
    key = (os.environ.get('CFBD_API_KEY') or '').strip()
    if not key:
        env = pathlib.Path('.env')
        if env.exists():
            for line in env.read_text().splitlines():
                line = line.strip()
                if line.startswith('CFBD_API_KEY='):
                    key = line.split('=', 1)[1].strip().strip('"\'')
                    break

    if key == PLACEHOLDER:
        sys.exit(
            '.env still has the placeholder in it.\n'
            '  Open ~/GameDay/.env and replace PASTE_YOUR_KEY_HERE with your key,\n'
            '  or run:  python3 tools/set-key.py'
        )
    if not key:
        sys.exit(
            'No CFBD key found.\n'
            '  python3 tools/set-key.py          (prompts, nothing echoes)\n'
            "  or export CFBD_API_KEY='...'\n"
            '  Free key: https://collegefootballdata.com/key'
        )
    return key


def espn_week(year, week):
    """The matchups for a week, as (away_name, home_name, away_id, home_id)."""
    with urllib.request.urlopen(ESPN.format(y=year, w=week), timeout=30) as r:
        data = json.load(r)
    out = []
    for ev in data.get('events', []):
        c = ev['competitions'][0]
        h = next(x for x in c['competitors'] if x['homeAway'] == 'home')['team']
        a = next(x for x in c['competitors'] if x['homeAway'] == 'away')['team']
        out.append((a.get('location'), h.get('location'), a['id'], h['id']))
    return out


def cfbd_teams(key):
    """CFBD's own team list, for resolving names BEFORE asking about a matchup.

    This matters more than it looks. /teams/matchup answers an unknown team the
    same way it answers two teams that never played: team1 null, 0-0-0, no
    games. A misspelling and a genuine first meeting are indistinguishable in
    the response. Checking the names first is what separates a fact from an
    absence of knowledge.
    """
    req = urllib.request.Request(f'{CFBD}/teams', headers={
        'Authorization': f'Bearer {key}', 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        teams = json.load(r)

    index = {}
    for t in teams:
        school = t.get('school')
        if not school:
            continue
        for name in [school, *(t.get('alternateNames') or [])]:
            index.setdefault(norm_name(name), school)
    return index


def norm_name(s):
    return ''.join(ch for ch in (s or '').lower() if ch.isalnum())


def resolve(index, espn_name):
    """ESPN's team name -> CFBD's school name, or None if CFBD has no such team."""
    if not espn_name:
        return None
    hit = index.get(norm_name(espn_name))
    if hit:
        return hit
    # ESPN writes "Hawai'i", "Texas A&M", "Miami" where CFBD may differ slightly.
    stripped = norm_name(espn_name.replace('&', 'and').replace("'", ''))
    return index.get(stripped)


def matchup(key, team1, team2):
    url = f'{CFBD}/teams/matchup?' + urllib.parse.urlencode({'team1': team1, 'team2': team2})
    req = urllib.request.Request(url, headers={
        'Authorization': f'Bearer {key}',
        'Accept': 'application/json',
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        if e.code == 401:
            sys.exit('CFBD rejected the key (401). Check CFBD_API_KEY.')
        if e.code == 429:
            print('  rate limited — pausing 10s', flush=True)
            time.sleep(10)
            return matchup(key, team1, team2)
        print(f'  HTTP {e.code} for {team1} vs {team2}', flush=True)
        return None
    except Exception as exc:                      # noqa: BLE001 — one pair failing is not fatal
        print(f'  failed {team1} vs {team2}: {exc}', flush=True)
        return None


def summarize(m, away_id, home_id, away_name, home_name):
    """CFBD's team1/team2 -> our away/home, plus a ready-to-render sentence."""
    if not m:
        return None
    t1, t2 = m.get('team1'), m.get('team2')
    w1, w2 = int(m.get('team1Wins') or 0), int(m.get('team2Wins') or 0)
    ties = int(m.get('ties') or 0)
    # CFBD echoes the names it matched; do not assume our order survived.
    away_w, home_w = (w1, w2) if t1 == away_name else (w2, w1)

    games = m.get('games') or []
    last = games[-1] if games else None

    if not games:
        # Both names resolved against CFBD's roster, so zero games is a fact:
        # these two have never played.
        return {
            'awayId': away_id, 'homeId': home_id, 'resolved': True,
            'awayWins': 0, 'homeWins': 0, 'ties': 0, 'meetings': 0,
            'startYear': None, 'endYear': None, 'last': None,
            'summary': 'First meeting',
        }

    if away_w > home_w:
        leader, lead = away_name, f'{away_w}-{home_w}'
    elif home_w > away_w:
        leader, lead = home_name, f'{home_w}-{away_w}'
    else:
        leader, lead = None, f'{away_w}-{home_w}'
    if ties:
        lead += f'-{ties}'

    return {
        'awayId': away_id,
        'homeId': home_id,
        'resolved': True,
        'awayWins': away_w,
        'homeWins': home_w,
        'ties': ties,
        'startYear': m.get('startYear'),
        'endYear': m.get('endYear'),
        'meetings': len(games),
        'summary': f'{leader} leads {lead}' if leader else f'Series tied {lead}',
        'last': {
            'season': last.get('season'),
            'date': last.get('date'),
            'winner': last.get('winner'),
            'homeTeam': last.get('homeTeam'), 'homeScore': last.get('homeScore'),
            'awayTeam': last.get('awayTeam'), 'awayScore': last.get('awayScore'),
        } if last else None,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--week', type=int)
    ap.add_argument('--weeks', help='inclusive range, e.g. 1-4')
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--season', type=int, default=SEASON)
    args = ap.parse_args()

    if args.all:
        weeks = range(1, 16)
    elif args.weeks:
        lo, hi = (int(x) for x in args.weeks.split('-'))
        weeks = range(lo, hi + 1)
    elif args.week:
        weeks = [args.week]
    else:
        ap.error('give --week, --weeks or --all')

    key = load_key()
    index = cfbd_teams(key)
    print(f'CFBD knows {len(index)} team names\n', flush=True)

    store = json.loads(OUT.read_text())['series'] if OUT.exists() else {}
    added = skipped = unresolved = 0

    for wk in weeks:
        pairs = espn_week(args.season, wk)
        print(f'week {wk}: {len(pairs)} games', flush=True)
        for away, home, aid, hid in pairs:
            if not away or not home:
                continue
            pair_key = f'{aid}-{hid}'
            if pair_key in store:
                skipped += 1
                continue

            a_cfbd, h_cfbd = resolve(index, away), resolve(index, home)
            if not a_cfbd or not h_cfbd:
                # Say which side we could not place, and record it as unknown
                # rather than letting it masquerade as "never met".
                miss = ' + '.join(n for n, r in ((away, a_cfbd), (home, h_cfbd)) if not r)
                store[pair_key] = {'awayId': aid, 'homeId': hid, 'resolved': False, 'unknown': miss}
                unresolved += 1
                print(f'  ? {away} at {home} — CFBD has no team named: {miss}', flush=True)
                continue

            row = summarize(matchup(key, a_cfbd, h_cfbd), aid, hid, a_cfbd, h_cfbd)
            if row:
                store[pair_key] = row
                added += 1
                label = 'first meeting' if row['meetings'] == 0 else f'{row["meetings"]} meetings'
                print(f'  {row["summary"]}  ({label})', flush=True)
            else:
                store[pair_key] = {'awayId': aid, 'homeId': hid, 'resolved': False, 'unknown': 'request failed'}
                unresolved += 1
            time.sleep(PAUSE)

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({
        '_note': 'All-time head-to-head, keyed "<awayEspnId>-<homeEspnId>". '
                 'Built by tools/build-series.py; the CFBD key never ships.',
        'source': 'CollegeFootballData /teams/matchup',
        'season': args.season,
        'series': store,
    }, indent=0))
    print(f'\n{added} resolved, {unresolved} unresolved, {skipped} already had '
          f'-> {OUT} ({len(store)} total)')


if __name__ == '__main__':
    main()
