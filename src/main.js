// GameDay — app entry.
//
// State lives in the URL (?year=&week=&conf=&q=) so any view is linkable,
// which the 2018 version could not do: it had one hardcoded week and no
// concept of navigation at all.

import { CONFERENCES, fetchCalendar, fetchWeek, weekFor, inConference } from './api/espn.js';
import { fetchRankings, applyRankings, weekHasOwnRanks, byRanking, byKickoff } from './api/rankings.js';
import { forecastFor } from './api/weather.js';
import { cardFor, paintWeather, patchCard } from './ui/card.js';
import { loadIndex, matchupSlug, loadIssue } from './sound.js';
import { openIssue } from './ui/issue.js';
import { openPicker, getTeam, hasBeenAsked, markAsked } from './ui/teampicker.js';
import { loadSeries } from './series.js';

const SEASON = 2026;

const el = {
	slate: document.getElementById('slate'),
	weekLabel: document.getElementById('week-label'),
	weekDetail: document.getElementById('week-detail'),
	prev: document.getElementById('prev-week'),
	next: document.getElementById('next-week'),
	conf: document.getElementById('conf'),
	search: document.getElementById('search'),
	favOnly: document.getElementById('fav-only'),
	hideCupcakes: document.getElementById('hide-cupcakes'),
	sort: document.getElementById('sort'),
	myTeam: document.getElementById('my-team'),
	poll: document.getElementById('poll'),
	status: document.getElementById('status'),
	count: document.getElementById('count'),
	live: document.getElementById('live'),
};

const state = {
	year: SEASON,
	week: null,
	conf: 'power4', // the Power 4 is the default view
	q: '',
	sort: 'rank', // open sorted by ranking
	favOnly: false,
	hideCupcakes: false,
	calendar: null,
	games: [],
	favorites: loadFavorites(),
	team: getTeam(), // the reader's own team, pinned to the top
	poll: null,
};

// ---------- favorites ----------

function loadFavorites() {
	try {
		return new Set(JSON.parse(localStorage.getItem('gd:favorites') ?? '[]'));
	} catch {
		return new Set();
	}
}

function saveFavorites() {
	try {
		localStorage.setItem('gd:favorites', JSON.stringify([...state.favorites]));
	} catch {
		/* non-fatal */
	}
}

// ---------- url state ----------

function readUrl() {
	const p = new URLSearchParams(location.search);
	if (p.get('year')) state.year = Number(p.get('year'));
	if (p.get('week')) state.week = Number(p.get('week'));
	if (p.get('conf')) state.conf = p.get('conf');
	if (p.get('q')) state.q = p.get('q');
	if (p.get('fav') === '1') state.favOnly = true;
	if (p.get('nocupcakes') === '1') state.hideCupcakes = true;
	if (p.get('sort') === 'time') state.sort = 'time';
}

function writeUrl() {
	const p = new URLSearchParams();
	p.set('year', state.year);
	if (state.week) p.set('week', state.week);
	if (state.conf !== 'power4') p.set('conf', state.conf);
	if (state.q) p.set('q', state.q);
	if (state.favOnly) p.set('fav', '1');
	if (state.hideCupcakes) p.set('nocupcakes', '1');
	if (state.sort !== 'rank') p.set('sort', state.sort);
	history.replaceState(null, '', `?${p}`);
}

// ---------- boot ----------

async function boot() {
	readUrl();

	for (const c of CONFERENCES) {
		const opt = document.createElement('option');
		opt.value = c.id;
		opt.textContent = c.name;
		el.conf.append(opt);
	}
	el.conf.value = state.conf;
	el.search.value = state.q;
	el.favOnly.checked = state.favOnly;
	el.hideCupcakes.checked = state.hideCupcakes;
	el.sort.value = state.sort;
	paintMyTeam();

	try {
		state.calendar = await fetchCalendar(state.year);
	} catch (err) {
		return fail(`Could not reach the schedule service. ${err.message}`);
	}

	if (!state.week) state.week = weekFor(state.calendar);
	wire();
	await load();

	// Ask once, after the slate is up, so the app is never a wall on arrival.
	if (!hasBeenAsked() && !state.team) {
		const picked = await openPicker({ firstRun: true });
		if (picked) {
			state.team = picked;
			paintMyTeam();
			render();
		} else {
			markAsked();
		}
	}
}

