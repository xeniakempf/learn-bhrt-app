// chart-request.js — handles the "Send me the chart" form on learn.bhrt.app
// 1) validates the email  2) saves it to the "bhrt-leads" blob store
// 3) emails the Estradiol Conversion Chart via Resend
//
// Environment variables needed in Netlify (Site settings → Environment variables):
//   RESEND_API_KEY   — same key used on bhrt.app
//   SITE_URL         — https://learn.bhrt.app   (no trailing slash)

import { getStore } from "@netlify/blobs";

const FROM = "BHRT Navigator <noreply@noreply.yourfunctional.health>";
const PDF_PATH = "/downloads/Estradiol_Conversion_Chart.pdf";

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }

  // Honeypot: real people never fill the hidden "website" field
  if (body.website) return json({ ok: true });

  const email = String(body.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Please enter a valid email address." }, 400);
  }

  const siteUrl = (process.env.SITE_URL || "https://learn.bhrt.app").replace(/\/$/, "");
  const pdfUrl = siteUrl + PDF_PATH;

  // Save the lead (one record per email; repeat requests just update the timestamp)
  try {
    const leads = getStore("bhrt-leads");
    const existing = await leads.get(email, { type: "json", consistency: "strong" }).catch(() => null);
    await leads.setJSON(email, {
      email,
      firstRequestedAt: existing?.firstRequestedAt || new Date().toISOString(),
      lastRequestedAt: new Date().toISOString(),
      requests: (existing?.requests || 0) + 1,
      source: "estradiol-chart",
    });
  } catch (err) {
    console.error("Blob write failed:", err);
    // Don't block the email over a storage hiccup
  }

  // Send the email
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: [email],
      subject: "Your Estradiol Conversion Chart",
      html: emailHtml(pdfUrl, siteUrl),
      text: emailText(pdfUrl, siteUrl),
      attachments: [{ path: pdfUrl, filename: "Estradiol_Conversion_Chart.pdf" }],
    }),
  });

  if (!resp.ok) {
    console.error("Resend error:", await resp.text());
    return json({ error: "We couldn't send the email just now. Please try again in a minute." }, 502);
  }

  return json({ ok: true });
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function emailHtml(pdfUrl, siteUrl) {
  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;color:#16232A;line-height:1.5">
    <p style="font-family:Georgia,serif;font-size:20px;color:#083F39;margin:0 0 16px">Your Estradiol Conversion Chart</p>
    <p>The chart is attached to this email as a PDF, and you can also download it here:</p>
    <p style="margin:20px 0">
      <a href="${pdfUrl}" style="display:inline-block;background:#083F39;color:#F3FBF8;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">Download the chart (PDF)</a>
    </p>
    <p>It covers labeled dose to expected serum estradiol for every patch, gel, spray, oral, and vaginal product, with the brand-to-brand spread called out where the labels disagree. Print it, keep it at the desk, forward it to a colleague.</p>
    <p>The chart is one page from <a href="${siteUrl}" style="color:#0B5D53">BHRT Navigator</a>, a point-of-care reference app for prescribers. The app adds injectable estradiol, the full Rx Cards, lab interpretation, and male protocols, and pairs with a complete BHRT course if you want the framework behind the numbers.</p>
    <p style="margin-top:28px;font-size:13px;color:#54666C">Educational content for licensed clinicians. Not a substitute for clinical judgment, current package labeling, or informed consent with your patients.</p>
    <p style="font-size:12px;color:#8B9A9C">You're receiving this because you requested the chart at learn.bhrt.app. We'll send updates about the course and app now and then; reply to this email with &quot;unsubscribe&quot; anytime and we'll take you off the list.</p>
  </div>`;
}

function emailText(pdfUrl, siteUrl) {
  return `Your Estradiol Conversion Chart

The chart is attached as a PDF, and you can also download it here:
${pdfUrl}

It covers labeled dose to expected serum estradiol for every patch, gel, spray, oral, and vaginal product, with the brand-to-brand spread called out where the labels disagree.

The chart is one page from BHRT Navigator, a point-of-care reference app for prescribers: ${siteUrl}

Educational content for licensed clinicians. Not a substitute for clinical judgment, current package labeling, or informed consent with your patients.

You're receiving this because you requested the chart at learn.bhrt.app. We'll send updates about the course and app now and then; reply with "unsubscribe" anytime and we'll take you off the list.`;
}
