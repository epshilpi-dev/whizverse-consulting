
(() => {
  const $ = (id) => document.getElementById(id);

  const form = $('filters-form');
  const list = $('jobs-list');
  const status = $('status');
  const summary = $('result-summary');
  const empty = $('empty-state');
  const moreWrap = $('pagination');
  const loadMore = $('load-more');
  const refreshButton = $('refresh-btn');

  const pageSize = 12;
  const TOKEN_KEY = 'whizverse_job_registration_token';

  let allJobs = [];
  let visibleCount = pageSize;
  let selectedJob = null;
  let registrationInProgress = false;

  $('year').textContent = new Date().getFullYear();

  const escapeHtml = (value = '') =>
    String(value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));

  const formatDate = (value) => {
    if (!value) return 'Date not provided';

    const date = new Date(value);

    return Number.isNaN(date.getTime())
      ? 'Date not provided'
      : `Posted ${date.toLocaleDateString(undefined, {
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        })}`;
  };

  const safeUrl = (value) => {
    try {
      const u = new URL(value);
      return ['https:', 'http:'].includes(u.protocol) ? u.href : '';
    } catch {
      return '';
    }
  };

  // The application endpoint must be HTTPS.
  const safeApplicationUrl = (value) => {
    try {
      const u = new URL(value);
      return u.protocol === 'https:' && !u.username && !u.password
        ? u.href
        : '';
    } catch {
      return '';
    }
  };

  // Generate a cryptographically random browser token.
  function generateToken() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);

    let binary = '';
    bytes.forEach(byte => {
      binary += String.fromCharCode(byte);
    });

    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  function getToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch {
      return '';
    }
  }

  function saveToken(token) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      throw new Error('Your browser could not save the registration session. Please enable local storage and try again.');
    }
  }

  // Create the registration dialog without changing jobs.html.
  function createRegistrationModal() {
    if ($('job-registration-modal')) return;

    const styles = document.createElement('style');

<CodeBlock language="css" editable>
#job-registration-modal {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 99999;
  background: rgba(9, 25, 45, .72);
  padding: 20px;
  align-items: center;
  justify-content: center;
  overflow-y: auto;
  overflow-x: hidden;
}


#job-registration-modal.is-open {
display: flex;
}

.job-reg-dialog,
.job-reg-dialog * {
box-sizing: border-box;
}

.job-reg-dialog {
width: 100%;
max-width: 470px;
min-width: 0;
background: #fff;
border-radius: 16px;
padding: 30px;
position: relative;
box-shadow: 0 20px 65px rgba(0,0,0,.25);
color: #243247;
max-height: calc(100vh - 40px);
overflow-y: auto;
overflow-x: hidden;
}

.job-reg-dialog h2 {
color: #102a43;
font-size: 25px;
line-height: 1.3;
margin: 0 35px 8px 0;
}

.job-reg-intro {
color: #64748b;
font-size: 14px;
margin: 0 0 18px;
}

.job-reg-selected {
background: #f1f6fa;
border-left: 4px solid #0f8b8d;
border-radius: 6px;
padding: 11px 13px;
margin-bottom: 20px;
font-size: 13px;
overflow-wrap: anywhere;
}

.job-reg-selected strong {
display: block;
color: #102a43;
font-size: 14px;
}

.job-reg-dialog form {
display: block !important;
grid-template-columns: none !important;
width: 100%;
min-width: 0;
margin: 0;
}

.job-reg-field {
display: block;
width: 100%;
min-width: 0;
margin-bottom: 15px;
}

.job-reg-field label {
display: block !important;
width: 100%;
font-weight: 700;
font-size: 13px;
margin-bottom: 6px;
color: #26374a;
}

.job-reg-field input {
display: block;
width: 100% !important;
max-width: 100%;
min-width: 0;
border: 1px solid #cbd5e1;
border-radius: 8px;
padding: 12px;
font: inherit;
font-size: 14px;
color: #243247;
background: #fff;
}

.job-reg-field input:focus {
outline: 2px solid rgba(15,139,141,.2);
border-color: #0f8b8d;
}

