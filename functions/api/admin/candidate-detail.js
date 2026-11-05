
import { isAdmin, json } from "./_auth.js";

export async function onRequestGet({ request, env }) {
  if (!(await isAdmin(request, env))) {
    return json({ success: false, message: "Unauthorized." }, 401);
  }

  if (!env.DB) {
    return json({
      success: false,
      message: "Database binding missing."
    }, 503);
  }

  const url = new URL(request.url);
  const id = (url.searchParams.get("id") || "").trim();

  if (!id || id.length > 100) {
    return json({
      success: false,
      message: "A valid candidate ID is required."
    }, 400);
  }

  try {
    const candidate = await env.DB.prepare(`
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
      WHERE id = ?
      LIMIT 1
    `).bind(id).first();

    if (!candidate) {
      return json({
        success: false,
        message: "Candidate not found."
      }, 404);
    }

    return json({
      success: true,
      candidate
    });

  } catch (error) {
    console.error("Admin candidate detail failed.", {
      message: error?.message || "Unknown database error."
    });

    return json({
      success: false,
      message: "Could not load candidate profile."
    }, 500);
  }
}
