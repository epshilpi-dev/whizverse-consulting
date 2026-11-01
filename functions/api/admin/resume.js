
import { isAdmin, json } from "./_auth.js";

export async function onRequestGet({ request, env }) {
  if (!(await isAdmin(request, env))) {
    return json({
      success: false,
      message: "Unauthorized."
    }, 401);
  }

  if (!env.DB || !env.RESUMES) {
    return json({
      success: false,
      message: "Storage bindings missing."
    }, 503);
  }

  const id = new URL(request.url).searchParams.get("id");

  if (!id || id.length > 100) {
    return json({
      success: false,
      message: "Invalid candidate ID."
    }, 400);
  }

  try {
    const candidate = await env.DB.prepare(
      "SELECT resume_key FROM candidates WHERE id = ?"
    ).bind(id).first();

    if (!candidate?.resume_key) {
      return json({
        success: false,
        message: "Resume not found."
      }, 404);
    }

    const object = await env.RESUMES.get(candidate.resume_key);

    if (!object) {
      return json({
        success: false,
        message: "Resume not found."
      }, 404);
    }

    const safeKey = String(candidate.resume_key).split("/").pop();
    const extension = safeKey
      .match(/\.(pdf|doc|docx)$/i)?.[0]?.toLowerCase();

    if (!extension) {
      return json({
        success: false,
        message: "Unsupported resume file."
      }, 415);
    }

    return new Response(object.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition":
          `attachment; filename="candidate-resume${extension}"`,
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch {
    return json({
      success: false,
      message: "Could not retrieve resume."
    }, 500);
  }
}
