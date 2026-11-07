function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return entities[character];
  });
}

const LOGO_URL = "https://www.whizverseconsulting.com/logo.png";
const ADMIN_EMAIL = "contact@whizverseconsulting.com";
const FROM_EMAIL =
  "Whizverse Consulting <contact@whizverseconsulting.com>";

function formatRupees(paise) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(Number(paise || 0) / 100);
}

function getItems(order) {
  try {
    const items = JSON.parse(order.items_json || "[]");
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function itemRows(items) {
  return items.map(item => `
    <tr>
      <td style="padding:12px 8px;border-bottom:1px solid #e2e8f0;">
        ${escapeHtml(item.name)}
        <span style="color:#64748b;"> × ${Number(item.quantity) || 0}</span>
      </td>
      <td align="right"
        style="padding:12px 8px;border-bottom:1px solid #e2e8f0;white-space:nowrap;">
        ${formatRupees((Number(item.lineTotalRupees) || 0) * 100)}
      </td>
    </tr>
  `).join("");
}

function emailLayout(content) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin:0;padding:0;background:#f1f5f9;
      font-family:Arial,Helvetica,sans-serif;color:#243447;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
        style="background:#f1f5f9;padding:28px 12px;">
        <tr><td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
            style="max-width:620px;background:#fff;border:1px solid #e2e8f0;
            border-radius:12px;overflow:hidden;">
            <tr>
              <td align="center" style="background:#102a43;padding:28px 24px;">
                <img src="${LOGO_URL}" alt="Whizverse Consulting" width="180"
                  style="display:block;width:180px;max-width:100%;height:auto;border:0;">
                <p style="margin:15px 0 0;color:#dbeafe;font-size:13px;
                  letter-spacing:.5px;">UK &amp; EUROPE CAREER ADVISORY</p>
              </td>
            </tr>
            <tr><td style="height:4px;background:#0f8b8d;"></td></tr>
            <tr><td style="padding:32px;">${content}</td></tr>
            <tr>
              <td style="background:#f8fafc;padding:22px 32px;
                border-top:1px solid #e2e8f0;">
                <p style="font-size:12px;line-height:1.7;color:#64748b;margin:0;">
                  <strong style="color:#102a43;">Whizverse Consulting</strong><br>
                  UK &amp; Europe Career Advisory<br>
                  <a href="https://www.whizverseconsulting.com"
                    style="color:#0f8b8d;text-decoration:none;">
                    www.whizverseconsulting.com
                  </a>
                  &nbsp;|&nbsp;
                  <a href="mailto:contact@whizverseconsulting.com"
                    style="color:#0f8b8d;text-decoration:none;">
                    Contact Us
                  </a>
                </p>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </body>
    </html>
  `;
}

async function sendTrackedEmail(
  env,
  order,
  emailType,
  recipient,
  subject,
  html,
  text
) {
  let notificationId = crypto.randomUUID();

  try {
    if (!env.DB || !env.RESEND_API_KEY) {
      throw new Error("Email service configuration is incomplete.");
    }

    await env.DB.prepare(`
      INSERT OR IGNORE INTO career_service_email_notifications (
        id, order_id, email_type, recipient_email, status
      ) VALUES (?, ?, ?, ?, 'pending')
    `).bind(
      notificationId,
      order.id,
      emailType,
      recipient
    ).run();

    const existing = await env.DB.prepare(`
      SELECT id, status
      FROM career_service_email_notifications
      WHERE order_id = ? AND email_type = ?
      LIMIT 1
    `).bind(order.id, emailType).first();

    if (!existing || existing.status === "sent" ||
        existing.status === "sending") {
      return;
    }

    notificationId = existing.id;

    const claim = await env.DB.prepare(`
      UPDATE career_service_email_notifications
      SET status = 'sending',
          attempt_count = attempt_count + 1,
          updated_at = datetime('now'),
          error_message = NULL
      WHERE id = ?
        AND status IN ('pending', 'failed')
    `).bind(notificationId).run();

    if (!claim.meta || claim.meta.changes !== 1) {
      return;
    }

    const resendResponse = await fetch(
      "https://api.resend.com/emails",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: [recipient],
          subject,
          html,
          text
        })
      }
    );

    const result = await resendResponse.json().catch(() => ({}));

    if (!resendResponse.ok) {
      throw new Error(
        String(
          result.message ||
          result.error ||
          `Resend returned HTTP ${resendResponse.status}.`
        ).slice(0, 500)
      );
    }

    await env.DB.prepare(`
      UPDATE career_service_email_notifications
      SET status = 'sent',
          provider_message_id = ?,
          sent_at = datetime('now'),
          updated_at = datetime('now'),
          error_message = NULL
      WHERE id = ?
    `).bind(result.id || null, notificationId).run();

  } catch (error) {
    console.error("Career service email failed.", {
      orderId: order?.id || null,
      emailType,
      error: String(error?.message || error).slice(0, 500)
    });

    try {
      await env.DB.prepare(`
        UPDATE career_service_email_notifications
        SET status = 'failed',
            error_message = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).bind(
        String(error?.message || error).slice(0, 500),
        notificationId
      ).run();
    } catch (loggingError) {
      console.error("Unable to log career email failure.", {
        orderId: order?.id || null,
        emailType
      });
    }
  }
}

