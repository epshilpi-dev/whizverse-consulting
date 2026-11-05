
import { isAdmin, json } from "./_auth.js";

export async function onRequestGet({ request, env }) {
  // 1. Verify administrator session.
  if (!(await isAdmin(request, env))) {
    return json({
      success: false,
      message: "Unauthorized."
    }, 401);
  }

  // 2. Verify database binding.
  if (!env.DB) {
    return json({
      success: false,
      message: "Database binding missing."
    }, 503);
  }

  const url = new URL(request.url);

  const q = (url.searchParams.get("q") || "")
    .trim()
    .slice(0, 100);

  const status = (url.searchParams.get("status") || "")
    .trim()
    .toLowerCase();

  const candidateType = (url.searchParams.get("candidateType") || "")
    .trim()
    .toLowerCase();

  // 3. Validate candidate type filter.
  const allowedTypes = [
    "",
    "all",
    "job_seeker",
    "career_advisory"
  ];

  if (!allowedTypes.includes(candidateType)) {
    return json({
      success: false,
      message: "Invalid candidate type filter."
    }, 400);
  }

  // 4. Pagination.
  const page = Math.max(
    1,
    Math.min(
      100000,
      Number.parseInt(url.searchParams.get("page") || "1", 10) || 1
    )
  );

  const limit = 25;
  const offset = (page - 1) * limit;

  // 5. Build parameterised filters.
  const conditions = [];
  const values = [];

  if (q) {
    conditions.push(`(
      full_name LIKE ?
      OR email LIKE ?
      OR phone LIKE ?
      OR target_role LIKE ?
      OR preferred_location LIKE ?
      OR skills LIKE ?
      OR current_location LIKE ?
      OR current_designation LIKE ?
      OR industry LIKE ?
      OR preferred_countries LIKE ?
      OR linkedin_url LIKE ?
      OR lead_source LIKE ?
      OR campaign_name LIKE ?
    )`);

    const term = `%${q}%`;

    values.push(
      term, term, term, term, term, term,
      term, term, term, term, term, term, term
    );
  }

  const allowedStatuses = [
    "new",
    "reviewed",
    "shortlisted",
    "rejected"
  ];

  if (allowedStatuses.includes(status)) {
    conditions.push("status = ?");
    values.push(status);
  }

  if (
    candidateType === "job_seeker" ||
    candidateType === "career_advisory"
  ) {
    conditions.push("candidate_type = ?");
    values.push(candidateType);
  }

  const where = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  try {
    // 6. Total records matching the filters.
    const countResult = await env.DB.prepare(`
      SELECT COUNT(*) AS total
      FROM candidates
      ${where}
    `).bind(...values).first();

    // 7. Retrieve candidate records.
    const result = await env.DB.prepare(`
      SELECT
        id,
        full_name,
        email,
        phone,
        preferred_location,
        target_role,
        skills,
        experience_years,
        status,
        created_at,

        candidate_type,
        current_location,
        current_designation,
        industry,
        linkedin_url,
        preferred_countries,
        career_reason,
        uk_europe_reason,
        lead_source,
        campaign_name,

        consent_privacy,
        consent_marketing,
        consent_ai_processing,
        consent_at,
        ai_consent_at,
        privacy_version,

        evaluation_status

      FROM candidates
      ${where}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).bind(
      ...values,
      limit,
      offset
    ).all();

    return json({
      success: true,
      candidates: result.results || [],
      total: Number(countResult?.total || 0),
      page,
      pageSize: limit,
      filters: {
        candidateType: candidateType || "all",
        status: status || "all",
        search: q
      }
    });

  } catch (error) {
    console.error("Admin candidate listing failed.", {
      message: error?.message || "Unknown database error."
    });

    return json({
      success: false,
      message: "Could not load candidates."
    }, 500);
  }
}
