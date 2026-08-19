import { droneBySlug, drones, type Drone } from "../data/drones";
import {
	compass,
	fetchMeteo,
	placeLabel,
	reversePlace,
	searchPlaces,
	type MeteoSnapshot,
} from "./meteo";
import {
	UNIT_LABEL,
	buildAltitudes,
	fillRatio,
	formatSpeed,
	judge,
	type Unit,
	type VerdictKind,
} from "./wind";

const STORAGE_KEY = "dmw-prefs";

type Prefs = {
	slug?: string;
	unit?: Unit;
	lat?: number;
	lon?: number;
	place?: string;
};

const KIND_CLASS: Record<VerdictKind, string> = {
	go: "bg-go text-band",
	caution: "bg-caution text-band",
	nogo: "bg-nogo text-on-band",
};

function loadPrefs(): Prefs {
	try {
		return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
	} catch {
		return {};
	}
}

function savePrefs(next: Prefs) {
	localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadPrefs(), ...next }));
}

function el<T extends HTMLElement>(root: ParentNode, selector: string) {
	const node = root.querySelector<T>(selector);
	if (!node) throw new Error(`Missing ${selector}`);
	return node;
}

function setText(node: Element, value: string) {
	node.textContent = value;
}

export function initCalculator(root: HTMLElement, presetSlug?: string) {
	const prefs = loadPrefs();
	const modelSelect = el<HTMLSelectElement>(root, "[data-model]");
	const modelFilter = el<HTMLInputElement>(root, "[data-model-filter]");
	const placeInput = el<HTMLInputElement>(root, "[data-place]");
	const placeList = el<HTMLUListElement>(root, "[data-place-list]");
	const locateBtn = el<HTMLButtonElement>(root, "[data-locate]");
	const checkBtn = el<HTMLButtonElement>(root, "[data-check]");
	const status = el<HTMLParagraphElement>(root, "[data-status]");
	const results = el<HTMLElement>(root, "[data-results]");
	const resultsEmpty = el<HTMLElement>(root, "[data-results-empty]");
	const resultsBody = el<HTMLElement>(root, "[data-results-body]");
	const unitBar = el<HTMLElement>(root, "[data-units]");
	const paneBtns = [...root.querySelectorAll<HTMLButtonElement>("[data-pane-btn]")];

	function setMobilePane(pane: "setup" | "results") {
		root.dataset.mobilePane = pane;
		for (const btn of paneBtns) {
			const active = btn.dataset.paneBtn === pane;
			btn.classList.toggle("bg-on-band", active);
			btn.classList.toggle("text-band", active);
			btn.classList.toggle("text-on-band/55", !active);
		}
	}

	let unit: Unit = prefs.unit ?? "mph";
	let lat = prefs.lat;
	let lon = prefs.lon;
	let place = prefs.place ?? "";
	let gpsAccuracy: number | null = null;
	let lastMeteo: MeteoSnapshot | null = null;

	function selectedDrone(): Drone | undefined {
		return droneBySlug(modelSelect.value);
	}

	function fillModels(filter = "") {
		const q = filter.trim().toLowerCase();
		const groups = new Map<string, Drone[]>();
		for (const drone of drones) {
			const hay = `${drone.name} ${drone.brand}`.toLowerCase();
			if (q && !hay.includes(q)) continue;
			const list = groups.get(drone.brand) ?? [];
			list.push(drone);
			groups.set(drone.brand, list);
		}
		const previous = modelSelect.value;
		modelSelect.innerHTML = "";
		for (const [brand, list] of groups) {
			const group = document.createElement("optgroup");
			group.label = brand;
			for (const drone of list) {
				const option = document.createElement("option");
				option.value = drone.slug;
				option.textContent = `${drone.name} · ${drone.windLevel}`;
				group.append(option);
			}
			modelSelect.append(group);
		}
		const preferred = presetSlug || previous || prefs.slug || "dji-mini-4-pro";
		if ([...modelSelect.options].some((o) => o.value === preferred)) {
			modelSelect.value = preferred;
		} else if (modelSelect.options.length) {
			modelSelect.selectedIndex = 0;
		}
		updateSpec();
	}

	function updateSpec() {
		const drone = selectedDrone();
		const spec = el<HTMLElement>(root, "[data-spec]");
		if (!drone) {
			spec.hidden = true;
			return;
		}
		spec.hidden = false;
		setText(el(spec, "[data-spec-limit]"), `${drone.maxWindMs} m/s`);
		setText(el(spec, "[data-spec-level]"), drone.windLevel);
		setText(el(spec, "[data-spec-weight]"), `${drone.weightG} g`);
		setText(
			el(spec, "[data-spec-source]"),
			drone.ratingSource === "manufacturer" ? "Manufacturer rating" : "Class estimate",
		);
		savePrefs({ slug: drone.slug });
	}

	function setUnit(next: Unit) {
		unit = next;
		savePrefs({ unit });
		for (const btn of unitBar.querySelectorAll<HTMLButtonElement>("[data-unit]")) {
			const active = btn.dataset.unit === unit;
			btn.setAttribute("aria-pressed", String(active));
			btn.classList.toggle("bg-on-band", active);
			btn.classList.toggle("text-band", active);
			btn.classList.toggle("text-on-band/60", !active);
		}
		if (lastMeteo) renderResults(lastMeteo);
	}

	function setStatus(message: string, isError = false) {
		status.hidden = !message;
		status.textContent = message;
		status.classList.toggle("text-nogo", isError);
		status.classList.toggle("text-on-band/55", !isError);
	}

	function showLocation() {
		const node = el<HTMLElement>(root, "[data-location-display]");
		if (lat == null || lon == null) {
			node.hidden = true;
			node.textContent = "";
			return;
		}
		const gps = gpsAccuracy != null ? ` · GPS ±${Math.round(gpsAccuracy)} m` : "";
		const name = place || "Selected pin";
		node.hidden = false;
		node.textContent = `${name} · ${lat.toFixed(4)}°, ${lon.toFixed(4)}°${gps}`;
		placeInput.value = name;
	}

	async function useLocation() {
		setStatus("Getting GPS fix…");
		locateBtn.disabled = true;
		try {
			const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
				navigator.geolocation.getCurrentPosition(resolve, reject, {
					enableHighAccuracy: true,
					timeout: 12000,
				});
			});
			lat = pos.coords.latitude;
			lon = pos.coords.longitude;
			gpsAccuracy = pos.coords.accuracy;
			place = coordFallback(lat, lon);
			showLocation();
			setStatus("Looking up this place…");
			place = await reversePlace(lat, lon);
			savePrefs({ lat, lon, place });
			showLocation();
			setStatus(`Using ${place}. Checking wind…`);
			await runCheck();
		} catch {
			setStatus("Location blocked. Search a city or field name instead.", true);
		} finally {
			locateBtn.disabled = false;
		}
	}

	function coordFallback(nextLat: number, nextLon: number) {
		return `${nextLat.toFixed(4)}°, ${nextLon.toFixed(4)}°`;
	}

	let searchTimer: number | undefined;
	function onPlaceInput() {
		place = placeInput.value;
		window.clearTimeout(searchTimer);
		if (place.trim().length < 2) {
			placeList.replaceChildren();
			placeList.hidden = true;
			return;
		}
		searchTimer = window.setTimeout(async () => {
			try {
				const hits = await searchPlaces(place.trim());
				placeList.replaceChildren();
				for (const hit of hits) {
					const item = document.createElement("li");
					const btn = document.createElement("button");
					btn.type = "button";
					btn.className =
						"flex min-h-11 w-full px-3 py-3 text-left text-sm text-on-band hover:bg-white/8";
					btn.textContent = placeLabel(hit);
					btn.addEventListener("click", () => {
						lat = hit.latitude;
						lon = hit.longitude;
						place = placeLabel(hit);
						gpsAccuracy = null;
						placeList.hidden = true;
						savePrefs({ lat, lon, place });
						showLocation();
						void runCheck();
					});
					item.append(btn);
					placeList.append(item);
				}
				placeList.hidden = hits.length === 0;
			} catch {
				placeList.hidden = true;
			}
		}, 280);
	}

	async function runCheck() {
		const drone = selectedDrone();
		if (!drone) {
			setStatus("Pick a drone model first.", true);
			return;
		}
		if (lat == null || lon == null) {
			setStatus("Use your location or search a place first.", true);
			return;
		}
		checkBtn.disabled = true;
		setStatus("Fetching 10 m / 80 m / 120 m wind…");
		try {
			const meteo = await fetchMeteo(lat, lon);
			lastMeteo = meteo;
			renderResults(meteo);
			setStatus("");
			setMobilePane("results");
			results.scrollTo({ top: 0, behavior: "smooth" });
		} catch {
			setStatus("Could not reach Open-Meteo. Try again in a moment.", true);
		} finally {
			checkBtn.disabled = false;
		}
	}

	function renderResults(meteo: MeteoSnapshot) {
		const drone = selectedDrone();
		if (!drone) return;
		const alts = buildAltitudes(
			meteo.altitudes.wind10,
			meteo.altitudes.wind80,
			meteo.altitudes.wind120,
			meteo.altitudes.gust10,
		);
		const verdict = judge(drone, alts);
		resultsEmpty.hidden = true;
		resultsBody.hidden = false;

		const badge = el(results, "[data-verdict]");
		badge.className = `flex min-h-24 flex-col items-start justify-center rounded-sm px-4 py-5 text-left ${KIND_CLASS[verdict.kind]}`;
		setText(el(badge, "[data-verdict-kicker]"), "Aviation verdict");
		setText(el(badge, "[data-verdict-title]"), verdict.title);
		setText(el(results, "[data-reason]"), verdict.reason);

		const cards = el(results, "[data-alt-cards]");
		cards.replaceChildren();
		for (const alt of alts) {
			const pct = fillRatio(Math.max(alt.speedMs, alt.gustMs), drone.maxWindMs);
			const card = document.createElement("article");
			card.className = "rounded-sm bg-white/5 p-4";
			card.innerHTML = `
				<p class="font-mono text-caption uppercase tracking-wide text-on-band/45">${alt.label}</p>
				<p class="mt-2 text-[22px] leading-7 font-semibold text-on-band sm:text-display-md">${formatSpeed(unit, alt.speedMs)}</p>
				<p class="mt-1 text-sm text-on-band/70">Gusts ${formatSpeed(unit, alt.gustMs)}</p>
				<p class="mt-3 text-sm text-on-band/45">${alt.note}</p>
				<div class="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
					<div class="h-full rounded-full ${pct >= 85 ? "bg-nogo" : pct >= 65 ? "bg-caution" : "bg-go"}" style="width:${pct}%"></div>
				</div>
				<p class="mt-2 font-mono text-caption text-on-band/40">${pct}% of ${drone.name} limit</p>
			`;
			cards.append(card);
		}

		setText(
			el(results, "[data-place-out]"),
			place || `${meteo.latitude.toFixed(3)}, ${meteo.longitude.toFixed(3)}`,
		);
		setText(el(results, "[data-updated]"), new Date(meteo.updated).toLocaleString());
		setText(el(results, "[data-temp]"), `${Math.round(meteo.temperatureC)}°C`);
		setText(el(results, "[data-cloud]"), `${Math.round(meteo.cloudCover)}% cloud`);
		setText(el(results, "[data-dir]"), `${compass(meteo.windDir10)} ${Math.round(meteo.windDir10)}°`);
		setText(
			el(results, "[data-gps]"),
			gpsAccuracy != null ? `±${Math.round(gpsAccuracy)} m` : "Search pin",
		);
		setText(el(results, "[data-limit-out]"), formatSpeed(unit, drone.maxWindMs, 1));
		setText(el(results, "[data-model-out]"), drone.name);

		const hours = el(results, "[data-hours]");
		hours.replaceChildren();
		const start = meteo.hourly.time.findIndex(
			(t) => new Date(t).getTime() >= Date.now() - 30 * 60 * 1000,
		);
		const from = Math.max(0, start);
		for (let i = 0; i < 12; i++) {
			const idx = from + i;
			if (!meteo.hourly.time[idx]) break;
			const rowAlts = buildAltitudes(
				meteo.hourly.wind10[idx],
				meteo.hourly.wind80[idx],
				meteo.hourly.wind120[idx],
				meteo.hourly.gust10[idx],
			);
			const hourlyVerdict = judge(drone, rowAlts);
			const card = document.createElement("article");
			card.className = "rounded-sm bg-white/5 p-3";
			const time = new Date(meteo.hourly.time[idx]);
			const tone =
				hourlyVerdict.kind === "go"
					? "text-go"
					: hourlyVerdict.kind === "caution"
						? "text-caution"
						: "text-nogo";
			card.innerHTML = `
				<div class="flex items-center justify-between gap-3">
					<p class="font-mono text-caption text-on-band/55">${time.toLocaleTimeString([], { hour: "numeric" })}</p>
					<p class="text-sm font-medium ${tone}">${hourlyVerdict.title}</p>
				</div>
				<dl class="mt-2 grid grid-cols-3 gap-2 text-center">
					<div>
						<dt class="font-mono text-caption text-on-band/40">10 m</dt>
						<dd class="mt-1 text-sm text-on-band">${formatSpeed(unit, meteo.hourly.wind10[idx], 0)}</dd>
					</div>
					<div>
						<dt class="font-mono text-caption text-on-band/40">80 m</dt>
						<dd class="mt-1 text-sm text-on-band">${formatSpeed(unit, meteo.hourly.wind80[idx], 0)}</dd>
					</div>
					<div>
						<dt class="font-mono text-caption text-on-band/40">120 m</dt>
						<dd class="mt-1 text-sm text-on-band">${formatSpeed(unit, meteo.hourly.wind120[idx], 0)}</dd>
					</div>
				</dl>
			`;
			hours.append(card);
		}

		for (const node of results.querySelectorAll("[data-unit-label]")) {
			setText(node, UNIT_LABEL[unit]);
		}
	}

	fillModels();
	if (place) placeInput.value = place;
	showLocation();
	setUnit(unit);

	modelFilter.addEventListener("input", () => fillModels(modelFilter.value));
	modelSelect.addEventListener("change", () => {
		updateSpec();
		if (lastMeteo) renderResults(lastMeteo);
	});
	unitBar.addEventListener("click", (event) => {
		const btn = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-unit]");
		if (btn?.dataset.unit) setUnit(btn.dataset.unit as Unit);
	});
	locateBtn.addEventListener("click", () => void useLocation());
	checkBtn.addEventListener("click", () => void runCheck());
	placeInput.addEventListener("input", onPlaceInput);
	for (const btn of paneBtns) {
		btn.addEventListener("click", () => {
			const pane = btn.dataset.paneBtn;
			if (pane === "setup" || pane === "results") setMobilePane(pane);
		});
	}
	document.addEventListener("click", (event) => {
		if (!root.contains(event.target as Node)) placeList.hidden = true;
	});
}
