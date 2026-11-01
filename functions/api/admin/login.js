
import {
  createSession,
  sessionCookie,
  json
} from "./_auth.js";

export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_PASSWORD || !env.ADMIN_SESSION_SECRET) {
    return json({
      success: false,
      message: "Admin authentication is not configured."
    }, 503);
  }

  const origin = request.headers.get("Origin");
  if (origin !== new URL(request.url).origin) {
    return json({
      success: false,
      message: "Invalid request origin."
    }, 403);
  }

  if (!request.headers.get("Content-Type")?.includes("application/json")) {
    return json({
      success: false,
      message: "JSON required."
    }, 415);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({
      success: false,
      message: "Invalid request."
    }, 400);
  }

  const supplied =
    typeof body.password === "string" ? body.password : "";

  if (supplied.length > 1024) {
    return json({
      success: false,
      message: "Invalid credentials."
    }, 401);
  }

  const digest = async value =>
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(value)
      )
    );

  const expected = await digest(env.ADMIN_PASSWORD);
  const actual = await digest(supplied);

  let difference = 0;
  for (let i = 0; i < expected.length; i++) {
    difference |= expected[i] ^ actual[i];
  }

  if (difference !== 0) {
    return json({
      success: false,
      message: "Invalid credentials."
    }, 401);
  }

  const token = await createSession(env);

  return json(
    { success: true },
    200,
    { "Set-Cookie": sessionCookie(token) }
  );
}