/* Consent alignment fix */
.job-reg-dialog label.job-reg-consent {
display: flex !important;
flex-direction: row !important;
align-items: flex-start !important;
justify-content: flex-start !important;
gap: 10px;
width: 100%;
min-width: 0;
margin: 18px 0;
font-size: 12px;
line-height: 1.6;
font-weight: 400;
color: #536276;
}

.job-reg-dialog .job-reg-consent input[type="checkbox"] {
display: block;
flex: 0 0 16px;
width: 16px !important;
min-width: 16px !important;
max-width: 16px;
height: 16px;
margin: 3px 0 0;
padding: 0;
cursor: pointer;
}

.job-reg-consent span {
display: block;
flex: 1 1 auto;
min-width: 0;
overflow-wrap: anywhere;
}

.job-reg-consent a {
color: #0f7779;
font-weight: 700;
}

.job-reg-submit {
display: block;
width: 100%;
max-width: 100%;
padding: 13px 18px;
border: 0;
border-radius: 8px;
background: #0f8b8d;
color: #fff;
font-weight: 700;
font-size: 15px;
cursor: pointer;
}

.job-reg-submit:hover {
background: #0b7375;
}

.job-reg-submit:disabled {
opacity: .6;
cursor: wait;
}

.job-reg-close {
position: absolute;
top: 15px;
right: 17px;
width: 34px;
height: 34px;
border: 0;
border-radius: 50%;
background: #f1f5f9;
color: #334155;
font-size: 22px;
cursor: pointer;
}

#job-reg-status {
margin-top: 12px;
font-size: 13px;
font-weight: 600;
color: #b42318;
min-height: 18px;
overflow-wrap: anywhere;
}

