// The picture for a link post from a site without its own player (OLX,
// 99acres, MagicBricks, Housing.com ...): the page's preview image, the same
// one WhatsApp and Facebook show (<meta property="og:image">).
//
// The server fetches an address a user typed, so it is careful:
//   - only http/https on the standard ports;
//   - every address the name resolves to must be public: no private,
//     loopback, link-local or other reserved ranges. The check runs in the
//     socket's own lookup, so the name can't change between check and use,
//     and again for each redirect (at most 3);
//   - at most 512 KB is read, within 8 seconds.
// Any failure just means no picture: the post is saved without one.
const http = require("http");
const https = require("https");
const dns = require("dns");
const net = require("net");

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
const USER_AGENT = "Mozilla/5.0 (compatible; PlotPostLinkPreview/1.0)";

// Two lists: Node's BlockList also checks IPv4 addresses against IPv6 rules
// (as ::ffff:a.b.c.d), so one mixed list would block every IPv4 address.
const blockedV4 = new net.BlockList();
const blockedV6 = new net.BlockList();
for (const [range, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
]) {
  blockedV4.addSubnet(range, bits, "ipv4");
}
// IPv4-mapped IPv6 (::ffff:a.b.c.d) is checked as IPv4 in isPublicAddress.
for (const [range, bits] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
]) {
  blockedV6.addSubnet(range, bits, "ipv6");
}

const isPublicAddress = (address, family) => {
  if (family === 6 || net.isIPv6(address)) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return !blockedV4.check(mapped[1], "ipv4");
    // Other ::ffff: forms (hex) are refused outright.
    if (/^::ffff:/i.test(address)) return false;
    return !blockedV6.check(address, "ipv6");
  }
  return !blockedV4.check(address, "ipv4");
};

// Resolves like the default lookup, but refuses non-public addresses.
const safeLookup = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options.family || 4 }];
    if (!list.length || list.some((a) => !isPublicAddress(a.address, a.family))) {
      const refused = new Error("Address not allowed");
      refused.code = "EADDRNOTALLOWED";
      return callback(refused);
    }
    if (options.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
};

const allowedUrl = (value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  if (port !== "443" && port !== "80") return null;
  // A literal IP must be public too (the lookup isn't used for those).
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && !isPublicAddress(host, net.isIP(host))) return null;
  return url;
};

// GETs one page (no redirects followed): { status, location, body }.
const getOnce = (url) =>
  new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const request = lib.get(
      url,
      {
        lookup: safeLookup,
        timeout: TIMEOUT_MS,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml",
          "accept-language": "en-IN,en;q=0.8",
        },
      },
      (response) => {
        const { statusCode, headers } = response;
        if (statusCode >= 300 && statusCode < 400 && headers.location) {
          response.resume();
          return resolve({ status: statusCode, location: headers.location, body: "" });
        }
        const type = String(headers["content-type"] || "");
        if (statusCode !== 200 || !/html/i.test(type)) {
          response.resume();
          return resolve({ status: statusCode, location: null, body: "" });
        }
        let size = 0;
        const chunks = [];
        response.on("data", (chunk) => {
          size += chunk.length;
          chunks.push(chunk);
          // The <head> with the preview tags comes first; stop early.
          if (size >= MAX_BYTES) response.destroy();
        });
        const finish = () => resolve({ status: statusCode, location: null, body: Buffer.concat(chunks).toString("utf8") });
        response.on("end", finish);
        response.on("close", finish);
        response.on("error", finish);
      }
    );
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", reject);
  });

const decodeEntities = (value) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

// The preview picture named in the page's <meta> tags, as an absolute URL.
const imageFromHtml = (html, pageUrl) => {
  const metas = html.match(/<meta\b[^>]*>/gi) || [];
  const wanted = ["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"];
  const found = {};
  for (const tag of metas) {
    const key = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const content = /\bcontent\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (key && content && wanted.includes(key) && !found[key]) found[key] = content;
  }
  let candidate = wanted.map((key) => found[key]).find(Boolean);
  if (!candidate) {
    const link = (html.match(/<link\b[^>]*>/gi) || []).find((tag) => /\brel\s*=\s*["']image_src["']/i.test(tag));
    candidate = link && /\bhref\s*=\s*["']([^"']+)["']/i.exec(link)?.[1];
  }
  if (!candidate) return null;
  try {
    const absolute = new URL(decodeEntities(candidate.trim()), pageUrl);
    if (absolute.protocol !== "https:" && absolute.protocol !== "http:") return null;
    const text = absolute.toString();
    return text.length <= 1000 && !/\s/.test(text) ? text : null;
  } catch {
    return null;
  }
};

// The preview picture for a page, or null. Never throws.
const previewImageFor = async (link) => {
  try {
    let url = allowedUrl(String(link || "").trim());
    for (let hop = 0; url && hop <= MAX_REDIRECTS; hop += 1) {
      const { status, location, body } = await getOnce(url);
      if (location) {
        url = allowedUrl(new URL(location, url).toString());
        continue;
      }
      return status === 200 && body ? imageFromHtml(body, url) : null;
    }
    return null;
  } catch {
    return null;
  }
};

// Sites whose posts are shown with their own player in the app: no picture
// needed (the app gets YouTube's still frame itself).
const PLAYER_SITES = /(^|\.)(youtube\.com|youtu\.be|instagram\.com|facebook\.com|fb\.watch|x\.com|twitter\.com|vimeo\.com|dailymotion\.com|dai\.ly|tiktok\.com|threads\.net|threads\.com)$/i;

const needsPreview = (link) => {
  const url = allowedUrl(String(link || "").trim());
  if (!url) return false;
  if (PLAYER_SITES.test(url.hostname)) return false;
  // A link straight to a picture or a video file is its own preview.
  return !/\.(jpe?g|png|webp|gif|mp4|m3u8|webm|mov|m4v|3gp|mkv)$/i.test(url.pathname);
};

module.exports = { previewImageFor, needsPreview, imageFromHtml, isPublicAddress, allowedUrl };
