const COUNTRY_CODES = new Set(['in','gb','ie','de','nl','ch','us','ca','sg','au','nz']);
const DEFAULT_KEYWORDS = 'technology IT software cloud data AI cybersecurity';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const selectedCountry = (url.searchParams.get('country') || 'all').toLowerCase();
  const keyword = (url.searchParams.get('keyword') || DEFAULT_KEYWORDS).trim().slice(0, 100);
  if (!env.ADZUNA_APP_ID || !env.ADZUNA_APP_KEY) {
    return json({ jobs: [], error: 'Job API credentials are not configured.', notice: 'Configure ADZUNA_APP_ID and ADZUNA_APP_KEY in Cloudflare Pages environment variables to enable live listings.' }, 503);
  }
  const countries = selectedCountry === 'all' ? [...COUNTRY_CODES] : [selectedCountry];
  if (countries.some((code) => !COUNTRY_CODES.has(code))) return json({ jobs: [], error: 'Unsupported country selection.' }, 400);

  // Parallel requests are capped to one page per selected market. Keep the API credentials server-side.
  const requests = countries.map(async (country) => {
    const api = new URL(`https://api.adzuna.com/v1/api/jobs/${country}/search/1`);
    api.searchParams.set('app_id', env.ADZUNA_APP_ID);
    api.searchParams.set('app_key', env.ADZUNA_APP_KEY);
    api.searchParams.set('results_per_page', '20');
    api.searchParams.set('what', keyword || DEFAULT_KEYWORDS);
    api.searchParams.set('content-type', 'application/json');
    const response = await fetch(api.toString(), { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Adzuna returned ${response.status} for ${country}`);
    const payload = await response.json();
    return (payload.results || []).map((item) => ({
      id: `${country}-${item.id || item.redirect_url}`,
      title: item.title || 'Technology opportunity',
      company: item.company?.display_name || 'Employer not specified',
      location: item.location?.display_name || country.toUpperCase(),
      url: item.redirect_url,
      source: 'Adzuna',
      created: item.created || null,
      description: stripHtml(item.description || ''),
      category: item.category?.label || 'Technology',
      contract: item.contract_type || item.contract_time || '',
      salary: formatSalary(item.salary_min, item.salary_max, item.salary_is_predicted, country)
    })).filter((job) => job.url && /^https?:\/\//i.test(job.url));
  });

  try {
    const batches = await Promise.allSettled(requests);
    const jobs = batches.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value);
    jobs.sort((a, b) => new Date(b.created || 0) - new Date(a.created || 0));
    const unique = [...new Map(jobs.map((job) => [job.url, job])).values()];
    const failed = batches.some((r) => r.status === 'rejected');
    return json({ jobs: unique, notice: failed ? 'Some country feeds were unavailable; showing the listings returned by the other feeds.' : 'Live listings supplied by Adzuna. Apply on the original job posting.' });
  } catch (error) {
    return json({ jobs: [], error: 'Unable to retrieve job listings.', notice: 'The job provider may be temporarily unavailable. Please try again later.' }, 502);
  }
}

function stripHtml(value) {
  return String(value).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/\s+/g, ' ').trim().slice(0, 650);
}
function formatSalary(min, max, predicted, country) {
  if (typeof min !== 'number' && typeof max !== 'number') return '';
  const currency = ({in:'INR',gb:'GBP',ie:'EUR',de:'EUR',nl:'EUR',ch:'CHF',us:'USD',ca:'CAD',sg:'SGD',au:'AUD',nz:'NZD'})[country] || '';
  const fmt = (v) => new Intl.NumberFormat('en', {maximumFractionDigits:0}).format(v);
  const range = min && max ? `${fmt(min)}–${fmt(max)}` : fmt(min || max);
  return `${currency} ${range}${predicted === '1' || predicted === 1 ? ' (estimated)' : ''}`.trim();
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' } });
}
