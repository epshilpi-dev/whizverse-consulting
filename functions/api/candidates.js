
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

function isChecked(value) {
  return ["on", "true", "1", "yes"].includes(
    String(value || "").toLowerCase()
  );
}

function hasValidFileSignature(bytes, extension) {
  if (extension === "pdf") {
    return (
      bytes.length >= 5 &&
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46 &&
      bytes[4] === 0x2d
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
    return json({
      success: false,
      error: "Candidate storage is not configured correctly.",
    }, 503);
  }

  let form;

  try {
    form = await request.formData();
  } catch {
    return json({
      success: false,
      error: "Invalid form submission. Please refresh and try again.",
    }, 400);
  }

  // Common fields used by both registration journeys.
  const fullName = cleanText(form.get("fullName"), 120);
  const email = cleanText(form.get("email"), 254).toLowerCase();
  const phone = cleanText(form.get("phone"), 30);
  const preferredLocation = cleanText(
    form.get("preferredLocation"), 120
  );
  const targetRole = cleanText(form.get("targetRole"), 120);
  const skills = cleanText(form.get("skills"), 1000);
  const experienceValue = cleanText(form.get("experienceYears"), 3);

  // Registration type defaults to the existing job-seeker journey.
  const submittedType = cleanText(
    form.get("candidateType"), 30
  ).toLowerCase();

  const candidateType = submittedType || "job_seeker";

  if (!["job_seeker", "career_advisory"].includes(candidateType)) {
    return json({
      success: false,
      error: "Invalid registration type.",
    }, 400);
  }

  // Additional profile fields for career advisory customers.
  const currentLocation = cleanText(
    form.get("currentLocation"), 120
  );
  const industry = cleanText(form.get("industry"), 120);
  const currentDesignation = cleanText(
    form.get("currentDesignation"), 120
  );
  const linkedinUrl = cleanText(form.get("linkedinUrl"), 300);
  const preferredCountries = cleanText(
    form.get("preferredCountries"), 500
  );
  const careerReason = cleanText(form.get("careerReason"), 1000);
  const ukEuropeReason = cleanText(
    form.get("ukEuropeReason"), 1000
  );
  const leadSource = cleanText(form.get("leadSource"), 100);
  const campaignName = cleanText(form.get("campaignName"), 100);

  // Separate consent controls.
  const consentPrivacy = isChecked(form.get("consentPrivacy"));
  const consentMarketing = isChecked(
    form.get("consentMarketing")
  );
  const consentAIProcessing = isChecked(
    form.get("consentAIProcessing")
  );

  const privacyVersion = cleanText(
    form.get("privacyVersion"), 30
  ) || "v1";

  const resume = form.get("resume");

  if (!fullName || !email || !phone) {
    return json({
      success: false,
      error: "Please provide your name, email address and phone number.",
    }, 400);
  }

  if (
    fullName.length < 2 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    phone.length < 5
  ) {
    return json({
      success: false,
      error: "Please check your name, email address and phone number.",
    }, 400);
  }

  let experienceYears = null;

  if (experienceValue !== "") {
    experienceYears = Number(experienceValue);

    if (
      !Number.isInteger(experienceYears) ||
      experienceYears < 0 ||
      experienceYears > 60
    ) {
      return json({
        success: false,
        error: "Experience must be a whole number between 0 and 60.",
      }, 400);
    }
  }

  if (!consentPrivacy) {
    return json({
      success: false,
      error: "Please accept the privacy consent to continue.",
    }, 400);
  }

  // AI consent is optional. No AI processing is triggered here.
  if (
    consentAIProcessing &&
    candidateType !== "career_advisory"
  ) {
    return json({
      success: false,
      error: "AI evaluation consent is only available for career advisory registrations.",
    }, 400);
  }

  if (
    linkedinUrl &&
    !/^https:\/\/(www\.)?linkedin\.com\//i.test(linkedinUrl)
  ) {
    return json({
      success: false,
      error: "Please enter a valid LinkedIn profile URL.",
    }, 400);
  }

  if (
    !resume ||
    typeof resume === "string" ||
    typeof resume.arrayBuffer !== "function" ||
    !resume.name
  ) {
    return json({
      success: false,
      error: "Please attach your resume.",
    }, 400);
  }

  if (resume.size === 0 || resume.size > MAX_RESUME_SIZE) {
    return json({
      success: false,
      error: "Resume must be a non-empty file of 5 MB or smaller.",
    }, 400);
  }

  const filename = resume.name.trim();
  const extension = filename.split(".").pop()?.toLowerCase();

  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return json({
      success: false,
      error: "Only PDF, DOC and DOCX resumes are accepted.",
    }, 400);
  }

  const contentType = (resume.type || "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  if (
    contentType &&
    !ALLOWED_MIME_TYPES[extension].has(contentType)
  ) {
    return json({
      success: false,
      error: "The resume file type does not match its extension.",
    }, 400);
  }

  let resumeBytes;

  try {
    resumeBytes = await resume.arrayBuffer();
  } catch {
    return json({
      success: false,
      error: "Unable to read the uploaded resume.",
    }, 400);
  }

  if (!hasValidFileSignature(
    new Uint8Array(resumeBytes), extension
  )) {
    return json({
      success: false,
      error: "The resume file appears invalid or has the wrong format.",
    }, 400);
  }

  const id = crypto.randomUUID();
  const resumeKey = `candidate-resumes/${id}.${extension}`;
  const consentTimestamp = new Date().toISOString();

  let resumeUploaded = false;

  try {
    await env.RESUMES.put(resumeKey, resumeBytes, {
      httpMetadata: {
        contentType: contentType || "application/octet-stream",
      },
    });

    resumeUploaded = true;

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
        status,
        current_location,
        industry,
        career_reason,
        uk_europe_reason,
        consent_marketing,
        consent_at,
        privacy_version,
        candidate_type,
        current_designation,
        linkedin_url,
        preferred_countries,
        lead_source,
        campaign_name,
        consent_ai_processing,
        ai_consent_at,
        evaluation_status
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `).bind(
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
      "new",
      currentLocation || null,
      industry || null,
      careerReason || null,
      ukEuropeReason || null,
      consentMarketing ? 1 : 0,
      consentTimestamp,
      privacyVersion,
      candidateType,
      currentDesignation || null,
      linkedinUrl || null,
      preferredCountries || null,
      leadSource || null,
      campaignName || null,
      consentAIProcessing ? 1 : 0,
      consentAIProcessing ? consentTimestamp : null,
      "not_started"
    ).run();

    return json({
      success: true,
      message: candidateType === "career_advisory"
        ? "Your career advisory profile has been submitted successfully."
        : "Your candidate profile has been submitted successfully.",
    }, 201);

  } catch (error) {
    if (resumeUploaded) {
      try {
        await env.RESUMES.delete(resumeKey);
      } catch {
        // Do not expose internal storage details.
      }
    }

    console.error("Candidate submission failed.", {
      stage: resumeUploaded ? "database_insert" : "resume_upload",
      candidateType,
    });

    return json({
      success: false,
      error: "Unable to save your profile right now. Please try again later.",
    }, 500);
  }
}

export async function onRequest({ request, env }) {
  if (request.method === "POST") {
    return onRequestPost({ request, env });
  }

  return json({
    success: false,
    error: "Method not allowed.",
  }, 405);
}