export async function sendCareerOrderEmails(env, order) {
  const items = getItems(order);
  const total = formatRupees(order.amount_paise);
  const safeName = escapeHtml(order.candidate_name);
  const safeOrderId = escapeHtml(order.id);

  const rows = itemRows(items);

  const customerHtml = emailLayout(`
    <p style="font-size:15px;color:#334155;">Dear ${safeName},</p>
    <h2 style="font-size:22px;color:#102a43;">
      Your payment has been received!
    </h2>
    <p style="font-size:15px;line-height:1.8;color:#475569;">
      Thank you for choosing Whizverse Consulting. Your payment has been
      successfully confirmed, and we have received your career services order.
    </p>
    <p style="font-size:14px;color:#334155;">
      <strong>Order reference:</strong> ${safeOrderId}
    </p>
    <h3 style="color:#102a43;font-size:17px;">Order summary</h3>
    <table width="100%" cellspacing="0" cellpadding="0"
      style="border-collapse:collapse;font-size:14px;">
      ${rows}
      <tr>
        <td style="padding:14px 8px;font-weight:bold;color:#102a43;">
          Total paid
        </td>
        <td align="right" style="padding:14px 8px;font-weight:bold;
          color:#102a43;white-space:nowrap;">${total}</td>
      </tr>
    </table>
    <p style="font-size:15px;line-height:1.8;color:#475569;margin-top:24px;">
      Our team will review your order and coordinate the next steps.
      We will contact you using your registered email address if any
      additional information is required.
    </p>
    <p style="font-size:14px;color:#334155;">
      Regards,<br><strong>Whizverse Consulting Team</strong>
    </p>
  `);

  const customerText = [
    `Dear ${order.candidate_name},`,
    "",
    "Your payment has been received and your order is confirmed.",
    "",
    `Order reference: ${order.id}`,
    "",
    "Services purchased:",
    ...items.map(item =>
      `${item.name} x ${item.quantity}: ${formatRupees(
        (Number(item.lineTotalRupees) || 0) * 100
      )}`
    ),
    "",
    `Total paid: ${total}`,
    "",
    "Our team will review your order and coordinate the next steps.",
    "",
    "Regards,",
    "Whizverse Consulting Team",
    "www.whizverseconsulting.com"
  ].join("\n");

  const adminHtml = emailLayout(`
    <h2 style="font-size:22px;color:#102a43;">
      New Career Services Payment Received
    </h2>
    <p style="font-size:15px;line-height:1.7;color:#475569;">
      A customer has successfully paid for a career services order.
    </p>
    <p style="font-size:14px;line-height:1.8;color:#334155;">
      <strong>Order reference:</strong> ${safeOrderId}<br>
      <strong>Customer:</strong> ${safeName}<br>
      <strong>Email:</strong> ${escapeHtml(order.email)}<br>
      <strong>Phone:</strong> ${escapeHtml(order.phone)}<br>
      <strong>Razorpay payment ID:</strong>
      ${escapeHtml(order.razorpay_payment_id)}
    </p>
    <h3 style="color:#102a43;font-size:17px;">Purchased services</h3>
    <table width="100%" cellspacing="0" cellpadding="0"
      style="border-collapse:collapse;font-size:14px;">
      ${rows}
      <tr>
        <td style="padding:14px 8px;font-weight:bold;color:#102a43;">
          Total paid
        </td>
        <td align="right" style="padding:14px 8px;font-weight:bold;
          color:#102a43;white-space:nowrap;">${total}</td>
      </tr>
    </table>
    <p style="font-size:13px;color:#64748b;margin-top:24px;">
      Please review the order in the Whizverse admin workflow and initiate
      service delivery.
    </p>
  `);

  const adminText = [
    "New Career Services Payment Received",
    "",
    `Order reference: ${order.id}`,
    `Customer: ${order.candidate_name}`,
    `Email: ${order.email}`,
    `Phone: ${order.phone}`,
    `Razorpay payment ID: ${order.razorpay_payment_id}`,
    "",
    "Purchased services:",
    ...items.map(item =>
      `${item.name} x ${item.quantity}: ${formatRupees(
        (Number(item.lineTotalRupees) || 0) * 100
      )}`
    ),
    "",
    `Total paid: ${total}`
  ].join("\n");

  await Promise.all([
    sendTrackedEmail(
      env,
      order,
      "payment_confirmation",
      order.email,
      "Payment Received – Your Whizverse Consulting Career Services Order",
      customerHtml,
      customerText
    ),
    sendTrackedEmail(
      env,
      order,
      "admin_paid_order_notification",
      ADMIN_EMAIL,
      `New Paid Career Services Order – ${order.id}`,
      adminHtml,
      adminText
    )
  ]);
}

export async function sendCareerOrderCompletedEmail(env, order) {
  const safeName = escapeHtml(order.candidate_name);
  const safeOrderId = escapeHtml(order.id);

  const html = emailLayout(`
    <p style="font-size:15px;color:#334155;">Dear ${safeName},</p>
    <h2 style="font-size:22px;color:#102a43;">
      Your career services order is complete!
    </h2>
    <p style="font-size:15px;line-height:1.8;color:#475569;">
      We are pleased to inform you that your Whizverse Consulting career
      services order has been marked as completed by our team.
    </p>
    <p style="font-size:14px;color:#334155;">
      <strong>Order reference:</strong> ${safeOrderId}
    </p>
    <p style="font-size:15px;line-height:1.8;color:#475569;">
      Please check your registered email for any deliverables or
      instructions associated with your selected services.
    </p>
    <p style="font-size:15px;color:#334155;">
      Regards,<br><strong>Whizverse Consulting Team</strong>
    </p>
  `);

  const text = [
    `Dear ${order.candidate_name},`,
    "",
    "Your Whizverse Consulting career services order has been marked as completed.",
    `Order reference: ${order.id}`,
    "",
    "Please check your registered email for any deliverables or instructions.",
    "",
    "Regards,",
    "Whizverse Consulting Team"
  ].join("\n");

  await sendTrackedEmail(
    env,
    order,
    "service_completion",
    order.email,
    "Your Whizverse Consulting Service Order Is Complete",
    html,
    text
  );
}
