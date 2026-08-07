#!/usr/bin/env python3
"""Regenerate data/teams.json — the FBS team list behind the team picker.

Run when conferences realign (which now happens most years):
    cd ~/GameDay && python3 tools/build-teams.py [season]

ESPN's /teams endpoint ignores groups= and returns all 758 NCAA programs
including D2/D3, so the FBS list is derived from the season's own schedule:
scan several weeks and keep every team whose conferenceId is an FBS one.
"""
import json, sys, time, urllib.request

SEASON = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
WEEKS = (2, 4, 6, 8, 10)  # mid-season, when nearly everyone is playing
FBS = {'1': 'ACC', '4': 'Big 12', '5': 'Big Ten', '8': 'SEC', '9': 'Pac-12',
       '12': 'Conference USA', '15': 'Mid-American', '17': 'Mountain West',
       '18': 'Independents', '37': 'Sun Belt', '151': 'American'}
URL = ('https://site.api.espn.com/apis/site/v2/sports/football/college-football'
       '/scoreboard?dates={y}&seasontype=2&week={w}&groups=80&limit=300')

teams = {}
for wk in WEEKS:
    with urllib.request.urlopen(URL.format(y=SEASON, w=wk), timeout=30) as r:
        data = json.load(r)
    for ev in data.get('events', []):
        for c in ev['competitions'][0]['competitors']:
            t = c['team']
            cid = str(t.get('conferenceId') or '')
            if cid in FBS:
                teams[t['id']] = {
                    'id': t['id'], 'name': t.get('displayName'),
                    'short': t.get('shortDisplayName'), 'abbr': t.get('abbreviation'),
                    'color': t.get('color'), 'logo': t.get('logo'),
                    'conf': cid, 'confName': FBS[cid],
                }
    time.sleep(0.3)

out = sorted(teams.values(), key=lambda t: (t['confName'], t['name']))
with open('data/teams.json', 'w') as f:
    json.dump({'_note': 'FBS teams for the team picker. Regenerate with tools/build-teams.py.',
               'season': SEASON, 'teams': out}, f, indent=0)
print(f'{len(out)} FBS teams -> data/teams.json')
