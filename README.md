# GameDay

The college football weekend, the weather at every stadium, and — eventually —
the sound of the two towns playing.

A static page. No build step, no dependencies, no backend, **no API keys.**
Open `index.html` behind any web server and it works.

---

## The short version

`gameDay` was built in October 2018 over eight days at DigitalCrafts by
[Brien Mizell](https://github.com/brienmizell) and Evan Procter — 119 commits,
four files, the first thing either of them shipped. It pulled a week of college
football and chased the weather at each stadium:

```
stadium name → Google Geocode → lat/lng → Dark Sky
```

That chain was the idea, and it was a good one. Every service in it is now dead.

This is that app, rebuilt in 2026 — with the music system that came after it
wired into the same card. The 2018 code is preserved in `legacy/` and still
runs; `compare.html` puts the two side by side.

---

## Running it

Any static server. No install.

```sh
cd ~/GameDay
python3 -m http.server 8777
open http://127.0.0.1:8777
```

ES modules need a real origin — opening `index.html` as a `file://` URL will not
work.

---

## Data

| what | source | key needed |
|---|---|---|
| schedule, scores, venues, ranks, records, TV, odds | public ESPN scoreboard endpoint | none |
| geocoding | [Open-Meteo](https://open-meteo.com) geocoder | none |
| forecast | [Open-Meteo](https://open-meteo.com) | none |

Both send `access-control-allow-origin: *`, which is why no CORS proxy is
needed and why this can be a static page again.

**The ESPN endpoint is undocumented and unversioned.** It is free, keyless and
widely used, but it carries no stability promise. Everything downstream reads
the normalized shape produced in `src/api/espn.js` — nothing else touches
ESPN's JSON — so replacing it with [CollegeFootballData](https://collegefootballdata.com)
(free tier, requires a key) means rewriting one file.

---

## Layout

```
index.html            the app
compare.html          2018 vs 2026, side by side (showcase, not linked in-app)
assets/app.css        one stylesheet
src/
  main.js             state, URL sync, filters, event wiring
  sound.js            the music-system contract  ← the seam
  api/espn.js         schedule + normalization + cupcake detection
  api/weather.js      geocode + forecast, with honest degradation
  ui/card.js          the matchup card
  ui/issue.js         the Sound Edition reader
  util/fmt.js         dates, temps, WMO codes, contrast
data/
  sound/SCHEMA.md     the contract, documented
  sound/index.json    which matchups have an issue
legacy/               the 2018 app, unmodified, plus a fixture that revives it
```

---

## What it does

- **Every week of the season**, arrow keys or the header buttons. The 2018
  version had `var page = 10` and two commented-out buttons.
- **Power 4 by default** — SEC, Big Ten, Big 12, ACC — with all eleven FBS
  conferences in the picker.
- **Cupcake marking.** September is body-bag season. A game against an FCS
  opponent, or one the book spots 21+, is dimmed and chipped. `Hide cupcakes`
  removes them. The count line always says how many there are.
- **Weather that tells the truth.** Matched to the game's own date, and when the
  game is past Open-Meteo's 16-day horizon it says *"Forecast opens in N days"*
  rather than showing a number it does not have. Domes say so.
- **Rank, record, logo, team colors, TV network, betting line**, neutral-site
  and conference-game flags, kickoff in your own timezone, and a countdown.
- **Search** across teams, stadiums and cities. **Star a team** by double-clicking
  it (stored locally).
- **Linkable state** — `?year=&week=&conf=&q=&fav=&nocupcakes=` .
- **The Sound slot** on every card. See below.

---

## The Sound Edition

Every card carries a slot for a music issue about that matchup: the two
programs' history, the two towns' musical history, and a playlist.

That layer is **not built yet**. This repo ships the seam for it:
`data/sound/*.json`, documented in
[`data/sound/SCHEMA.md`](data/sound/SCHEMA.md) and read by `src/sound.js`.
Cards with no issue render *"No issue yet"* and behave normally, so the app is
complete on its own and the music side can land later without a rewrite.

`data/sound/2026-w01-colorado-at-georgia-tech.json` is a hand-written **sample**
that exercises the schema end to end. It is labelled as such in the file, in the
index, and in its own masthead. Delete it when the first real issue lands.

See [`SOUND_EDITION.md`](SOUND_EDITION.md) for where that work goes next.

---

## Credits

Original: Brien Mizell and Evan Procter, DigitalCrafts, October 2018.
Rebuild: 2026, targeting the August 22 kickoff.
