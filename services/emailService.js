// Sends PlotPost's emails: sign-up verification codes, password-reset codes,
// copies of buyer inquiries and report alerts for admins.
//
// Three ways to send, whichever is set up (in this order):
//   Brevo   BREVO_API_KEY    (HTTPS; works on Railway's Hobby plan; free 300/day)
//   Resend  RESEND_API_KEY   (HTTPS; works on Railway's Hobby plan; free 100/day)
//   SMTP    SMTP_HOST, SMTP_USER, SMTP_PASS (e.g. Gmail; Railway only allows
//           SMTP on its Pro plan, but it works on your PC)
// EMAIL_PROVIDER=brevo|resend|smtp picks one when several are set.
// EMAIL_FROM is the sender, e.g. "PlotPost <no-reply@your-domain.com>".
const nodemailer = require("nodemailer");
const { CODE_TTL_MINUTES } = require("./codeService");

const isTest = () => process.env.NODE_ENV === "test";
// Testing on your PC without any email set up: print codes in the terminal.
// Never in production.
const devLogCodes = () =>
  process.env.EMAIL_DEV_LOG_CODES === "true" && process.env.NODE_ENV !== "production";

// In tests, emails are collected here instead of being sent.
const outbox = [];

const configured = {
  brevo: () => Boolean(process.env.BREVO_API_KEY),
  resend: () => Boolean(process.env.RESEND_API_KEY),
  smtp: () => Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
};

// The provider that will send, or null when none is set up.
const provider = () => {
  const wanted = String(process.env.EMAIL_PROVIDER || "").trim().toLowerCase();
  if (configured[wanted]?.()) return wanted;
  return ["brevo", "resend", "smtp"].find((name) => configured[name]()) || null;
};

// True when an email can actually reach someone (or, on your PC, the code is
// printed in the terminal).
const canSend = () => isTest() || Boolean(provider()) || devLogCodes();

// "PlotPost <no-reply@x.com>" -> { name: "PlotPost", email: "no-reply@x.com" }
const sender = () => {
  const raw = String(process.env.EMAIL_FROM || process.env.SMTP_USER || "").trim();
  const match = raw.match(/^\s*"?([^"<]*?)"?\s*<\s*([^>]+)\s*>\s*$/);
  if (match) return { name: match[1].trim() || "PlotPost", email: match[2].trim() };
  return { name: "PlotPost", email: raw };
};

let transporter;
const smtpTransporter = () => {
  if (!transporter) {
    const port = parseInt(process.env.SMTP_PORT || "465", 10);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
};

const postJson = async (url, headers, body) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    // The provider's answer, without the API key or the email's content.
    throw new Error(`email service answered ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
};

// Sends one email. Throws when it can't be sent.
const deliver = async ({ to, subject, text, html, replyTo }) => {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!recipients.length) return;
  const from = sender();
  const which = provider();
  if (!which) throw new Error("No email service is set up (BREVO_API_KEY, RESEND_API_KEY or SMTP_*).");
  if (!from.email) throw new Error("EMAIL_FROM is not set.");

  if (which === "brevo") {
    await postJson(
      "https://api.brevo.com/v3/smtp/email",
      { "api-key": process.env.BREVO_API_KEY },
      {
        sender: from,
        to: recipients.map((email) => ({ email })),
        subject,
        textContent: text,
        ...(html ? { htmlContent: html } : {}),
        ...(replyTo ? { replyTo: { email: replyTo } } : {}),
      }
    );
    return;
  }
  if (which === "resend") {
    await postJson(
      "https://api.resend.com/emails",
      { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      {
        from: `${from.name} <${from.email}>`,
        to: recipients,
        subject,
        text,
        ...(html ? { html } : {}),
        ...(replyTo ? { reply_to: replyTo } : {}),
      }
    );
    return;
  }
  await smtpTransporter().sendMail({
    from: `${from.name} <${from.email}>`,
    to: recipients.join(", "),
    subject,
    text,
    ...(html ? { html } : {}),
    ...(replyTo ? { replyTo } : {}),
  });
};

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const oneLine = (value, max = 200) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

// ------------------------------------------------------------ codes

const CODE_EMAILS = {
  reset: {
    subject: "Your PlotPost password reset code",
    heading: "Reset your password",
    intro: (name) => `Hi ${name}, use this code to reset your PlotPost password.`,
    ignore: "If you didn't ask for this, you can ignore this email; your password stays the same.",
  },
  verify: {
    subject: "Your PlotPost verification code",
    heading: "Confirm your email",
    intro: (name) => `Hi ${name}, welcome to PlotPost! Enter this code in the app to confirm your email.`,
    ignore: "If you didn't create a PlotPost account, you can ignore this email.",
  },
  delete: {
    subject: "Your PlotPost account deletion code",
    heading: "Delete your PlotPost account",
    intro: (name) =>
      `Hi ${name}, someone asked on the PlotPost website to delete your account. If it was you, enter this code on that page to confirm. Deleting your account removes your listings, chats and everything else, and can't be undone.`,
    ignore: "If you didn't ask for this, ignore this email; nothing is deleted without the code.",
  },
};