@media(max-width: 520px) {
.job-reg-dialog {
padding: 24px 20px;
}
}
</CodeBlock>    document.head.appendChild(styles);

    const modal = document.createElement('div');
    modal.id = 'job-registration-modal';
    modal.setAttribute('aria-hidden', 'true');

    modal.innerHTML = `
      <div class="job-reg-dialog"
           role="dialog"
           aria-modal="true"
           aria-labelledby="job-reg-title">

        <button type="button"
                class="job-reg-close"
                id="job-reg-close"
                aria-label="Close registration form">&times;</button>

        <h2 id="job-reg-title">Register to apply</h2>

        <p class="job-reg-intro">
          Complete your free registration to continue to the employer's application page.
        </p>

        <div class="job-reg-selected">
          Applying for:
          <strong id="job-reg-job-title">Selected opportunity</strong>
          <span id="job-reg-company"></span>
        </div>

        <form id="job-reg-form">
          <div class="job-reg-field">
            <label for="job-reg-name">Full name *</label>
            <input type="text"
                   id="job-reg-name"
                   name="fullName"
                   autocomplete="name"
                   maxlength="120"
                   required>
          </div>

          <div class="job-reg-field">
            <label for="job-reg-email">Email address *</label>
            <input type="email"
                   id="job-reg-email"
                   name="email"
                   autocomplete="email"
                   maxlength="254"
                   required>
          </div>

          <div class="job-reg-field">
            <label for="job-reg-phone">Mobile number *</label>
            <input type="tel"
                   id="job-reg-phone"
                   name="phone"
                   autocomplete="tel"
                   maxlength="20"
                   placeholder="Enter your mobile number"
                   required>
          </div>

          <label class="job-reg-consent">
            <input type="checkbox"
                   id="job-reg-consent"
                   required>
            <span>
              I acknowledge the
              <a href="/privacy-policy.html"
                 target="_blank"
                 rel="noopener noreferrer">Privacy Policy</a>
              and agree that Whizverse Consulting may process the details
              I submit to register my job application interest and facilitate
              my access to this opportunity.
            </span>
          </label>

          <button type="submit"
                  class="job-reg-submit"
                  id="job-reg-submit">
            Register & Continue to Apply
          </button>

          <div id="job-reg-status" role="status" aria-live="polite"></div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);

    $('job-reg-close').addEventListener('click', closeRegistrationModal);

    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeRegistrationModal();
    });

    $('job-reg-form').addEventListener('submit', submitRegistration);

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && modal.classList.contains('is-open')) {
        closeRegistrationModal();
      }
    });
  }

  function openRegistrationModal(job) {
    selectedJob = job;
    createRegistrationModal();

    $('job-reg-job-title').textContent =
      job.title || 'Technology opportunity';

    $('job-reg-company').textContent =
      job.company || 'Employer not specified';

    $('job-reg-status').textContent = '';
    $('job-reg-form').reset();

    $('job-reg-submit').disabled = false;
    $('job-reg-submit').textContent = 'Register & Continue to Apply';

    const modal = $('job-registration-modal');

    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    $('job-reg-name').focus();
  }

  function closeRegistrationModal() {
    const modal = $('job-registration-modal');
    if (!modal || registrationInProgress) return;

    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  async function verifyRegistration(token) {
    const response = await fetch('/api/job-register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        mode: 'verify',
        token
      })
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Unable to verify your registration.');
    }

    return Boolean(result.registered);
  }

  async function handleApply(job) {
    const applicationUrl = safeApplicationUrl(job.url);

    if (!applicationUrl) {
      alert('The application link is unavailable or is not a secure HTTPS link.');
      return;
    }

    const token = getToken();

    if (token) {
      try {
        const registered = await verifyRegistration(token);

        if (registered) {
          window.location.assign(applicationUrl);
          return;
        }

        // Token is no longer recognised. Ask the visitor to register again.
        localStorage.removeItem(TOKEN_KEY);

      } catch (error) {
        console.error('Registration verification failed:', error);
        alert('We could not verify your registration at the moment. Please try again shortly.');
        return;
      }
    }

    openRegistrationModal({
      ...job,
      url: applicationUrl
    });
  }

  async function submitRegistration(event) {
    event.preventDefault();

    if (!selectedJob || registrationInProgress) return;

    const registrationForm = $('job-reg-form');

    if (!registrationForm.reportValidity()) return;

    const applicationUrl = safeApplicationUrl(selectedJob.url);

    if (!applicationUrl) {
      $('job-reg-status').textContent = 'The employer application link is invalid.';
      return;
    }

    const submitButton = $('job-reg-submit');
    const statusMessage = $('job-reg-status');

    registrationInProgress = true;
    submitButton.disabled = true;
    submitButton.textContent = 'Registering…';
    statusMessage.textContent = '';

    try {
      const token = getToken() || generateToken();

      const payload = {
        mode: 'register',
        token,
        fullName: $('job-reg-name').value.trim(),
        email: $('job-reg-email').value.trim(),
        phone: $('job-reg-phone').value.trim(),
        jobTitle: selectedJob.title || 'Technology opportunity',
        company: selectedJob.company || '',
        source: selectedJob.source || '',
        applicationUrl,
        consentPrivacy: $('job-reg-consent').checked
      };

      const response = await fetch('/api/job-register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (!response.ok || !result.success || !result.registered) {
        throw new Error(result.message || 'Registration could not be completed.');
      }

      // Save the browser token only after the server confirms registration.
      saveToken(token);

      statusMessage.style.color = '#087c70';
      statusMessage.textContent = 'Registration successful. Redirecting to the employer…';

      window.location.assign(applicationUrl);

    } catch (error) {
      console.error('Job registration failed:', error);

      statusMessage.style.color = '#b42318';
      statusMessage.textContent =
        error.message || 'Unable to complete registration. Please try again.';

      submitButton.disabled = false;
      submitButton.textContent = 'Register & Continue to Apply';

    } finally {
      registrationInProgress = false;
    }
  }

  const matches = (job) => {
    const keyword = $('keyword').value.trim().toLowerCase();
    const mode = $('work-mode').value;
    const seniority = $('seniority').value;
    const days = $('posted').value;

    const searchable = [
      job.title,
      job.company,
      job.location,
      job.description,
      job.category
    ].join(' ').toLowerCase();

    if (keyword && !keyword.split(/\s+/).every(word => searchable.includes(word))) {
      return false;
    }

    const loc = `${job.location || ''} ${job.description || ''}`.toLowerCase();

    if (mode === 'remote' && !/remote|work from home|distributed/.test(loc)) return false;
    if (mode === 'hybrid' && !/hybrid/.test(loc)) return false;
    if (mode === 'onsite' && /remote|work from home|hybrid/.test(loc)) return false;

    const title = (job.title || '').toLowerCase();

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
      <div class="job-top">
        <div>
          <h3>${escapeHtml(job.title || 'Technology opportunity')}</h3>
          <div class="company">${escapeHtml(job.company || 'Employer not specified')}</div>
        </div>
        <a class="source-pill"
           href="${escapeHtml(safeUrl(job.sourceUrl) || 'https://www.himalayas.app/')}"
           target="_blank"
           rel="noopener noreferrer">
          ${escapeHtml(job.source || 'Job feed')} · Source
        </a>
      </div>

      <div class="job-meta">
        <span>⌖ ${escapeHtml(job.location || 'Location not specified')}</span>
        ${contract}${category}${salary}
      </div>

      <p class="job-description">
        ${escapeHtml(job.description || 'Open the original listing for full role details and application requirements.')}
      </p>

      <div class="job-bottom">
        <span class="posted-date">${escapeHtml(formatDate(job.created))}</span>
        <button class="apply-link"
                type="button"
                data-job-apply
                data-job-url="${escapeHtml(url)}"
                data-job-title="${escapeHtml(job.title || 'Technology opportunity')}"
                data-job-company="${escapeHtml(job.company || '')}"
                data-job-source="${escapeHtml(job.source || '')}">
          View job & apply ↗
        </button>
      </div>
    </article>`;
  };

  function render() {
    const filtered = allJobs.filter(matches);
    const shown = filtered.slice(0, visibleCount);

    list.innerHTML = shown.map(card).join('');

    summary.textContent =
      `${filtered.length} matching ${filtered.length === 1 ? 'opportunity' : 'opportunities'}`;

    empty.hidden = filtered.length !== 0;
    moreWrap.hidden = filtered.length <= visibleCount;

    if (filtered.length === 0 && allJobs.length > 0) {
      empty.hidden = false;
      status.textContent = 'No opportunities match these filters. Try changing your search criteria.';
    }
  }

  async function loadJobs() {
    status.textContent = 'Finding the latest technology opportunities…';
    refreshButton.disabled = true;

    try {
      const params = new URLSearchParams({
        country: $('country').value,
        keyword: $('keyword').value.trim() || 'software engineer'
      });

      const response = await fetch(`/api/jobs?${params.toString()}`, {
        headers: { Accept: 'application/json' }
      });

      let data;

      try {
        data = await response.json();
      } catch {
        throw new Error('The job service returned an unexpected response.');
      }

      if (!response.ok) {
        throw new Error(data.error || 'The job service is temporarily unavailable.');
      }

      if (!Array.isArray(data.jobs)) {
        throw new Error('We could not retrieve job listings at the moment.');
      }

      allJobs = data.jobs;
      visibleCount = pageSize;

      render();

      if (allJobs.length > 0) {
        status.textContent = data.notice ||
          'Browse the latest opportunities and apply directly through the original employer listing.';
      } else {
        status.textContent =
          'No matching opportunities are available right now. Please try another search or explore the job portals above.';
      }

    } catch (error) {
      allJobs = [];
      list.innerHTML = '';
      summary.textContent = 'Job opportunities temporarily unavailable';
      empty.hidden = false;
      moreWrap.hidden = true;

      status.textContent =
        'We’re having trouble refreshing job listings right now. Please try again shortly, or explore opportunities through the job portals above.';

      console.error('Job listing request failed:', error);

    } finally {
      refreshButton.disabled = false;
    }
  }

  // Handle Apply clicks using event delegation.
  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-job-apply]');
    if (!button) return;

    handleApply({
      url: button.dataset.jobUrl,
      title: button.dataset.jobTitle,
      company: button.dataset.jobCompany,
      source: button.dataset.jobSource
    });
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    loadJobs();
  });

  refreshButton.addEventListener('click', loadJobs);

  loadMore.addEventListener('click', () => {
    visibleCount += pageSize;
    render();
  });

  ['work-mode', 'seniority', 'posted'].forEach((id) => {
    $(id).addEventListener('change', render);
  });

  $('country').addEventListener('change', loadJobs);

  loadJobs();
})();
