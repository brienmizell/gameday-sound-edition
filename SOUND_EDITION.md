# GameDay: The Sound Edition

**Status: the seam is built, the layer is not.** This document is the record of
what the layer is supposed to be, so the next session does not have to
reconstruct it. Written 2026-08-07.

---

## What it is

A weekly college football matchup told as a music set: two schools, two towns,
one argument, one playlist. For each matchup — the **full history of the two
programs**, then the **musical history of the two places**, then a **playlist**,
written in the voice the music system uses for its write-ups.

## This is not a new idea — it was already filed

Two existing commitments, and this is their intersection:

1. **"GameDay: The Sound Edition"** — `~/Claude/repo-rebuilds/PLAN.md`,
   2026-08-05, rebuild #1 of three. *"gameDay was his FIRST app ever … Rebuild
   fused with musicsystem's Conference Series … every matchup gets schedule +
   weather + THE SOUND: fight songs, both schools' scenes, the college-radio
   canon."* Framing line on the record: *"My first app, rebuilt eight years
   later with my life's project inside it."*

2. **The Conference Series** — an OPEN promise in
   `briens-mac-mini.local:~/musicsystem/docs/PROMISES.md:76`, ledgered
   2026-08-02, Brien's own commission and his own deferral: *"since college
   music scene is big. I'd love to have a whole series about … the big schools
   but the music they produced. Even grouping bands by football conference,"*
   then *"maybe that by conference can wait till football season."* Docked to
   kickoff week, SEC first.

The 2026 season kicks off **August 22**. That is the deadline this was docked to.

**Nothing has ever been delivered against either.** No artifact, no write-up, no
playlist — verified across the artifact list, `~/musicsystem/ARTIFACTS.md`, and
transcript sweeps on both machines. The promise is honestly still open, and
should be closed as **PARTIAL** when GameDay ships — a per-matchup cut does not
discharge a per-conference series.

---

## The ruling on where it lives

**The prose and the playlists live in `~/musicsystem` on the Mac mini. This repo
only renders what that system produces.**

Not negotiable, for concrete reasons: every write-up law that makes the format
worth doing (CANON-1, SOURCE-1, WRITEUP-1) is executable only there, and so are
`spotify_push.py`, the saved Spotify session, the listening ledger, and the
acoustic caches. A split surface would recreate exactly the two-`~/musicsystem`-
folders divergence that the control-room README exists to prevent.

The interface between them is `data/sound/*.json` and nothing else.
See [`data/sound/SCHEMA.md`](data/sound/SCHEMA.md).

**No prose is ever generated on a schedule.** The machine fetches, joins, scores
and stops at a fact card. A human writes the issue.

---

## The central design problem, and the rule that resolves it

A Georgia-vs-Alabama playlist of pure regional music would not be Brien's
record. But dropping a nu-disco track into an Alabama soul set to make it "more
him" is laundering. Both failures are real and they pull opposite ways.

**THE SEATING RULE: place decides who gets a seat, taste decides which track
takes it and what order they play in.**

Eligibility is a question about place, answered by tenancy — the artist formed
there, enrolled there, or first played there. Once eligible, the *track* chosen
is the one with the highest count in the listening ledger, or failing that the
best acoustic fit. Selecting by taste *inside* the canon costs nothing in
authenticity and buys everything in listenability.

Supporting rules:

- **The ledger floor.** At least a third of seats must carry a nonzero playcount,
  printed. If a matchup cannot clear it, *the failure is the finding* — it gets
  written down, not cheated around.
- **The tailgate exemption.** At most two seats of ~22 may come from outside
  both canons, and each still needs a **named joint** (the artist played the
  town; a credit ties them; a documented stadium use). No joint, seat forfeited,
  forfeit named in the write-up. An unpoliced exemption becomes the whole set by
  week four.
- **The acoustic floor.** A track that cannot be seated in the flow is **cited,
  not seated** — it gets a sentence and no slot. This is what stops a regional
  history set from becoming a metadata grab-bag.
- **Sequencing is where taste actually lives.** The material is regional; the
  shape is his.

And the honest resolution underneath all of it: **college towns are where his
taste comes from.** Athens indie rock is his lane natively. The real tension is
never region-versus-taste, it is that *some* towns are in his ledger and some
are not — and that asymmetry is the story, printed, not hidden.

## How musical history gets derived

A reach ladder, checked in order, each rung emitting a receipt:

| tier | what it is | example |
|---|---|---|
| **T0** | the town — artist began there | R.E.M., Athens GA |
| **T1** | the enrollment — formed at the school, its station, its art department | Indigo Girls, Emory |
| **T2** | the room — the studio, label or venue that is the town's instrument | Caribou Ranch, Nederland CO |
| **T3** | the stadium canon — fight songs, the band's book. **Cap: one per side.** | "Ramblin' Wreck" |
| **T4** | diaspora, and songs about the place. Admitted only on a named tie. **Cap: two.** | — |

T0 is computable from the music system's artist database. T1–T3 are curated
once per program — roughly ten lines per school — because no database holds a
fight song, and pretending otherwise produces slop.

**Fight songs and marching bands are prose objects with one capped exception;
they mostly fail the plays-as-music test.**

## The structural move: THE NEUTRAL FIELD

Two rival subjects run in parallel, then collided on a **named tie** — the one
artist, room, or person who belongs to both sides without a reach. That
collision is the playlist's peak and the essay's middle.

If the two towns have never touched, the section still appears, headed
*"The neutral field, empty,"* and says so in two sentences. Absence is a
finding.

*(Worked example, already rendered in the sample issue: Colorado at Georgia
Tech — India.Arie, born in Denver, made in Atlanta.)*

---

## What is already built

- `data/sound/SCHEMA.md` — the contract.
- `src/sound.js` — slug generation, index loading, structural validation that
  degrades rather than breaks on a bad write.
- `src/ui/issue.js` — the reader: masthead, declaration, both sides, neutral
  field, numbered running order with tier badges and receipts, sources.
- `data/sound/2026-w01-colorado-at-georgia-tech.json` — a labelled **sample**
  that exercises every field.

## What is not

- Anything on the Mini. No `gameday/` module, no pipeline, no runner.
- Matchup-of-the-week selection.
- The per-school canon file (`canon.yml`) — ~10 curated lines per program.
- Any real issue, any real playlist.

## Next session, in order

1. On the Mini, scaffold `gameday/` in `~/musicsystem` and add a
   `docs/GAMEDAY.md` charter.
2. Curate `canon.yml` for the SEC first — it is the docked starting point.
3. Write **one** issue by hand, end to end, and place its playlist with
   `spotify_push.py` (**never** the generative Spotify connector — it caps
   length and refuses exact placement; this is already a standing ruling, and
   the July matchday run is the evidence).
4. Emit `data/sound/<slug>.json` into this repo, delete the sample, look at it
   in the card.
5. Only then automate.

## Open questions for Brien

1. **Whose matchup?** One issue a week — chosen by ranking, by rivalry, or by
   whichever two towns have the better music? These give different answers most
   weeks.
2. **Does UGA get a standing seat**, or does the format pick on merit and let
   Georgia turn up when it turns up?
3. **How much of the team history** — the full program story, or the series
   between these two and one hinge game?
4. **Does the app get a public URL**, or stay local? That decides whether the
   write-ups are published or only rendered here.
5. **What happens in a rematch** (championship, playoff)? The music system's
   convention would be a second pressing with a printed diff, never a silent
   overwrite.
