// Emails you when the server has a problem: a request that failed with a
// server error (500), a background job that failed, or a crash.
//
// Who gets it: ERROR_ALERT_EMAILS (comma separated), or REPORT_ALERT_EMAILS
// if that's empty. Nobody listed, or no email service: nothing is sent (the
// problem is still in the Railway logs).
//
// At most one email every 15 minutes; problems in between are collected
// into the next one. Only the place and the first line of the error are
// sent, never request bodies or passwords.
const emailService = require("./emailService");

const WINDOW_MS = 15 * 60 * 1000;
const MAX_LINES = 20;

const recipients = () =>
  String(process.env.ERROR_ALERT_EMAILS || process.env.REPORT_ALERT_EMAILS || "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);

const firstLine = (error) => {
  const text = String(error?.message || error || "Unknown error").split("\n")[0].trim();
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
};

const serverName = () =>
  process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RAILWAY_SERVICE_NAME || "PlotPost server";

const formatEmail = (items, total) => {
  const when = (date) => date.toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const lines = items.map((item) => `${when(item.at)}  ${item.where}: ${item.message}`);
  const more = total > items.length ? `\n…and ${total - items.length} more. See the Railway logs.` : "";
  const subject =
    total === 1 ? `PlotPost server problem: ${items[0].where}` : `PlotPost server: ${total} problems`;
  const text = `${serverName()} had ${total === 1 ? "a problem" : `${total} problems`}:\n\n${lines.join("\n")}${more}\n\nThe full details are in the Railway logs (Deployments → View logs).\n\nPlotPost`;
  return { subject, text };
};

// A small sender with its own clock and email function, so tests can check
// the 15-minute rule without waiting.
const createAlerter = ({
  send = (message) => emailService.deliver(message),
  canSend = () => process.env.NODE_ENV !== "test" && emailService.canSend() && recipients().length > 0,
  to = recipients,
  now = () => Date.now(),
  windowMs = WINDOW_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms).unref(),
} = {}) => {
  let pending = [];
  let pendingTotal = 0;
  let lastSentAt = 0;
  let timer = null;
  let sending = Promise.resolve(false);

  const flush = async () => {
    timer = null;
    if (!pendingTotal) return false;
    const items = pending;
    const total = pendingTotal;
    pending = [];
    pendingTotal = 0;
    lastSentAt = now();
    try {
      await send({ to: to(), ...formatEmail(items, total) });
      return true;
    } catch (error) {
      console.error(`Error alert email not sent (${error.message}).`);
      return false;
    }
  };

  // Records a problem; sends now, or with the next email in 15 minutes.
  const report = (error, { where = "server" } = {}) => {
    if (!canSend()) return false;
    pendingTotal += 1;
    if (pending.length < MAX_LINES) pending.push({ at: new Date(now()), where, message: firstLine(error) });
    const wait = lastSentAt + windowMs - now();
    if (wait <= 0) {
      sending = flush();
    } else if (!timer) {
      timer = setTimer(() => {
        sending = flush();
      }, wait);
    }
    return true;
  };

  // A crash: send straight away (the server is about to stop), but don't
  // wait longer than a few seconds for the email service.
  const reportNow = async (error, { where = "crash", timeoutMs = 5000 } = {}) => {
    if (!report(error, { where })) return false;
    // Not sent yet because of the 15-minute rule: send it anyway.
    if (pendingTotal) sending = flush();
    const giveUp = new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs).unref());
    return Promise.race([sending, giveUp]);
  };

  return { report, reportNow, flush, pendingCount: () => pendingTotal };
};

const alerter = createAlerter();

module.exports = {
  report: alerter.report,
  reportNow: alerter.reportNow,
  createAlerter,
  recipients,
  formatEmail,
  WINDOW_MS,
};
