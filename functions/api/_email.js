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
      <body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#263238;">
        <div style="max-width:620px;margin:30px auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb;">
          <div style="background:#14213d;padding:28px 32px;color:#ffffff;">
            <h1 style="margin:0;font-size:23px;">Whizverse Consulting</h1>
            <p style="margin:8px 0 0;color:#dbeafe;font-size:13px;">
              UK &amp; Europe Career Advisory
            </p>
          </div>

          <div style="padding:32px;">
            <p style="font-size:16px;">Dear ${name},</p>

            <h2 style="font-size:21px;color:#14213d;margin-top:24px;">
              ${heading}
            </h2>

            <p style="font-size:15px;line-height:1.7;color:#4b5563;">
              ${message}
            </p>

            <p style="font-size:15px;line-height:1.7;color:#4b5563;">
              Thank you for considering Whizverse Consulting.
            </p>

            <p style="font-size:15px;line-height:1.7;margin-top:28px;">
              Regards,<br>
              <strong>Whizverse Consulting Team</strong>
            </p>
          </div>

          <div style="background:#f8fafc;padding:18px 32px;border-top:1px solid #e5e7eb;">
            <p style="font-size:12px;line-height:1.6;color:#6b7280;margin:0;">
              This is an automated confirmation of your submission.
              Please do not reply directly to this email.
            </p>
            <p style="font-size:12px;color:#6b7280;margin:8px 0 0;">
              Whizverse Consulting
            </p>
          </div>
        </div>
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
    "Thank you for considering Whizverse Consulting.",
    "",
    "Regards,",
    "Whizverse Consulting Team",
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

    // Reserve one notification per candidate and email type.
    // The unique constraint prevents accidental duplicate sends.
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
      // A notification already exists. Do not send another email.
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

    // Email logging failures must never affect candidate registration.
    if (notificationId) {
      try {
        await env.DB.prepare(`
          UPDATE email_notifications
          SET
            status = 'failed',
            error_message = ?,
            updated_at = datetime('now'
            )
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
