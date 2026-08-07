// The slate. ESPN's public scoreboard endpoint: no API key, CORS-open,
// which is what lets this whole app be a static page again.
//
// The 2018 version used FantasyData behind a Heroku CORS proxy with the key
// committed in source. All three of those are dead or wrong. This has none.

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football';

/** groups=80 is FBS. Without it you also get FCS and the slate triples. */
const FBS = '80';

/** The Power 4. The default view, because it is the football that matters. */
export const POWER_4 = new Set(['8', '5', '4', '1']); // SEC, Big Ten, Big 12, ACC

/** Every FBS conference ESPN issues an id for. Anything else is FCS. */
export const FBS_CONFERENCES = new Set(['1', '4', '5', '8', '9', '12', '15', '17', '18', '37', '151']);

/**
 * Filter values. `power4` and `80` are client-side selections over one fetch,
 * not separate requests — the slate is small enough to filter in the page.
 */
export const CONFERENCES = [
	{ id: 'power4', name: 'Power 4', short: 'P4' },
	{ id: '80', name: 'All FBS', short: 'FBS' },
	{ id: '8', name: 'SEC', short: 'SEC' },
	{ id: '1', name: 'ACC', short: 'ACC' },
	{ id: '5', name: 'Big Ten', short: 'B1G' },
	{ id: '4', name: 'Big 12', short: 'XII' },
	{ id: '9', name: 'Pac-12', short: 'PAC' },
	{ id: '151', name: 'American', short: 'AAC' },
	{ id: '12', name: 'Conference USA', short: 'CUSA' },
	{ id: '15', name: 'Mid-American', short: 'MAC' },
	{ id: '17', name: 'Mountain West', short: 'MW' },
	{ id: '37', name: 'Sun Belt', short: 'SBC' },
	{ id: '18', name: 'Independents', short: 'IND' },
];

/** Does this game belong in the selected conference view? */
export function inConference(game, conf) {
	if (conf === '80') return true;
	const ids = [String(game.home.conferenceId ?? ''), String(game.away.conferenceId ?? '')];
	if (conf === 'power4') return ids.some((id) => POWER_4.has(id));
	return ids.includes(String(conf));
}

async function getJSON(url) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`ESPN ${res.status} for ${url}`);
	return res.json();
}

/**
 * The season calendar: every week with its date range.
 * This is what makes the week a real navigable dimension — the thing the
 * 2018 app stubbed out with `var page = 10` and two commented-out buttons.
 */
export async function fetchCalendar(year) {
	const d = await getJSON(`${BASE}/scoreboard?dates=${year}&limit=1`);
	const league = d.leagues?.[0] ?? {};
	const regular = (league.calendar ?? []).find((c) => c.value === '2');
	const weeks = (regular?.entries ?? []).map((e) => ({
		week: Number(e.value),
		label: e.label,
		detail: e.detail,
		startDate: e.startDate,
		endDate: e.endDate,
	}));
	return { year, seasonStart: regular?.startDate, seasonEnd: regular?.endDate, weeks };
}

/** Which week contains `date` — falls back to week 1 before the season, last week after. */
export function weekFor(calendar, date = new Date()) {
	const t = date.getTime();
	for (const w of calendar.weeks) {
		if (t >= new Date(w.startDate).getTime() && t <= new Date(w.endDate).getTime()) return w.week;
	}
	if (calendar.weeks.length && t < new Date(calendar.weeks[0].startDate).getTime()) {
		return calendar.weeks[0].week;
	}
	return calendar.weeks.at(-1)?.week ?? 1;
}

/**
 * One week's games, normalized. Everything downstream reads THIS shape,
 * never ESPN's — so swapping in CFBD later touches only this file.
 */
export async function fetchWeek(year, week) {
	const url = `${BASE}/scoreboard?dates=${year}&seasontype=2&week=${week}&groups=${FBS}&limit=300`;
	const d = await getJSON(url);
	return (d.events ?? []).map(normalizeGame).filter(Boolean);
}

/** "ALA -45.5" -> 45.5. Null when there is no line, which is itself a signal. */
function spreadOf(odds) {
	const m = /-(\d+(?:\.\d+)?)/.exec(odds?.details ?? '');
	return m ? Number(m[1]) : null;
}

/**
 * Cupcake detection. September is full of body-bag games, and a slate that
 * shows them at the same weight as a real matchup is lying about the week.
 *   fcs    — an FBS team hosting a non-FBS opponent
 *   spread — the book expects a blowout
 * Threshold is 21: three scores, the point past which the game stops being
 * a contest. Deliberately conservative — it hides nothing by itself, it only
 * marks. The reader chooses whether to filter.
 */
const BLOWOUT = 21;

function mismatchOf(comp, home, away) {
	const fcs = [home, away].some((t) => t.conferenceId != null && !FBS_CONFERENCES.has(String(t.conferenceId)));
	const spread = spreadOf(comp.odds?.[0]);
	return { fcs, spread, cupcake: fcs || (spread != null && spread >= BLOWOUT) };
}

function side(competitors, which) {
	const c = competitors.find((x) => x.homeAway === which) ?? {};
	const t = c.team ?? {};
	return {
		id: t.id,
		name: t.displayName ?? 'TBA',
		short: t.shortDisplayName ?? t.abbreviation ?? '',
		abbr: t.abbreviation ?? '',
		location: t.location ?? '',
		nickname: t.name ?? '',
		color: t.color,
		altColor: t.alternateColor,
		logo: t.logo,
		conferenceId: t.conferenceId,
		score: c.score == null ? null : Number(c.score),
		rank: c.curatedRank?.current && c.curatedRank.current <= 25 ? c.curatedRank.current : null,
		record: (c.records ?? []).find((r) => r.type === 'total')?.summary ?? null,
		winner: c.winner === true,
	};
}

function normalizeGame(ev) {
	const comp = ev.competitions?.[0];
	if (!comp) return null;
	const venue = comp.venue ?? {};
	const addr = venue.address ?? {};
	const status = ev.status ?? {};

	const home = side(comp.competitors ?? [], 'home');
	const away = side(comp.competitors ?? [], 'away');

	return {
		id: ev.id,
		name: ev.name,
		shortName: ev.shortName,
		date: comp.date ?? ev.date,
		// ESPN parks an unscheduled game at midnight UTC and flags it here.
		// Mid-season most of the slate is TBA — week 6 of 2026 is 37 of 58 —
		// so rendering that placeholder as a kickoff time would be a lie.
		timeValid: comp.timeValid !== false,
		week: ev.week?.number ?? null,
		season: ev.season?.year ?? null,

		home,
		away,
		mismatch: mismatchOf(comp, home, away),

		venue: {
			id: venue.id ?? null,
			name: venue.fullName ?? 'Site TBA',
			city: addr.city ?? '',
			state: addr.state ?? '',
			indoor: venue.indoor === true,
		},

		neutralSite: comp.neutralSite === true,
		conferenceGame: comp.conferenceCompetition === true,
		notes: (comp.notes ?? []).map((n) => n.headline).filter(Boolean),

		broadcast: (comp.broadcasts ?? []).flatMap((b) => b.names ?? [])[0] ?? null,
		odds: comp.odds?.[0]
			? { details: comp.odds[0].details ?? null, overUnder: comp.odds[0].overUnder ?? null }
			: null,

		status: {
			state: status.type?.state ?? 'pre', // pre | in | post
			detail: status.type?.shortDetail ?? '',
			completed: status.type?.completed === true,
		},

		links: { gamecast: (ev.links ?? []).find((l) => l.rel?.includes('summary'))?.href ?? null },
	};
}
