
function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[character];
  });
}

// Use the URL that successfully displays your official logo.
const logoUrl = "https://www.whizverseconsulting.com/logo.png";

function buildEmail(candidate) {
  const name = escapeHtml(candidate.full_name);
  const isAdvisory = candidate.candidate_type === "career_advisory";

  const subject = isAdvisory
    ? "We Have Received Your Free Profile Evaluation Request"
    : "Your Registration with Whizverse Consulting Is Successful";

  const heading = isAdvisory
    ? "Your profile evaluation request has been received!"
    : "Your registration was successful!";

  const message = isAdvisory
    ? "Thank you for submitting your profile for a free career evaluation. Our HR team will review your professional background, experience, skills and career aspirations for the UK and European markets. We will contact you with relevant observations and possible next steps."
    : "Thank you for registering with Whizverse Consulting. We have successfully received your candidate profile and resume. Our team may review your profile against relevant opportunities and contact you if a suitable match is identified.";

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${subject}</title>
      </head>

      <body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#243447;">

        <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
          style="background:#f1f5f9;padding:28px 12px;">
          <tr>
            <td align="center">

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                style="max-width:620px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">

                <!-- Branded header -->
                <tr>
                  <td align="center" style="background:#102a43;padding:28px 24px 24px;">

                    <table role="presentation" cellspacing="0" cellpadding="0">
                      <tr>
                        <td align="center"
                          style="background:#ffffff;padding:10px 18px;border-radius:8px;">
                          <img
                            src="${logoUrl}"
                            alt="Whizverse Consulting"
                            width="180"
                            style="display:block;width:180px;max-width:100%;height:auto;border:0;"
                          >
                        </td>
                      </tr>
                    </table>

                    <p style="margin:15px 0 0;color:#dbeafe;font-size:13px;letter-spacing:0.5px;">
                      UK &amp; EUROPE CAREER ADVISORY
                    </p>
                  </td>
                </tr>

                <!-- Teal brand accent -->
                <tr>
                  <td style="height:4px;background:#0f8b8d;font-size:0;line-height:0;">
                    &nbsp;
                  </td>
                </tr>

                <!-- Email content -->
                <tr>
                  <td style="padding:34px 32px;">

                    <p style="font-size:15px;color:#334155;margin:0 0 22px;">
                      Dear ${name},
                    </p>

                    <h2 style="font-size:22px;line-height:1.4;color:#102a43;margin:0 0 18px;">
                      ${heading}
                    </h2>

                    <p style="font-size:15px;line-height:1.8;color:#475569;margin:0 0 18px;">
                      ${message}
                    </p>

                    <p style="font-size:15px;line-height:1.8;color:#475569;margin:0 0 26px;">
                      Thank you for considering Whizverse Consulting. We appreciate the opportunity to support your career journey.
                    </p>

                    <p style="font-size:15px;line-height:1.7;color:#334155;margin:0;">
                      Regards,<br>
                      <strong style="color:#102a43;">Whizverse Consulting Team</strong>
                    </p>

                  </td>
                </tr>

                <!-- Branded footer -->
                <tr>
                  <td style="background:#f8fafc;padding:22px 32px;border-top:1px solid #e2e8f0;">

                    <p style="font-size:12px;line-height:1.7;color:#64748b;margin:0 0 10px;">
                      This is an automated confirmation of your submission.
                      Please do not reply directly to this email.
                    </p>

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

            </td>
          </tr>
        </table>

      </body>
    </html>
  `;

  const text = [
    `Dear ${candidate.full_name},`,
    "",
    heading,
    "",
    message,
    "",
    "Thank you for considering Whizverse Consulting. We appreciate the opportunity to support your career journey.",
    "",
    "Regards,",
    "Whizverse Consulting Team",
    "",
    "www.whizverseconsulting.com",
    "contact@whizverseconsulting.com",
  ].join("\n");

  return { subject, html, text };
}

export async function sendRegistrationEmail(env, candidate) {
  let notificationId = null;
  let emailType = null;

  try {
    if (!env.DB || !env.RESEND_API_KEY) {
      throw new Error("Email service configuration is incomplete.");
    }

    if (!candidate?.id || !candidate?.email || !candidate?.full_name) {
      throw new Error("Candidate email details are incomplete.");
    }

    const isAdvisory = candidate.candidate_type === "career_advisory";

    emailType = isAdvisory
      ? "career_advisory_confirmation"
      : "job_seeker_confirmation";

    notificationId = crypto.randomUUID();

    const reservation = await env.DB.prepare(`
      INSERT OR IGNORE INTO email_notifications (
        id,
        candidate_id,
        email_type,
        recipient_email,
        status
      ) VALUES (?, ?, ?, ?, 'pending')
    `).bind(
      notificationId,
      candidate.id,
      emailType,
      candidate.email
    ).run();

    if (!reservation.meta || reservation.meta.changes !== 1) {
      return;
    }

    await env.DB.prepare(`
      UPDATE email_notifications
      SET
        status = 'sending',
        attempt_count = attempt_count + 1,
        updated_at = datetime('now'),
        error_message = NULL
      WHERE id = ?
    `).bind(notificationId).run();

    const email = buildEmail(candidate);

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Whizverse Consulting <contact@whizverseconsulting.com>",
        to: [candidate.email],
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      const providerError =
        result.message ||
        result.error ||
        `Resend returned HTTP ${response.status}.`;

      throw new Error(String(providerError).slice(0, 500));
    }

    await env.DB.prepare(`
      UPDATE email_notifications
      SET
        status = 'sent',
        provider_message_id = ?,
        sent_at = datetime('now'),
        updated_at = datetime('now'),
        error_message = NULL
      WHERE id = ?
    `).bind(
      result.id || null,
      notificationId
    ).run();

  } catch (error) {
    console.error("Registration confirmation email failed.", {
      candidateId: candidate?.id || null,
      emailType,
      error: String(error?.message || error).slice(0, 500),
    });

    if (notificationId) {
      try {
        await env.DB.prepare(`
          UPDATE email_notifications
          SET
            status = 'failed',
            error_message = ?,
            updated_at = datetime('now')
          WHERE id = ?
        `).bind(
          String(error?.message || error).slice(0, 500),
          notificationId
        ).run();
      } catch (loggingError) {
        console.error("Unable to update email notification log.", {
          candidateId: candidate?.id || null,
        });
      }
    }
  }
}
