
import { isAdmin, json } from "./_auth.js";

const ALLOWED_STATUSES = [
  "pending",
  "in_review",
  "changes_requested",
  "approved"
];

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function validId(value) {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= 100;
}

// GET: Retrieve assessment history for one candidate.
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
  const candidateId = (url.searchParams.get("candidateId") || "").trim();

  if (!validId(candidateId)) {
    return json({
      success: false,
      message: "A valid candidate ID is required."
    }, 400);
  }

  try {
    const candidate = await env.DB.prepare(`
      SELECT id
      FROM candidates
      WHERE id = ?
      LIMIT 1
    `).bind(candidateId).first();

    if (!candidate) {
      return json({
        success: false,
        message: "Candidate not found."
      }, 404);
    }

    const result = await env.DB.prepare(`
      SELECT
        id,
        candidate_id,
        evaluation_status,
        ai_output_json,
        human_notes,
        reviewed_by,
        approved_at,
        created_at,
        updated_at
      FROM candidate_evaluations
      WHERE candidate_id = ?
      ORDER BY created_at DESC, rowid DESC
    `).bind(candidateId).all();

    return json({
      success: true,
      evaluations: result.results || []
    });

  } catch (error) {
    console.error("Evaluation history retrieval failed.", {
      message: error?.message || "Unknown database error."
    });

    return json({
      success: false,
      message: "Could not retrieve evaluation history."
    }, 500);
  }
}

// POST: Create a NEW assessment. Never overwrite an earlier assessment.
export async function onRequestPost({ request, env }) {
  if (!(await isAdmin(request, env))) {
    return json({ success: false, message: "Unauthorized." }, 401);
  }

  if (!env.DB) {
    return json({
      success: false,
      message: "Database binding missing."
    }, 503);
  }

  const body = await readBody(request);

  if (!body || !validId(body.candidateId)) {
    return json({
      success: false,
      message: "A valid candidate ID is required."
    }, 400);
  }

  const candidateId = body.candidateId.trim();

  try {
    const candidate = await env.DB.prepare(`
      SELECT id
      FROM candidates
      WHERE id = ?
      LIMIT 1
    `).bind(candidateId).first();

    if (!candidate) {
      return json({
        success: false,
        message: "Candidate not found."
      }, 404);
    }

    const evaluationId = crypto.randomUUID();

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO candidate_evaluations (
          id,
          candidate_id,
          evaluation_status,
          human_notes
        )
        VALUES (?, ?, 'pending', '')
      `).bind(evaluationId, candidateId),

      env.DB.prepare(`
        UPDATE candidates
        SET evaluation_status = 'pending'
        WHERE id = ?
      `).bind(candidateId)
    ]);

    return json({
      success: true,
      message: "New assessment created.",
      evaluationId
    }, 201);

  } catch (error) {
    console.error("Assessment creation failed.", {
      message: error?.message || "Unknown database error."
    });

    return json({
      success: false,
      message: "Could not create a new assessment."
    }, 500);
  }
}

// PATCH: Save HR notes or change the status of an existing assessment.
export async function onRequestPatch({ request, env }) {
  if (!(await isAdmin(request, env))) {
    return json({ success: false, message: "Unauthorized." }, 401);
  }

  if (!env.DB) {
    return json({
      success: false,
      message: "Database binding missing."
    }, 503);
  }

  const body = await readBody(request);

  if (
    !body ||
    !validId(body.evaluationId) ||
    typeof body.humanNotes !== "string" ||
    body.humanNotes.length > 20000 ||
    typeof body.reviewedBy !== "string" ||
    !body.reviewedBy.trim() ||
    body.reviewedBy.trim().length > 120 ||
    !ALLOWED_STATUSES.includes(body.status)
  ) {
    return json({
      success: false,
      message: "Invalid assessment details."
    }, 400);
  }

  const evaluationId = body.evaluationId.trim();
  const humanNotes = body.humanNotes.trim();
  const reviewedBy = body.reviewedBy.trim();
  const status = body.status;

  if (status === "approved" && humanNotes.length < 20) {
    return json({
      success: false,
      message: "Add meaningful HR assessment notes before approval."
    }, 400);
  }

  try {
    const existing = await env.DB.prepare(`
      SELECT id, candidate_id, evaluation_status
      FROM candidate_evaluations
      WHERE id = ?
      LIMIT 1
    `).bind(evaluationId).first();

    if (!existing) {
      return json({
        success: false,
        message: "Assessment not found."
      }, 404);
    }

    if (existing.evaluation_status === "approved") {
      return json({
        success: false,
        message: "Approved assessments cannot be edited. Create a new assessment instead."
      }, 409);
    }

    const now = new Date().toISOString();
    const approvedAt = status === "approved" ? now : null;

    const updateResult = await env.DB.prepare(`
      UPDATE candidate_evaluations
      SET
        human_notes = ?,
        reviewed_by = ?,
        evaluation_status = ?,
        approved_at = ?,
        updated_at = ?
      WHERE id = ?
        AND evaluation_status <> 'approved'
    `).bind(
      humanNotes,
      reviewedBy,
      status,
      approvedAt,
      now,
      evaluationId
    ).run();

    if (!updateResult.meta || updateResult.meta.changes !== 1) {
      return json({
        success: false,
        message: "Assessment could not be updated. It may already be approved."
      }, 409);
    }

    await env.DB.prepare(`
      UPDATE candidates
      SET evaluation_status = ?
      WHERE id = ?
    `).bind(status, existing.candidate_id).run();

    return json({
      success: true,
      message: status === "approved"
        ? "Assessment approved successfully."
        : "Assessment saved successfully.",
      evaluationId,
      status
    });

  } catch (error) {
    console.error("Assessment update failed.", {
      message: error?.message || "Unknown database error."
    });

    return json({
      success: false,
      message: "Could not save assessment."
    }, 500);
  }
}