function paintMyTeam() {
	if (state.team) {
		el.myTeam.textContent = state.team.short ?? state.team.name;
		el.myTeam.classList.add('has-team');
		el.myTeam.style.setProperty('--tc', state.team.color ? `#${state.team.color}` : 'var(--accent)');
		el.myTeam.title = `Your team: ${state.team.name}. Click to change.`;
	} else {
		el.myTeam.textContent = 'Pick your team';
		el.myTeam.classList.remove('has-team');
		el.myTeam.style.removeProperty('--tc');
		el.myTeam.title = 'Pin one team to the top of every week';
	}
}

/** Is this the reader's team, or one they starred? */
function isMine(game) {
	const ids = [game.home.id, game.away.id];
	return (state.team && ids.includes(state.team.id)) || ids.some((id) => state.favorites.has(id));
}

function wire() {
	el.prev.addEventListener('click', () => step(-1));
	el.next.addEventListener('click', () => step(1));
	// Conference and cupcake are views over the same fetched week, not refetches.
	el.conf.addEventListener('change', () => {
		state.conf = el.conf.value;
		render();
		writeUrl();
	});
	el.favOnly.addEventListener('change', () => {
		state.favOnly = el.favOnly.checked;
		render();
		writeUrl();
	});
	el.hideCupcakes.addEventListener('change', () => {
		state.hideCupcakes = el.hideCupcakes.checked;
		render();
		writeUrl();
	});
	el.sort.addEventListener('change', () => {
		state.sort = el.sort.value;
		render();
		writeUrl();
	});
	el.myTeam.addEventListener('click', async () => {
		state.team = await openPicker({ firstRun: false });
		paintMyTeam();
		render();
	});

	let t;
	el.search.addEventListener('input', () => {
		clearTimeout(t);
		t = setTimeout(() => {
			state.q = el.search.value.trim();
			render();
			writeUrl();
		}, 150);
	});

	document.addEventListener('keydown', (e) => {
		if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
		if (e.key === 'ArrowLeft') step(-1);
		if (e.key === 'ArrowRight') step(1);
		if (e.key === '/') {
			e.preventDefault();
			el.search.focus();
		}
	});

	// Delegated: star a team, or open a Sound issue.
	el.slate.addEventListener('click', async (e) => {
		const star = e.target.closest('.team');
		const openBtn = e.target.closest('.sound-open');

		if (openBtn) {
			const slug = openBtn.dataset.slug;
			openBtn.disabled = true;
			openBtn.textContent = 'Opening…';
			try {
				openIssue(await loadIssue(slug));
			} catch (err) {
				openBtn.textContent = 'Unavailable';
				console.warn(`[gameday] issue ${slug}: ${err.message}`);
				return;
			}
			openBtn.disabled = false;
			openBtn.textContent = 'Read the issue';
			return;
		}

		if (star && e.detail === 2) {
			const card = star.closest('.game');
			const game = state.games.find((g) => g.id === card.dataset.gameId);
			if (!game) return;
			const id = star.classList.contains('team-home') ? game.home.id : game.away.id;
			state.favorites.has(id) ? state.favorites.delete(id) : state.favorites.add(id);
			saveFavorites();
			render();
		}
	});
}

function step(delta) {
	const weeks = state.calendar.weeks.map((w) => w.week);
	const i = weeks.indexOf(state.week);
	const next = weeks[Math.min(weeks.length - 1, Math.max(0, i + delta))];
	if (next === state.week) return;
	state.week = next;
	load();
}

// ---------- load + render ----------

