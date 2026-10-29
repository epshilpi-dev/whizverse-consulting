
const COUNTRY_CODES = new Set([
  "in", "gb", "ie", "de", "nl", "ch",
  "us", "ca", "sg", "au", "nz"
]);

const DEFAULT_KEYWORDS =
  "software engineer";

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

  try {
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
      return json({
        jobs: [],
        error: "The free job provider is temporarily unavailable."
      }, 502);
    }

    const payload = await response.json();

    const jobs = (payload.jobs || []).map((item) => {
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

      const location = Array.isArray(item.locationRestrictions)
        && item.locationRestrictions.length
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

    return json({
      jobs,
      total: payload.totalCount ?? jobs.length,
      notice: "Remote job listings provided by Himalayas. Job data refreshes periodically; availability may change.",
      source: "Himalayas",
      sourceUrl: "https://himalayas.app/"
    });
  } catch {
    return json({
      jobs: [],
      error: "Unable to retrieve job listings. Please try again."
    }, 502);
  }
}

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
