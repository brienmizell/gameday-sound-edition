// "Who's your team?"
//
// Storage is localStorage, not a cookie. There is no server here — a cookie
// would be sent on every request to nobody, capped at 4KB, and expire. This
// persists until the reader clears it, and never leaves the machine.
//
// Asked once, on first visit, and dismissible. A reader who skips it gets a
// working app; the choice only ever reorders the slate.

import { logoUrl } from '../util/fmt.js';

const KEY = 'gd:team';
const ASKED = 'gd:asked';

let teamsPromise = null;

export function loadTeams() {
	if (!teamsPromise) {
		teamsPromise = fetch('data/teams.json')
			.then((r) => (r.ok ? r.json() : { teams: [] }))
			.then((d) => d.teams ?? [])
			.catch(() => []);
	}
	return teamsPromise;
}

export function getTeam() {
	try {
		const raw = localStorage.getItem(KEY);
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}

export function setTeam(team) {
	try {
		if (team) localStorage.setItem(KEY, JSON.stringify(team));
		else localStorage.removeItem(KEY);
		localStorage.setItem(ASKED, '1');
	} catch {
		/* private mode — the app still works, it just forgets */
	}
}

export function hasBeenAsked() {
	try {
		return localStorage.getItem(ASKED) === '1';
	} catch {
		return true; // cannot remember the answer, so do not keep asking
	}
}

export function markAsked() {
	try {
		localStorage.setItem(ASKED, '1');
	} catch {
		/* non-fatal */
	}
}

let dlg = null;

/** Opens the picker. Resolves with the chosen team, or null if skipped. */
export async function openPicker({ firstRun = false } = {}) {
	const teams = await loadTeams();
	const current = getTeam();

	return new Promise((resolve) => {
		if (!dlg) {
			dlg = document.createElement('dialog');
			dlg.className = 'picker';
			document.body.append(dlg);
		}
		dlg.replaceChildren(build(teams, current, firstRun, resolve));
		dlg.showModal();
		dlg.querySelector('.picker-search')?.focus();

		dlg.addEventListener(
			'close',
			() => {
				markAsked();
				resolve(getTeam());
			},
			{ once: true }
		);
	});

	function build(list, chosen, isFirstRun, done) {
		const wrap = document.createElement('div');
		wrap.className = 'picker-body';

		const h = document.createElement('h2');
		h.textContent = isFirstRun ? "Who's your team?" : 'Change your team';
		wrap.append(h);

		const p = document.createElement('p');
		p.className = 'picker-sub';
		p.textContent = isFirstRun
			? 'Their games get pinned to the top of every week. Stored on this device only — skip if you would rather not.'
			: 'Their games get pinned to the top of every week.';
		wrap.append(p);

		const search = document.createElement('input');
		search.type = 'search';
		search.className = 'picker-search';
		search.placeholder = 'Georgia, Ohio State, Boise…';
		search.autocomplete = 'off';
		wrap.append(search);

		const results = document.createElement('div');
		results.className = 'picker-results';
		wrap.append(results);

		const foot = document.createElement('div');
		foot.className = 'picker-foot';
		if (chosen) {
			const clear = document.createElement('button');
			clear.type = 'button';
			clear.className = 'picker-clear';
			clear.textContent = `Clear (${chosen.short ?? chosen.name})`;
			clear.addEventListener('click', () => {
				setTeam(null);
				dlg.close();
				done(null);
			});
			foot.append(clear);
		}
		const skip = document.createElement('button');
		skip.type = 'button';
		skip.className = 'picker-skip';
		skip.textContent = isFirstRun ? 'Skip' : 'Cancel';
		skip.addEventListener('click', () => {
			markAsked();
			dlg.close();
			done(getTeam());
		});
		foot.append(skip);
		wrap.append(foot);

		function paint(q = '') {
			const needle = q.trim().toLowerCase();
			const shown = needle
				? list.filter((t) => `${t.name} ${t.short} ${t.abbr} ${t.confName}`.toLowerCase().includes(needle))
				: list;

			results.replaceChildren();
			if (!shown.length) {
				const none = document.createElement('p');
				none.className = 'picker-none';
				none.textContent = 'No team by that name.';
				results.append(none);
				return;
			}

			let conf = null;
			for (const t of shown.slice(0, 400)) {
				if (t.confName !== conf) {
					conf = t.confName;
					const head = document.createElement('h3');
					head.className = 'picker-conf';
					head.textContent = conf;
					results.append(head);
				}
				const btn = document.createElement('button');
				btn.type = 'button';
				btn.className = 'picker-team';
				if (chosen?.id === t.id) btn.classList.add('is-current');
				btn.style.setProperty('--tc', t.color ? `#${t.color}` : '#666');
				const src = logoUrl(t.logo, 44);
				btn.innerHTML =
					(src ? `<img src="${src}" alt="" width="22" height="22" decoding="async">` : '<span class="picker-dot"></span>') +
					`<span>${escapeHtml(t.name)}</span>`;
				btn.addEventListener('click', () => {
					setTeam(t);
					dlg.close();
					done(t);
				});
				results.append(btn);
			}
		}

		let t;
		search.addEventListener('input', () => {
			clearTimeout(t);
			t = setTimeout(() => paint(search.value), 100);
		});
		paint();

		return wrap;
	}
}

function escapeHtml(s) {
	return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
