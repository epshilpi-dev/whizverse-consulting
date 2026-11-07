import { sendCareerOrderEmails } from "../../_lib/career-service-email.js";

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
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
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

    // payment.captured is the primary successful-payment event.
    // order.paid is also supported when it contains a payment entity.
    const payment = event.payload?.payment?.entity;

    if (event.event === "payment.captured" ||
        event.event === "order.paid") {

      if (!payment?.id || !payment?.order_id ||
          payment.status !== "captured") {
        // Acknowledge unrelated or incomplete event payloads.
        // The payment verification endpoint remains another confirmation path.
        return response({ received: true });
      }

      const order = await env.DB.prepare(`
        SELECT id, candidate_id, candidate_name, email, phone,
               items_json, amount_paise, currency, status,
               razorpay_order_id, razorpay_payment_id, paid_at
        FROM career_service_orders
        WHERE razorpay_order_id = ?
        LIMIT 1
      `).bind(payment.order_id).first();

      if (!order) {
        // Do not retry an event for an order not belonging to this checkout.
        return response({ received: true });
      }

      if (payment.amount !== order.amount_paise ||
          payment.currency !== order.currency) {
        console.error("Career webhook payment mismatch.", {
          orderId: order.id
        });
        return response({ error: "Payment does not match the saved order." }, 400);
      }

      if (order.status === "paid" &&
          order.razorpay_payment_id &&
          order.razorpay_payment_id !== payment.id) {
        console.error("Career webhook payment ID conflict.", {
          orderId: order.id
        });
        return response({ error: "Order is associated with another payment." }, 409);
      }

      await env.DB.prepare(`
        UPDATE career_service_orders
        SET status = 'paid',
            razorpay_payment_id = ?,
            paid_at = COALESCE(paid_at, datetime('now'))
        WHERE id = ?
          AND (
            status = 'created'
            OR (
              status = 'paid'
              AND (
                razorpay_payment_id = ?
                OR razorpay_payment_id IS NULL
              )
            )
          )
      `).bind(payment.id, order.id, payment.id).run();

      const updatedOrder = await env.DB.prepare(`
        SELECT id, candidate_id, candidate_name, email, phone,
               items_json, amount_paise, currency, status,
               razorpay_order_id, razorpay_payment_id, paid_at
        FROM career_service_orders
        WHERE id = ?
        LIMIT 1
      `).bind(order.id).first();

      if (updatedOrder &&
          updatedOrder.status === "paid" &&
          updatedOrder.razorpay_payment_id === payment.id) {
        await sendCareerOrderEmails(env, updatedOrder);
      }

    } else if (event.event === "payment.failed") {
      if (!payment?.order_id) {
        return response({ received: true });
      }

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
