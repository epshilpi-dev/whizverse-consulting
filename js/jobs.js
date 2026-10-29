(() => {
  const $ = (id) => document.getElementById(id);
  const form = $('filters-form');
  const list = $('jobs-list');
  const status = $('status');
  const summary = $('result-summary');
  const empty = $('empty-state');
  const moreWrap = $('pagination');
  const loadMore = $('load-more');
  const pageSize = 12;
  let allJobs = [];
  let visibleCount = pageSize;

  $('year').textContent = new Date().getFullYear();
  const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const formatDate = (value) => {
    if (!value) return 'Date not provided';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Date not provided' : `Posted ${date.toLocaleDateString(undefined, {day:'numeric', month:'short', year:'numeric'})}`;
  };
  const safeUrl = (value) => {
    try { const u = new URL(value); return ['https:','http:'].includes(u.protocol) ? u.href : ''; }
    catch { return ''; }
  };
  const matches = (job) => {
    const keyword = $('keyword').value.trim().toLowerCase();
    const mode = $('work-mode').value;
    const seniority = $('seniority').value;
    const days = $('posted').value;
    const searchable = `${job.title} ${job.company} ${job.location} ${job.description} ${job.category}`.toLowerCase();
    if (keyword && !searchable.includes(keyword)) return false;
    const loc = `${job.location} ${job.description}`.toLowerCase();
    if (mode === 'remote' && !/remote|work from home|distributed/.test(loc)) return false;
    if (mode === 'hybrid' && !/hybrid/.test(loc)) return false;
    if (mode === 'onsite' && /remote|work from home|hybrid/.test(loc)) return false;
    const title = job.title.toLowerCase();
    if (seniority === 'leadership' && !/chief|cto|cio|vp|vice president|director|head of|leadership|executive|manager/.test(title)) return false;
    if (seniority === 'architect' && !/architect|principal/.test(title)) return false;
    if (seniority === 'senior' && !/senior|lead|staff|principal/.test(title)) return false;
    if (seniority === 'engineering' && !/engineer|developer|analyst|specialist|administrator|technician|security|data scientist|tester|qa/.test(title)) return false;
    if (days !== 'any' && job.created) {
      const age = (Date.now() - new Date(job.created).getTime()) / 86400000;
      if (Number.isFinite(age) && (age < -1 || age > Number(days))) return false;
    }
    return true;
  };
  const card = (job) => {
    const url = safeUrl(job.url);
    if (!url) return '';
    const salary = job.salary ? `<span>${escapeHtml(job.salary)}</span>` : '';
    const category = job.category ? `<span>${escapeHtml(job.category)}</span>` : '';
    const contract = job.contract ? `<span>${escapeHtml(job.contract)}</span>` : '';
    return `<article class="job-card">
      <div class="job-top"><div><h3>${escapeHtml(job.title || 'Technology opportunity')}</h3><div class="company">${escapeHtml(job.company || 'Employer not specified')}</div></div><span class="source-pill">${escapeHtml(job.source || 'Job feed')}</span></div>
      <div class="job-meta"><span>⌖ ${escapeHtml(job.location || 'Location not specified')}</span>${contract}${category}${salary}</div>
      <p class="job-description">${escapeHtml(job.description || 'Open the original listing for full role details and application requirements.')}</p>
      <div class="job-bottom"><span class="posted-date">${escapeHtml(formatDate(job.created))}</span><a class="apply-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">View job & apply ↗</a></div>
    </article>`;
  };
  function render() {
    const filtered = allJobs.filter(matches);
    const shown = filtered.slice(0, visibleCount);
    list.innerHTML = shown.map(card).join('');
    summary.textContent = `${filtered.length} matching ${filtered.length === 1 ? 'opportunity' : 'opportunities'}`;
    empty.hidden = filtered.length !== 0;
    moreWrap.hidden = filtered.length <= visibleCount;
  }
  async function loadJobs() {
    status.textContent = 'Loading current listings from the configured job feed…';
    $('refresh-btn').disabled = true;
    try {
      const params = new URLSearchParams({ country: $('country').value, keyword: $('keyword').value.trim() || 'technology IT software cloud data AI cybersecurity' });
      const response = await fetch(`/api/jobs?${params.toString()}`, {headers:{Accept:'application/json'}});
      if (!response.ok) throw new Error(`Job feed returned HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data.jobs)) throw new Error(data.error || 'Unexpected response from job feed');
      allJobs = data.jobs;
      visibleCount = pageSize;
      render();
      status.textContent = data.notice || (allJobs.length ? 'Listings from supported feeds. Use View job & apply to continue at the original source.' : 'No live listings were returned by the configured feed.');
    } catch (error) {
      allJobs = [];
      list.innerHTML = '';
      summary.textContent = 'Live listings could not be loaded';
      empty.hidden = false;
      status.textContent = 'The live job feed is not configured yet or is temporarily unavailable. Configure the Cloudflare Pages environment variables described in README.md. The external job-portal search links above are still available.';
      console.error('Job feed error:', error);
    } finally { $('refresh-btn').disabled = false; }
  }
  form.addEventListener('submit', (event) => { event.preventDefault(); loadJobs(); });
  $('refresh-btn').addEventListener('click', loadJobs);
  loadMore.addEventListener('click', () => { visibleCount += pageSize; render(); });
  // Filters that can be applied locally do not need another API request.
  ['work-mode','seniority','posted'].forEach((id) => $(id).addEventListener('change', render));
  $('country').addEventListener('change', loadJobs);
  loadJobs();
})();
