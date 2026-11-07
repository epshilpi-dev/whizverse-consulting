
import { isAdmin, json } from "./_auth.js";

export async function onRequestGet({ request, env }) {
  try {
    // 1. Verify Admin session
    if (!(await isAdmin(request, env))) {
      return json({
        success: false,
        message: "Unauthorized. Please log in again."
      }, 401);
    }

    // 2. Check database binding
    if (!env.DB) {
      return json({
        success: false,
        message: "Database is not configured."
      }, 500);
    }

    // 3. Read filters
    const url = new URL(request.url);
    const search = (url.searchParams.get("q") || "").trim();
    const status = (url.searchParams.get("status") || "").trim().toLowerCase();

    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get("limit") || "25", 10) || 25, 1),
      100
    );

    const offset = Math.max(
      parseInt(url.searchParams.get("offset") || "0", 10) || 0,
      0
    );

    const allowedStatuses = ["created", "paid", "failed"];

    if (status && !allowedStatuses.includes(status)) {
      return json({
        success: false,
        message: "Invalid payment status filter."
      }, 400);
    }

    // 4. Build safe SQL filters
    const conditions = [];
    const bindings = [];

    if (status) {
      conditions.push("status = ?");
      bindings.push(status);
    }

    if (search) {
      conditions.push(`(
        candidate_name LIKE ?
        OR email LIKE ?
        OR phone LIKE ?
        OR razorpay_order_id LIKE ?
        OR razorpay_payment_id LIKE ?
        OR id LIKE ?
      )`);

      const term = `%${search}%`;

      bindings.push(
        term, term, term, term, term, term
      );
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    // 5. Fetch payment records
    const paymentsQuery = `
      SELECT
        id,
        candidate_name,
        email,
        phone,
        items_json,
        amount_paise,
        currency,
        razorpay_order_id,
        razorpay_payment_id,
        status,
        created_at,
        paid_at
      FROM career_service_orders
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;

    const paymentsResult = await env.DB
      .prepare(paymentsQuery)
      .bind(...bindings, limit, offset)
      .all();

    // 6. Count matching records
    const countResult = await env.DB
      .prepare(`
        SELECT COUNT(*) AS total
        FROM career_service_orders
        ${whereClause}
      `)
      .bind(...bindings)
      .first();

    // 7. Overall payment summary
    const summary = await env.DB
      .prepare(`
        SELECT
          COUNT(*) AS total_orders,
          SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS successful_payments,
          SUM(CASE WHEN status = 'created' THEN 1 ELSE 0 END) AS pending_payments,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_payments,
          COALESCE(
            SUM(CASE WHEN status = 'paid' THEN amount_paise ELSE 0 END),
            0
          ) AS total_collected_paise
        FROM career_service_orders
      `)
      .first();

    // 8. Format records
    const payments = (paymentsResult.results || []).map(order => {
      let items = [];

      try {
        items = JSON.parse(order.items_json || "[]");
      } catch {
        items = [];
      }

      return {
        id: order.id,
        customer_name: order.candidate_name,
        email: order.email,
        phone: order.phone,
        items,
        amount_paise: order.amount_paise,
        amount_rupees: Number(order.amount_paise) / 100,
        currency: order.currency,
        razorpay_order_id: order.razorpay_order_id,
        razorpay_payment_id: order.razorpay_payment_id,
        status: order.status,
        created_at: order.created_at,
        paid_at: order.paid_at
      };
    });

    // 9. Return response
    return json({
      success: true,
      summary: {
        total_orders: Number(summary?.total_orders || 0),
        successful_payments: Number(summary?.successful_payments || 0),
        pending_payments: Number(summary?.pending_payments || 0),
        failed_payments: Number(summary?.failed_payments || 0),
        total_collected_paise: Number(summary?.total_collected_paise || 0),
        total_collected_rupees:
          Number(summary?.total_collected_paise || 0) / 100
      },
      payments,
      pagination: {
        total: Number(countResult?.total || 0),
        limit,
        offset
      }
    });

  } catch (error) {
    console.error("Admin payments API error:", error);

    return json({
      success: false,
      message: "Unable to retrieve payment records."
    }, 500);
  }
}
