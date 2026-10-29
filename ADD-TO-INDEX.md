# Add the IT Jobs link to Whizverse Consulting

Your current `index.html` navigation includes Home, About, Services, Industries, Why Us, and Contact. Add the following link inside the existing `<nav class="main-nav">` in `index.html`, immediately before the Contact link:

```html
<a href="jobs.html">IT Jobs</a>
```

Do not replace the entire navigation or overwrite `style.css`, `logo.png`, or existing pages.

## Copy these files into the repository root

```text
jobs.html
css/jobs.css
js/jobs.js
functions/api/jobs.js
```

The new page uses its own `css/jobs.css`, so it does not require changes to your existing `style.css`.

## Important hosting requirement

`functions/api/jobs.js` is a Cloudflare Pages Function. The live Adzuna feed requires Cloudflare Pages (or an equivalent server-side API proxy). If the site is deployed only with GitHub Pages, this function will not run; deploy the site on Cloudflare Pages or use another backend before expecting live job results.

## Configure live jobs

1. Register for API access at https://developer.adzuna.com/ and review its current terms and supported markets.
2. In Cloudflare Pages, add `ADZUNA_APP_ID` and `ADZUNA_APP_KEY` as server-side secrets/environment variables.
3. Redeploy and test `/api/jobs?country=gb&keyword=technology`.
4. Open `/jobs.html`, test filters, and confirm the Apply link redirects to the original listing.

LinkedIn, Indeed, Glassdoor, and Wellfound are provided as direct job-search links. The starter does not scrape those portals or claim their results are included in the Adzuna feed. API coverage and visa sponsorship data vary by provider.
