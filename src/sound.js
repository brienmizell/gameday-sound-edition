// THE SOUND EDITION — the seam.
//
// This file is the entire contract between the schedule app (this repo) and
// the music system (briens-mac-mini.local:~/musicsystem). GameDay renders
// whatever sound data exists and behaves normally when none does, so the two
// halves can be built and shipped independently.
//
// The music side WRITES data/sound/<slug>.json + data/sound/index.json.
// The app only READS them. Nothing here calls Spotify, and nothing here
// generates prose — per the musicsystem ruling, a human writes the issue.
//
// Schema: see data/sound/SCHEMA.md. Shape is validated, not trusted.

/** Canonical matchup id. The music side must produce the same string. */
export function matchupSlug(game) {
	const norm = (s) =>
		String(s || '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '');
	const season = game.season ?? new Date(game.date).getFullYear();
	const week = String(game.week ?? 0).padStart(2, '0');
	return `${season}-w${week}-${norm(game.away.short || game.away.name)}-at-${norm(game.home.short || game.home.name)}`;
}

let indexPromise = null;

/**
 * The set of matchups that have an issue. One fetch per page load.
 * A missing or malformed index is not an error — it means "none yet",
 * which is the correct state for every week until the music side runs.
 */
export function loadIndex() {
	if (!indexPromise) {
		indexPromise = fetch('data/sound/index.json', { cache: 'no-cache' })
			.then((r) => (r.ok ? r.json() : { issues: [] }))
			.then((d) => new Map((d.issues ?? []).map((i) => [i.slug, i])))
			.catch(() => new Map());
	}
	return indexPromise;
}

export async function issueFor(game) {
	const index = await loadIndex();
	return index.get(matchupSlug(game)) ?? null;
}

/** Full issue body, loaded only when the reader opens it. */
export async function loadIssue(slug) {
	const res = await fetch(`data/sound/${slug}.json`, { cache: 'no-cache' });
	if (!res.ok) throw new Error(`no issue at data/sound/${slug}.json`);
	return validate(await res.json());
}

/**
 * Structural validation. The music side is a different machine and a
 * different language; a bad write should degrade this page, not break it.
 * Returns the issue with unusable parts dropped and `_warnings` attached.
 */
export function validate(raw) {
	const warn = [];
	const issue = {
		slug: str(raw.slug),
		title: str(raw.title) || 'Untitled issue',
		masthead: str(raw.masthead),
		declaration: str(raw.declaration),
		playlistUrl: str(raw.playlistUrl) || null,
		writeupUrl: str(raw.writeupUrl) || null,
		status: ['pressed', 'held', 'field-note'].includes(raw.status) ? raw.status : 'pressed',
		sides: {
			home: side(raw.sides?.home, warn, 'home'),
			away: side(raw.sides?.away, warn, 'away'),
		},
		neutralField: str(raw.neutralField) || null,
		tracks: [],
		sources: Array.isArray(raw.sources) ? raw.sources.map(str).filter(Boolean) : [],
	};

	for (const [i, t] of (Array.isArray(raw.tracks) ? raw.tracks : []).entries()) {
		if (!t || !t.artist || !t.title) {
			warn.push(`track ${i + 1} missing artist or title — dropped`);
			continue;
		}
		issue.tracks.push({
			n: Number(t.n) || issue.tracks.length + 1,
			artist: str(t.artist),
			title: str(t.title),
			year: t.year == null ? null : Number(t.year),
			side: ['home', 'away', 'neutral', 'tailgate'].includes(t.side) ? t.side : 'neutral',
			tier: str(t.tier) || null, // T0 town, T1 enrollment, T2 room, T3 stadium, T4 diaspora
			receipt: str(t.receipt) || null, // the fact that earns the seat
			plays: t.plays == null ? null : Number(t.plays),
			note: str(t.note) || null, // the 40-90 word paragraph
			spotifyUrl: str(t.spotifyUrl) || null,
		});
	}

	if (issue.status === 'pressed' && !issue.tracks.length) {
		warn.push('status is "pressed" but no tracks resolved');
	}
	issue._warnings = warn;
	return issue;
}

function side(s, warn, which) {
	if (!s) {
		warn.push(`sides.${which} missing`);
		return { school: '', town: '', scene: '', plays: null };
	}
	return {
		school: str(s.school),
		town: str(s.town),
		scene: str(s.scene), // the musical-history paragraph for this side
		plays: s.plays == null ? null : Number(s.plays),
	};
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** Counts for the card badge: "12 home · 8 away · 2 tailgate". */
export function tally(issue) {
	const c = { home: 0, away: 0, neutral: 0, tailgate: 0 };
	for (const t of issue.tracks) c[t.side]++;
	return c;
}
