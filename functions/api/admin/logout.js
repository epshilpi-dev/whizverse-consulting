
import { clearSessionCookie, json } from "./_auth.js";

export async function onRequestPost({ request }) {
  const origin = request.headers.get("Origin");

  if (origin !== new URL(request.url).origin) {
    return json({
      success: false,
      message: "Invalid request origin."
    }, 403);
  }

  return json(
    { success: true },
    200,
    { "Set-Cookie": clearSessionCookie() }
  );
}
