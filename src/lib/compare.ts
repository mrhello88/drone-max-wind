import { calculatorPath, droneBySlug, groupedDrones, type Drone } from "../data/drones";
import { UNIT_LABEL, formatSpeed, type Unit } from "./wind";

const DEFAULTS = ["dji-mini-4-pro", "dji-air-3s", ""];

function el<T extends HTMLElement>(root: ParentNode, selector: string) {
	const node = root.querySelector<T>(selector);
	if (!node) throw new Error(`Missing ${selector}`);
	return node;
}

function fillSelect(select: HTMLSelectElement, filter = "", selected = "") {
	const q = filter.trim().toLowerCase();
	const previous = selected || select.value;
	select.innerHTML = "";
	const empty = document.createElement("option");
	empty.value = "";
	empty.textContent = "Choose a drone";
	select.append(empty);
	for (const [brand, list] of groupedDrones()) {
		const group = document.createElement("optgroup");
		group.label = brand;
		for (const drone of list) {
			const hay = `${drone.name} ${drone.brand}`.toLowerCase();
			if (q && !hay.includes(q)) continue;
			const option = document.createElement("option");
			option.value = drone.slug;
			option.textContent = `${drone.name} · ${drone.windLevel}`;
			group.append(option);
		}
		if (group.childElementCount) select.append(group);
	}
	if ([...select.options].some((o) => o.value === previous)) select.value = previous;
}

function selectedSlugs(root: HTMLElement) {
	return [...root.querySelectorAll<HTMLSelectElement>("[data-slot-select]")]
		.map((select) => select.value)
		.filter(Boolean);
}

function uniqueDrones(slugs: string[]) {
	const seen = new Set<string>();
	const list: Drone[] = [];
	for (const slug of slugs) {
		if (seen.has(slug)) continue;
		const drone = droneBySlug(slug);
		if (!drone) continue;
		seen.add(slug);
		list.push(drone);
	}
	return list;
}

function summary(picks: Drone[]) {
	if (picks.length < 2) {
		return "Pick at least two drones to compare wind ratings, weight, and class.";
	}
	const ranked = [...picks].sort((a, b) => b.maxWindMs - a.maxWindMs);
	const top = ranked[0];
	const rest = ranked.slice(1);
	if (rest.every((d) => d.maxWindMs === top.maxWindMs)) {
		return `${picks.map((d) => d.name).join(" and ")} share the same ${top.maxWindMs} m/s ceiling. Compare weight and class below.`;
	}
	const second = rest[0];
	const extra = Math.round(((top.maxWindMs - second.maxWindMs) / second.maxWindMs) * 100);
	return `${top.name} handles more wind (${formatSpeed("mph", top.maxWindMs)} vs ${formatSpeed("mph", second.maxWindMs)}). That is about ${extra}% more headroom than ${second.name}.`;
}

function bar(ms: number, max: number) {
	const pct = max > 0 ? Math.round((ms / max) * 100) : 0;
	return `<div class="mt-2 h-2 overflow-hidden rounded-full bg-canvas-soft-2"><div class="h-full rounded-full bg-go" style="width:${pct}%"></div></div>`;
}