const sendCode = async (kind, user, code) => {
  const copy = CODE_EMAILS[kind];
  if (isTest()) {
    outbox.push({ to: user.email, subject: copy.subject, kind, code });
    return;
  }
  if (!provider()) {
    if (devLogCodes()) {
      console.log(`[email not sent, no email service set up] ${kind} code for ${user.email}: ${code}`);
      return;
    }
    throw new Error("No email service is set up.");
  }
  const name = oneLine(user.name, 60) || "there";
  const intro = copy.intro(name);
  const footer = `The code expires in ${CODE_TTL_MINUTES} minutes. ${copy.ignore}`;
  await deliver({
    to: user.email,
    subject: copy.subject,
    text: `${intro}\n\nYour code: ${code}\n\n${footer}\n\nPlotPost`,
    html: `<div style="font-family:Arial,sans-serif;max-width:480px">
  <h2 style="margin:0 0 12px">${copy.heading}</h2>
  <p>${escapeHtml(intro)}</p>
  <p style="font-size:28px;font-weight:bold;letter-spacing:6px;margin:20px 0">${code}</p>
  <p style="color:#666">${escapeHtml(footer)}</p>
  <p>PlotPost</p></div>`,
  });
};

const sendPasswordResetCode = (user, code) => sendCode("reset", user, code);
const sendVerificationCode = (user, code) => sendCode("verify", user, code);
const sendDeletionCode = (user, code) => sendCode("delete", user, code);

// ------------------------------------------------------------ inquiries

// Email Inquiries: a copy of a buyer inquiry for the seller. Only when email
// is set up (otherwise the inquiry is still in Buyer Inquiries). Sent in the
// background so the buyer isn't kept waiting; a failed email is only logged.
const sendEnquiryCopy = (seller, enquiry, postTitle, updated = false) => {
  const title = oneLine(postTitle, 120) || "your property";
  const subject = `${updated ? "Updated inquiry" : "New inquiry"}: ${title}`;

  if (isTest()) {
    outbox.push({ to: seller.email, subject, kind: "enquiry", enquiryId: String(enquiry._id) });
    return true;
  }
  if (!provider() || !seller.email) return false;

  const lines = [
    ["Name", oneLine(enquiry.name, 80)],
    ["Phone", oneLine(enquiry.phone, 20)],
    ["Email", oneLine(enquiry.email, 120) || "not given"],
    ["Prefers", oneLine(enquiry.contactMethod, 20)],
    ["Wants a site visit", enquiry.wantsVisit ? "Yes" : "No"],
  ];
  const intro = `Hi ${oneLine(seller.name, 60)}, ${oneLine(enquiry.name, 80)} ${
    updated ? "updated their inquiry about" : "is interested in"
  } "${title}".`;
  const footer =
    'Reply from PlotPost > Buyer Inquiries. You get these emails because "Email Inquiries" is on in your PlotPost settings.';
  const message = String(enquiry.message || "").slice(0, 1000);

  deliver({
    to: seller.email,
    ...(enquiry.email ? { replyTo: oneLine(enquiry.email, 120) } : {}),
    subject,
    text: `${intro}\n\n${lines.map(([label, value]) => `${label}: ${value}`).join("\n")}\n\nMessage:\n${message}\n\n${footer}\n\nPlotPost`,
    html: `<div style="font-family:Arial,sans-serif;max-width:520px">
  <h2 style="margin:0 0 12px">${updated ? "Updated inquiry" : "New inquiry"}</h2>
  <p>${escapeHtml(intro)}</p>
  <table style="border-collapse:collapse">${lines
    .map(
      ([label, value]) =>
        `<tr><td style="padding:2px 12px 2px 0;color:#666">${escapeHtml(label)}</td><td style="padding:2px 0">${escapeHtml(value)}</td></tr>`
    )
    .join("")}</table>
  <p style="margin-top:16px"><b>Message</b><br>${escapeHtml(message).replace(/\n/g, "<br>")}</p>
  <p style="color:#666">${escapeHtml(footer)}</p>
  <p>PlotPost</p></div>`,
  }).catch((error) => console.error(`Inquiry email not sent (${error.message}).`));
  return true;
};

// ------------------------------------------------------------ reports

// A new report: an email to the admins, so it can be handled within 24 hours.
// Never waits for the email service; problems are only logged.
const KIND_LABELS = { post: "listing", comment: "comment", user: "account" };
const sendReportAlert = (to, { kind, reason, details = "", about = "", commentText = "" }) => {
  const what = KIND_LABELS[kind] || "item";
  const subject = `New report (${what}): ${oneLine(reason, 60)}${about ? ` – ${oneLine(about, 60)}` : ""}`;
  if (isTest()) {
    outbox.push({ to, subject, kind: "report" });
    return true;
  }
  if (!provider() || !to.length) return false;

  const panel = process.env.ADMIN_PANEL_URL || "your server's /admin page";
  const lines = [
    `Someone reported a ${what} on PlotPost.`,
    "",
    `Reason: ${oneLine(reason, 80)}`,
    about ? `Listing: ${oneLine(about, 120)}` : "",
    commentText ? `Comment: "${oneLine(commentText, 200)}"` : "",
    details ? `Details: ${oneLine(details, 500)}` : "",
    "",
    `Please review it within 24 hours in the admin panel: ${panel}`,
  ].filter((line, index, all) => line !== "" || (index > 0 && all[index - 1] !== ""));

  deliver({ to, subject, text: `${lines.join("\n")}\n\nPlotPost` }).catch((error) =>
    console.error(`Report alert email not sent (${error.message}).`)
  );
  return true;
};

module.exports = {
  canSend,
  provider,
  deliver,
  sendPasswordResetCode,
  sendVerificationCode,
  sendDeletionCode,
  sendEnquiryCopy,
  sendReportAlert,
  outbox,
};
