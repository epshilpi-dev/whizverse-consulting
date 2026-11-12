
const COUNTRY_CODES = new Set([
  "in", "gb", "ie", "de", "nl", "ch",
  "us", "ca", "sg", "au", "nz"
]);

const DEFAULT_KEYWORDS = "software engineer";

// Arbeitnow has no server-side keyword search.
// Keep the number of pages limited to protect response time and provider limits.
const ARBEITNOW_MAX_PAGES = 2;

const ARBEITNOW_EU_URL =
  "https://www.arbeitnow.com/api/job-board-api";

const ARBEITNOW_UK_URL =
  "https://www.arbeitnow.co.uk/api/job-board-api";

export async function onRequestGet({ request }) {
  const url = new URL(request.url);

  const country = (
    url.searchParams.get("country") || "all"
  ).toLowerCase();

  const keyword = (
    url.searchParams.get("keyword") || DEFAULT_KEYWORDS
  ).trim().slice(0, 100);

  if (country !== "all" && !COUNTRY_CODES.has(country)) {
    return json({ jobs: [], error: "Unsupported country." }, 400);
  }

  // Run providers independently. One provider failing must not
  // prevent the other provider from returning job listings.
  const results = await Promise.allSettled([
    fetchHimalayas(keyword, country),
    shouldUseArbeitnow(country)
      ? fetchArbeitnow(country)
      : Promise.resolve([])
  ]);

  const himalayasJobs =
    results[0].status === "fulfilled" ? results[0].value : [];

  const arbeitnowJobs =
    results[1].status === "fulfilled" ? results[1].value : [];

  const himalayasOk = results[0].status === "fulfilled";
  const arbeitnowOk = results[1].status === "fulfilled";

  const jobs = deduplicateJobs([
    ...himalayasJobs,
    ...arbeitnowJobs
  ]);

  const providers = [];

  if (himalayasOk) providers.push("Himalayas");
  if (arbeitnowOk && shouldUseArbeitnow(country)) {
    providers.push("Arbeitnow");
  }

  if (!himalayasOk && !arbeitnowOk) {
    return json({
      jobs: [],
      error: "Job listings are temporarily unavailable. Please try again shortly."
    }, 502);
  }

  let notice = "";

  if (providers.length === 2) {
    notice = "Job opportunities from Himalayas and Arbeitnow. Select a listing to view the original posting and apply.";
  } else if (providers.includes("Himalayas")) {
    notice = "Job opportunities from Himalayas. Some additional listings may be temporarily unavailable.";
  } else {
    notice = "Job opportunities from Arbeitnow. Some additional listings may be temporarily unavailable.";
  }

  return json({
    jobs,
    total: jobs.length,
    notice,
    source: providers.join(", "),
    providers: {
      himalayas: himalayasOk,
      arbeitnow: arbeitnowOk
    },
    sources: [
      {
        name: "Himalayas",
        url: "https://himalayas.app/"
      },
      {
        name: "Arbeitnow",
        url: "https://www.arbeitnow.com/"
      }
    ]
  });
}

// --------------------------------------------------
// HIMALAYAS — EXISTING PROVIDER
// --------------------------------------------------

async function fetchHimalayas(keyword, country) {
  const api = new URL(
    "https://himalayas.app/jobs/api/search"
  );

  api.searchParams.set("q", keyword || DEFAULT_KEYWORDS);
  api.searchParams.set("sort", "recent");
  api.searchParams.set("page", "1");

  if (country !== "all") {
    api.searchParams.set("country", country);
  }

  const response = await fetch(api.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    throw new Error(`Himalayas returned ${response.status}`);
  }

  const payload = await response.json();

  return (payload.jobs || []).map((item) => {
    const salaryCurrency = item.currency || "";
    const salaryMin = item.minSalary;
    const salaryMax = item.maxSalary;

    let salary = "";

    if (salaryMin != null || salaryMax != null) {
      const fmt = (value) =>
        new Intl.NumberFormat("en", {
          maximumFractionDigits: 0
        }).format(value);

      const range =
        salaryMin != null && salaryMax != null
          ? `${fmt(salaryMin)}–${fmt(salaryMax)}`
          : fmt(salaryMin ?? salaryMax);

      salary = `${salaryCurrency} ${range} (${item.salaryPeriod || "annual"})`.trim();
    }

    const location =
      Array.isArray(item.locationRestrictions) &&
      item.locationRestrictions.length
        ? item.locationRestrictions.join(", ")
        : "Remote — location restrictions not specified";

    return {
      id: item.guid || item.applicationLink,
      title: item.title || "Technology opportunity",
      company: item.companyName || "Employer not specified",
      location,
      url: item.applicationLink,
      source: "Himalayas",
      sourceUrl: "https://himalayas.app/",
      created: item.pubDate
        ? new Date(item.pubDate * 1000).toISOString()
        : null,
      description: stripHtml(item.excerpt || item.description || ""),
      category: Array.isArray(item.categories)
        ? item.categories.join(", ")
        : "Technology",
      contract: item.employmentType || "",
      salary
    };
  }).filter((job) =>
    job.url && /^https:\/\//i.test(job.url)
  );
}

