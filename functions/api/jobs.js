
const JOOBLE_COUNTRIES = {
  gb: {
    name: "United Kingdom",
    domain: "uk",
    secret: "JOOBLE_UK_API_KEY"
  },
  ie: {
    name: "Ireland",
    domain: "ie",
    secret: "JOOBLE_IE_API_KEY"
  },
  de: {
    name: "Germany",
    domain: "de",
    secret: "JOOBLE_DE_API_KEY"
  },
  nl: {
    name: "Netherlands",
    domain: "nl",
    secret: "JOOBLE_NL_API_KEY"
  },
  ch: {
    name: "Switzerland",
    domain: "ch",
    secret: "JOOBLE_CH_API_KEY"
  },
  in: {
    name: "India",
    domain: "in",
    secret: "JOOBLE_IN_API_KEY"
  },
  sg: {
    name: "Singapore",
    domain: "sg",
    secret: "JOOBLE_SG_API_KEY"
  },
  au: {
    name: "Australia",
    domain: "au",
    secret: "JOOBLE_AU_API_KEY"
  },
  nz: {
    name: "New Zealand",
    domain: "nz",
    secret: "JOOBLE_NZ_API_KEY"
  }
};

const COUNTRY_CODES = new Set(
  Object.keys(JOOBLE_COUNTRIES)
);

const DEFAULT_KEYWORDS = "software engineer";
const CACHE_TTL = 1800;

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);

  const country = (
    url.searchParams.get("country") || "all"
  ).toLowerCase();

  const keyword = (
    url.searchParams.get("keyword") || DEFAULT_KEYWORDS
  ).trim().slice(0, 100) || DEFAULT_KEYWORDS;

  if (country !== "all" && !COUNTRY_CODES.has(country)) {
    return json({
      jobs: [],
      total: 0,
      error: "Unsupported country."
    }, 400);
  }

  // Always retain Himalayas.
  const tasks = [
    {
      name: "Himalayas",
      run: () => fetchHimalayas(keyword, country)
    }
  ];

  // For a specific country, query only that Jooble provider.
  // For All Countries, query all nine configured providers.
  const selectedCountries = country === "all"
    ? Object.keys(JOOBLE_COUNTRIES)
    : [country];

  for (const code of selectedCountries) {
    const config = JOOBLE_COUNTRIES[code];
    const apiKey = env[config.secret];

    if (!apiKey) continue;

    tasks.push({
      name: `Jooble ${code}`,
      run: () => fetchJoobleCached(
        keyword,
        code,
        config,
        apiKey
      )
    });
  }

  const results = await Promise.allSettled(
    tasks.map(task => task.run())
  );

  const himalayasOk =
    results[0].status === "fulfilled";

  const himalayasJobs = himalayasOk
    ? results[0].value
    : [];

  let joobleJobs = [];
  const joobleCountries = {};
  const providerErrors = {};

  if (!himalayasOk) {
    providerErrors.himalayas =
      String(results[0].reason?.message || "Unknown error");
  }

  for (let i = 1; i < tasks.length; i++) {
    const task = tasks[i];
    const code = task.name.replace("Jooble ", "");
    const result = results[i];

    joobleCountries[code] =
      result.status === "fulfilled";

    if (result.status === "fulfilled") {
      joobleJobs.push(...result.value);
    } else {
      providerErrors[`jooble_${code}`] =
        String(result.reason?.message || "Unknown error");
    }
  }

  const jobs = deduplicateJobs([
    ...himalayasJobs,
    ...joobleJobs
  ]);

  const joobleOk = joobleJobs.length > 0;

  const providers = {
    himalayas: himalayasOk,
    jooble: joobleOk,
    joobleCountries
  };

  if (!himalayasOk && !joobleOk) {
    return json({
      jobs: [],
      total: 0,
      error: "Job listings are temporarily unavailable. Please try again shortly.",
      providers,
      providerErrors
    }, 502);
  }

  const activeSources = [];

  if (himalayasOk) {
    activeSources.push("Himalayas");
  }

  if (joobleOk) {
    activeSources.push("Jooble");
  }

  const successfulJoobleCountries = Object.keys(joobleCountries)
    .filter(code => joobleCountries[code])
    .map(code => JOOBLE_COUNTRIES[code].name);

  const sources = [];

  if (himalayasOk) {
    sources.push({
      name: "Himalayas",
      url: "https://himalayas.app/"
    });
  }

  for (const code of Object.keys(joobleCountries)) {
    if (joobleCountries[code]) {
      const config = JOOBLE_COUNTRIES[code];

      sources.push({
        name: `Jooble - ${config.name}`,
        url: `https://${config.domain}.jooble.org/`
      });
    }
  }

  let notice;

  if (himalayasOk && joobleOk) {
    notice =
      `Explore job opportunities from Himalayas and Jooble across ${successfulJoobleCountries.join(", ")}.`;
  } else if (himalayasOk) {
    notice =
      "Explore job opportunities from Himalayas. Additional job sources may be temporarily unavailable.";
  } else {
    notice =
      `Explore job opportunities from Jooble across ${successfulJoobleCountries.join(", ")}.`;
  }

  return json({
    jobs,
    total: jobs.length,
    notice,
    source: activeSources.join(", "),
    providers,
    providerErrors,
    sources
  });
}

