// Rankings.
//
// The scoreboard's inline `curatedRank` is null for most of the season, so the
// poll has to be fetched separately and joined by team id.
//
// Which poll: the College Football Playoff rankings are the real answer once
// they exist, but they do not appear until early November. Until then the AP
// Top 25 is the poll of record. The Coaches Poll is the last resort — in early
// August it is genuinely the only one published, so the app would otherwise
// show nothing ranked at all.
//
// Whichever one wins, the UI names it. A rank with no poll attached is a
// number the reader cannot check.

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football';

/** Preference order. First match wins. */
const PREFERENCE = [
	{ key: 'cfp', label: 'CFP Rankings', match: (r) => /playoff|^cfp$/i.test(`${r.type} ${r.name} ${r.shortName}`) },
	{ key: 'ap', label: 'AP Top 25', match: (r) => /\bap\b/i.test(`${r.type} ${r.name} ${r.shortName}`) },
	{ key: 'coaches', label: 'Coaches Poll', match: (r) => /coaches|usa/i.test(`${r.type} ${r.name} ${r.shortName}`) },
];

let cached = null;

/**
 * Returns { byTeam: Map(teamId -> rank), poll: label, occurrence: string }.
 * Never throws — with no poll the app simply has no ranks, and sorting falls
 * back to kickoff time.
 */
export async function fetchRankings() {
	if (cached) return cached;

	let data;
	try {
		const res = await fetch(`${BASE}/rankings`);
		if (!res.ok) throw new Error(String(res.status));
		data = await res.json();
	} catch {
		cached = { byTeam: new Map(), poll: null, occurrence: null };
		return cached;
	}

	const polls = (data.rankings ?? []).filter((r) => (r.ranks ?? []).length);
	let chosen = null;
	for (const pref of PREFERENCE) {
		const hit = polls.find((r) => pref.match({ type: r.type ?? '', name: r.name ?? '', shortName: r.shortName ?? '' }));
		if (hit) {
			chosen = { poll: hit, label: pref.label };
			break;
		}
	}
	if (!chosen && polls.length) chosen = { poll: polls[0], label: polls[0].name ?? 'Poll' };

	const byTeam = new Map();
	for (const row of chosen?.poll?.ranks ?? []) {
		const id = row.team?.id;
		if (id && row.current) byTeam.set(String(id), Number(row.current));
	}

	cached = {
		byTeam,
		poll: chosen?.label ?? null,
		occurrence: chosen?.poll?.occurrence?.displayValue ?? null,
	};
	return cached;
}

/** Stamp poll ranks onto games that the scoreboard left unranked. */
export function applyRankings(games, byTeam) {
	if (!byTeam.size) return games;
	for (const g of games) {
		for (const t of [g.home, g.away]) {
			if (t.rank == null && t.id) {
				const r = byTeam.get(String(t.id));
				if (r) t.rank = r;
			}
		}
	}
	return games;
}

const UNRANKED = 999;

/**
 * Sort key for "by ranking".
 *   [best rank, other rank, kickoff]
 * so #1 vs #2 outranks #1 vs unranked, and everything unranked falls back to
 * chronological order among itself.
 */
export function rankKey(game) {
	const a = game.home.rank ?? UNRANKED;
	const b = game.away.rank ?? UNRANKED;
	return [Math.min(a, b), Math.max(a, b), new Date(game.date).getTime()];
}

export function byRanking(a, b) {
	const ka = rankKey(a);
	const kb = rankKey(b);
	for (let i = 0; i < ka.length; i++) {
		if (ka[i] !== kb[i]) return ka[i] - kb[i];
	}
	return 0;
}

export function byKickoff(a, b) {
	return new Date(a.date) - new Date(b.date);
}
