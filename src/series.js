// Head-to-head series history — a link out to Winsipedia.
//
// Winsipedia has the best all-time-series pages anywhere: the record, the
// streaks, the largest margins, every meeting since 1892. GameDay links to
// them rather than reproducing them, for two concrete reasons and one good one:
//
//   * their robots.txt Disallows /api/, so their data endpoints are off-limits;
//   * their pages send no CORS headers, so a static page in a browser could not
//     read them even if it were allowed to;
//   * a link costs them nothing and sends them traffic, which is the right way
//     to use someone else's work.
//
// The slug table is built once by tools/build-winsipedia.py from the sitemap
// they publish, so this ships as static data and adds no request at runtime.
//
// The numbers themselves — "Georgia leads 44-25-4" — are a different problem
// and want CollegeFootballData's /teams/matchup at build time. See
// SOUND_EDITION.md; that is what the write-up's series paragraph needs.

let slugs = null;

export async function loadSeries() {
	if (slugs) return slugs;
	try {
		const d = await fetch('data/winsipedia.json').then((r) => (r.ok ? r.json() : null));
		slugs = new Map(Object.entries(d?.teams ?? {}));
	} catch {
		slugs = new Map(); // no table, no links — the card is fine without them
	}
	return slugs;
}

/** Away vs home, matching how the matchup reads. Null unless BOTH sides map. */
export function seriesUrl(game) {
	if (!slugs) return null;
	const away = slugs.get(String(game.away.id));
	const home = slugs.get(String(game.home.id));
	if (!away || !home || away === home) return null;
	return `https://www.winsipedia.com/${away}/vs/${home}`;
}
