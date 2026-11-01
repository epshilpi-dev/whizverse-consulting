
const MAX_RESUME_SIZE = 5 * 1024 * 1024;
export async function onRequestPost({ request, env }) {
  const contentType = request.headers.get("content-type") || "";

  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return json({ error: "Submit the form using multipart/form-data." }, 415);
  }

  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_RESUME_SIZE + 100_000) {
    return json({ error: "Resume must not exceed 5 MB." }, 413);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Invalid form submission." }, 400);
  }

  const fullName = textField(form, "fullName", 120);
  const email = textField(form, "email", 254).toLowerCase();
  const phone = textField(form, "phone", 30);
  const location = textField(form, "preferredLocation", 120);
  const targetRole = textField(form, "targetRole", 120);
  const skills = textField(form, "skills", 1000);
  const experience = textField(form, "experienceYears", 3);
  const consent = form.get("consentPrivacy");
  const resume = form.get("resume");

  if (!fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !/^[+\d\s().-]{7,30}$/.test(phone)) {
    return json({ error: "Enter a valid name, email address and phone number." }, 400);
  }

  if (consent !== "on" && consent !== "true") {
    return json({ error: "Please provide privacy consent before submitting." }, 400);
  }

  if (experience && (!/^\d{1,2}$/.test(experience) || Number(experience) > 60)) {
    return json({ error: "Enter a valid number of years of experience." }, 400);
  }

  if (!(resume instanceof File) || resume.size === 0 || resume.size > MAX_RESUME_SIZE) {
    return json({ error: "Upload a resume no larger than 5 MB." }, 400);
  }

  const extension = (resume.name.split(".").pop() || "").toLowerCase();
  const allowedExtensions = new Set(["pdf", "doc", "docx"]);

  if (!allowedExtensions.has(extension) || !ALLOWED_TYPES.has(resume.type)) {
    return json({ error: "Only PDF, DOC and DOCX resumes are accepted." }, 400);
  }

  // Check common file signatures before storing the upload.
  const header = new Uint8Array(await resume.slice(0, 8).arrayBuffer());
  const isPdf = header[0] === 0x25 && header[1] === 0x50 &&
    header[2] === 0x44 && header[3] === 0x46;
  const isOle = header[0] === 0xD0 && header[1] === 0xCF &&
    header[2] === 0x11 && header[3] === 0xE0;
  const isZip = header[0] === 0x50 && header[1] === 0x4B &&
    header[2] === 0x03 && header[3] === 0x04;

  if ((extension === "pdf" && !isPdf) ||
      (extension === "doc" && !isOle) ||
      (extension === "docx" && !isZip)) {
    return json({ error: "The file content does not match its extension." }, 400);
  }

  const id = crypto.randomUUID();
  const safeExtension = extension;
  const resumeKey = `candidate-resumes/${id}.${safeExtension}`;

  try {
    await env.RESUMES.put(resumeKey, resume.stream(), {
      httpMetadata: { contentType: resume.type }
    });

    await env.DB.prepare(`
      INSERT INTO candidates (
        id, full_name, email, phone, preferred_location, target_role,
        skills, experience_years, resume_key, consent_privacy
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).bind(
      id, fullName, email, phone, location, targetRole,
      skills, experience ? Number(experience) : null, resumeKey
    ).run();

    return json({
      success: true,
      message: "Your profile has been submitted successfully."
    }, 201);
  } catch {
    // Avoid leaving an orphaned resume if the database insert fails.
    try {
      await env.RESUMES.delete(resumeKey);
    } catch {
      // Cleanup can be retried by an administrator.
    }
    return json({ error: "We could not save your submission. Please try again later." }, 500);
  }
}

function textField(form, name, maxLength) {
  const value = form.get(name);
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
