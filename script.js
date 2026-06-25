(function () {
  var toggle = document.querySelector(".nav-toggle");
  var links = document.querySelector(".nav .links");
  if (toggle && links) {
    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  // UI strings — picked by <html lang>; localized mirror lives under /it/.
  var LANG = (document.documentElement.lang || "en").slice(0, 2).toLowerCase();
  var STR = {
    en: {
      formInvalid: "Please fill in your name, a valid email, and a brief.",
      noEndpoint: "Form endpoint not configured yet. Email alex@nadir-fly.com directly.",
      sending: "Sending…",
      sent: "Thanks, your message has been sent. We'll reply within 1 working day.",
      error: "Something went wrong. Please email alex@nadir-fly.com directly.",
      cookieAria: "Cookie consent",
      cookieText: 'We use Google Analytics to understand site usage. Analytics cookies are set <strong>only with your consent</strong>. See our <a href="privacy.html">Privacy policy</a>.',
      reject: "Reject",
      accept: "Accept",
      cookieSettings: "Cookie settings"
    },
    it: {
      formInvalid: "Inserisci il tuo nome, un'email valida e un brief.",
      noEndpoint: "Endpoint del modulo non ancora configurato. Scrivi direttamente a alex@nadir-fly.com.",
      sending: "Invio…",
      sent: "Grazie, il tuo messaggio è stato inviato. Ti rispondiamo entro 1 giorno lavorativo.",
      error: "Qualcosa è andato storto. Scrivi direttamente a alex@nadir-fly.com.",
      cookieAria: "Consenso ai cookie",
      cookieText: 'Usiamo Google Analytics per capire l\'utilizzo del sito. I cookie analitici vengono impostati <strong>solo con il tuo consenso</strong>. Consulta la nostra <a href="privacy.html">Informativa privacy</a>.',
      reject: "Rifiuta",
      accept: "Accetta",
      cookieSettings: "Impostazioni cookie"
    },
    sl: {
      formInvalid: "Vnesite svoje ime, veljaven e-naslov in povpraševanje.",
      noEndpoint: "Končna točka obrazca še ni nastavljena. Pišite neposredno na alex@nadir-fly.com.",
      sending: "Pošiljanje…",
      sent: "Hvala, vaše sporočilo je bilo poslano. Odgovorimo v 1 delovnem dnevu.",
      error: "Nekaj je šlo narobe. Pišite neposredno na alex@nadir-fly.com.",
      cookieAria: "Soglasje za piškotke",
      cookieText: 'Uporabljamo Google Analytics za razumevanje uporabe spletnega mesta. Analitični piškotki se nastavijo <strong>samo z vašim soglasjem</strong>. Glejte naš <a href="privacy.html">Pravilnik o zasebnosti</a>.',
      reject: "Zavrni",
      accept: "Sprejmi",
      cookieSettings: "Nastavitve piškotkov"
    }
  };
  var t = STR[LANG] || STR.en;

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
        setStatus(t.formInvalid, true);
        return;
      }

      var endpoint = form.getAttribute("data-endpoint");
      if (!endpoint) {
        setStatus(t.noEndpoint, true);
        return;
      }

      var btn = form.querySelector("button[type=submit]");
      var original = btn ? btn.innerHTML : "";
      if (btn) { btn.disabled = true; btn.textContent = t.sending; }

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
          setStatus(t.sent, false);
          // GA4 conversion — only fires if analytics consent was granted (gtag exists).
          if (window.gtag) window.gtag("event", "generate_lead", { method: "contact_form" });
        })
        .catch(function () {
          setStatus(t.error, true);
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
    b.setAttribute("aria-label", t.cookieAria);
    b.innerHTML =
      '<div class="cookie-inner">' +
        '<p class="cookie-text">' + t.cookieText + '</p>' +
        '<div class="cookie-actions">' +
          '<button class="btn btn-ghost btn-sm" data-consent="denied">' + t.reject + '</button>' +
          '<button class="btn btn-primary btn-sm" data-consent="granted">' + t.accept + '</button>' +
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
    a.textContent = t.cookieSettings;
    a.style.marginLeft = "18px";
    a.addEventListener("click", function (e) { e.preventDefault(); showBanner(); });
    target.appendChild(a);
  }

  var consent = getConsent();
  if (consent === "granted") loadGA();
  if (consent !== "granted" && consent !== "denied") showBanner();
  addCookieSettingsLink();
})();
