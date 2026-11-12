
const COUNTRY_CODES = new Set([
  "in", "gb", "ie", "de", "nl", "ch",
  "us", "ca", "sg", "au", "nz"
]);

const DEFAULT_KEYWORDS = "software engineer";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);

  const country = (
    url.searchParams.get("country") || "all"
  ).toLowerCase();

  const keyword = (
    url.searchParams.get("keyword") || DEFAULT_KEYWORDS
  ).trim().slice(0, 100) || DEFAULT_KEYWORDS;

  if (country !== "all" && !COUNTRY_CODES.has(country)) {
    return json({ jobs: [], error: "Unsupported country." }, 400);
  }

  // Himalayas remains available for all supported countries.
  const tasks = [
    fetchHimalayas(keyword, country)
  ];

  // Jooble UK is only queried for UK or all-country searches.
  const joobleEnabled =
    country === "all" || country === "gb";

  if (joobleEnabled && env.JOOBLE_UK_API_KEY) {
    tasks.push(fetchJoobleUK(keyword, env.JOOBLE_UK_API_KEY));
  }

  const results = await Promise.allSettled(tasks);

  const himalayasOk = results[0].status === "fulfilled";
  const himalayasJobs = himalayasOk ? results[0].value : [];

  let joobleOk = false;
  let joobleJobs = [];

  if (joobleEnabled && env.JOOBLE_UK_API_KEY) {
    joobleOk = results[1]?.status === "fulfilled";
    joobleJobs = joobleOk ? results[1].value : [];
  }

  const jobs = deduplicateJobs([
    ...himalayasJobs,
    ...joobleJobs
  ]);

  const providers = {
    himalayas: himalayasOk,
    jooble: joobleEnabled
      ? Boolean(env.JOOBLE_UK_API_KEY) && joobleOk
      : false
  };

  if (!himalayasOk && !joobleOk) {
    return json({
      jobs: [],
      total: 0,
      error: "Job listings are temporarily unavailable. Please try again shortly.",
      providers
    }, 502);
  }

  const activeSources = [];

  if (himalayasOk) activeSources.push("Himalayas");
  if (joobleOk) activeSources.push("Jooble");

  let notice;

  if (activeSources.length === 2) {
    notice = "Explore job opportunities from Himalayas and Jooble. Listings link to their original job sources.";
  } else if (himalayasOk) {
    notice = "Explore job opportunities from Himalayas. Additional job sources may be temporarily unavailable.";
  } else {
    notice = "Explore UK job opportunities from Jooble. Additional job sources may be temporarily unavailable.";
  }

  return json({
    jobs,
    total: jobs.length,
    notice,
    source: activeSources.join(", "),
    providers,
    sources: [
      {
        name: "Himalayas",
        url: "https://himalayas.app/"
      },
      {
        name: "Jooble",
        url: "https://uk.jooble.org/"
      }
    ]
  });
}

// --------------------------------------------------
// HIMALAYAS — ORIGINAL WORKING INTEGRATION
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
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`Himalayas returned ${response.status}`);
  }

  const payload = await response.json();

  if (!Array.isArray(payload.jobs)) {
    throw new Error("Invalid Himalayas response");
  }

  return payload.jobs.map((item) => {
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
      description: stripHtml(
        item.excerpt || item.description || ""
      ),
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
// JOOBLE — UK INTEGRATION
// --------------------------------------------------

async function fetchJoobleUK(keyword, apiKey) {
  const endpoint =
    `https://uk.jooble.org/api/${encodeURIComponent(apiKey)}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({
      keywords: keyword || DEFAULT_KEYWORDS,
      location: "United Kingdom",
      page: 1,
      ResultOnPage: 20,
      companysearch: false
    })
  });

  if (!response.ok) {
    throw new Error(`Jooble returned ${response.status}`);
  }

  const payload = await response.json();

  if (!Array.isArray(payload.jobs)) {
    throw new Error("Invalid Jooble response");
  }

  return payload.jobs.map((item) => ({
    id: `jooble-${item.id || item.link}`,
    title: item.title || "Technology opportunity",
    company: item.company || "Employer not specified",
    location: item.location || "United Kingdom",
    countryCode: "gb",
    url: item.link,
    source: "Jooble",
    sourceUrl: "https://uk.jooble.org/",
    created: item.updated && !Number.isNaN(Date.parse(item.updated))
      ? new Date(item.updated).toISOString()
      : null,
    description: stripHtml(item.snippet || ""),
    category: "Technology",
    contract: item.type || "",
    salary: item.salary || ""
  })).filter((job) =>
    job.url && /^https:\/\//i.test(job.url)
  );
}

// --------------------------------------------------
// DEDUPLICATION
// --------------------------------------------------

function deduplicateJobs(jobs) {
  const seen = new Set();
  const result = [];

  for (const job of jobs) {
    const urlKey = normalizeUrl(job.url);

    const titleKey = String(job.title || "")
      .toLowerCase()
      .trim();

    const companyKey = String(job.company || "")
      .toLowerCase()
      .trim();

    const key = urlKey || `${titleKey}|${companyKey}`;

    if (!key || seen.has(key)) continue;

    seen.add(key);
    result.push(job);
  }

  return result.sort((a, b) => {
    const dateA = a.created ? Date.parse(a.created) : 0;
    const dateB = b.created ? Date.parse(b.created) : 0;

    return dateB - dateA;
  });
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
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
