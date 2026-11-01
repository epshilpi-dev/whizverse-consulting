
import { isAdmin, json } from "./_auth.js";

export async function onRequestGet({ request, env }) {
  if (!(await isAdmin(request, env))) {
    return json({
      success: false,
      message: "Unauthorized."
    }, 401);
  }

  if (!env.DB) {
    return json({
      success: false,
      message: "Database binding missing."
    }, 503);
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
  const status = (url.searchParams.get("status") || "").trim();

  const page = Math.max(
    1,
    Math.min(
      100000,
      Number.parseInt(url.searchParams.get("page") || "1", 10) || 1
    )
  );

  const limit = 25;
  const offset = (page - 1) * limit;
  const conditions = [];
  const values = [];

  if (q) {
    conditions.push(
      "(full_name LIKE ? OR email LIKE ? OR phone LIKE ? OR target_role LIKE ? OR preferred_location LIKE ? OR skills LIKE ?)"
    );

    const term = `%${q}%`;
    values.push(term, term, term, term, term, term);
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

  const where = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  try {
    const countResult = await env.DB.prepare(
      `SELECT COUNT(*) AS total FROM candidates ${where}`
    ).bind(...values).first();

    const result = await env.DB.prepare(
      `SELECT id, full_name, email, phone, preferred_location,
              target_role, skills, experience_years, status, created_at
       FROM candidates ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    ).bind(...values, limit, offset).all();

    return json({
      success: true,
      candidates: result.results || [],
      total: countResult?.total || 0,
      page,
      pageSize: limit
    });
  } catch {
    return json({
      success: false,
      message: "Could not load candidates."
    }, 500);
  }
}
