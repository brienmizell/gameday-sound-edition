#!/usr/bin/env python3
"""Climate normals per venue -> data/normals.json

    cd ~/GameDay && python3 tools/build-normals.py

WHY
---
Open-Meteo forecasts about 16 days out. Most of a college football season is
further away than that, so for most of the year the card can say only
"Forecast opens in N days" — honest, but not useful when you are deciding
whether to buy tickets for a game in November.

What IS knowable is what that stadium is usually like on that date. This
fetches ten years of daily observations per venue — ONE call covers the whole
decade, 3,653 days, ~104 KB — and reduces them to a normal for each date in
the season window: mean high, mean low, and how often it actually rained.

Free and keyless, like everything else the deployed site touches. This runs at
build time only so the page loads a small static file instead of making
hundreds of archive calls in a visitor's browser.

Normals are computed over a +/-3 day window around each date, which is the
usual practice: it stops one freak afternoon in 2019 from defining October 12.
"""
import json
import pathlib
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date, timedelta

SEASON = 2026
YEARS = range(2015, 2025)          # ten complete years
WINDOW = 3                         # +/- days folded into each normal
WET_INCHES = 0.01                  # what counts as "it rained"
DATA = pathlib.Path('data')
ESPN = ('https://site.api.espn.com/apis/site/v2/sports/football/college-football'
        '/scoreboard?dates={y}&seasontype=2&week={w}&groups=80&limit=300')
GEO = 'https://geocoding-api.open-meteo.com/v1/search'
ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive'

STATES = {'Alabama': 'AL', 'Arizona': 'AZ', 'Arkansas': 'AR', 'California': 'CA', 'Colorado': 'CO',
          'Connecticut': 'CT', 'Delaware': 'DE', 'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI',
          'Idaho': 'ID', 'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
          'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
          'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS',
          'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
          'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
          'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK',
          'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
          'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT', 'Vermont': 'VT',
          'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV', 'Wisconsin': 'WI',
          'Wyoming': 'WY', 'District of Columbia': 'DC'}


def get(url, timeout=90, tries=5):
    """Open-Meteo throttles a burst of decade-wide archive pulls. Back off and
    retry rather than dropping the venue — the first run lost 93 of 144 to 429s."""
    import urllib.error
    for attempt in range(1, tries + 1):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < tries:
                wait = 10 * attempt
                print(f'      throttled — waiting {wait}s ({attempt}/{tries - 1})', flush=True)
                time.sleep(wait)
                continue
            raise


def venues(season):
    """Distinct outdoor venues on the schedule, with their city and state."""
    out = {}
    for wk in range(1, 16):
        try:
            data = get(ESPN.format(y=season, w=wk), timeout=30)
        except Exception:
            continue
        for ev in data.get('events', []):
            c = ev['competitions'][0]
            v = c.get('venue') or {}
            addr = v.get('address') or {}
            vid = v.get('id')
            if not vid or v.get('indoor') is True:
                continue                      # a dome has no weather to normalise
            if vid not in out and addr.get('city'):
                out[vid] = {'name': v.get('fullName'), 'city': addr.get('city'),
                            'state': addr.get('state')}
    return out


def geocode(city, state):
    url = f'{GEO}?{urllib.parse.urlencode({"name": city, "count": 10, "language": "en", "format": "json"})}'
    try:
        results = get(url, timeout=30).get('results') or []
    except Exception:
        return None
    if not results:
        return None
    pick = (next((r for r in results if r.get('country_code') == 'US'
                  and (r.get('admin1_code') == state or STATES.get(r.get('admin1', '')) == state)), None)
            or next((r for r in results if r.get('country_code') == 'US'), None)
            or results[0])
    return pick['latitude'], pick['longitude']


def season_dates(season):
    """Aug 15 -> Jan 20, the window any college football game can fall in."""
    d, end, out = date(season, 8, 15), date(season + 1, 1, 20), []
    while d <= end:
        out.append(d)
        d += timedelta(days=1)
    return out


