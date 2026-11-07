
function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message)
  );

  return [...new Uint8Array(signature)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" ||
      a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function onRequestPost({ request, env }) {
  try {
    const origin = request.headers.get("Origin");
    if (!origin || origin !== new URL(request.url).origin) {
      return response({ error: "Request not allowed." }, 403);
    }

    if (!env.DB || !env.RAZORPAY_KEY_ID ||
        !env.RAZORPAY_KEY_SECRET) {
      return response({ error: "Checkout is not configured." }, 503);
    }

    const input = await request.json();
    const orderId = String(input.razorpay_order_id || "");
    const paymentId = String(input.razorpay_payment_id || "");
    const signature = String(input.razorpay_signature || "");

    if (!/^order_[A-Za-z0-9]+$/.test(orderId) ||
        !/^pay_[A-Za-z0-9]+$/.test(paymentId) ||
        !/^[a-fA-F0-9]{64}$/.test(signature)) {
      return response({ error: "Invalid payment details." }, 400);
    }

    const result = await env.DB.prepare(`
      SELECT id, amount_paise, currency, status,
             razorpay_order_id, razorpay_payment_id
      FROM career_service_orders
      WHERE razorpay_order_id = ?
      LIMIT 1
    `).bind(orderId).first();

    if (!result) {
      return response({ error: "Order not found." }, 404);
    }

    if (result.status === "paid") {
      return response({ success: true, status: "paid" });
    }

    const expectedSignature = await hmacHex(
      env.RAZORPAY_KEY_SECRET,
      result.razorpay_order_id + "|" + paymentId
    );

    if (!constantTimeEqual(
      expectedSignature.toLowerCase(),
      signature.toLowerCase()
    )) {
      return response({ error: "Payment signature is invalid." }, 400);
    }

    const paymentResponse = await fetch(
      "https://api.razorpay.com/v1/payments/" +
        encodeURIComponent(paymentId),
      {
        headers: {
          "Authorization": "Basic " +
            btoa(env.RAZORPAY_KEY_ID + ":" + env.RAZORPAY_KEY_SECRET)
        }
      }
    );

    const payment = await paymentResponse.json();

    if (!paymentResponse.ok) {
      return response({
        error: "Payment status could not be confirmed."
      }, 502);
    }

    if (payment.order_id !== result.razorpay_order_id ||
        payment.amount !== result.amount_paise ||
        payment.currency !== result.currency) {
      return response({
        error: "Payment does not match the saved order."
      }, 400);
    }

    if (payment.status !== "captured") {
      return response({
        success: false,
        status: payment.status,
        message: "Payment is not yet captured. Please wait for confirmation."
      }, 202);
    }

    await env.DB.prepare(`
      UPDATE career_service_orders
      SET status = 'paid',
          razorpay_payment_id = ?,
          paid_at = datetime('now')
      WHERE id = ?
        AND status = 'created'
    `).bind(paymentId, result.id).run();

    const updated = await env.DB.prepare(`
      SELECT status
      FROM career_service_orders
      WHERE id = ?
      LIMIT 1
    `).bind(result.id).first();

    if (!updated || updated.status !== "paid") {
      return response({
        error: "Payment received; order confirmation is pending."
      }, 202);
    }

    return response({ success: true, status: "paid" });
  } catch (error) {
    console.error("Career payment verification error", {
      name: error?.name || "Error"
    });

    return response({
      error: "Unable to verify payment yet. Please contact support if debited."
    }, 500);
  }
}