// --------------------------------------------------
// HIMALAYAS
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
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Himalayas returned ${response.status}`);
  }

  const payload = await response.json();

  if (!Array.isArray(payload.jobs)) {
    throw new Error("Invalid Himalayas response");
  }

  return payload.jobs.map(item => {
    const salaryCurrency = item.currency || "";
    const salaryMin = item.minSalary;
    const salaryMax = item.maxSalary;

    let salary = "";

    if (salaryMin != null || salaryMax != null) {
      const fmt = value =>
        new Intl.NumberFormat("en", {
          maximumFractionDigits: 0
        }).format(value);

      const range =
        salaryMin != null && salaryMax != null
          ? `${fmt(salaryMin)}–${fmt(salaryMax)}`
          : fmt(salaryMin ?? salaryMax);

      salary =
        `${salaryCurrency} ${range} (${item.salaryPeriod || "annual"})`.trim();
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
  }).filter(job =>
    job.url && /^https:\/\//i.test(job.url)
  );
}

// --------------------------------------------------
// JOOBLE WITH CLOUDFLARE EDGE CACHE
// --------------------------------------------------

async function fetchJoobleCached(
  keyword,
  countryCode,
  config,
  apiKey
) {
  const cacheKey = new Request(
    `https://whizverse-job-cache.example/jooble/${countryCode}?keyword=${encodeURIComponent(keyword.toLowerCase())}`
  );

  const cache = typeof caches !== "undefined"
    ? caches.default
    : null;

  if (cache) {
    try {
      const cached = await cache.match(cacheKey);

      if (cached) {
        return await cached.json();
      }
    } catch {
      // Continue with the live API request.
    }
  }

  const jobs = await fetchJooble(
    keyword,
    countryCode,
    config,
    apiKey
  );

  if (cache) {
    try {
      await cache.put(
        cacheKey,
        new Response(JSON.stringify(jobs), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": `public, max-age=${CACHE_TTL}`
          }
        })
      );
    } catch {
      // A cache failure must not affect job retrieval.
    }
  }

  return jobs;
}

// --------------------------------------------------
// JOOBLE COUNTRY API
// --------------------------------------------------

async function fetchJooble(
  keyword,
  countryCode,
  config,
  apiKey
) {
  const endpoint =
    `https://${config.domain}.jooble.org/api/${encodeURIComponent(apiKey)}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({
      keywords: keyword || DEFAULT_KEYWORDS,
      location: config.name,
      page: 1,
      ResultOnPage: 20,
      companysearch: false
    })
  });

  if (!response.ok) {
    throw new Error(
      `Jooble ${countryCode.toUpperCase()} returned ${response.status}`
    );
  }

  const payload = await response.json();

  if (!Array.isArray(payload.jobs)) {
    throw new Error(
      `Invalid Jooble ${countryCode.toUpperCase()} response`
    );
  }

  return payload.jobs.map(item => ({
    id: `jooble-${countryCode}-${item.id || item.link}`,
    title: item.title || "Technology opportunity",
    company: item.company || "Employer not specified",
    location: item.location || config.name,
    countryCode,
    url: item.link,
    source: "Jooble",
    sourceUrl: `https://${config.domain}.jooble.org/`,
    created: item.updated &&
      !Number.isNaN(Date.parse(item.updated))
        ? new Date(item.updated).toISOString()
        : null,
    description: stripHtml(item.snippet || ""),
    category: "Technology",
    contract: item.type || "",
    salary: item.salary || ""
  })).filter(job =>
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

    return url.toString()
      .replace(/\/$/, "")
      .toLowerCase();
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
