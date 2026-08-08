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
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            teams = json.load(r)
    except urllib.error.HTTPError as e:
        if e.code == 429:
            body = e.read(300).decode(errors='replace')
            sys.exit(
                f'CFBD is refusing calls: {body.strip()}\n'
                '  The free tier is a MONTHLY quota. Nothing to do but wait for it to\n'
                '  reset, or upgrade at https://collegefootballdata.com\n'
                '  Whatever is already in data/series.json still works.'
            )
        if e.code == 401:
            sys.exit('CFBD rejected the key (401). Check CFBD_API_KEY.')
        raise

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


def check_quota(key, planned):
    """Ask CFBD how much budget is left BEFORE spending any of it.

    /info keeps returning 200 while every data endpoint 429s, so it is a free
    and reliable meter. Reading X-CallLimit-Remaining off a response only tells
    you after you have already spent the call — which is how a run kept going
    into a wall it could have seen.
    """
    req = urllib.request.Request(f'{CFBD}/info', headers={
        'Authorization': f'Bearer {key}', 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            d = json.load(r)
    except Exception:
        return None                      # meter unavailable; the budget cap still applies

    left, limit = d.get('remainingCalls'), d.get('monthlyLimit')
    print(f"CFBD {d.get('tierName')} tier — {left}/{limit} calls left, resets {d.get('resetAt')}")
    if d.get('sharedPool'):
        print(f"  (pool is shared across {', '.join(d.get('products') or [])})")
    if left == 0:
        sys.exit('  Quota is spent. Nothing to do but wait for the reset, or upgrade:\n'
                 '  https://collegefootballdata.com/api-tiers  (Tier 1 is $1/month for 5,000)')
    if isinstance(left, int) and left < planned:
        print(f'  WARNING: this run plans up to {planned} calls but only {left} remain.\n'
              f'  It will stop cleanly when the budget runs out; finished pairs are saved.')
    return left


class QuotaExhausted(Exception):
    """The month's call budget is gone. Not retryable — stop, do not spin."""


def matchup(key, team1, team2, attempt=1):
    url = f'{CFBD}/teams/matchup?' + urllib.parse.urlencode({'team1': team1, 'team2': team2})
    req = urllib.request.Request(url, headers={
        'Authorization': f'Bearer {key}',
        'Accept': 'application/json',
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            left = r.headers.get('X-CallLimit-Remaining')
            return json.load(r), (int(left) if left and left.isdigit() else None)
    except urllib.error.HTTPError as e:
        if e.code == 401:
            sys.exit('CFBD rejected the key (401). Check CFBD_API_KEY.')
        if e.code == 429:
            # A 429 here is TWO different things and they must not be conflated.
            # "Monthly call quota exceeded" is permanent until the month rolls
            # over; retrying it is pure abuse of someone's free API. Only a
            # transient throttle is worth waiting out, and only a few times.
            body = e.read(400).decode(errors='replace')
            if 'quota' in body.lower():
                raise QuotaExhausted(body.strip()) from e
            if attempt > 3:
                raise QuotaExhausted('throttled repeatedly; stopping rather than hammering') from e
            wait = 5 * attempt
            print(f'  throttled — waiting {wait}s (attempt {attempt}/3)', flush=True)
            time.sleep(wait)
            return matchup(key, team1, team2, attempt + 1)
        print(f'  HTTP {e.code} for {team1} vs {team2}', flush=True)
        return None, None
    except Exception as exc:                      # noqa: BLE001 — one pair failing is not fatal
        print(f'  failed {team1} vs {team2}: {exc}', flush=True)
        return None, None


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


def save(store, season):
    """Write after every week, not just at the end.

    A full-season run is ~870 requests and several minutes. Saving once at the
    end means a stall, a rate limit, or a closed laptop throws all of it away —
    which is exactly what happened the first time. Now a killed run resumes
    where it stopped, because completed pairs are already on disk and get
    skipped next time.
    """
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({
        '_note': 'All-time head-to-head, keyed "<awayEspnId>-<homeEspnId>". '
                 'Built by tools/build-series.py; the CFBD key never ships. '
                 'resolved:false means CFBD could not place a team name — not that they never met.',
        'source': 'CollegeFootballData /teams/matchup',
        'season': season,
        'series': store,
    }, indent=0))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--week', type=int)
    ap.add_argument('--weeks', help='inclusive range, e.g. 1-4')
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--i-know-it-costs-a-month', dest='i_know_it_costs_a_month', action='store_true',
                    help='required with --all; a full season can spend the entire monthly quota')
    ap.add_argument('--budget', type=int, default=250,
                    help='stop after this many CFBD calls in one run (default 250)')
    ap.add_argument('--season', type=int, default=SEASON)
    args = ap.parse_args()

    if args.all:
        if not args.i_know_it_costs_a_month:
            sys.exit(
                'Refusing --all.\n'
                '  A full season is roughly 870 requests. The CFBD free tier is a MONTHLY\n'
                '  quota, not a per-second throttle — one --all run can spend the whole\n'
                '  month, which is exactly what happened on 2026-08-08.\n'
                '  Build the weeks you need:  --week 1   or   --weeks 1-3\n'
                '  If you really mean it:     --all --i-know-it-costs-a-month'
            )
        weeks = range(1, 16)
    elif args.weeks:
        lo, hi = (int(x) for x in args.weeks.split('-'))
        weeks = range(lo, hi + 1)
    elif args.week:
        weeks = [args.week]
    else:
        ap.error('give --week, --weeks or --all')

    key = load_key()
    check_quota(key, args.budget)
    index = cfbd_teams(key)
    print(f'CFBD knows {len(index)} team names\n', flush=True)

    store = json.loads(OUT.read_text())['series'] if OUT.exists() else {}
    added = skipped = unresolved = calls = 0

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

            if calls >= args.budget:
                print(f'\n  budget reached ({args.budget} calls) — stopping here.', flush=True)
                print('  Re-run to continue; finished pairs are already saved.', flush=True)
                save(store, args.season)
                return report(added, unresolved, skipped, store)
            try:
                m, remaining = matchup(key, a_cfbd, h_cfbd)
            except QuotaExhausted as e:
                print(f'\n  CFBD quota exhausted: {e}', flush=True)
                print('  Stopping. Finished pairs are saved; resume after the quota resets.', flush=True)
                save(store, args.season)
                return report(added, unresolved, skipped, store)
            calls += 1
            if remaining is not None and remaining <= 5:
                print(f'\n  only {remaining} CFBD calls left this month — stopping.', flush=True)
                save(store, args.season)
                return report(added, unresolved, skipped, store)
            row = summarize(m, aid, hid, a_cfbd, h_cfbd)
            if row:
                store[pair_key] = row
                added += 1
                label = 'first meeting' if row['meetings'] == 0 else f'{row["meetings"]} meetings'
                print(f'  {row["summary"]}  ({label})', flush=True)
            else:
                store[pair_key] = {'awayId': aid, 'homeId': hid, 'resolved': False, 'unknown': 'request failed'}
                unresolved += 1
            time.sleep(PAUSE)

        save(store, args.season)   # checkpoint after each week

    save(store, args.season)
    report(added, unresolved, skipped, store)


def report(added, unresolved, skipped, store):
    print(f'\n{added} resolved, {unresolved} unresolved, {skipped} already had '
          f'-> {OUT} ({len(store)} total)')


if __name__ == '__main__':
    main()
