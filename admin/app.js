// PlotPost admin panel. Plain JavaScript, no build step. Talks to /api/admin.
// Look follows the Supertainer role page (gradient banner, white cards, Light/Vibrant). Everything that
// comes from the server is escaped with esc() before it goes into the page,
// and no inline styles are written (the page's security policy blocks them).
(() => {
  "use strict";

  const API = "/api";
  const TOKEN_KEY = "plotpost_admin_token";
  const THEME_KEY = "plotpost_admin_theme";
  const LOOK_KEY = "plotpost_admin_look";
  const TARGET = 3000; // launch target for live posts

  // ------------------------------------------------------------ helpers

  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const fmt = (n) => Number(n || 0).toLocaleString("en-IN");
  const plural = (n, word) => `${fmt(n)} ${word}${Number(n) === 1 ? "" : "s"}`;
  const cut = (text, max) => {
    const value = String(text ?? "").replace(/\s+/g, " ").trim();
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
  };
  const initials = (name) =>
    String(name || "")
      .trim()
      .split(/\s+/)
      .map((word) => word[0] || "")
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?";
  const httpsUrl = (url) => (/^https:\/\//i.test(String(url || "")) ? String(url) : "");
  const webUrl = (url) => (/^https?:\/\//i.test(String(url || "")) ? String(url) : "");

  const store = {
    get(kind, key) {
      try {
        return window[kind].getItem(key);
      } catch (error) {
        return null;
      }
    },
    set(kind, key, value) {
      try {
        if (value === null) window[kind].removeItem(key);
        else window[kind].setItem(key, value);
      } catch (error) {
        // storage blocked: works until the tab closes
      }
    },
  };

  const IST = "Asia/Kolkata";
  const ago = (iso) => {
    if (!iso) return "";
    const minutes = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return `${hours} h ago`;
    return `${Math.floor(hours / 24)} days ago`;
  };
  const when = (iso) =>
    iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: IST }) : "";
  const dayLabel = (day, withWeekday = true) =>
    new Date(`${day}T12:00:00+05:30`).toLocaleDateString("en-IN", {
      ...(withWeekday ? { weekday: "short" } : {}),
      day: "numeric",
      month: "short",
      timeZone: IST,
    });
  const todayLong = () =>
    new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: IST });

  // Icons from the design (20×20, stroked).
  const P = {
    dashboard: '<path d="M3 3h6v8H3zM11 3h6v5h-6zM11 10h6v7h-6zM3 13h6v4H3z"/>',
    flag: '<path d="M4.5 17.5V3M4.5 3.5h10l-2 3.7 2 3.8h-10"/>',
    posts: '<path d="M5 2.5h10v15H5zM8 6.5h4M8 9.5h4M8 12.5h2"/>',
    users:
      '<circle cx="8" cy="7" r="3"/><path d="M2.5 17c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5M13 4.2a3 3 0 0 1 0 5.6M15 12.8c1.3.6 2.2 1.9 2.5 4.2"/>',
    pin: '<path d="M10 18s5.5-5.2 5.5-9.5a5.5 5.5 0 0 0-11 0C4.5 12.8 10 18 10 18z"/><circle cx="10" cy="8.5" r="2"/>',
    log: '<path d="M3.5 10a6.5 6.5 0 1 0 2-4.7M3.5 3v3.5H7M10 6.5V10l2.5 2"/>',
    chart: '<path d="M3 17h14M6 14V9M10 14V5M14 14v-3"/>',
    shield: '<path d="M10 2.5 4 5v5c0 3.6 2.6 6.4 6 7.5 3.4-1.1 6-3.9 6-7.5V5z"/>',
    search: '<circle cx="9" cy="9" r="5.5"/><path d="m13 13 4 4"/>',
    close: '<path d="M5 5l10 10M15 5 5 15"/>',
    arrow: '<path d="M5 10h10M11 6l4 4-4 4"/>',
    ext: '<path d="M8 4H4v12h12v-4M11 3h6v6M17 3l-8 8"/>',
    alert: '<path d="M10 3 2.5 16.5h15zM10 8v4M10 14.2v.3"/>',
    info: '<circle cx="10" cy="10" r="7.5"/><path d="M10 9v5M10 6.2v.3"/>',
  };
  const icon = (name, cls = "") =>
    `<svg class="ico ${cls}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name]}</svg>`;

  const pill = (cls, text) => `<span class="pill ${cls}">${esc(text)}</span>`;
  const plat = (name) => `<span class="plat">${esc(name || "PlotPost")}</span>`;
  const PLATFORM_MARK = { Instagram: "IG", Facebook: "FB", YouTube: "YT", PlotPost: "PP" };
  const PLATFORMS = ["Instagram", "Facebook", "YouTube", "PlotPost"];

  const reasonClass = (reason) => {
    const r = String(reason || "");
    if (/spam|scam|fraud/i.test(r)) return "r-spam";
    if (/offens|hate|harass|bully|sexual|abus|inappropriate/i.test(r)) return "r-offensive";
    if (/sold|rented/i.test(r)) return "r-sold";
    if (/not (a )?property|duplicate/i.test(r)) return "r-notprop";
    if (/location|wrong|fake|mislead|pretend/i.test(r)) return "r-wrong";
    return "";
  };
  const reasonChip = (reason) => `<span class="chip ${reasonClass(reason)}">${esc(reason || "Other")}</span>`;
  const topReason = (group) => {
    const tally = new Map();
    for (const r of group.reports) tally.set(r.reason, (tally.get(r.reason) || 0) + 1);
    return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  };

  const postPill = (p) => {
    if (p.removed) return pill("crit", "Removed");
    if (p.sellerBanned) return pill("crit", "Seller banned");
    if (p.status === "sold") return pill("neutral", "Sold");
    if (p.status === "rented") return pill("neutral", "Rented");
    if (p.expired) return pill("warn", "Expired");
    return pill("good", "Live");
  };
  const userPill = (u) => {
    if (u.banned) return pill("crit", "Banned");
    if (u.role === "admin") return pill("neutral", "Admin");
    return pill("good", "Active");
  };

  const KIND_TITLE = { post: "Reported post", comment: "Reported comment", user: "Reported account" };
  const PERSON_TITLE = { post: "Seller", comment: "Comment author", user: "Account" };
  const ACTION_LABEL = {
    remove_post: "Removed post",
    restore_post: "Restored post",
    remove_comment: "Removed comment",
    ban_user: "Banned account",
    unban_user: "Unbanned account",
    dismiss_reports: "Kept, closed reports",
  };
  const OUTCOME = {
    dismissed: ["good", "Kept"],
    removed_post: ["crit", "Post removed"],
    removed_comment: ["crit", "Comment removed"],
    banned_user: ["crit", "Account banned"],
  };

  const REMOVE_PRESETS = [
    "Fake or misleading listing",
    "Spam or scam (asking for advance money)",
    "Offensive or inappropriate content",
    "Property already sold or rented",
  ];
  const COMMENT_PRESETS = ["Abusive or offensive language", "Spam or scam", "Harassment"];
  const BAN_PRESETS = [
    "Repeated fake listings",
    "Scam or fraud",
    "Harassment or abuse of other users",
    "Hate speech or offensive content",
  ];

  // Sizes that depend on data are set here, not with style="" in the HTML.
  const applySizes = (root) => {
    if (!root) return;
    for (const el of root.querySelectorAll("[data-h]")) el.style.height = `${el.dataset.h}%`;
    for (const el of root.querySelectorAll("[data-b]")) el.style.bottom = `${el.dataset.b}%`;
    for (const el of root.querySelectorAll("[data-flex]")) el.style.flex = `${el.dataset.flex} 1 150px`;
  };

  // ------------------------------------------------------------ API

  let token = store.get("sessionStorage", TOKEN_KEY) || "";

  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }

  const api = async (path, { method = "GET", body } = {}) => {
    let res;
    try {
      res = await fetch(API + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      throw new ApiError("Can't reach the server. Check your internet connection.", 0);
    }
    let data = {};
    try {
      data = await res.json();
    } catch (error) {
      // not JSON
    }
    if (res.status === 401 && token && !path.startsWith("/auth/")) {
      logout(data.message || "Your login has ended. Please sign in again.");
      throw new ApiError(data.message || "Signed out.", 401);
    }
    if (!res.ok || data.success === false) {
      throw new ApiError(data.message || `Request failed (${res.status}).`, res.status);
    }
    return data;
  };

  // ------------------------------------------------------------ state

  const S = {
    me: null,
    openCount: 0,
    current: "dashboard",
    groupsByKey: new Map(),
    drawer: null, // { type: "report", key } or { type: "user", id }
    reports: { tab: "open", kind: "all", groups: [], counts: { open: 0, done: 0 }, seq: 0 },
    posts: { q: "", filter: "all", platform: "all", page: 1, items: [], hasMore: false, total: 0, counts: {}, seq: 0 },
    people: { q: "", filter: "all", page: 1, items: [], hasMore: false, total: 0, counts: {}, seq: 0 },
    audit: { q: "", who: "all", page: 1, items: [], hasMore: false, total: 0, admins: [], seq: 0 },
    dashSeq: 0,
  };

  const remember = (groups) => {
    for (const group of groups) S.groupsByKey.set(group.key, group);
  };

  // ------------------------------------------------------------ toast, drawer, modal

  let toastTimer;
  const toast = (text, bad = false) => {
    const box = $("#toast");
    box.textContent = text;
    box.classList.toggle("bad", bad);
    box.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.classList.remove("on"), bad ? 6000 : 3400);
  };

  let drawerFocus = null;
  const openDrawer = (html, info) => {
    if (!$("#drawer").classList.contains("on")) drawerFocus = document.activeElement;
    S.drawer = info;
    const drawer = $("#drawer");
    drawer.innerHTML = html;
    drawer.classList.add("on");
    drawer.setAttribute("aria-hidden", "false");
    $("#scrim").classList.add("on");
    setTimeout(() => drawer.querySelector(".x")?.focus(), 50);
  };
  const closeDrawer = () => {
    const drawer = $("#drawer");
    const wasOpen = drawer.classList.contains("on");
    S.drawer = null;
    drawer.classList.remove("on");
    drawer.setAttribute("aria-hidden", "true");
    $("#scrim").classList.remove("on");
    if (wasOpen) drawerFocus?.focus?.();
  };

  let modal = null; // { resolve, required, focus }
  const askReason = ({
    title,
    help = "",
    presets = [],
    ok = "Confirm",
    danger = true,
    required = true,
    label = "Reason (shown to the person)",
    placeholder = "",
  }) =>
    new Promise((resolve) => {
      if (modal) modal.resolve(null);
      modal = { resolve, required, focus: document.activeElement };
      const box = $("#modal");
      box.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-labelledby="m-t">
        <h2 id="m-t">${esc(title)}</h2>
        <div class="m-body">
          ${help ? `<p>${esc(help)}</p>` : ""}
          ${presets.length ? `<div class="radios" role="group" aria-label="Common reasons">${presets.map((text) => `<button type="button" data-act="preset" data-text="${esc(text)}">${esc(text)}</button>`).join("")}</div>` : ""}
          <label class="lb" for="m-why">${esc(label)}</label>
          <textarea id="m-why" maxlength="500" placeholder="${esc(placeholder)}"></textarea>
          <div class="err" id="m-err" role="alert"></div>
        </div>
        <div class="m-f">
          <button type="button" class="btn" data-act="cancelModal">Cancel</button>
          <button type="button" class="btn ${danger ? "dangerfill" : "ink"}" data-act="okModal">${esc(ok)}</button>
        </div>
      </div>`;
      box.classList.add("on");
      setTimeout(() => $("#m-why")?.focus(), 30);
    });
  const finishModal = (value) => {
    const box = $("#modal");
    box.classList.remove("on");
    const current = modal;
    modal = null;
    if (!current) return;
    current.focus?.focus?.();
    current.resolve(value);
  };
  const okModal = () => {
    if (!modal) return;
    const value = ($("#m-why")?.value || "").trim();
    if (modal.required && value.length < 3) {
      $("#m-err").textContent = "Please give a reason (at least 3 characters).";
      return;
    }
    finishModal(value);
  };

  // ------------------------------------------------------------ sign in

  const showLogin = (message = "") => {
    closeDrawer();
    if (modal) finishModal(null);
    $("#app-view").hidden = true;
    $("#login-view").hidden = false;
    $("#login-error").textContent = message;
    setTimeout(() => $("#login-email").focus(), 30);
  };

  const logout = (message = "") => {
    token = "";
    S.me = null;
    store.set("sessionStorage", TOKEN_KEY, null);
    showLogin(message);
  };

  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("#login-button");
    const email = $("#login-email").value.trim().toLowerCase();
    const password = $("#login-password").value;
    if (!email || !password) {
      $("#login-error").textContent = "Enter your email and password.";
      return;
    }
    button.disabled = true;
    $("#login-error").textContent = "";
    try {
      const data = await api("/auth/login", { method: "POST", body: { email, password } });
      token = data.token;
      try {
        await start();
        store.set("sessionStorage", TOKEN_KEY, token);
        $("#login-password").value = "";
      } catch (error) {
        token = "";
        showLogin(error.status === 403 ? "This account isn't an admin." : error.message);
      }
    } catch (error) {
      showLogin(error.message);
    } finally {
      button.disabled = false;
    }
  });

  const start = async () => {
    const data = await api("/admin/summary");
    S.me = data.admin;
    S.openCount = data.summary.openReports;
    $("#me-initials").textContent = initials(S.me.name);
    $("#me-name").textContent = S.me.name || S.me.email;
    $("#me-pill").setAttribute("aria-label", `Signed in as ${S.me.name || S.me.email}, admin`);
    $("#login-view").hidden = true;
    $("#app-view").hidden = false;
    syncLook();
    route();
  };

  // ------------------------------------------------------------ navigation

  const VIEWS = {
    dashboard: {
      t: "Dashboard",
      s: () => `${todayLong()}. Kerala launch, Kozhikode focus.`,
      ic: "dashboard",
      shell: () => `<div class="content" id="dash"><div class="empty">Loading…</div></div>`,
      load: () => loadDashboard(),
    },
    reports: {
      t: "Reports",
      s: () => "Posts, comments and accounts that people reported. Act on each one within 24 hours.",
      ic: "flag",
      shell: () => reportsShell(),
      load: () => loadReports(),
    },
    posts: {
      t: "Posts",
      s: () => "Every post on PlotPost. Remove or restore.",
      ic: "posts",
      shell: () => postsShell(),
      load: (fresh = true) => loadPosts(fresh),
    },
    people: {
      t: "People",
      s: () => "Everyone with a PlotPost account. Open an account to see its posts and reports, or ban it.",
      ic: "users",
      shell: () => peopleShell(),
      load: (fresh = true) => loadPeople(fresh),
    },
    audit: {
      t: "Audit log",
      s: () => "Who did what, and when. Entries can't be edited or deleted.",
      ic: "log",
      shell: () => auditShell(),
      load: (fresh = true) => loadAudit(fresh),
    },
  };

  const renderNav = () => {
    const link = (key) =>
      `<a href="#${key}" ${S.current === key ? 'aria-current="page"' : ""}><span class="ni">${icon(VIEWS[key].ic)}</span><span>${VIEWS[key].t}</span>${
        key === "reports" && S.openCount ? `<span class="badge" aria-label="${esc(plural(S.openCount, "open report"))}">${fmt(S.openCount)}</span>` : ""
      }</a>`;
    const soon = (ic, text) =>
      `<span class="soon" title="Coming later"><span class="ni">${icon(ic)}</span><span>${esc(text)}</span><span class="soon-tag">Soon</span></span>`;
    $("#nav").innerHTML = `
      <div class="nav-group"><div class="nav-label">Overview</div>${link("dashboard")}</div>
      <div class="nav-group"><div class="nav-label">Moderation</div>${link("reports")}${link("posts")}${link("people")}</div>
      <div class="nav-group"><div class="nav-label">Platform</div>${link("audit")}</div>
      <div class="nav-group later"><div class="nav-label">Coming later</div>${soon("shield", "Agent verification")}${soon("pin", "Locations")}${soon("chart", "District analytics")}</div>`;
  };

  const route = () => {
    if (!S.me) return;
    const key = location.hash.slice(1);
    S.current = VIEWS[key] ? key : "dashboard";
    const view = VIEWS[S.current];
    $("#vt").textContent = view.t;
    $("#vs").textContent = view.s();
    $("#phead").classList.toggle("dash", S.current === "dashboard");
    document.title = `${view.t} · PlotPost Admin Panel`;
    closeDrawer();
    $("#content").innerHTML = view.shell();
    renderNav();
    $("#main").scrollTop = 0;
    view.load(true);
  };
  window.addEventListener("hashchange", route);
  const go = (key) => {
    if (location.hash === `#${key}`) route();
    else location.hash = key;
  };

  const setOpenCount = (count) => {
    if (typeof count !== "number" || count === S.openCount) return;
    S.openCount = count;
    renderNav();
  };

  const failBox = (error) =>
    `<div class="empty"><strong>Couldn't load this</strong>${esc(error.message)}<br><button type="button" class="btn sm" data-act="retry">Try again</button></div>`;

  // A segmented control (tabs with counts), as in the design.
  const seg = (list, field, items, counts = {}) =>
    `<div class="seg" role="group">${items
      .map(
        ([value, label]) =>
          `<button type="button" data-act="seg" data-list="${list}" data-field="${field}" data-val="${esc(value)}" aria-pressed="${S[list][field] === value}">${esc(label)}${
            counts[value] != null ? `<span class="n">${fmt(counts[value])}</span>` : ""
          }</button>`
      )
      .join("")}</div>`;

  // ------------------------------------------------------------ small renderers

  const subjectCell = (group, extra = "") => {
    if (group.kind === "user") {
      const p = group.person;
      return `<td class="t-title">${p ? esc(p.name) : "Account deleted"}<div class="t-meta">Account${p ? ` · ${esc(p.email)}` : ""}</div>${extra}</td>`;
    }
    const post = group.post;
    if (group.kind === "comment") {
      return `<td class="t-title">“${esc(cut(group.comment?.text, 90)) || "No text saved"}”<div class="t-meta">Comment on ${post ? esc(cut(post.title, 60)) : "a deleted post"}</div>${extra}</td>`;
    }
    return post
      ? `<td class="t-title">${esc(post.title || "Untitled post")}<div class="t-meta">${plat(post.platform)} ${esc(post.location)}</div>${extra}</td>`
      : `<td class="t-title">Post deleted<div class="t-meta">The seller deleted it</div>${extra}</td>`;
  };

  const pcard = (p) => {
    const image = httpsUrl(p.image);
    const link = webUrl(p.socialUrl);
    const meta = [p.type, p.deal, p.location, p.price].filter(Boolean).map(esc).join(" · ");
    return `<div class="pcard">
      <div class="pc-top">${plat(p.platform)}<span class="t-meta">Posted ${esc(ago(p.createdAt))}</span></div>
      ${image ? `<img class="pc-img" src="${esc(image)}" alt="">` : ""}
      <div class="pc-t">${esc(p.title || "Untitled post")}</div>
      ${meta ? `<div class="pc-m">${meta}</div>` : ""}
      ${link ? `<a class="pc-btn pc-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">View on ${esc(p.platform || "the original site")}</a>` : ""}
    </div>`;
  };

  const personRow = (person) =>
    `<div class="mini"><div><span class="avatar sm" aria-hidden="true">${esc(initials(person.name))}</span><span class="grow"><b>${esc(person.name)}</b><br><span class="t-meta">${esc(person.email)}${
      person.phone ? ` · ${esc(person.phone)}` : ""
    }</span></span>${userPill(person)}</div></div>`;

  const canBan = (person) => person && !person.banned && person.role !== "admin" && String(person._id) !== String(S.me?._id);

  // ------------------------------------------------------------ dashboard

  const niceMax = (top) => {
    const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
    const step = steps.find((s) => s * 4 >= top) || Math.ceil(top / 4);
    return step * 4;
  };

  const loadDashboard = async () => {
    const seq = ++S.dashSeq;
    let summary;
    let groups;
    try {
      const [summaryData, reportsData] = await Promise.all([api("/admin/summary"), api("/admin/reports?status=open")]);
      summary = summaryData.summary;
      groups = reportsData.groups;
    } catch (error) {
      if (seq === S.dashSeq && $("#dash")) $("#dash").innerHTML = failBox(error);
      return;
    }
    const box = $("#dash");
    if (seq !== S.dashSeq || !box) return;
    remember(groups);
    setOpenCount(summary.openReports);
    box.innerHTML = dashboardHtml(summary, groups);
    applySizes(box);
    bindChart();
    if (S.current === "dashboard") dashHeadline(summary);
  };

  // The dashboard banner leads with what needs doing, not just "Dashboard".
  const dashHeadline = (s) => {
    const open = Number(s.openReports) || 0;
    const late = Number(s.overdueReports) || 0;
    const oldest = s.oldestOpenHours;
    let title;
    let sub;
    if (late) {
      title = `${plural(late, "report")} ${late === 1 ? "has" : "have"} waited more than 24 hours`;
      sub = `${plural(open, "open report")}, the oldest waiting ${fmt(oldest)} hours. Clear those first. ${todayLong()}.`;
    } else if (open) {
      title = `${plural(open, "open report")}, all inside 24 hours`;
      sub = `The oldest has waited ${fmt(oldest)} hours. ${todayLong()}.`;
    } else {
      title = "The report queue is clear";
      sub = `${todayLong()}. Kerala launch, Kozhikode focus.`;
    }
    $("#vt").textContent = title;
    $("#vs").textContent = sub;
  };

  const syncLook = () => {
    const look = document.documentElement.dataset.look === "vibrant" ? "vibrant" : "light";
    for (const b of document.querySelectorAll('[data-act="look"]')) b.setAttribute("aria-pressed", String(b.dataset.look === look));
  };

  const dashboardHtml = (s, groups) => {
    const days = s.newPostsPerDay || [];
    const counts = days.map((d) => d.count);
    const today = counts[counts.length - 1] || 0;
    const past = counts.slice(0, -1);
    const peak = Math.max(0, ...past);
    const peakIndex = peak > 0 ? past.indexOf(peak) : -1;
    const max = niceMax(Math.max(peak, today, 1));
    const pctOf = (v) => ((v / max) * 100).toFixed(2);

    const bars = days
      .map((d, i) => {
        const isToday = i === days.length - 1;
        const isPeak = i === peakIndex;
        const label = dayLabel(d.day);
        const tip = isToday ? `${label} · ${plural(d.count, "new post")} so far today` : `${label} · ${plural(d.count, "new post")}`;
        const lab = isPeak
          ? `<span class="lab" data-b="${pctOf(d.count)}">${fmt(d.count)}</span>`
          : isToday
            ? `<span class="lab t" data-b="${pctOf(d.count)}">${fmt(d.count)}*</span>`
            : "";
        return `<div class="bcol${isToday ? " today" : ""}${isPeak ? " peak" : ""}" tabindex="0" data-tip="${esc(tip)}" aria-label="${esc(tip)}">${lab}<div class="bar" data-h="${pctOf(d.count)}"></div></div>`;
      })
      .join("");
    const ticks = [0, 1, 2, 3, 4].map((i) => (max / 4) * i);

    const mixTotal = (s.byPlatform || []).reduce((n, p) => n + p.count, 0);
    const mix = mixTotal
      ? s.byPlatform
          .map(
            (p) =>
              `<div class="mixseg" data-flex="${p.count}"><span class="mc" aria-hidden="true">${esc(PLATFORM_MARK[p.platform] || String(p.platform).slice(0, 2).toUpperCase())}</span><span class="ms-t"><b>${fmt(p.count)}</b><small>${esc(p.platform)}</small></span><span class="ms-p">${Math.round((p.count / mixTotal) * 100)}%</span></div>`
          )
          .join("")
      : `<div class="mixseg"><span class="ms-t"><b>No live posts yet</b><small>The platform mix shows here once posts go live</small></span></div>`;

    const kpi = (cls, label, num, sub) =>
      `<div class="kpi ${cls}"><div class="k-l">${esc(label)}</div><div class="k-n">${esc(num)}</div><div class="k-s">${esc(sub)}</div></div>`;

    const byKind = (kind) => groups.filter((g) => g.kind === kind).length;
    const attn = (n, what, sub, kind, tone) => {
      const t = n ? tone : "good";
      const label = n ? (tone === "crit" ? "Act today" : "Review") : "Clear";
      return `<a href="#reports" class="arow t-${t}" data-act="goReports" data-kind="${kind}"><span class="n">${fmt(n)}</span><span class="what">${esc(what)}<small>${esc(sub)}</small></span>${pill(t, label)}<span class="go">${icon("arrow")}</span></a>`;
    };

    const latest = groups
      .slice(0, 5)
      .map(
        (g) =>
          `<tr class="click" tabindex="0" data-act="openReport" data-key="${esc(g.key)}">${subjectCell(g, `<div class="chiprow">${reasonChip(topReason(g))}</div>`)}<td class="num">${fmt(g.count)}</td><td class="nowrap">${
            g.overdue ? pill("crit", `${g.ageHours} h`) : `<span class="t-meta">${esc(g.ageHours)} h</span>`
          }</td></tr>`
      )
      .join("");

    const mid = days[Math.floor(days.length / 2)];
    return `
    <section class="hero" aria-label="Key numbers">
      <div>
        <div class="h-lbl">Active posts</div>
        <div class="h-num">${fmt(s.activePosts)}<span class="dim"> / ${fmt(TARGET)}</span></div>
        <div class="h-badges"><span class="bdg">+${fmt(s.newThisWeek)} this week</span><span class="bdg line">${Math.round((s.activePosts / TARGET) * 100)}% of target</span></div>
        <div class="h-sub">Live posts: not removed, not sold or rented, not expired (90 days without renewing), seller not banned. Launch target is ${fmt(TARGET)}.</div>
      </div>
      <div class="kpis">
        ${kpi("dark", "New today", `${fmt(s.newToday)}*`, `So far today. Busiest day: ${fmt(peak)}`)}
        ${kpi("", "Sellers who posted", fmt(s.sellersWhoPosted), "Accounts with at least one live post")}
        ${kpi("", "Accounts", fmt(s.users), `${fmt(s.bannedUsers)} banned`)}
        ${kpi("", "Post views", fmt(s.views), "All posts, all time")}
        ${kpi("", "Contact taps", fmt(s.contactTaps), `Calls and link opens. ${plural(s.shares, "share")}`)}
        ${kpi(s.overdueReports ? "hot" : "", "Oldest open report", s.oldestOpenHours == null ? "–" : `${s.oldestOpenHours} h`, "Act on reports within 24 hours")}
      </div>
    </section>
    <section class="mixwrap" aria-label="Live posts by platform">
      <div class="mixbar">${mix}</div>
      <a class="btn ink wide" href="#posts">Browse posts</a>
    </section>
    <div class="grid2">
      <div class="stack">
        <section class="card"><div class="card-h"><h2>Needs attention</h2><span class="hint">Work through these from the top</span></div>
          <div class="attn">
            ${attn(s.overdueReports, "Waiting over 24 hours", s.overdueReports ? `Oldest is ${s.oldestOpenHours} h old. Act on these first.` : "Nothing is overdue", "all", "crit")}
            ${attn(byKind("post"), "Reported posts", "Remove the post or keep it", "post", "warn")}
            ${attn(byKind("comment"), "Reported comments", "Remove the comment or keep it", "comment", "warn")}
            ${attn(byKind("user"), "Reported accounts", "Ban the account or keep it", "user", "warn")}
          </div>
        </section>
        <section class="card"><div class="card-h"><h2>Open reports</h2><span class="hint">Oldest first</span><a class="btn ghost sm end" href="#reports" data-act="goReports" data-kind="all">Open queue ${icon("arrow", "s14")}</a></div>
          <div class="tbl-wrap"><table><thead><tr><th>Reported</th><th class="num">Reports</th><th>Waiting</th></tr></thead><tbody>
          ${latest || `<tr><td colspan="3"><div class="empty"><strong>No open reports</strong>The queue is clear.</div></td></tr>`}
          </tbody></table></div>
        </section>
      </div>
      <div class="stack">
        <section class="card"><div class="card-h"><h2>New posts per day</h2><span class="hint">Last 14 days, India time</span></div>
          <div class="card-b">
            <div class="chart" id="chart">
              <div class="yaxis">${ticks.map((v) => `<span data-b="${pctOf(v)}">${fmt(v)}</span>`).join("")}</div>
              <div class="plot">${ticks
                .slice(1)
                .map((v) => `<div class="gl" data-b="${pctOf(v)}"></div>`)
                .join("")}<div class="gl base" data-b="0"></div><div class="bars">${bars}</div></div>
              <div class="xaxis"><span>${days[0] ? esc(dayLabel(days[0].day, false)) : ""}</span><span>${mid ? esc(dayLabel(mid.day, false)) : ""}</span><span>Today</span></div>
              <div class="tip" id="tip"></div>
            </div>
            <p class="help mt">* Today so far. The dark bar is the busiest of the 13 days before. Hover a bar for the exact count.</p>
            <details class="data"><summary>Show as table</summary><table><thead><tr><th>Day</th><th class="num">New posts</th></tr></thead><tbody>${days
              .map((d) => `<tr><td>${esc(dayLabel(d.day))}</td><td class="num">${fmt(d.count)}</td></tr>`)
              .join("")}</tbody></table></details>
          </div>
        </section>
        <div class="note-card"><span class="faint">${icon("chart")}</span>
          <p class="help">Agent verification, locations and district numbers come later. For now this page shows totals for all of PlotPost: ${plural(s.posts, "post")} in total, ${fmt(s.removedPosts)} removed.</p>
        </div>
      </div>
    </div>
    <h2 class="sec-t">Guided journeys</h2>
    <div class="jour">
      <section class="card"><b>Clear the report queue</b><div class="help">Oldest first, each one inside 24 hours</div>
        <ol><li>Open Reports; the oldest is at the top</li><li>Read what people said and check the post</li><li>Keep, remove or ban, with a reason</li><li>Find your decision in the Audit log</li></ol>
        <a class="btn" href="#reports" data-act="goReports" data-kind="all">Start this journey</a></section>
      <section class="card"><b>Check a seller</b><div class="help">Before or after a ban</div>
        <ol><li>Search People by name, email or phone</li><li>Open their account</li><li>Look at their posts, reports and past actions</li><li>Ban or unban, with a reason</li></ol>
        <a class="btn" href="#people">Start this journey</a></section>
    </div>
    <h2 class="sec-t">All screens</h2>
    <div class="tiles">${screenTiles(s)}</div>`;
  };

  const screenTiles = (s) => {
    const preview = (kind) =>
      kind === "dash"
        ? `<div class="tv" aria-hidden="true"><div class="hb"></div><div class="bx">${[5, 8, 6, 9, 7, 11, 10].map((v) => `<i data-h="${v * 9}"></i>`).join("")}</div></div>`
        : '<div class="tv" aria-hidden="true"><div class="hb"></div><div class="r"></div><div class="r w85"></div><div class="r"></div><div class="r w70"></div></div>';
    const tile = (href, kind, label, note) =>
      `<a class="card tile" href="${href}">${preview(kind)}<span class="tl">${esc(label)}<em>${esc(note)}</em></span></a>`;
    const later = (label) => `<div class="card tile off">${preview("list")}<span class="tl">${esc(label)}<em>Later</em></span></div>`;
    return [
      tile("#dashboard", "dash", "Dashboard", ""),
      tile("#reports", "list", "Reports", `${fmt(s.openReports)} open`),
      tile("#posts", "list", "Posts", `${fmt(s.activePosts)} live`),
      tile("#people", "list", "People", fmt(s.users)),
      tile("#audit", "list", "Audit log", ""),
      later("Agent verification"),
      later("Locations"),
      later("District analytics"),
    ].join("");
  };

  const bindChart = () => {
    const chart = $("#chart");
    if (!chart) return;
    const tip = $("#tip");
    const show = (col) => {
      const r = col.getBoundingClientRect();
      const c = chart.getBoundingClientRect();
      const height = parseFloat(col.querySelector(".bar").style.height) || 0;
      tip.textContent = col.dataset.tip;
      tip.style.left = `${r.left - c.left + r.width / 2}px`;
      tip.style.top = `${r.top - c.top + r.height * (1 - height / 100) - 8}px`;
      tip.classList.add("on");
    };
    for (const col of chart.querySelectorAll(".bcol")) {
      col.addEventListener("mouseenter", () => show(col));
      col.addEventListener("focus", () => show(col));
      col.addEventListener("mouseleave", () => tip.classList.remove("on"));
      col.addEventListener("blur", () => tip.classList.remove("on"));
    }
  };

  // ------------------------------------------------------------ reports

  const reportsShell = () => `
    <div class="toolbar" id="r-tools"></div>
    <section class="card">
      <div class="tbl-wrap"><table><thead id="r-head"></thead><tbody id="r-body"><tr><td colspan="6"><div class="empty">Loading…</div></td></tr></tbody></table></div>
      <div class="foot-note">Reports come from signed-in people in the app. Several reports on the same item are grouped into one row. Overdue means waiting more than 24 hours.</div>
    </section>`;

  const renderReportTools = () => {
    const r = S.reports;
    const kinds = [
      ["all", "All types"],
      ["post", "Posts"],
      ["comment", "Comments"],
      ["user", "Accounts"],
    ];
    $("#r-tools").innerHTML = `${seg("reports", "tab", [["open", "Open"], ["done", "Resolved"]], r.counts)}
      <select class="sel" id="f-rkind" data-select="reports.kind" aria-label="Type">${kinds
        .map(([v, label]) => `<option value="${v}" ${r.kind === v ? "selected" : ""}>${label}</option>`)
        .join("")}</select>`;
  };

  const loadReports = async () => {
    const r = S.reports;
    const seq = ++r.seq;
    if ($("#r-tools")) renderReportTools();
    try {
      const data = await api(`/admin/reports?status=${r.tab}${r.kind !== "all" ? `&kind=${r.kind}` : ""}`);
      if (seq !== r.seq || !$("#r-body")) return;
      r.groups = data.groups;
      r.counts = data.counts || r.counts;
      remember(data.groups);
      setOpenCount(r.counts.open);
      renderReportTools();
      renderReports();
    } catch (error) {
      if (seq === r.seq && $("#r-body")) $("#r-body").innerHTML = `<tr><td colspan="6">${failBox(error)}</td></tr>`;
    }
  };

  const renderReports = () => {
    const r = S.reports;
    const open = r.tab === "open";
    $("#r-head").innerHTML = open
      ? '<tr><th>Reported</th><th>Reason</th><th class="num">Reports</th><th>Seller or author</th><th>Waiting</th><th><span class="sr">Action</span></th></tr>'
      : '<tr><th>Reported</th><th>Reason</th><th class="num">Reports</th><th>Outcome</th><th>Decided by</th><th>When</th></tr>';
    const rows = r.groups
      .map((g) => {
        const start = `<tr class="click" tabindex="0" data-act="openReport" data-key="${esc(g.key)}">${subjectCell(g)}<td>${reasonChip(topReason(g))}</td><td class="num">${fmt(g.count)}</td>`;
        if (open) {
          return `${start}<td class="nowrap">${g.person ? esc(g.person.name) : '<span class="t-meta">Deleted</span>'}</td>
            <td class="nowrap">${g.overdue ? pill("crit", `Overdue · ${g.ageHours} h`) : `<span class="t-meta">${esc(g.ageHours)} h</span>`}</td>
            <td><div class="row-actions"><button type="button" class="btn sm" data-act="openReport" data-key="${esc(g.key)}">Review</button></div></td></tr>`;
        }
        const last = g.reports[0] || {};
        const [cls, label] = OUTCOME[last.resolution] || ["neutral", "Closed"];
        return `${start}<td>${pill(cls, label)}</td><td class="nowrap">${esc(last.resolvedBy || "–")}</td><td class="nowrap t-meta">${esc(ago(last.resolvedAt || g.lastAt))}</td></tr>`;
      })
      .join("");
    $("#r-body").innerHTML =
      rows ||
      `<tr><td colspan="6"><div class="empty"><strong>${open ? "No open reports" : "Nothing here yet"}</strong>${
        open ? "The queue is clear for this filter." : "Resolved reports appear here with the decision taken."
      }</div></td></tr>`;
  };

  const reportDrawer = (g) => {
    const open = g.reports.some((r) => !r.resolution);
    const p = g.post;
    const person = g.person;
    let subject = "";
    if (g.kind === "post") {
      subject = p
        ? `<div class="sec"><h3>Post</h3>${pcard(p)}
            <dl class="dl"><dt>Status</dt><dd>${postPill(p)}</dd>${p.removedReason ? `<dt>Removed because</dt><dd>${esc(p.removedReason)}</dd>` : ""}
            <dt>Views</dt><dd>${fmt(p.views)}</dd><dt>Posted</dt><dd>${esc(when(p.createdAt))}</dd>${
              p.expiresAt && p.status === "active" ? `<dt>${p.expired ? "Expired" : "Expires"}</dt><dd>${esc(when(p.expiresAt))}</dd>` : ""
            }<dt>Post ID</dt><dd class="mono">${esc(p._id)}</dd></dl></div>`
        : `<div class="sec"><h3>Post</h3><p class="help">The seller deleted this post.</p></div>`;
    } else if (g.kind === "comment") {
      subject = `<div class="sec"><h3>Comment</h3><div class="notes"><div class="note">${esc(g.comment?.text) || "No text saved"}<div class="meta">On ${
        p ? `“${esc(p.title)}”` : "a deleted post"
      }</div></div></div></div>`;
    }
    const said = g.reports
      .map(
        (r) => `<div class="note"><b>${esc(r.reason)}</b>${r.details ? `<br>${esc(r.details)}` : ""}<div class="meta">${esc(r.reporter ? r.reporter.name : "Deleted account")} · ${esc(ago(r.at))}${
          r.resolution ? ` · ${esc((OUTCOME[r.resolution] || [, "Closed"])[1])}` : ""
        }</div></div>`
      )
      .join("");
    const personSec = `<div class="sec"><h3>${PERSON_TITLE[g.kind]}</h3>${
      person
        ? `${personRow(person)}<div><button type="button" class="btn sm" data-act="openUser" data-id="${esc(person._id)}">View account</button></div>`
        : '<p class="help">This account was deleted.</p>'
    }</div>`;
    const HELP = {
      post: "Keep closes the reports and leaves the post up. Remove hides it from everyone and tells the seller why; you can restore it later from Posts. Ban logs the seller out, hides all their posts and comments, and closes every report about them.",
      comment: "Keep closes the reports and leaves the comment. Remove deletes the comment and tells its author why. Ban logs the author out and hides all their posts and comments.",
      user: "Keep closes the reports. Ban logs the account out everywhere, stops new logins, hides their posts and comments, and closes every report about them. You can unban later.",
    };
    const last = g.reports[0] || {};
    const decision = open
      ? `<div class="sec"><h3>Decision</h3>${
          g.overdue
            ? `<div class="banner warn"><span class="ic">${icon("alert")}</span><span class="txt">Waiting ${esc(g.ageHours)} hours.<small>Reports should be handled within 24 hours.</small></span></div>`
            : ""
        }<p class="help">${HELP[g.kind]}</p></div>`
      : `<div class="sec"><h3>Decision</h3><p>${esc(last.resolvedBy || "An admin")} · ${esc((OUTCOME[last.resolution] || [, "Closed"])[1]).toLowerCase()} · ${esc(when(last.resolvedAt))}</p></div>`;

    const buttons = [];
    if (open) {
      const dismissData =
        g.kind === "user"
          ? `data-kind="user" data-user="${esc(person?._id || "")}"`
          : g.kind === "comment"
            ? `data-kind="comment" data-comment="${esc(g.comment?._id || "")}"`
            : `data-kind="post" data-post="${esc(g.postId || "")}"`;
      buttons.push(`<button type="button" class="btn" data-act="dismiss" ${dismissData}>${g.kind === "user" ? "Keep account" : g.kind === "comment" ? "Keep comment" : "Keep post"}</button>`);
      if (g.kind === "post" && p && !p.removed) {
        buttons.push(`<button type="button" class="btn danger" data-act="removePost" data-post="${esc(p._id)}">Remove post</button>`);
      }
      if (g.kind === "post" && p?.removed) {
        buttons.push(`<button type="button" class="btn" data-act="restorePost" data-post="${esc(p._id)}">Restore post</button>`);
      }
      if (g.kind === "comment" && g.postId && g.comment?._id) {
        buttons.push(`<button type="button" class="btn danger" data-act="removeComment" data-post="${esc(g.postId)}" data-comment="${esc(g.comment._id)}">Remove comment</button>`);
      }
      if (canBan(person)) {
        buttons.push(
          `<button type="button" class="btn dangerfill" data-act="ban" data-user="${esc(person._id)}" data-name="${esc(person.name)}">Ban ${g.kind === "post" ? "seller" : g.kind === "comment" ? "author" : "account"}</button>`
        );
      }
    }
    return `
      <div class="drawer-h"><h2>${KIND_TITLE[g.kind]}</h2>${reasonChip(topReason(g))}<button type="button" class="btn ghost sm x" data-act="closeDrawer" aria-label="Close">${icon("close")}</button></div>
      <div class="drawer-b">
        ${subject}
        <div class="sec"><h3>What people said (${fmt(g.count)})</h3><div class="notes">${said}</div></div>
        ${personSec}
        ${decision}
      </div>
      ${buttons.length ? `<div class="drawer-f">${buttons.join("")}</div>` : ""}`;
  };

  const openReport = (key) => {
    const group = S.groupsByKey.get(key);
    if (group) openDrawer(reportDrawer(group), { type: "report", key });
  };

  // ------------------------------------------------------------ posts

  const postsShell = () => {
    const s = S.posts;
    return `
    <div class="toolbar">
      <label class="field grow"><span class="sr">Search posts</span>${icon("search")}<input id="f-pq" type="search" data-search="posts" value="${esc(s.q)}" placeholder="Search by title, locality, seller name or email, or post ID" autocomplete="off"></label>
      <select class="sel" id="f-pplat" data-select="posts.platform" aria-label="Platform"><option value="all">All platforms</option>${PLATFORMS.map(
        (name) => `<option value="${name}" ${s.platform === name ? "selected" : ""}>${name}</option>`
      ).join("")}</select>
    </div>
    <div id="p-seg"></div>
    <section class="card">
      <div class="tbl-wrap"><table><thead><tr><th>Post</th><th>Type</th><th>Seller</th><th>Posted</th><th class="num">Views</th><th class="num">Reports</th><th>Status</th><th><span class="sr">Actions</span></th></tr></thead>
      <tbody id="p-body"><tr><td colspan="8"><div class="empty">Loading…</div></td></tr></tbody></table></div>
      <div class="more" id="p-more" hidden><button type="button" class="btn" data-act="more" data-list="posts">Load more</button></div>
      <div class="foot-note" id="p-foot"></div>
    </section>`;
  };

  const postRow = (p) => {
    const link = webUrl(p.socialUrl);
    const actions = p.removed
      ? `<button type="button" class="btn sm" data-act="restorePost" data-post="${esc(p._id)}">Restore</button>`
      : `<button type="button" class="btn sm danger" data-act="removePost" data-post="${esc(p._id)}">Remove</button>`;
    const platform = link
      ? `<a class="plat" href="${esc(link)}" target="_blank" rel="noopener noreferrer" title="Open the original post">${esc(p.platform || "PlotPost")}${icon("ext", "s14")}</a>`
      : plat(p.platform);
    return `<tr>
      <td class="t-title">${esc(p.title || "Untitled post")}<div class="t-meta">${platform} <span class="mono" title="${esc(p._id)}">…${esc(String(p._id).slice(-6))}</span> · ${esc(p.location)}</div></td>
      <td class="nowrap">${esc(p.type)}<div class="t-meta">${esc(p.deal)}</div></td>
      <td>${
        p.seller
          ? `<button type="button" class="btn ghost sm flush" data-act="openUser" data-id="${esc(p.seller._id)}">${esc(p.seller.name)}</button>`
          : '<span class="t-meta">Deleted account</span>'
      }</td>
      <td class="nowrap t-meta">${esc(ago(p.createdAt))}</td>
      <td class="num">${fmt(p.views)}</td>
      <td class="num">${p.openReports ? `<b class="n-crit">${fmt(p.openReports)}</b>` : "0"}</td>
      <td>${postPill(p)}${p.removed && p.removedReason ? `<div class="t-meta why">${esc(p.removedReason)}</div>` : ""}</td>
      <td><div class="row-actions">${actions}</div></td>
    </tr>`;
  };

  const loadPosts = async (fresh) => {
    const s = S.posts;
    const seq = ++s.seq;
    if (fresh) s.page = 1;
    const query = `?page=${s.page}&filter=${s.filter}&platform=${encodeURIComponent(s.platform)}&q=${encodeURIComponent(s.q)}`;
    try {
      const data = await api(`/admin/posts${query}`);
      if (seq !== s.seq || !$("#p-body")) return;
      s.items = fresh ? data.posts : [...s.items, ...data.posts];
      s.hasMore = data.hasMore;
      s.total = data.total;
      s.counts = data.counts || {};
      $("#p-seg").innerHTML = seg(
        "posts",
        "filter",
        [
          ["all", "All"],
          ["live", "Live"],
          ["expired", "Expired"],
          ["removed", "Removed"],
          ["sold", "Sold / rented"],
          ["banned", "Seller banned"],
        ],
        s.counts
      );
      $("#p-body").innerHTML =
        s.items.map(postRow).join("") ||
        `<tr><td colspan="8"><div class="empty"><strong>No posts match</strong>Try a different search or clear the filters.</div></td></tr>`;
      $("#p-more").hidden = !s.hasMore;
      $("#p-foot").textContent = s.items.length ? `Showing ${fmt(s.items.length)} of ${fmt(s.total)}, newest first.` : "";
    } catch (error) {
      if (seq === s.seq && $("#p-body")) $("#p-body").innerHTML = `<tr><td colspan="8">${failBox(error)}</td></tr>`;
    }
  };

  // ------------------------------------------------------------ people

  const peopleShell = () => `
    <div class="toolbar">
      <label class="field grow"><span class="sr">Search people</span>${icon("search")}<input id="f-uq" type="search" data-search="people" value="${esc(S.people.q)}" placeholder="Search by name, email, phone or account ID" autocomplete="off"></label>
    </div>
    <div id="u-seg"></div>
    <section class="card">
      <div class="tbl-wrap"><table><thead><tr><th>Person</th><th>Joined</th><th class="num">Posts</th><th class="num">Open reports</th><th>Status</th><th><span class="sr">Action</span></th></tr></thead>
      <tbody id="u-body"><tr><td colspan="6"><div class="empty">Loading…</div></td></tr></tbody></table></div>
      <div class="more" id="u-more" hidden><button type="button" class="btn" data-act="more" data-list="people">Load more</button></div>
      <div class="foot-note" id="u-foot"></div>
    </section>`;

  const peopleRow = (u) => `<tr class="click" tabindex="0" data-act="openUser" data-id="${esc(u._id)}">
      <td><div class="who"><span class="avatar sm" aria-hidden="true">${esc(initials(u.name))}</span><span><b>${esc(u.name)}</b><div class="t-meta">${esc(u.email)}${u.phone ? ` · ${esc(u.phone)}` : ""}</div></span></div></td>
      <td class="nowrap t-meta">${esc(when(u.createdAt))}</td>
      <td class="num">${fmt(u.posts)}</td>
      <td class="num">${u.openReports ? `<b class="n-crit">${fmt(u.openReports)}</b>` : "0"}</td>
      <td>${userPill(u)}${u.banned && u.banReason ? `<div class="t-meta why">${esc(u.banReason)}</div>` : ""}</td>
      <td><div class="row-actions"><button type="button" class="btn sm" data-act="openUser" data-id="${esc(u._id)}">View</button></div></td>
    </tr>`;

  const loadPeople = async (fresh) => {
    const s = S.people;
    const seq = ++s.seq;
    if (fresh) s.page = 1;
    try {
      const data = await api(`/admin/users?page=${s.page}&filter=${s.filter}&q=${encodeURIComponent(s.q)}`);
      if (seq !== s.seq || !$("#u-body")) return;
      s.items = fresh ? data.users : [...s.items, ...data.users];
      s.hasMore = data.hasMore;
      s.total = data.total;
      s.counts = data.counts || {};
      $("#u-seg").innerHTML = seg(
        "people",
        "filter",
        [
          ["all", "All"],
          ["active", "Active"],
          ["banned", "Banned"],
          ["admins", "Admins"],
        ],
        s.counts
      );
      $("#u-body").innerHTML =
        s.items.map(peopleRow).join("") ||
        `<tr><td colspan="6"><div class="empty"><strong>No one matches</strong>Try a different search or clear the filter.</div></td></tr>`;
      $("#u-more").hidden = !s.hasMore;
      $("#u-foot").textContent = s.items.length ? `Showing ${fmt(s.items.length)} of ${fmt(s.total)}, newest first.` : "";
    } catch (error) {
      if (seq === s.seq && $("#u-body")) $("#u-body").innerHTML = `<tr><td colspan="6">${failBox(error)}</td></tr>`;
    }
  };

  const openUser = async (id) => {
    openDrawer(
      `<div class="drawer-h"><h2>Account</h2><button type="button" class="btn ghost sm x" data-act="closeDrawer" aria-label="Close">${icon("close")}</button></div><div class="drawer-b"><div class="empty">Loading…</div></div>`,
      { type: "user", id }
    );
    let data;
    try {
      data = await api(`/admin/users/${encodeURIComponent(id)}`);
    } catch (error) {
      if (S.drawer?.type === "user" && S.drawer.id === id) $(".drawer-b", $("#drawer")).innerHTML = failBox(error);
      return;
    }
    if (S.drawer?.type !== "user" || S.drawer.id !== id) return;
    openDrawer(userDrawer(data), { type: "user", id });
  };

  const userDrawer = ({ user: u, posts, reports, actions }) => {
    const live = posts.filter((p) => !p.removed && !p.sellerBanned && p.status === "active" && !p.expired).length;
    const removed = posts.filter((p) => p.removed).length;
    const views = posts.reduce((n, p) => n + (p.views || 0), 0);
    const openReports = reports.filter((r) => r.status === "open").length;
    const postList = posts.length
      ? `<div class="mini">${posts
          .map(
            (p) => `<div>${plat(p.platform)}<span class="grow">${esc(p.title || "Untitled post")}<br><span class="t-meta">${esc(p.location)} · ${esc(ago(p.createdAt))}${
              p.removed && p.removedReason ? ` · ${esc(p.removedReason)}` : ""
            }</span></span>${postPill(p)}<span class="acts">${
              p.removed
                ? `<button type="button" class="btn sm" data-act="restorePost" data-post="${esc(p._id)}">Restore</button>`
                : `<button type="button" class="btn sm danger" data-act="removePost" data-post="${esc(p._id)}">Remove</button>`
            }</span></div>`
          )
          .join("")}</div>`
      : '<p class="help">No posts.</p>';
    const reportList = reports.length
      ? `<div class="notes">${reports
          .map(
            (r) => `<div class="note"><b>${esc(r.reason)}</b>${r.postTitle ? ` · on “${esc(cut(r.postTitle, 60))}”` : ""}${r.commentText ? `<br>“${esc(cut(r.commentText, 140))}”` : ""}${
              r.details ? `<br>${esc(r.details)}` : ""
            }<div class="meta">${esc(r.reporter ? r.reporter.name : "Deleted account")} · ${esc(ago(r.at))} · ${r.status === "open" ? "open" : "closed"}</div></div>`
          )
          .join("")}</div>`
      : '<p class="help">No reports about this account.</p>';
    const actionList = actions.length
      ? `<div class="notes">${actions
          .map(
            (a) => `<div class="note"><b>${esc(ACTION_LABEL[a.action] || a.action)}</b>${a.reason ? `<br>${esc(a.reason)}` : ""}<div class="meta">${esc(a.adminName || "Admin")} · ${esc(when(a.at))}</div></div>`
          )
          .join("")}</div>`
      : '<p class="help">No admin actions yet.</p>';
    let foot = "";
    if (canBan(u)) {
      foot = `<button type="button" class="btn dangerfill" data-act="ban" data-user="${esc(u._id)}" data-name="${esc(u.name)}">Ban account</button>`;
    } else if (u.banned) {
      foot = `<button type="button" class="btn" data-act="unban" data-user="${esc(u._id)}" data-name="${esc(u.name)}">Unban</button>`;
    } else if (u.role === "admin") {
      foot = '<p class="help">Admin accounts can\'t be banned here. Remove the admin role first (scripts/make-admin.js --remove).</p>';
    }
    return `
      <div class="drawer-h"><span class="avatar" aria-hidden="true">${esc(initials(u.name))}</span><h2>${esc(u.name)}</h2><button type="button" class="btn ghost sm x" data-act="closeDrawer" aria-label="Close">${icon("close")}</button></div>
      <div class="drawer-b">
        <div>${userPill(u)}</div>
        ${u.banned ? `<div class="banner warn"><span class="ic">${icon("alert")}</span><span class="txt">Banned ${esc(when(u.bannedAt))}.<small>${esc(u.banReason || "No reason saved.")}</small></span></div>` : ""}
        <div class="sec"><h3>Profile</h3><dl class="dl">
          <dt>Email</dt><dd>${esc(u.email)}</dd>
          <dt>Phone</dt><dd>${esc(u.phone || "–")}</dd>
          <dt>Profession</dt><dd>${esc(u.profession || "–")}${u.agency ? ` · ${esc(u.agency)}` : ""}</dd>
          <dt>Location</dt><dd>${esc(u.location || "–")}</dd>
          <dt>Joined</dt><dd>${esc(when(u.createdAt))}</dd>
          <dt>Account ID</dt><dd class="mono">${esc(u._id)}</dd>
        </dl></div>
        <div class="sec"><h3>Activity</h3><div class="stats">
          <div><b>${fmt(posts.length)}</b><span>Posts</span></div>
          <div><b>${fmt(live)}</b><span>Live</span></div>
          <div><b>${fmt(removed)}</b><span>Removed</span></div>
          <div><b>${fmt(views)}</b><span>Views</span></div>
          <div><b>${fmt(openReports)}</b><span>Open reports</span></div>
        </div></div>
        <div class="sec"><h3>Posts (${fmt(posts.length)})</h3>${postList}</div>
        <div class="sec"><h3>Reports about them (${fmt(reports.length)})</h3>${reportList}</div>
        <div class="sec"><h3>Admin actions</h3>${actionList}</div>
      </div>
      ${foot ? `<div class="drawer-f">${foot}</div>` : ""}`;
  };

  // ------------------------------------------------------------ audit

  const auditShell = () => `
    <div class="toolbar">
      <label class="field grow"><span class="sr">Search the log</span>${icon("search")}<input id="f-aq" type="search" data-search="audit" value="${esc(S.audit.q)}" placeholder="Search actions, posts, accounts and reasons" autocomplete="off"></label>
      <select class="sel" id="f-awho" data-select="audit.who" aria-label="Who"><option value="all">Everyone</option></select>
    </div>
    <section class="card">
      <div class="tbl-wrap"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
      <tbody id="a-body"><tr><td colspan="5"><div class="empty">Loading…</div></td></tr></tbody></table></div>
      <div class="more" id="a-more" hidden><button type="button" class="btn" data-act="more" data-list="audit">Load more</button></div>
      <div class="foot-note">Every action taken in this panel is recorded here. Entries can't be edited or deleted.</div>
    </section>`;

  const auditRow = (a) => `<tr>
      <td class="nowrap t-meta">${esc(when(a.at))}</td>
      <td class="nowrap">${esc(a.adminName || "Admin")}</td>
      <td class="nowrap"><b>${esc(ACTION_LABEL[a.action] || a.action)}</b></td>
      <td>${a.user ? `<button type="button" class="btn ghost sm flush" data-act="openUser" data-id="${esc(a.user)}">${esc(a.summary)}</button>` : esc(a.summary)}</td>
      <td>${esc(a.reason || "")}${a.reportsClosed ? `<div class="t-meta">${esc(plural(a.reportsClosed, "report"))} closed</div>` : ""}</td>
    </tr>`;

  const loadAudit = async (fresh) => {
    const s = S.audit;
    const seq = ++s.seq;
    if (fresh) s.page = 1;
    try {
      const data = await api(`/admin/audit?page=${s.page}&q=${encodeURIComponent(s.q)}&who=${encodeURIComponent(s.who)}`);
      if (seq !== s.seq || !$("#a-body")) return;
      s.items = fresh ? data.actions : [...s.items, ...data.actions];
      s.hasMore = data.hasMore;
      s.admins = data.admins || [];
      const who = $("#f-awho");
      if (who && document.activeElement !== who) {
        who.innerHTML = `<option value="all">Everyone</option>${s.admins
          .map((name) => `<option value="${esc(name)}" ${s.who === name ? "selected" : ""}>${esc(name)}</option>`)
          .join("")}`;
      }
      $("#a-body").innerHTML =
        s.items.map(auditRow).join("") ||
        `<tr><td colspan="5"><div class="empty"><strong>${s.q || s.who !== "all" ? "No entries match" : "Nothing yet"}</strong>${
          s.q || s.who !== "all" ? "Try a different search." : "Actions taken in this panel appear here."
        }</div></td></tr>`;
      $("#a-more").hidden = !s.hasMore;
    } catch (error) {
      if (seq === s.seq && $("#a-body")) $("#a-body").innerHTML = `<tr><td colspan="5">${failBox(error)}</td></tr>`;
    }
  };

  // ------------------------------------------------------------ actions

  // After an action: refresh what's on screen, the open drawer and the badge.
  const refreshAfterAction = async () => {
    if (S.drawer?.type === "report") closeDrawer();
    if (S.drawer?.type === "user") openUser(S.drawer.id);
    VIEWS[S.current].load(true);
    if (S.current !== "dashboard" && S.current !== "reports") {
      try {
        const { summary } = await api("/admin/summary");
        setOpenCount(summary.openReports);
      } catch (error) {
        // badge only
      }
    }
  };

  const run = async (button, call) => {
    button.disabled = true;
    try {
      const data = await call();
      toast(data.message || "Done.");
      await refreshAfterAction();
    } catch (error) {
      if (error.status !== 401) toast(error.message, true);
    } finally {
      button.disabled = false;
    }
  };

  const post = (path, body) => api(path, { method: "POST", body });

  const A = {
    signout: () => logout(),
    theme: () => {
      const root = document.documentElement;
      const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
      root.dataset.theme = dark ? "light" : "dark";
      store.set("localStorage", THEME_KEY, root.dataset.theme);
    },
    look: (d) => {
      const root = document.documentElement;
      if (d.look === "vibrant") root.dataset.look = "vibrant";
      else delete root.dataset.look;
      store.set("localStorage", LOOK_KEY, d.look === "vibrant" ? "vibrant" : null);
      syncLook();
    },
    closeDrawer: () => closeDrawer(),
    cancelModal: () => finishModal(null),
    okModal: () => okModal(),
    preset: (d) => {
      const box = $("#m-why");
      if (!box) return;
      box.value = d.text;
      $("#m-err").textContent = "";
      box.focus();
    },
    retry: () => VIEWS[S.current].load(true),
    seg: (d) => {
      S[d.list][d.field] = d.val;
      if (d.list === "reports") loadReports();
      else VIEWS[S.current].load(true);
    },
    more: (d) => {
      S[d.list].page += 1;
      VIEWS[S.current].load(false);
    },
    goReports: (d, el, event) => {
      event.preventDefault();
      S.reports.tab = "open";
      S.reports.kind = d.kind || "all";
      go("reports");
    },
    openReport: (d) => openReport(d.key),
    openUser: (d) => openUser(d.id),

    removePost: async (d, el) => {
      const reason = await askReason({
        title: "Remove this post?",
        help: "It disappears for everyone straight away. The seller sees it as removed, with this reason, and gets a notification. Open reports on it are closed. You can restore it later.",
        presets: REMOVE_PRESETS,
        ok: "Remove post",
      });
      if (reason) run(el, () => post(`/admin/posts/${encodeURIComponent(d.post)}/remove`, { reason }));
    },
    restorePost: async (d, el) => {
      const reason = await askReason({
        title: "Restore this post?",
        help: "It becomes visible again (unless the seller is banned). The seller is told.",
        ok: "Restore post",
        danger: false,
        required: false,
        label: "Note for the audit log (optional)",
      });
      if (reason !== null) run(el, () => post(`/admin/posts/${encodeURIComponent(d.post)}/restore`, reason ? { reason } : {}));
    },
    removeComment: async (d, el) => {
      const reason = await askReason({
        title: "Remove this comment?",
        help: "The comment is deleted. Its author is told why. Open reports on it are closed.",
        presets: COMMENT_PRESETS,
        ok: "Remove comment",
      });
      if (reason) {
        run(el, () => post(`/admin/posts/${encodeURIComponent(d.post)}/comments/${encodeURIComponent(d.comment)}/remove`, { reason }));
      }
    },
    ban: async (d, el) => {
      const reason = await askReason({
        title: `Ban ${d.name || "this account"}?`,
        help: "They are logged out everywhere and can't log in. Their posts and comments are hidden. Every open report about them is closed. You can unban later.",
        presets: BAN_PRESETS,
        ok: "Ban account",
        label: "Reason (kept in the audit log)",
      });
      if (reason) run(el, () => post(`/admin/users/${encodeURIComponent(d.user)}/ban`, { reason }));
    },
    unban: async (d, el) => {
      const reason = await askReason({
        title: `Unban ${d.name || "this account"}?`,
        help: "They can log in again and their posts come back. Posts you removed one by one stay removed.",
        ok: "Unban",
        danger: false,
        required: false,
        label: "Note for the audit log (optional)",
      });
      if (reason !== null) run(el, () => post(`/admin/users/${encodeURIComponent(d.user)}/unban`, reason ? { reason } : {}));
    },
    dismiss: async (d, el) => {
      const reason = await askReason({
        title: "Keep it and close the reports?",
        help: "Nothing is removed. The open reports about this item are closed. If someone reports it again, it comes back to the queue.",
        ok: "Keep and close",
        danger: false,
        required: false,
        label: "Note for the audit log (optional)",
      });
      if (reason === null) return;
      const body = {
        kind: d.kind,
        ...(d.post ? { post: d.post } : {}),
        ...(d.comment ? { comment: d.comment } : {}),
        ...(d.user ? { user: d.user } : {}),
        ...(reason ? { reason } : {}),
      };
      run(el, () => post("/admin/reports/dismiss", body));
    },
  };

  document.addEventListener("click", (event) => {
    const el = event.target.closest("[data-act]");
    if (!el || el.disabled) return;
    const action = A[el.dataset.act];
    if (action) action(el.dataset, el, event);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (modal) finishModal(null);
      else if ($("#drawer").classList.contains("on")) closeDrawer();
      return;
    }
    if (event.key === "Enter" && event.target.matches("tr[data-act]")) {
      event.preventDefault();
      event.target.click();
    }
    if (event.key === "Enter" && event.target.id === "gsearch") {
      Object.assign(S.posts, { q: event.target.value.trim().slice(0, 80), filter: "all", platform: "all" });
      event.target.value = "";
      go("posts");
    }
  });

  // Search boxes: wait until typing pauses, then load.
  let searchTimer;
  document.addEventListener("input", (event) => {
    const list = event.target.dataset?.search;
    if (!list) return;
    clearTimeout(searchTimer);
    const value = event.target.value.trim().slice(0, 80);
    searchTimer = setTimeout(() => {
      if (S[list].q === value) return;
      S[list].q = value;
      VIEWS[S.current].load(true);
    }, 350);
  });

  document.addEventListener("change", (event) => {
    const target = event.target.dataset?.select;
    if (!target) return;
    const [list, field] = target.split(".");
    S[list][field] = event.target.value;
    if (list === "reports") loadReports();
    else VIEWS[S.current].load(true);
  });

  $("#modal").addEventListener("click", (event) => {
    if (event.target.id === "modal") finishModal(null);
  });

  // ------------------------------------------------------------ start

  if (token) {
    start().catch((error) => {
      if (error.status !== 401) logout(error.status === 403 ? "This account isn't an admin." : error.message);
    });
  } else {
    showLogin();
  }
})();
