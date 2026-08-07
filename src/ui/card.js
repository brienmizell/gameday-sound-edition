// The matchup card. The one real idea the 2018 app had, widened.
//
// 2018 rendered: two team names, two scores, a stadium string, a city/state,
// a truncated date, and three weather lines. Eight fields.
// This adds rank, record, logo, team color, TV, line, venue flags, kickoff in
// the viewer's own timezone, a countdown, and the Sound slot.

import { weatherLabel, kickoff, countdown, temp, teamColor, logoUrl } from '../util/fmt.js';
import { matchupSlug } from '../sound.js';

export function cardFor(game, { issue = null, favorites = new Set(), myTeamId = null } = {}) {
	const el = document.createElement('article');
	el.className = 'game';
	el.dataset.gameId = game.id;
	el.dataset.slug = matchupSlug(game);

	const isMine = myTeamId != null && (game.home.id === myTeamId || game.away.id === myTeamId);
	const isFav = favorites.has(game.home.id) || favorites.has(game.away.id);
	if (isMine) el.classList.add('is-mine');
	if (isFav) el.classList.add('is-fav');
	if (game.status.state === 'in') el.classList.add('is-live');
	if (game.mismatch?.cupcake) el.classList.add('is-cupcake');

	el.style.setProperty('--home-color', teamColor(game.home.color));
	el.style.setProperty('--away-color', teamColor(game.away.color));
	if (isMine) {
		const mine = game.home.id === myTeamId ? game.home : game.away;
		el.style.setProperty('--mine-color', teamColor(mine.color, 'var(--accent)'));
	}

	el.append(header(game, isMine), teams(game, myTeamId), meta(game), soundSlot(game, issue));
	return el;
}

function header(game, isMine) {
	const h = document.createElement('div');
	h.className = 'game-head';

	if (isMine) {
		const m = document.createElement('span');
		m.className = 'mine-mark';
		m.textContent = 'Your team';
		h.append(m);
	}

	const k = kickoff(game.date, game.timeValid);
	const when = document.createElement('span');
	when.className = 'when';
	if (k.tba) when.classList.add('when-tba');
	when.textContent = game.status.state === 'post' ? 'Final' : `${k.day} · ${k.time}`;
	h.append(when);

	const cd = countdown(game.date, game.status.state);
	if (cd && game.status.state === 'pre') {
		const c = document.createElement('span');
		c.className = 'countdown';
		c.textContent = cd;
		h.append(c);
	}
	if (game.status.state === 'in') {
		const live = document.createElement('span');
		live.className = 'live-dot';
		live.textContent = game.status.detail || 'Live';
		h.append(live);
	}

	const tags = document.createElement('span');
	tags.className = 'tags';
	if (game.broadcast) tags.append(chip(game.broadcast, 'tv'));
	if (game.neutralSite) tags.append(chip('Neutral site', 'neutral'));
	if (game.conferenceGame) tags.append(chip('Conference', 'conf'));
	if (game.venue.indoor) tags.append(chip('Dome', 'dome'));
	if (game.mismatch?.cupcake) {
		tags.append(
			chip(game.mismatch.fcs ? 'FCS opponent' : `Line ${game.mismatch.spread}`, 'cupcake')
		);
	}
	h.append(tags);

	return h;
}

function chip(text, kind) {
	const s = document.createElement('span');
	s.className = `chip chip-${kind}`;
	s.textContent = text;
	return s;
}

function teams(game, myTeamId) {
	const wrap = document.createElement('div');
	wrap.className = 'teams';
	wrap.append(teamRow(game.away, game, 'away', myTeamId), teamRow(game.home, game, 'home', myTeamId));
	return wrap;
}

