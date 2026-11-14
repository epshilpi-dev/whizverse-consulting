
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidToken(token) {
  return typeof token === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(token);
}

async function hashToken(token) {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function validateApplicationUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password;
  } catch {
    return false;
  }
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) {
      return jsonResponse({ success: false, message: "Database is not configured." }, 500);
    }

    const body = await request.json();

    const mode = body.mode;
    const token = body.token;

    if (!isValidToken(token)) {
      return jsonResponse({ success: false, message: "Invalid registration token." }, 400);
    }

    const tokenHash = await hashToken(token);

    // Verify whether this browser has already registered.
    if (mode === "verify") {
      const candidate = await env.DB.prepare(`
        SELECT id
        FROM candidates
        WHERE registration_token_hash = ?
          AND candidate_type = 'job_seeker'
          AND lead_source = 'whizverse_job_portal'
        LIMIT 1
      `).bind(tokenHash).first();

      return jsonResponse({
        success: true,
        registered: Boolean(candidate)
      });
    }

    // Register a new candidate.
    if (mode !== "register") {
      return jsonResponse({ success: false, message: "Invalid request mode." }, 400);
    }

    const fullName = String(body.fullName || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const phone = String(body.phone || "").trim();
    const jobTitle = String(body.jobTitle || "").trim();
    const company = String(body.company || "").trim();
    const source = String(body.source || "").trim();
    const applicationUrl = String(body.applicationUrl || "").trim();

    if (fullName.length < 2 || fullName.length > 120) {
      return jsonResponse({ success: false, message: "Please enter a valid full name." }, 400);
    }

    if (!isValidEmail(email) || email.length > 254) {
      return jsonResponse({ success: false, message: "Please enter a valid email address." }, 400);
    }

    if (phone.length < 7 || phone.length > 20) {
      return jsonResponse({ success: false, message: "Please enter a valid mobile number." }, 400);
    }

    if (!jobTitle || jobTitle.length > 250) {
      return jsonResponse({ success: false, message: "The selected job title is invalid." }, 400);
    }

    if (company.length > 200 || source.length > 100) {
      return jsonResponse({ success: false, message: "The job details are invalid." }, 400);
    }

    if (!validateApplicationUrl(applicationUrl)) {
      return jsonResponse({ success: false, message: "The application link is invalid." }, 400);
    }

    if (body.consentPrivacy !== true) {
      return jsonResponse({
        success: false,
        message: "Please accept the Privacy Notice to continue."
      }, 400);
    }

    const id = crypto.randomUUID();
    const consentAt = new Date().toISOString();
    const privacyVersion = "job-registration-v1";

    // INSERT OR IGNORE makes a repeated submission with the same token safe.
    await env.DB.prepare(`
      INSERT OR IGNORE INTO candidates (
        id,
        full_name,
        email,
        phone,
        target_role,
        resume_key,
        consent_privacy,
        status,
        consent_at,
        privacy_version,
        candidate_type,
        lead_source,
        campaign_name,
        job_company,
        job_application_url,
        job_source,
        registration_token_hash
      ) VALUES (?, ?, ?, ?, ?, '', 1, 'new', ?, ?, 'job_seeker',
                'whizverse_job_portal', 'job_application', ?, ?, ?, ?)
    `).bind(
      id,
      fullName,
      email,
      phone,
      jobTitle,
      consentAt,
      privacyVersion,
      company,
      applicationUrl,
      source,
      tokenHash
    ).run();

    // Confirm that the token is now registered, including duplicate submissions.
    const candidate = await env.DB.prepare(`
      SELECT id
      FROM candidates
      WHERE registration_token_hash = ?
        AND candidate_type = 'job_seeker'
        AND lead_source = 'whizverse_job_portal'
      LIMIT 1
    `).bind(tokenHash).first();

    if (!candidate) {
      return jsonResponse({
        success: false,
        message: "Registration could not be completed. Please try again."
      }, 500);
    }

    return jsonResponse({
      success: true,
      registered: true,
      candidateId: candidate.id
    }, 201);

  } catch (error) {
    return jsonResponse({
      success: false,
      message: "Something went wrong while processing your registration."
    }, 500);
  }
}