def normals_for(lat, lon):
    """One call: a decade of daily observations, folded into per-date normals."""
    url = (f'{ARCHIVE}?latitude={lat}&longitude={lon}'
           f'&start_date={YEARS[0]}-01-01&end_date={YEARS[-1]}-12-31'
           '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum'
           '&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=auto')
    d = get(url).get('daily') or {}
    times = d.get('time') or []
    if not times:
        return None

    by_md = defaultdict(list)                 # (month, day) -> [(hi, lo, precip)]
    for i, iso in enumerate(times):
        y, m, dd = (int(x) for x in iso.split('-'))
        hi, lo = d['temperature_2m_max'][i], d['temperature_2m_min'][i]
        pr = d['precipitation_sum'][i]
        if hi is None or lo is None:
            continue
        by_md[(m, dd)].append((hi, lo, pr or 0.0))

    out = {}
    for target in season_dates(SEASON):
        rows = []
        for off in range(-WINDOW, WINDOW + 1):
            d2 = target + timedelta(days=off)
            rows.extend(by_md.get((d2.month, d2.day), []))
        if len(rows) < 10:
            continue
        highs = [r[0] for r in rows]
        lows = [r[1] for r in rows]
        wet = sum(1 for r in rows if r[2] >= WET_INCHES)
        out[f'{target.month:02d}-{target.day:02d}'] = {
            'high': round(sum(highs) / len(highs)),
            'low': round(sum(lows) / len(lows)),
            'rain': round(100 * wet / len(rows)),
            'n': len(rows),
        }
    return out


def _save(path, out):
    path.write_text(json.dumps({
        '_note': f'Climate normals per venue, {YEARS[0]}-{YEARS[-1]}, +/-{WINDOW} day window. '
                 'Keyed by ESPN venue id then MM-DD. "rain" is the percent of observed days with '
                 f'at least {WET_INCHES}in — a frequency, NOT a forecast. Built by tools/build-normals.py.',
        'source': 'Open-Meteo archive API (keyless)',
        'years': [YEARS[0], YEARS[-1]],
        'window': WINDOW,
        'venues': out,
    }, indent=0))


def main():
    if not pathlib.Path('tools').is_dir():
        sys.exit('Run from the repo root: cd ~/GameDay && python3 tools/build-normals.py')

    vs = venues(SEASON)
    path = DATA / 'normals.json'
    out = json.loads(path.read_text())['venues'] if path.exists() else {}
    todo = {k: v for k, v in vs.items() if k not in out}
    print(f'{len(vs)} outdoor venues on the {SEASON} schedule; '
          f'{len(out)} already built, {len(todo)} to go')

    failed = []
    for i, (vid, v) in enumerate(sorted(todo.items()), 1):
        place = geocode(v['city'], v['state'])
        if not place:
            failed.append(f"{v['name']} ({v['city']}, {v['state']}) — could not geocode")
            continue
        try:
            n = normals_for(*place)
        except Exception as exc:                                   # noqa: BLE001
            failed.append(f"{v['name']} — archive failed: {exc}")
            continue
        if not n:
            failed.append(f"{v['name']} — no observations returned")
            continue
        out[vid] = {'name': v['name'], 'city': v['city'], 'state': v['state'], 'days': n}
        print(f"  [{i:>3}/{len(todo)}] {v['name']}, {v['city']} {v['state']} — {len(n)} dates", flush=True)
        # Write after every venue, so a throttle never costs completed work.
        _save(path, out)
        time.sleep(1.2)

    _save(path, out)(json.dumps({
        '_note': f'Climate normals per venue, {YEARS[0]}-{YEARS[-1]}, +/-{WINDOW} day window. '
                 'Keyed by ESPN venue id then MM-DD. "rain" is the percent of observed days with '
                 f'at least {WET_INCHES}in — a frequency, NOT a forecast. Built by tools/build-normals.py.',
        'source': 'Open-Meteo archive API (keyless)',
        'years': [YEARS[0], YEARS[-1]],
        'window': WINDOW,
        'venues': out,
    }, indent=0))
    print(f'\n{len(out)} venues -> {path}')
    for f in failed:
        print(f'  skipped: {f}')


if __name__ == '__main__':
    main()