async function load() {
	el.status.textContent = 'Loading the slate…';
	el.slate.setAttribute('aria-busy', 'true');
	writeUrl();
	updateWeekLabel();

	try {
		const [games, ranks] = await Promise.all([
			fetchWeek(state.year, state.week),
			fetchRankings(),
			loadIndex(),
			loadSeries(),
		]);

		// The rankings endpoint serves only the CURRENT poll, so it may only be
		// used on a week that has no poll of its own. A played week carries the
		// ranks that were true at the time and those win — otherwise browsing
		// 2018 prints 2026 ranks, which is how a phantom "#18 Tennessee" landed
		// on a 4-5 team in Week 10 of 2018.
		const own = weekHasOwnRanks(games);
		state.games = own ? games : applyRankings(games, ranks.byTeam);
		state.poll = own ? null : ranks.poll;
		el.poll.textContent = own
			? `${state.year} Week ${state.week} · ranks as they stood`
			: ranks.poll
				? `Ranked by ${ranks.poll}${ranks.occurrence ? ` · ${ranks.occurrence}` : ''}`
				: '';
	} catch (err) {
		return fail(`Could not load week ${state.week}. ${err.message}`);
	}

	el.slate.removeAttribute('aria-busy');
	el.status.textContent = '';
	await render();
}

function updateWeekLabel() {
	const w = state.calendar.weeks.find((x) => x.week === state.week);
	el.weekLabel.textContent = w?.label ?? `Week ${state.week}`;
	el.weekDetail.textContent = w?.detail ?? '';
	const weeks = state.calendar.weeks.map((x) => x.week);
	el.prev.disabled = weeks.indexOf(state.week) <= 0;
	el.next.disabled = weeks.indexOf(state.week) >= weeks.length - 1;
}

function visible() {
	const q = state.q.toLowerCase();
	return state.games.filter((g) => {
		if (!inConference(g, state.conf)) return false;
		if (state.hideCupcakes && g.mismatch.cupcake) return false;
		if (state.favOnly && !isMine(g)) return false;
		if (!q) return true;
		return [g.home.name, g.away.name, g.venue.name, g.venue.city, g.venue.state]
			.join(' ')
			.toLowerCase()
			.includes(q);
	});
}

/**
 * Sort order. Your team first, always — that is the whole point of choosing
 * one. Then by rank (the default) or by kickoff.
 */
function sorted(games) {
	const base = state.sort === 'time' ? byKickoff : byRanking;
	return [...games].sort((a, b) => {
		const ma = isMine(a) ? 0 : 1;
		const mb = isMine(b) ? 0 : 1;
		return ma !== mb ? ma - mb : base(a, b);
	});
}

async function render() {
	const index = await loadIndex();
	const games = sorted(visible());

	el.slate.replaceChildren();
	if (!games.length) {
		el.slate.append(empty());
	} else {
		const frag = document.createDocumentFragment();
		for (const g of games) {
			frag.append(
				cardFor(g, {
					issue: index.get(matchupSlug(g)) ?? null,
					favorites: state.favorites,
					myTeamId: state.team?.id ?? null,
				})
			);
		}
		el.slate.append(frag);
	}

	// Count against the conference view, not the whole FBS slate, and always
	// say how many cupcakes are in it — that number is the point of the week.
	const inConf = state.games.filter((g) => inConference(g, state.conf));
	const cupcakes = inConf.filter((g) => g.mismatch.cupcake).length;
	const parts = [games.length === inConf.length ? `${inConf.length} games` : `${games.length} of ${inConf.length} games`];
	if (cupcakes) parts.push(state.hideCupcakes ? `${cupcakes} hidden` : `${cupcakes} cupcake${cupcakes === 1 ? '' : 's'}`);
	el.count.textContent = parts.join(' · ');

	fillWeather(); // cards exist now; weather paints in behind them
	scheduleLive(); // start (or stop) polling based on what is on screen
}

function empty() {
	const d = document.createElement('p');
	d.className = 'empty';
	d.textContent = state.games.length
		? 'No games match that filter.'
		: 'No games scheduled for this week in this conference.';
	return d;
}