function render(root: HTMLElement, unit: Unit) {
	const picks = uniqueDrones(selectedSlugs(root));
	const note = el(root, "[data-compare-note]");
	const grid = el(root, "[data-compare-grid]");
	const tableWrap = el(root, "[data-compare-table]");
	note.textContent = summary(picks);

	if (picks.length < 2) {
		grid.innerHTML = "";
		tableWrap.innerHTML =
			'<p class="rounded-md bg-canvas-soft p-5 text-sm text-body">Choose two or three models. We highlight who takes more wind and who is lighter.</p>';
		return;
	}

	const maxWind = Math.max(...picks.map((d) => d.maxWindMs));
	const minWeight = Math.min(...picks.map((d) => d.weightG));

	grid.innerHTML = picks
		.map((drone) => {
			const windWin = drone.maxWindMs === maxWind;
			const lightWin = drone.weightG === minWeight;
			return `
				<article class="rounded-md bg-canvas p-5 shadow-card">
					<p class="font-mono text-caption uppercase tracking-wide text-mute">${drone.brand}</p>
					<h2 class="mt-2 text-display-sm font-semibold text-ink">${drone.name}</h2>
					<p class="mt-3 text-display-md font-semibold ${windWin ? "text-go" : "text-ink"}">${formatSpeed(unit, drone.maxWindMs)}</p>
					<p class="text-sm text-body">${drone.windLevel} published ceiling</p>
					${bar(drone.maxWindMs, maxWind)}
					<ul class="mt-4 space-y-1 text-sm text-body">
						<li>${drone.class} · ${drone.weightG} g${lightWin ? " · lightest here" : ""}</li>
						<li>${drone.ratingSource === "manufacturer" ? "Manufacturer rating" : "Class estimate"}</li>
					</ul>
					<a class="mt-4 inline-flex h-11 items-center text-sm font-medium text-link" href="${calculatorPath(drone)}">Check this field →</a>
				</article>
			`;
		})
		.join("");

	const rows: { label: string; values: string[]; nums?: number[]; better?: "high" | "low" }[] = [
		{ label: "Brand", values: picks.map((d) => d.brand) },
		{ label: "Class", values: picks.map((d) => d.class) },
		{
			label: `Max wind (${UNIT_LABEL[unit]})`,
			values: picks.map((d) => formatSpeed(unit, d.maxWindMs)),
			nums: picks.map((d) => d.maxWindMs),
			better: "high",
		},
		{ label: "Level", values: picks.map((d) => d.windLevel) },
		{
			label: "Weight",
			values: picks.map((d) => `${d.weightG} g`),
			nums: picks.map((d) => d.weightG),
			better: "low",
		},
		{
			label: "Caution starts",
			values: picks.map((d) => formatSpeed(unit, d.maxWindMs * 0.65)),
		},
		{
			label: "No-go starts",
			values: picks.map((d) => formatSpeed(unit, d.maxWindMs * 0.85)),
		},
		{
			label: "Source",
			values: picks.map((d) => (d.ratingSource === "manufacturer" ? "Manufacturer" : "Estimate")),
		},
	];

	const head = picks.map((d) => `<th class="px-4 py-3 font-medium text-ink">${d.name}</th>`).join("");
	const body = rows
		.map((row) => {
			const best =
				row.nums && row.better
					? row.better === "high"
						? Math.max(...row.nums)
						: Math.min(...row.nums)
					: undefined;
			const cells = row.values
				.map((value, i) => {
					const win = best != null && row.nums && row.nums[i] === best ? "text-go font-medium" : "text-ink";
					return `<td class="px-4 py-3 text-sm ${win}">${value}</td>`;
				})
				.join("");
			return `<tr class="border-t border-hairline"><th class="px-4 py-3 text-left text-sm font-normal text-mute">${row.label}</th>${cells}</tr>`;
		})
		.join("");

	tableWrap.innerHTML = `
		<div class="hidden min-w-0 overflow-x-auto rounded-md bg-canvas shadow-card md:block">
			<table class="w-full min-w-[32rem] text-left">
				<thead>
					<tr class="bg-canvas-soft font-mono text-caption uppercase text-mute">
						<th class="px-4 py-3 font-normal">Spec</th>
						${head}
					</tr>
				</thead>
				<tbody>${body}</tbody>
			</table>
		</div>
	`;
}

function writeUrl(slugs: string[]) {
	const url = new URL(window.location.href);
	["a", "b", "c"].forEach((key) => url.searchParams.delete(key));
	slugs.forEach((slug, i) => {
		if (slug) url.searchParams.set(["a", "b", "c"][i], slug);
	});
	history.replaceState({}, "", url);
}

export function initCompare(root: HTMLElement) {
	const params = new URLSearchParams(window.location.search);
	const fromUrl = [params.get("a"), params.get("b"), params.get("c")];
	const start = fromUrl.some(Boolean) ? fromUrl.map((s) => s ?? "") : DEFAULTS;
	let unit: Unit = "mph";

	root.querySelectorAll<HTMLSelectElement>("[data-slot-select]").forEach((select, i) => {
		fillSelect(select, "", start[i] ?? "");
		if (start[i] && droneBySlug(start[i])) select.value = start[i];
	});

	function refresh() {
		writeUrl(selectedSlugs(root));
		render(root, unit);
	}

	root.querySelectorAll<HTMLInputElement>("[data-slot-filter]").forEach((input) => {
		input.addEventListener("input", () => {
			const slot = input.dataset.slotFilter;
			const select = el<HTMLSelectElement>(root, `[data-slot-select="${slot}"]`);
			fillSelect(select, input.value, select.value);
			refresh();
		});
	});

	root.addEventListener("change", (event) => {
		if ((event.target as HTMLElement).closest("[data-slot-select]")) refresh();
	});

	const unitBar = el(root, "[data-units]");
	unitBar.addEventListener("click", (event) => {
		const btn = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-unit]");
		if (!btn?.dataset.unit) return;
		unit = btn.dataset.unit as Unit;
		for (const item of unitBar.querySelectorAll<HTMLButtonElement>("[data-unit]")) {
			const active = item.dataset.unit === unit;
			item.setAttribute("aria-pressed", String(active));
			item.classList.toggle("bg-primary", active);
			item.classList.toggle("text-on-primary", active);
			item.classList.toggle("text-body", !active);
		}
		render(root, unit);
	});

	refresh();
}
