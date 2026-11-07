
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

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB || !env.RAZORPAY_WEBHOOK_SECRET) {
      return response({ error: "Webhook is not configured." }, 503);
    }

    const rawBody = await request.text();
    const receivedSignature =
      request.headers.get("X-Razorpay-Signature") || "";

    const expectedSignature = await hmacHex(
      env.RAZORPAY_WEBHOOK_SECRET,
      rawBody
    );

    if (!constantTimeEqual(
      expectedSignature.toLowerCase(),
      receivedSignature.toLowerCase()
    )) {
      return response({ error: "Invalid webhook signature." }, 400);
    }

    const event = JSON.parse(rawBody);
    const payment =
      event.payload?.payment?.entity;

    if (!payment?.order_id) {
      return response({ received: true });
    }

    if (event.event === "payment.captured" ||
        event.event === "order.paid") {
      if (payment.status !== "captured") {
        return response({ received: true });
      }

      await env.DB.prepare(`
        UPDATE career_service_orders
        SET status = 'paid',
            razorpay_payment_id = ?,
            paid_at = COALESCE(paid_at, datetime('now'))
        WHERE razorpay_order_id = ?
          AND amount_paise = ?
          AND currency = ?
          AND status IN ('created', 'paid')
      `).bind(
        payment.id,
        payment.order_id,
        payment.amount,
        payment.currency
      ).run();
    } else if (event.event === "payment.failed") {
      await env.DB.prepare(`
        UPDATE career_service_orders
        SET status = 'failed'
        WHERE razorpay_order_id = ?
          AND status = 'created'
      `).bind(payment.order_id).run();
    }

    return response({ received: true });
  } catch (error) {
    console.error("Career payment webhook error", {
      name: error?.name || "Error"
    });

    return response({ error: "Webhook processing failed." }, 500);
  }
}

