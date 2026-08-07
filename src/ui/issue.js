// The issue reader — how a Sound Edition write-up gets read in the app.
//
// Renders the structure the music system produces: masthead, declaration,
// the two sides, the neutral field, and a numbered running order where every
// track shows the receipt that earned its seat.

import { tally } from '../sound.js';

let dlg = null;

export function openIssue(issue) {
	if (!dlg) {
		dlg = document.createElement('dialog');
		dlg.className = 'issue';
		dlg.addEventListener('click', (e) => {
			if (e.target === dlg) dlg.close(); // click the backdrop
			if (e.target.closest('.issue-close')) dlg.close();
		});
		document.body.append(dlg);
	}

	dlg.replaceChildren(body(issue));
	dlg.showModal();
	dlg.querySelector('.issue-close')?.focus();
}

function body(issue) {
	const wrap = document.createElement('div');
	wrap.className = 'issue-body';

	const close = document.createElement('button');
	close.className = 'issue-close';
	close.type = 'button';
	close.setAttribute('aria-label', 'Close');
	close.textContent = '×';
	wrap.append(close);

	wrap.append(h('h2', 'issue-title', issue.title));
	if (issue.masthead) wrap.append(h('p', 'issue-masthead', issue.masthead));

	if (issue.status !== 'pressed') {
		wrap.append(
			h('p', 'issue-flag', issue.status === 'held' ? 'Pressing held — the playlist was not placed.' : 'Filed as a field note — no playlist.')
		);
	}

	if (issue.declaration) wrap.append(h('blockquote', 'issue-declaration', issue.declaration));

	// The two sides, side by side. This is the musical history.
	const sides = document.createElement('div');
	sides.className = 'issue-sides';
	for (const which of ['away', 'home']) {
		const s = issue.sides[which];
		if (!s?.school && !s?.scene) continue;
		const col = document.createElement('section');
		col.className = `issue-side issue-side-${which}`;
		col.append(h('h3', 'side-school', s.school || which));
		if (s.town) col.append(h('p', 'side-town', s.town));
		if (s.scene) col.append(h('p', 'side-scene', s.scene));
		if (s.plays != null) col.append(h('p', 'side-plays', `${s.plays.toLocaleString()} plays in the ledger`));
		sides.append(col);
	}
	if (sides.childElementCount) wrap.append(sides);

	if (issue.neutralField) {
		wrap.append(h('h3', 'issue-h', 'The neutral field'));
		wrap.append(h('p', 'issue-neutral', issue.neutralField));
	}

	// Running order.
	if (issue.tracks.length) {
		const t = tally(issue);
		wrap.append(
			h(
				'h3',
				'issue-h',
				`Running order — ${issue.tracks.length} tracks · ${t.home} home · ${t.away} away` +
					(t.tailgate ? ` · ${t.tailgate} tailgate` : '')
			)
		);

		const ol = document.createElement('ol');
		ol.className = 'tracks';
		for (const tr of issue.tracks) {
			const li = document.createElement('li');
			li.className = `track track-${tr.side}`;

			const head = document.createElement('p');
			head.className = 'track-head';
			head.append(h('span', 'track-artist', tr.artist));
			head.append(document.createTextNode(', '));
			head.append(h('span', 'track-title', `"${tr.title}"`));
			if (tr.year) head.append(h('span', 'track-year', ` (${tr.year})`));
			if (tr.tier) head.append(h('span', 'track-tier', tr.tier));
			if (tr.plays) head.append(h('span', 'track-plays', `${tr.plays} plays`));
			li.append(head);

			if (tr.note) li.append(h('p', 'track-note', tr.note));
			if (tr.receipt) li.append(h('p', 'track-receipt', tr.receipt));
			ol.append(li);
		}
		wrap.append(ol);
	}

	const foot = document.createElement('div');
	foot.className = 'issue-foot';
	if (issue.playlistUrl) {
		const a = document.createElement('a');
		a.className = 'issue-link';
		a.href = issue.playlistUrl;
		a.target = '_blank';
		a.rel = 'noopener noreferrer';
		a.textContent = 'Open the playlist in Spotify';
		foot.append(a);
	}
	if (issue.writeupUrl) {
		const a = document.createElement('a');
		a.className = 'issue-link issue-link-quiet';
		a.href = issue.writeupUrl;
		a.target = '_blank';
		a.rel = 'noopener noreferrer';
		a.textContent = 'The full write-up';
		foot.append(a);
	}
	if (foot.childElementCount) wrap.append(foot);

	if (issue.sources.length) {
		wrap.append(h('h3', 'issue-h', 'Sources'));
		const ul = document.createElement('ul');
		ul.className = 'issue-sources';
		for (const s of issue.sources) ul.append(h('li', '', s));
		wrap.append(ul);
	}

	if (issue._warnings?.length) {
		const w = document.createElement('details');
		w.className = 'issue-warnings';
		w.append(h('summary', '', `${issue._warnings.length} data warning(s)`));
		const ul = document.createElement('ul');
		for (const line of issue._warnings) ul.append(h('li', '', line));
		w.append(ul);
		wrap.append(w);
	}

	return wrap;
}

function h(tag, cls, text) {
	const n = document.createElement(tag);
	if (cls) n.className = cls;
	if (text != null) n.textContent = text;
	return n;
}