// --------------------------------------------------
// ARBEITNOW — NEW PROVIDER
// --------------------------------------------------

function shouldUseArbeitnow(country) {
  return country === "all" ||
    ["gb", "ie", "de", "nl", "ch"].includes(country);
}

async function fetchArbeitnow(country) {
  const endpoints = country === "all"
    ? [ARBEITNOW_EU_URL, ARBEITNOW_UK_URL]
    : country === "gb"
      ? [ARBEITNOW_UK_URL, ARBEITNOW_EU_URL]
      : [ARBEITNOW_EU_URL];

  const results = await Promise.allSettled(
    endpoints.map((endpoint) => fetchArbeitnowPages(endpoint))
  );

  const jobs = results
    .filter((result) => result.status === "fulfilled")
    .flatMap((result) => result.value);

  // If every requested Arbeitnow endpoint failed, mark this
  // provider as unavailable without affecting Himalayas.
  if (jobs.length === 0 && results.every(
    (result) => result.status === "rejected"
  )) {
    throw new Error("Arbeitnow is temporarily unavailable");
  }

  const normalized = jobs.map(normalizeArbeitnowJob)
    .filter(Boolean);

  if (country === "all") return normalized;

  return normalized.filter((job) =>
    job.countryCode === country
  );
}

async function fetchArbeitnowPages(baseUrl) {
  const jobs = [];

  for (let page = 1; page <= ARBEITNOW_MAX_PAGES; page++) {
    const api = new URL(baseUrl);
    api.searchParams.set("page", String(page));

    const response = await fetch(api.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new Error(`Arbeitnow returned ${response.status}`);
    }

    const payload = await response.json();
    const pageJobs = Array.isArray(payload.data)
      ? payload.data
      : [];

    jobs.push(...pageJobs);

    if (!payload.links?.next || pageJobs.length === 0) {
      break;
    }
  }

  return jobs;
}

function normalizeArbeitnowJob(item) {
  const jobUrl = item.url || "";

  if (!/^https:\/\//i.test(jobUrl)) return null;

  const location = item.location || (
    item.remote ? "Remote" : "Location not specified"
  );

  const countryCode = getCountryCode(
    `${location} ${item.title || ""}`
  );

  return {
    id: item.slug || jobUrl,
    title: item.title || "Technology opportunity",
    company: item.company_name || "Employer not specified",
    location,
    countryCode,
    url: jobUrl,
    source: "Arbeitnow",
    sourceUrl: "https://www.arbeitnow.com/",
    created: item.created_at
      ? new Date(item.created_at * 1000).toISOString()
      : null,
    description: stripHtml(item.description || ""),
    category: Array.isArray(item.tags)
      ? item.tags.join(", ")
      : "Technology",
    contract: "",
    salary: ""
  };
}

// --------------------------------------------------
// COUNTRY MAPPING
// --------------------------------------------------

function getCountryCode(value) {
  const text = String(value || "").toLowerCase();

  const countries = [
    { code: "gb", terms: ["united kingdom", "uk", "england", "scotland", "wales", "london", "manchester", "birmingham", "edinburgh", "glasgow", "bristol", "leeds"] },
    { code: "ie", terms: ["ireland", "dublin", "cork", "galway", "limerick"] },
    { code: "nl", terms: ["netherlands", "the netherlands", "amsterdam", "rotterdam", "utrecht", "eindhoven", "the hague"] },
    { code: "de", terms: ["germany", "berlin", "munich", "frankfurt", "hamburg", "cologne"] },
    { code: "ch", terms: ["switzerland", "zurich", "geneva", "basel"] },
    { code: "in", terms: ["india", "bengaluru", "bangalore", "mumbai", "pune", "hyderabad", "chennai", "delhi"] },
    { code: "us", terms: ["united states", "usa", "new york", "san francisco", "seattle", "austin"] },
    { code: "ca", terms: ["canada", "toronto", "vancouver", "montreal"] },
    { code: "sg", terms: ["singapore"] },
    { code: "au", terms: ["australia", "sydney", "melbourne"] },
    { code: "nz", terms: ["new zealand", "auckland", "wellington"] }
  ];

  for (const country of countries) {
    if (country.terms.some((term) => {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, "i").test(text);
    })) {
      return country.code;
    }
  }

  return "";
}

// --------------------------------------------------
// DEDUPLICATION
// --------------------------------------------------

function deduplicateJobs(jobs) {
  const seen = new Set();
  const result = [];

  for (const job of jobs) {
    const urlKey = normalizeUrl(job.url);
    const titleKey = String(job.title || "").toLowerCase().trim();
    const companyKey = String(job.company || "").toLowerCase().trim();

    const key = urlKey || `${titleKey}|${companyKey}`;

    if (!key || seen.has(key)) continue;

    seen.add(key);
    result.push(job);
  }

  return result.sort((a, b) => {
    const dateA = a.created ? new Date(a.created).getTime() : 0;
    const dateB = b.created ? new Date(b.created).getTime() : 0;
    return dateB - dateA;
  });
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return "";
  }
}

// --------------------------------------------------
// COMMON HELPERS
// --------------------------------------------------

function stripHtml(value) {
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 650);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300"
    }
  });
}
