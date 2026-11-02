
const MAX_RESUME_SIZE = 5 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set(["pdf", "doc", "docx"]);

const ALLOWED_MIME_TYPES = {
  pdf: new Set(["application/pdf"]),
  doc: new Set([
    "application/msword",
    "application/octet-stream",
  ]),
  docx: new Set([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/octet-stream",
  ]),
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function hasValidFileSignature(bytes, extension) {
  if (extension === "pdf") {
    return (
      bytes.length >= 5 &&
      bytes[0] === 0x25 && // %
      bytes[1] === 0x50 && // P
      bytes[2] === 0x44 && // D
      bytes[3] === 0x46 && // F
      bytes[4] === 0x2d // -
    );
  }

  if (extension === "doc") {
    const signature = [
      0xd0, 0xcf, 0x11, 0xe0,
      0xa1, 0xb1, 0x1a, 0xe1,
    ];

    return (
      bytes.length >= signature.length &&
      signature.every((byte, index) => bytes[index] === byte)
    );
  }

  if (extension === "docx") {
    // DOCX files are ZIP containers.
    return (
      bytes.length >= 4 &&
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      [0x03, 0x05, 0x07].includes(bytes[2]) &&
      [0x04, 0x06, 0x08].includes(bytes[3])
    );
  }

  return false;
}

export async function onRequestPost({ request, env }) {
  if (!env.DB || !env.RESUMES) {
    return json(
      {
        success: false,
        error: "Candidate storage is not configured correctly.",
      },
      503
    );
  }

  let form;

  try {
    // Read the multipart request body only once.
    form = await request.formData();
  } catch {
    return json(
      {
        success: false,
        error: "Invalid form submission. Please refresh and try again.",
      },
      400
    );
  }

  const fullName = cleanText(form.get("fullName"), 120);
  const email = cleanText(form.get("email"), 254).toLowerCase();
  const phone = cleanText(form.get("phone"), 30);
  const preferredLocation = cleanText(
    form.get("preferredLocation"),
    120
  );
  const targetRole = cleanText(form.get("targetRole"), 120);
  const skills = cleanText(form.get("skills"), 1000);
  const experienceValue = cleanText(form.get("experienceYears"), 3);
  const consentPrivacy = form.get("consentPrivacy") === "on";
  const resume = form.get("resume");

  if (!fullName || !email || !phone) {
    return json(
      {
        success: false,
        error: "Please provide your name, email address and phone number.",
      },
      400
    );
  }

  if (
    fullName.length < 2 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    phone.length < 5
  ) {
    return json(
      {
        success: false,
        error: "Please check your name, email address and phone number.",
      },
      400
    );
  }

  let experienceYears = null;

  if (experienceValue !== "") {
    experienceYears = Number(experienceValue);

    if (
      !Number.isInteger(experienceYears) ||
      experienceYears < 0 ||
      experienceYears > 60
    ) {
      return json(
        {
          success: false,
          error: "Experience must be a whole number between 0 and 60.",
        },
        400
      );
    }
  }

  if (!consentPrivacy) {
    return json(
      {
        success: false,
        error: "Please accept the privacy consent to continue.",
      },
      400
    );
  }

  if (
    !resume ||
    typeof resume === "string" ||
    typeof resume.arrayBuffer !== "function" ||
    !resume.name
  ) {
    return json(
      {
        success: false,
        error: "Please attach your resume.",
      },
      400
    );
  }

  if (resume.size === 0 || resume.size > MAX_RESUME_SIZE) {
    return json(
      {
        success: false,
        error: "Resume must be a non-empty file of 5 MB or smaller.",
      },
      400
    );
  }

  const filename = resume.name.trim();
  const extension = filename.split(".").pop()?.toLowerCase();

  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return json(
      {
        success: false,
        error: "Only PDF, DOC and DOCX resumes are accepted.",
      },
      400
    );
  }

  const contentType = (resume.type || "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  if (
    contentType &&
    !ALLOWED_MIME_TYPES[extension].has(contentType)
  ) {
    return json(
      {
        success: false,
        error: "The resume file type does not match its extension.",
      },
      400
    );
  }

  let resumeBytes;

  try {
    resumeBytes = await resume.arrayBuffer();
  } catch {
    return json(
      {
        success: false,
        error: "Unable to read the uploaded resume.",
      },
      400
    );
  }

  if (!hasValidFileSignature(new Uint8Array(resumeBytes), extension)) {
    return json(
      {
        success: false,
        error: "The resume file appears invalid or has the wrong format.",
      },
      400
    );
  }

  const id = crypto.randomUUID();
  const resumeKey = `candidate-resumes/${id}.${extension}`;

  let resumeUploaded = false;

  try {
    // Store the resume only after all input validation passes.
    await env.RESUMES.put(resumeKey, resumeBytes, {
      httpMetadata: {
        contentType:
          contentType || "application/octet-stream",
      },
    });

    resumeUploaded = true;

    // Column names match the candidates table schema.
    await env.DB.prepare(`
      INSERT INTO candidates (
        id,
        full_name,
        email,
        phone,
        preferred_location,
        target_role,
        skills,
        experience_years,
        resume_key,
        consent_privacy,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        id,
        fullName,
        email,
        phone,
        preferredLocation || null,
        targetRole || null,
        skills || null,
        experienceYears,
        resumeKey,
        1,
        "new"
      )
      .run();

    return json(
      {
        success: true,
        message: "Your candidate profile has been submitted successfully.",
      },
      201
    );
  } catch (error) {
    // If the database insert fails, remove the uploaded resume.
    if (resumeUploaded) {
      try {
        await env.RESUMES.delete(resumeKey);
      } catch {
        // Avoid exposing internal storage details to the visitor.
      }
    }

    // Keep detailed errors out of the public response.
    console.error("Candidate submission failed.", {
      stage: resumeUploaded ? "database_insert" : "resume_upload",
    });

    return json(
      {
        success: false,
        error: "Unable to save your profile right now. Please try again later.",
      },
      500
    );
  }
}

// Reject other HTTP methods.
export async function onRequest({ request }) {
  if (request.method !== "POST") {
    return json(
      {
        success: false,
        error: "Method not allowed.",
      },
      405
    );
  }
}
