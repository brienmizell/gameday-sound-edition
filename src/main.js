// GameDay — app entry.
//
// State lives in the URL (?year=&week=&conf=&q=) so any view is linkable,
// which the 2018 version could not do: it had one hardcoded week and no
// concept of navigation at all.

import { CONFERENCES, fetchCalendar, fetchWeek, weekFor, inConference } from './api/espn.js';
import { forecastFor } from './api/weather.js';
import { cardFor, paintWeather } from './ui/card.js';
import { loadIndex, matchupSlug, loadIssue } from './sound.js';
import { openIssue } from './ui/issue.js';

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
	status: document.getElementById('status'),
	count: document.getElementById('count'),
};

const state = {
	year: SEASON,
	week: null,
	conf: 'power4', // the Power 4 is the default view
	q: '',
	favOnly: false,
	hideCupcakes: false,
	calendar: null,
	games: [],
	favorites: loadFavorites(),
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
}

function writeUrl() {
	const p = new URLSearchParams();
	p.set('year', state.year);
	if (state.week) p.set('week', state.week);
	if (state.conf !== 'power4') p.set('conf', state.conf);
	if (state.q) p.set('q', state.q);
	if (state.favOnly) p.set('fav', '1');
	if (state.hideCupcakes) p.set('nocupcakes', '1');
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

	try {
		state.calendar = await fetchCalendar(state.year);
	} catch (err) {
		return fail(`Could not reach the schedule service. ${err.message}`);
	}

	if (!state.week) state.week = weekFor(state.calendar);
	wire();
	await load();
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
		const [games] = await Promise.all([fetchWeek(state.year, state.week), loadIndex()]);
		state.games = games.sort((a, b) => new Date(a.date) - new Date(b.date));
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
		if (state.favOnly && !state.favorites.has(g.home.id) && !state.favorites.has(g.away.id)) return false;
		if (!q) return true;
		return [g.home.name, g.away.name, g.venue.name, g.venue.city, g.venue.state]
			.join(' ')
			.toLowerCase()
			.includes(q);
	});
}

async function render() {
	const index = await loadIndex();
	const games = visible();

	el.slate.replaceChildren();
	if (!games.length) {
		el.slate.append(empty());
	} else {
		const frag = document.createDocumentFragment();
		for (const g of games) {
			frag.append(cardFor(g, { issue: index.get(matchupSlug(g)) ?? null, favorites: state.favorites }));
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

function fail(msg) {
	el.slate.removeAttribute('aria-busy');
	el.slate.replaceChildren();
	el.status.textContent = msg;
	el.status.classList.add('error');
}

boot();
