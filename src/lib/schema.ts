const SITE = "https://dronemaxwind.com";

export function organizationLd() {
	return {
		"@context": "https://schema.org",
		"@type": "Organization",
		name: "Drone Max Wind",
		url: SITE,
		logo: `${SITE}/favicon.svg`,
		description:
			"Free consumer drone wind check. Go / caution / no go from published model limits and 10 m, 80 m, and 120 m wind.",
	};
}

export function websiteLd() {
	return {
		"@context": "https://schema.org",
		"@type": "WebSite",
		name: "Drone Max Wind",
		url: SITE,
		publisher: { "@type": "Organization", name: "Drone Max Wind", url: SITE },
	};
}

export function webAppLd() {
	return {
		"@context": "https://schema.org",
		"@type": "WebApplication",
		name: "Drone Max Wind calculator",
		url: SITE,
		applicationCategory: "UtilitiesApplication",
		operatingSystem: "Any",
		offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
		description:
			"Select a consumer drone and a location. Get a go / caution / no go from wind at 10 m, 80 m, and 120 m.",
	};
}

export function breadcrumbLd(items: { name: string; href: string }[]) {
	return {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: items.map((item, i) => ({
			"@type": "ListItem",
			position: i + 1,
			name: item.name,
			item: item.href.startsWith("http") ? item.href : `${SITE}${item.href}`,
		})),
	};
}

export function faqLd(items: { q: string; a: string }[]) {
	return {
		"@context": "https://schema.org",
		"@type": "FAQPage",
		mainEntity: items.map((item) => ({
			"@type": "Question",
			name: item.q,
			acceptedAnswer: { "@type": "Answer", text: item.a },
		})),
	};
}
