
const SERVICES = {
  resume_rewriting: {
    name: "Resume Rewriting",
    price: 7500
  },
  cover_letter: {
    name: "Cover Letter",
    price: 4700
  },
  linkedin_optimisation: {
    name: "LinkedIn Optimisation",
    price: 7500
  },
  interview_preparation: {
    name: "Interview Preparation",
    price: 9400
  },
  ready_job_pack: {
    name: "Ready Job Pack",
    price: 9400
  }
};

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

function normalisePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export async function onRequestPost({ request, env }) {
  try {
    const origin = request.headers.get("Origin");
    const requestOrigin = new URL(request.url).origin;

    if (!origin || origin !== requestOrigin) {
      return response({ error: "Request not allowed." }, 403);
    }

    if (!env.DB || !env.RAZORPAY_KEY_ID ||
        !env.RAZORPAY_KEY_SECRET) {
      return response({
        error: "Checkout is not configured yet."
      }, 503);
    }

    const contentType = request.headers.get("Content-Type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return response({ error: "JSON is required." }, 415);
    }

    const input = await request.json();
    const email = String(input.email || "").trim().toLowerCase();
    const phone = normalisePhone(input.phone);
    const cart = input.items;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        phone.length !== 10) {
      return response({
        error: "Enter a valid email and 10-digit mobile number."
      }, 400);
    }

    if (!Array.isArray(cart) || cart.length < 1 || cart.length > 5) {
      return response({ error: "Invalid shopping cart." }, 400);
    }

    const quantities = new Map();

    for (const item of cart) {
      const id = String(item.id || "");
      const quantity = Number(item.quantity);

      if (!SERVICES[id] ||
          !Number.isInteger(quantity) ||
          quantity < 1 || quantity > 5) {
        return response({ error: "Invalid service selection." }, 400);
      }

      quantities.set(id, (quantities.get(id) || 0) + quantity);

      if (quantities.get(id) > 5) {
        return response({
          error: "Maximum quantity per service is 5."
        }, 400);
      }
    }

    // Match both email and phone. Return no candidate details
    // if there is no match.
    const candidates = await env.DB.prepare(`
      SELECT id, full_name, email, phone
      FROM candidates
      WHERE lower(email) = ?
      ORDER BY created_at DESC
      LIMIT 20
    `).bind(email).all();

    const candidate = (candidates.results || []).find(
      item => normalisePhone(item.phone) === phone
    );

    if (!candidate) {
      return response({
        error: "registration_required",
        message:
          "We could not match these details to an existing profile. " +
          "Register using this email and mobile number, then return to checkout."
      }, 409);
    }

    const items = [...quantities.entries()].map(([id, quantity]) => ({
      id,
      name: SERVICES[id].name,
      unitPriceRupees: SERVICES[id].price,
      quantity,
      lineTotalRupees: SERVICES[id].price * quantity
    }));

    const amountRupees = items.reduce(
      (sum, item) => sum + item.lineTotalRupees, 0
    );

    // Razorpay expects the amount in paise for INR.
    const amountPaise = amountRupees * 100;

    if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
      return response({ error: "Invalid order amount." }, 400);
    }

    const localOrderId = crypto.randomUUID();
    const receipt = "wz_" + crypto.randomUUID().replace(/-/g, "").slice(0, 28);

    const razorpayResponse = await fetch(
      "https://api.razorpay.com/v1/orders",
      {
        method: "POST",
        headers: {
          "Authorization": "Basic " +
            btoa(env.RAZORPAY_KEY_ID + ":" + env.RAZORPAY_KEY_SECRET),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          amount: amountPaise,
          currency: "INR",
          receipt,
          notes: {
            whizverse_order_ref: localOrderId,
            candidate_ref: candidate.id
          }
        })
      }
    );

    const gatewayOrder = await razorpayResponse.json();

    if (!razorpayResponse.ok || !gatewayOrder.id) {
      console.error("Razorpay order creation failed", {
        status: razorpayResponse.status,
        code: gatewayOrder.code || null
      });

      return response({
        error: "Payment order could not be created. Please try again."
      }, 502);
    }

    await env.DB.prepare(`
      INSERT INTO career_service_orders (
        id, candidate_id, candidate_name, email, phone,
        items_json, amount_paise, currency,
        razorpay_order_id, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'INR', ?, 'created')
    `).bind(
      localOrderId,
      candidate.id,
      candidate.full_name,
      email,
      candidate.phone,
      JSON.stringify(items),
      amountPaise,
      gatewayOrder.id
    ).run();

    return response({
      success: true,
      keyId: env.RAZORPAY_KEY_ID,
      localOrderId,
      orderId: gatewayOrder.id,
      amount: amountPaise,
      currency: "INR",
      name: candidate.full_name,
      email,
      phone: candidate.phone,
      items
    });
  } catch (error) {
    console.error("Career service order error", {
      name: error?.name || "Error"
    });

    return response({
      error: "Unable to start checkout. Please try again."
    }, 500);
  }
}
