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
let records = null;
let lines = null;

export async function loadSeries() {
	if (slugs && records && lines) return { slugs, records, lines };

	const [w, s, l] = await Promise.all([
		fetch('data/winsipedia.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
		// Both optional. Absent until the build tools have run, and the card
		// simply shows less until then.
		fetch('data/series.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
		fetch('data/lines.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
	]);

	slugs = new Map(Object.entries(w?.teams ?? {}));
	records = new Map(Object.entries(s?.series ?? {}));
	lines = new Map(Object.entries(l?.games ?? {}));
	return { slugs, records, lines };
}

/**
 * The multi-book average line, or null.
 *
 * ESPN carries one book and drops odds the moment a game ends. This is built
 * from CFBD across every book it lists, one vote each, and a completed game's
 * number is by definition its CLOSING line — it cannot move again.
 */
export function avgLine(game) {
	if (!lines) return null;
	return lines.get(`${game.season}-w${game.week}-${game.away.id}-${game.home.id}`) ?? null;
}

/** "Avg −7.2 · O/U 48.1 · 3 books", or the closing number on a finished game. */
export function lineText(game) {
	const l = avgLine(game);
	if (!l || (l.spread == null && l.overUnder == null)) return null;

	const parts = [];
	if (l.spread != null) {
		// CFBD's sign convention is home-relative: negative means home is favoured.
		const fav = l.spread < 0 ? game.home : game.away;
		const num = Math.abs(l.spread);
		parts.push(`${fav.abbr || fav.short || fav.name} −${num}`);
	}
	if (l.overUnder != null) parts.push(`O/U ${l.overUnder}`);
	return {
		text: parts.join(' · '),
		label: l.closing ? 'closing' : `avg of ${l.books}`,
		books: l.books,
		closing: l.closing,
	};
}

/** Away vs home, matching how the matchup reads. Null unless BOTH sides map. */
export function seriesUrl(game) {
	if (!slugs) return null;
	const away = slugs.get(String(game.away.id));
	const home = slugs.get(String(game.home.id));
	if (!away || !home || away === home) return null;
	return `https://www.winsipedia.com/${away}/vs/${home}`;
}

/**
 * The all-time record for this matchup, or null.
 *
 * Built at BUILD time from CollegeFootballData — see tools/build-series.py.
 * Two teams that have never met are a real answer, not a missing one, so the
 * caller gets `meetings: 0` and says "First meeting" rather than nothing.
 */
export function seriesRecord(game) {
	if (!records) return null;
	return records.get(`${game.away.id}-${game.home.id}`) ?? null;
}

/** One line for the card: "Georgia leads 44-25-4 · last met 2024". */
export function seriesLine(game) {
	const r = seriesRecord(game);
	if (!r) return null;
	if (!r.meetings) return 'First meeting';
	const parts = [r.summary];
	if (r.last?.season) parts.push(`last met ${r.last.season}`);
	return parts.join(' · ');
}
