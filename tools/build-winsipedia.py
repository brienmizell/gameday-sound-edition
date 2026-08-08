#!/usr/bin/env python3
"""Map ESPN team ids to Winsipedia slugs -> data/winsipedia.json

    cd ~/GameDay && python3 tools/build-winsipedia.py

Winsipedia (winsipedia.com) has the best head-to-head pages on the internet:
all-time series record, streaks, largest margins, every meeting. GameDay links
out to them per matchup — it does NOT scrape them:

  * their robots.txt Disallows /api/, so their data endpoints are off-limits,
  * their pages send no CORS headers, so a static page could not read them
    from the browser anyway.

A link costs them nothing and sends them traffic. So all this script needs is
the slug for each team, and it takes those from the sitemap they publish for
exactly this purpose — one request, no crawling.
"""
import json
import re
import unicodedata
import urllib.request

SITEMAP = 'https://www.winsipedia.com/sitemap/teams.xml'

# Only for genuine ambiguity — a name no rule can reach, not mere abbreviation.
MANUAL = {
    'Miami': 'miami-fl',
    'Miami (OH)': 'miami-oh',
    'NC State': 'north-carolina-state',
    'Texas A&M': 'texas-am',
    'UConn': 'connecticut',
    'UMass': 'massachusetts',
    'USC': 'southern-california',
    'UCF': 'central-florida',
    'UAB': 'alabama-birmingham',
    'UTSA': 'texas-san-antonio',
    'UTEP': 'texas-el-paso',
    'FIU': 'florida-international',
    'Ole Miss': 'mississippi',
    'Louisiana': 'louisiana-lafayette',
    'UL Monroe': 'louisiana-monroe',
    'Southern Miss': 'southern-mississippi',
    'Sam Houston': 'sam-houston-state',
    'App State': 'appalachian-state',
    'Hawaiʻi': 'hawaii',
}


def norm(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    s = s.lower().replace('&', '').replace("'", '')
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')


def candidates(team):
    loc, short = team.get('location') or '', team.get('short') or ''
    out = [MANUAL.get(loc), MANUAL.get(short)]
    for base in (loc, short):
        n = norm(base)
        out += [n, n + '-state', n.replace('-state', '')]
    return [c for c in dict.fromkeys(out) if c]


def main():
    with urllib.request.urlopen(SITEMAP, timeout=30) as r:
        xml = r.read().decode()
    slugs = {
        loc.rstrip('/').rsplit('/', 1)[-1]
        for loc in re.findall(r'<loc>(.*?)</loc>', xml)
        if re.match(r'^https://www\.winsipedia\.com/[a-z0-9.\-]+/?$', loc)
    }
    print(f'{len(slugs)} slugs in the sitemap')

    teams = json.load(open('data/teams.json'))['teams']
    mapping, missing = {}, []
    for t in teams:
        hit = next((c for c in candidates(t) if c in slugs), None)
        if hit:
            mapping[t['id']] = hit
        else:
            missing.append(t)

    with open('data/winsipedia.json', 'w') as f:
        json.dump({
            '_note': 'ESPN team id -> Winsipedia slug. Link-out only; see tools/build-winsipedia.py.',
            'base': 'https://www.winsipedia.com',
            'teams': mapping,
        }, f, indent=0)

    print(f'{len(mapping)}/{len(teams)} mapped -> data/winsipedia.json')
    for t in missing:
        print(f'  UNMAPPED: {t["location"]} ({t["short"]}) — add to MANUAL')
    return 1 if missing else 0


if __name__ == '__main__':
    raise SystemExit(main())
