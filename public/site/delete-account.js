// The Delete account page: 1) email a code, 2) confirm with the code.
// Talks to /api/auth/delete-account/* on the same server.
(function () {
  "use strict";

  var byId = function (id) { return document.getElementById(id); };
  var emailForm = byId("email-form");
  var codeForm = byId("code-form");
  var done = byId("done");
  var status = byId("status");
  var emailInput = byId("email");
  var codeInput = byId("code");
  var understand = byId("understand");
  var sentTo = byId("sent-to");
  var email = "";

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function show(kind, text) {
    status.textContent = text || "";
    status.className = "notice" + (kind ? " " + kind : "");
    status.hidden = !text;
  }

  function invalid(input, on) {
    if (on) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }

  function busy(button, on, label) {
    if (on) {
      button.dataset.label = button.textContent;
      button.textContent = label;
      button.disabled = true;
    } else {
      button.textContent = button.dataset.label || button.textContent;
      button.disabled = false;
    }
  }

  function post(path, body) {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          return { ok: res.ok, status: res.status, data: data || {} };
        });
      })
      .catch(function () {
        return {
          ok: false,
          status: 0,
          data: { message: "Couldn't reach PlotPost. Check your internet connection and try again." },
        };
      });
  }

  function messageOf(result, fallback) {
    return (result.data && result.data.message) || fallback;
  }

  function requestCode() {
    return post("/api/auth/delete-account/request-code", { email: email });
  }

  emailForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var value = emailInput.value.trim();
    if (!EMAIL_RE.test(value)) {
      invalid(emailInput, true);
      show("error", "Please enter the email address of your PlotPost account.");
      emailInput.focus();
      return;
    }
    invalid(emailInput, false);
    email = value;
    var button = emailForm.querySelector("button[type=submit]");
    busy(button, true, "Sending…");
    show("", "");
    requestCode().then(function (result) {
      busy(button, false);
      if (!result.ok) {
        show("error", messageOf(result, "We couldn't send a code. Please try again."));
        return;
      }
      sentTo.textContent = email;
      emailForm.hidden = true;
      codeForm.hidden = false;
      show("", messageOf(result, "Check your email for a 6-digit code."));
      codeInput.value = "";
      codeInput.focus();
    });
  });

  codeInput.addEventListener("input", function () {
    var digits = codeInput.value.replace(/\D/g, "").slice(0, 6);
    if (digits !== codeInput.value) codeInput.value = digits;
    invalid(codeInput, false);
  });

  codeForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var code = codeInput.value.trim();
    if (!/^\d{6}$/.test(code)) {
      invalid(codeInput, true);
      show("error", "Please enter the 6-digit code from the email.");
      codeInput.focus();
      return;
    }
    if (!understand.checked) {
      show("error", "Please tick the box to confirm that you understand the account will be deleted permanently.");
      understand.focus();
      return;
    }
    var button = codeForm.querySelector("button[type=submit]");
    busy(button, true, "Deleting…");
    post("/api/auth/delete-account/confirm", { email: email, code: code }).then(function (result) {
      busy(button, false);
      if (!result.ok) {
        if (result.status === 400) invalid(codeInput, true);
        show("error", messageOf(result, "We couldn't delete the account. Please try again."));
        return;
      }
      codeForm.hidden = true;
      show("", "");
      done.hidden = false;
      byId("done-title").focus();
      document.title = "Account deleted · PlotPost";
    });
  });

  byId("resend").addEventListener("click", function (event) {
    var button = event.currentTarget;
    busy(button, true, "Sending…");
    requestCode().then(function (result) {
      busy(button, false);
      show(result.ok ? "" : "error", messageOf(result, result.ok ? "We've sent a new code." : "We couldn't send a code. Please try again."));
      codeInput.focus();
    });
  });

  byId("change-email").addEventListener("click", function () {
    codeForm.hidden = true;
    emailForm.hidden = false;
    understand.checked = false;
    show("", "");
    emailInput.focus();
  });
})();