/**
 * Weather fills in per card after the slate is already on screen.
 * The 2018 version chained geocode -> darksky inside the render loop, so a
 * slow or failed leg took the card with it. Here a card is never blocked.
 */
const wxCache = new Map(); // game id -> forecast, so filtering never refetches

async function fillWeather() {
	const cards = [...el.slate.querySelectorAll('.game')];
	const queue = [];

	for (const card of cards) {
		const game = state.games.find((g) => g.id === card.dataset.gameId);
		if (!game) continue;
		const cached = wxCache.get(game.id);
		if (cached) paintWeather(card, cached);
		else queue.push({ card, game });
	}

	// Small concurrency cap — polite to a free, unauthenticated API.
	const LANES = 6;
	await Promise.all(
		Array.from({ length: LANES }, async () => {
			while (queue.length) {
				const { card, game } = queue.shift();
				if (!card.isConnected) continue;
				let fc;
				try {
					fc = await forecastFor(game);
				} catch {
					fc = { status: 'unknown' };
				}
				wxCache.set(game.id, fc);
				if (card.isConnected) paintWeather(card, fc);
			}
		})
	);
}

// ---------- live scores ----------
//
// Polls ONLY while something is actually being played, and only while the tab
// is visible. A free unauthenticated endpoint does not deserve a heartbeat
// from a page nobody is looking at.

const LIVE_MS = 30000;
let liveTimer = null;
let lastTick = null;

/** A game is worth polling for if it is in progress, or should have kicked off. */
function isLiveish(g) {
	if (g.status.state === 'in') return true;
	// A 'pre' game whose kickoff has passed is about to flip; ESPN lags a little.
	return g.status.state === 'pre' && g.timeValid && new Date(g.date) <= Date.now();
}

function liveCount() {
	return state.games.filter(isLiveish).length;
}

function scheduleLive() {
	clearTimeout(liveTimer);
	liveTimer = null;
	if (document.hidden) return paintLive();
	if (!liveCount()) return paintLive();
	liveTimer = setTimeout(tickLive, LIVE_MS);
	paintLive();
}

async function tickLive() {
	if (document.hidden || !liveCount()) return scheduleLive();

	try {
		const fresh = await fetchWeek(state.year, state.week);
		const ranks = await fetchRankings();
		applyRankings(fresh, ranks.byTeam);

		const byId = new Map(fresh.map((g) => [g.id, g]));
		let changed = 0;

		for (const [i, old] of state.games.entries()) {
			const next = byId.get(old.id);
			if (!next) continue;
			const moved =
				next.home.score !== old.home.score ||
				next.away.score !== old.away.score ||
				next.status.state !== old.status.state ||
				next.status.detail !== old.status.detail;
			state.games[i] = next;
			if (!moved) continue;
			changed++;
			const card = el.slate.querySelector(`.game[data-game-id="${next.id}"]`);
			if (card) patchCard(card, next);
		}

		lastTick = Date.now();
		if (changed) el.count.classList.add('count-flash');
		setTimeout(() => el.count.classList.remove('count-flash'), 900);
	} catch {
		// A dropped poll is not worth surfacing — the next one is 30s away.
	}
	scheduleLive();
}

function paintLive() {
	const n = liveCount();
	if (!n) {
		el.live.textContent = '';
		el.live.className = 'live-status';
		return;
	}
	const ago = lastTick ? Math.round((Date.now() - lastTick) / 1000) : null;
	el.live.className = document.hidden ? 'live-status is-paused' : 'live-status is-live';
	el.live.textContent = document.hidden
		? `${n} live · paused`
		: `${n} live · ${ago == null ? 'updating…' : `updated ${ago}s ago`}`;
}

document.addEventListener('visibilitychange', () => {
	if (!document.hidden && liveCount()) tickLive();
	else scheduleLive();
});

setInterval(paintLive, 5000); // keep the "updated Ns ago" honest

function fail(msg) {
	el.slate.removeAttribute('aria-busy');
	el.slate.replaceChildren();
	el.status.textContent = msg;
	el.status.classList.add('error');
}

boot();