function teamRow(team, game, which, myTeamId) {
	const row = document.createElement('div');
	row.className = `team team-${which}`;
	if (game.status.completed && team.winner) row.classList.add('won');
	if (myTeamId != null && team.id === myTeamId) row.classList.add('is-mine-row');

	const bar = document.createElement('span');
	bar.className = 'team-bar';
	bar.style.background = teamColor(team.color);
	row.append(bar);

	const src = logoUrl(team.logo);
	if (src) {
		const img = document.createElement('img');
		img.className = 'logo';
		img.src = src;
		img.alt = '';
		img.decoding = 'async';
		img.width = 28;
		img.height = 28;
		row.append(img);
	}

	const name = document.createElement('span');
	name.className = 'team-name';
	if (team.rank) {
		const r = document.createElement('span');
		r.className = 'rank';
		r.textContent = team.rank;
		name.append(r);
	}
	name.append(document.createTextNode(team.name));
	row.append(name);

	if (team.record) {
		const rec = document.createElement('span');
		rec.className = 'record';
		rec.textContent = team.record;
		row.append(rec);
	}

	const score = document.createElement('span');
	score.className = 'score';
	score.textContent = game.status.state === 'pre' ? '' : (team.score ?? 0);
	row.append(score);

	return row;
}

function meta(game) {
	const m = document.createElement('div');
	m.className = 'game-meta';

	const place = document.createElement('div');
	place.className = 'venue';
	const where = [game.venue.city, game.venue.state].filter(Boolean).join(', ');
	place.innerHTML = `<strong>${escapeHtml(game.venue.name)}</strong>${where ? ` · ${escapeHtml(where)}` : ''}`;
	m.append(place);

	const wx = document.createElement('div');
	wx.className = 'weather';
	wx.dataset.pending = '1';
	wx.textContent = '…';
	m.append(wx);

	if (game.odds?.details) {
		const o = document.createElement('div');
		o.className = 'odds';
		o.textContent = game.odds.overUnder
			? `${game.odds.details} · O/U ${game.odds.overUnder}`
			: game.odds.details;
		m.append(o);
	}

	if (game.notes.length) {
		const n = document.createElement('div');
		n.className = 'note';
		n.textContent = game.notes[0];
		m.append(n);
	}

	return m;
}

/** Paint the weather line once its request settles. Never blocks the card. */
export function paintWeather(cardEl, fc) {
	const wx = cardEl.querySelector('.weather');
	if (!wx) return;
	delete wx.dataset.pending;

	if (fc.status === 'ok') {
		const { label, icon } = weatherLabel(fc.code);
		wx.innerHTML =
			`<span class="wx-icon">${icon}</span> ${escapeHtml(label)} · ` +
			`<strong>${temp(fc.high)}</strong>/${temp(fc.low)} · ` +
			`${fc.precip ?? 0}% precip · ${Math.round(fc.wind ?? 0)} mph`;
		return;
	}
	wx.classList.add('wx-muted');
	wx.textContent = {
		indoor: 'Indoors — weather is not a factor',
		horizon: `Forecast opens ${fc.days - 16} day${fc.days - 16 === 1 ? '' : 's'} from now`,
		past: 'Kickoff has passed',
		unknown: 'Weather unavailable',
	}[fc.status] ?? 'Weather unavailable';
}

/**
 * The Sound slot. Empty until the music system writes an issue for this
 * matchup — and an empty slot renders as a quiet invitation, not a hole.
 */
function soundSlot(game, issue) {
	const s = document.createElement('div');
	s.className = 'sound';

	if (!issue) {
		s.classList.add('sound-empty');
		s.innerHTML = `<span class="sound-mark">♪</span><span class="sound-none">No issue yet</span>`;
		return s;
	}

	s.classList.add('sound-has');
	const held = issue.status === 'held' || issue.status === 'field-note';
	s.innerHTML =
		`<span class="sound-mark">♪</span>` +
		`<span class="sound-title">${escapeHtml(issue.title ?? 'The Sound Edition')}</span>` +
		(issue.trackCount ? `<span class="sound-count">${issue.trackCount} tracks</span>` : '') +
		(held ? `<span class="chip chip-held">${issue.status === 'held' ? 'Pressing held' : 'Field note'}</span>` : '');

	const btn = document.createElement('button');
	btn.className = 'sound-open';
	btn.type = 'button';
	btn.textContent = 'Read the issue';
	btn.dataset.slug = issue.slug;
	s.append(btn);

	return s;
}

function escapeHtml(s) {
	return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
