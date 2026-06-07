(function () {
  var toggle = document.querySelector(".nav-toggle");
  var links = document.querySelector(".nav .links");
  if (toggle && links) {
    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  // Language pill — placeholder state toggle; localized mirror not yet built.
  var lang = document.querySelector(".lang");
  if (lang) {
    lang.addEventListener("click", function (e) {
      var btn = e.target.closest("button");
      if (!btn) return;
      lang.querySelectorAll("button").forEach(function (b) {
        b.classList.toggle("is-on", b === btn);
        b.setAttribute("aria-pressed", b === btn ? "true" : "false");
      });
    });
  }

  // Contact form — POST as JSON to /api/contact (EC2 Node service → Amazon SES).
  var form = document.getElementById("contact-form");
  if (form) {
    var status = form.querySelector(".form-status");
    var setStatus = function (msg, isErr) {
      if (!status) return;
      status.textContent = msg;
      status.className = "form-status " + (isErr ? "is-err" : "is-ok");
    };

    // reCAPTCHA v3 — loaded lazily on first form interaction so Google isn't
    // contacted on passive page views. Site key lives in the form data attribute.
    var siteKey = form.getAttribute("data-recaptcha-sitekey");
    var hasKey = siteKey && siteKey !== "RECAPTCHA_SITE_KEY";
    var recaptchaLoading = false;
    var loadRecaptcha = function () {
      if (recaptchaLoading || !hasKey) return;
      recaptchaLoading = true;
      var s = document.createElement("script");
      s.async = true;
      s.src = "https://www.google.com/recaptcha/api.js?render=" + encodeURIComponent(siteKey);
      document.head.appendChild(s);
    };
    form.addEventListener("focusin", loadRecaptcha, { once: true });

    var getToken = function () {
      return new Promise(function (resolve) {
        if (!hasKey) { resolve(""); return; }
        loadRecaptcha();
        var waited = 0;
        (function waitForReady() {
          if (typeof grecaptcha !== "undefined" && grecaptcha.execute) {
            try {
              grecaptcha.ready(function () {
                grecaptcha.execute(siteKey, { action: "contact" }).then(resolve, function () { resolve(""); });
              });
            } catch (e) { resolve(""); }
            return;
          }
          if (waited >= 5000) { resolve(""); return; }   // script never loaded (blocked/offline) → fall back
          waited += 100;
          setTimeout(waitForReady, 100);
        })();
      });
    };

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      setStatus("", false);

      if (!form.checkValidity()) {
        setStatus("Please fill in your name, a valid email, and a brief.", true);
        return;
      }

      var endpoint = form.getAttribute("data-endpoint");
      if (!endpoint) {
        setStatus("Form endpoint not configured yet — email alex@nadir-fly.com directly.", true);
        return;
      }

      var btn = form.querySelector("button[type=submit]");
      var original = btn ? btn.innerHTML : "";
      if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }

      loadRecaptcha();
      getToken().then(function (token) {
        var payload = {};
        new FormData(form).forEach(function (v, k) { payload[k] = v; });
        if (token) payload.recaptcha_token = token;

        return fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        });
      })
        .then(function (r) { if (!r.ok) throw new Error("bad status"); return r.json(); })
        .then(function () {
          form.reset();
          setStatus("Thanks — your message has been sent. We'll reply within 1 working day.", false);
          // GA4 conversion — only fires if analytics consent was granted (gtag exists).
          if (window.gtag) window.gtag("event", "generate_lead", { method: "contact_form" });
        })
        .catch(function () {
          setStatus("Something went wrong. Please email alex@nadir-fly.com directly.", true);
        })
        .finally(function () {
          if (btn) { btn.disabled = false; btn.innerHTML = original; }
        });
    });
  }

  // ---- Cookie consent + GA4 (analytics loads ONLY after opt-in) ----
  var GA_ID = "G-6FMLTHPBNL";
  var CONSENT_KEY = "nadir-consent";

  function getConsent() { try { return localStorage.getItem(CONSENT_KEY); } catch (e) { return null; } }
  function setConsent(v) { try { localStorage.setItem(CONSENT_KEY, v); } catch (e) {} }

  function loadGA() {
    if (window.__nadirGA) return;
    window.__nadirGA = true;
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + GA_ID;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", GA_ID, { anonymize_ip: true });
  }

  function clearGACookies() {
    var host = location.hostname.replace(/^www\./, "");
    document.cookie.split(";").forEach(function (c) {
      var name = c.split("=")[0].trim();
      if (/^_ga/.test(name) || name === "_gid") {
        ["", host, "." + host].forEach(function (d) {
          document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/" + (d ? "; domain=" + d : "");
        });
      }
    });
  }

  function showBanner() {
    if (document.querySelector(".cookie-banner")) return;
    var b = document.createElement("div");
    b.className = "cookie-banner";
    b.setAttribute("role", "dialog");
    b.setAttribute("aria-label", "Cookie consent");
    b.innerHTML =
      '<div class="cookie-inner">' +
        '<p class="cookie-text">We use Google Analytics to understand site usage. Analytics cookies are set <strong>only with your consent</strong>. See our <a href="privacy.html">Privacy policy</a>.</p>' +
        '<div class="cookie-actions">' +
          '<button class="btn btn-ghost btn-sm" data-consent="denied">Reject</button>' +
          '<button class="btn btn-primary btn-sm" data-consent="granted">Accept</button>' +
        '</div>' +
      '</div>';
    b.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-consent]");
      if (!btn) return;
      var choice = btn.getAttribute("data-consent");
      setConsent(choice);
      b.remove();
      if (choice === "granted") {
        loadGA();
      } else {
        clearGACookies();
        if (window.__nadirGA) location.reload(); // stop GA if it was running this session
      }
    });
    document.body.appendChild(b);
  }

  function addCookieSettingsLink() {
    var meta = document.querySelector(".footer .meta");
    if (!meta) return;
    var target = meta.querySelector("span:last-child") || meta;
    var a = document.createElement("a");
    a.href = "#";
    a.textContent = "Cookie settings";
    a.style.marginLeft = "18px";
    a.addEventListener("click", function (e) { e.preventDefault(); showBanner(); });
    target.appendChild(a);
  }

  var consent = getConsent();
  if (consent === "granted") loadGA();
  if (consent !== "granted" && consent !== "denied") showBanner();
  addCookieSettingsLink();
})();
