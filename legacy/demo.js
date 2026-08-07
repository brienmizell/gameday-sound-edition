// Makes the 2018 app run again, untouched.
//
// index.js is the original file, byte for byte. Every one of its three network
// dependencies is dead:
//   · my-little-cors-proxy.herokuapp.com  — Heroku killed free dynos, Nov 2022
//   · api.fantasydata.net (that key)      — long expired
//   · api.darksky.net                     — Apple shut Dark Sky down, Mar 2023
//
// So this file stands in for all three, using REAL 2018 Week 10 results, which
// is the exact week the original was hardcoded to (`var page = 10`). Nothing in
// index.js is modified: it still "fetches", still chains geocode into weather,
// still reads daily.data[4]. It just gets answers again.

(function () {
	const fixture = fetch('fixture.json').then((r) => r.json());

	// Deterministic fake coordinates, so geocode -> weather round-trips.
	const byCoord = new Map();
	function coordFor(stadiumName) {
		let h = 0;
		for (const ch of stadiumName) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
		const lat = (25 + (h % 2000) / 100).toFixed(4);
		const lng = (-(70 + ((h >> 5) % 5000) / 100)).toFixed(4);
		const key = `${lat}, ${lng}`;
		byCoord.set(key, stadiumName);
		return key;
	}

	// --- stub axios (the original loaded it from unpkg for the geocode leg) ---
	window.axios = {
		get(url, config) {
			const address = config?.params?.address ?? '';
			const key = coordFor(address);
			const [lat, lng] = key.split(', ').map(Number);
			return Promise.resolve({ data: { results: [{ geometry: { location: { lat, lng } } }] } });
		},
	};

	// --- stub fetch for the two remaining legs ---
	const realFetch = window.fetch.bind(window);

	window.fetch = async function (input, init) {
		const url = String(input);

		if (url.includes('fantasydata.net')) {
			const { games } = await fixture;
			return jsonResponse(games);
		}

		if (url.includes('darksky.net')) {
			const { weather } = await fixture;
			// ".../forecast/<key>/<lat>, <lng>?units=..."
			const coords = decodeURIComponent(url.split('/').pop().split('?')[0]).trim();
			const stadium = byCoord.get(coords);
			const w = weather[stadium] ?? { high: 60, low: 42, precip: 0.1 };
			// daily.data[4] — the original always read the fifth day, whatever
			// day the game was. Five entries, and the payload sits at index 4.
			const data = Array.from({ length: 5 }, () => ({
				temperatureHigh: w.high,
				temperatureLow: w.low,
				precipProbability: w.precip,
			}));
			return jsonResponse({ daily: { data } });
		}

		return realFetch(input, init);
	};

	function jsonResponse(payload) {
		return {
			ok: true,
			status: 200,
			json: () => Promise.resolve(payload),
		};
	}

	// A quiet banner, so no one mistakes this for a live app.
	addEventListener('DOMContentLoaded', () => {
		const b = document.createElement('div');
		b.textContent = 'Archive mode — real 2018 Week 10 results, stand-in weather. Original code, unmodified.';
		b.style.cssText =
			'position:sticky;top:0;z-index:99;background:#2b2b2b;color:#f5f5f5;' +
			'font:12px/1.6 ui-sans-serif,system-ui,sans-serif;padding:6px 10px;text-align:center';
		document.body.prepend(b);
	});
})();
