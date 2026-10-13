(function () {
  "use strict";

  var API = window.VAPOGO_API;
  var TOKEN_KEY = "vapogo_admin_token";
  var root = document.getElementById("app");

  // sessionStorage: the login ends when the tab/browser is closed
  function getToken() {
    try { return sessionStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
  }
  function setToken(t) {
    try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
  }

  // ---- tiny safe DOM helper (text only, never innerHTML) ----
  function h(tag, props) {
    var el = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      if (k === "class") el.className = props[k];
      else if (k.indexOf("on") === 0) el.addEventListener(k.slice(2), props[k]);
      else if (props[k] !== undefined && props[k] !== null) el.setAttribute(k, props[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      el.appendChild(typeof c === "object" ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  function mount(node) { root.replaceChildren(node); }

  var toastTimer;
  function toast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.style.display = "none"; }, 3000);
  }

  // ---- API ----
  function request(method, path, body) {
    var headers = { "Content-Type": "application/json", "x-app-name": "admin", "x-app-version": "1.0.0" };
    var token = getToken();
    if (token) headers.Authorization = "Bearer " + token;
    return fetch(API + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (res.status === 401 && token) { setToken(null); showLogin("Session expired. Please log in again."); }
          if (!res.ok) {
            var msg = data.error || "Request failed";
            if (data.details && data.details.length) msg = data.details.map(function (d) { return d.message; }).join(". ");
            var err = new Error(msg); err.status = res.status; err.details = data.details; throw err;
          }
          return data;
        });
      });
  }

  // "15th August 2026". Calendar dates (expiry dates) are stored as UTC midnight and read in UTC so they never
  // shift a day; a real moment (e.g. "joined") is shown in the browser's own date.
  function fmtDate(v) {
    if (!v) return "";
    var d = new Date(v);
    if (isNaN(d.getTime())) return "";
    var months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    var dateOnly = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
    var day = dateOnly ? d.getUTCDate() : d.getDate();
    var month = dateOnly ? d.getUTCMonth() : d.getMonth();
    var year = dateOnly ? d.getUTCFullYear() : d.getFullYear();
    var suffix = day % 100 >= 11 && day % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][day % 10 > 3 ? 0 : day % 10];
    return day + suffix + " " + months[month] + " " + year;
  }
  function isPast(d) { return d ? new Date(d) < new Date() : false; }

  // ---- login / first-time admin creation ----
  function showLogin(message) {
    var email = h("input", { type: "email", autocomplete: "username" });
    var pass = h("input", { type: "password", autocomplete: "current-password" });
    var err = h("div", { class: "err" }, message || "");
    var btn = h("button", { class: "btn", type: "button" }, "Log in");
    function go() {
      btn.disabled = true; err.textContent = "";
      request("POST", "/auth/login", { email: email.value.trim(), password: pass.value })
        .then(function (d) {
          if (d.user.role !== "ADMIN") { setToken(null); throw new Error("This site is for administrators only."); }
          setToken(d.token); showConsole();
        })
        .catch(function (e) { err.textContent = e.message; })
        .then(function () { btn.disabled = false; });
    }
    btn.addEventListener("click", go);
    pass.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
    mount(h("div", { class: "login card" },
      h("h2", {}, "VAPOGO Admin"),
      h("p", { class: "muted" }, "Administrator access only."),
      h("label", {}, "Email"), email,
      h("label", {}, "Password"), pass,
      err,
      h("div", { class: "row" }, btn, h("button", { class: "btn ghost", type: "button", onclick: showForgot }, "Forgot password?"))
    ));
  }

  // Forgot password: email -> Request code (the code goes to the VAPOGO support mailbox) -> code + new password.
  function showForgot() {
    var keys = ["email", "otp", "password", "password2"];
    var input = {
      email: h("input", { type: "email", autocomplete: "username" }),
      otp: h("input", { type: "text", inputmode: "numeric", maxlength: "6", autocomplete: "one-time-code" }),
      password: h("input", { type: "password", autocomplete: "new-password" }),
      password2: h("input", { type: "password", autocomplete: "new-password" })
    };
    var fieldErr = {};
    keys.forEach(function (k) { fieldErr[k] = h("div", { class: "ferr" }); });
    function field(label, k) { return [h("label", {}, label), input[k], fieldErr[k]]; }

    var stage2 = h("div", { class: "hidden" });
    []
      .concat(field("Code (ask the VAPOGO support team for it)", "otp"), field("New password (10+ characters)", "password"), field("Repeat new password", "password2"))
      .forEach(function (n) { stage2.appendChild(n); });

    var formErr = h("div", { class: "err" });
    var info = h("div", { class: "muted" });
    var btn = h("button", { class: "btn", type: "button" }, "Request code");
    var step = 1;

    function clearErrors() { keys.forEach(function (k) { fieldErr[k].textContent = ""; }); formErr.textContent = ""; }
    function mark(k, msg) { fieldErr[k].textContent = msg; return 1; }
    function validate() {
      var bad = 0, email = input.email.value.trim();
      if (!email) bad += mark("email", "Required. Enter your admin email.");
      else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) bad += mark("email", "Enter a valid email address.");
      if (step === 2) {
        if (!/^\d{6}$/.test(input.otp.value.trim())) bad += mark("otp", input.otp.value.trim() ? "The code is 6 digits." : "Required. Enter the code.");
        if (!input.password.value) bad += mark("password", "Required. Choose a new password.");
        else if (input.password.value.length < 10) bad += mark("password", "Use at least 10 characters.");
        if (!input.password2.value) bad += mark("password2", "Required. Repeat the new password.");
        else if (input.password2.value !== input.password.value) bad += mark("password2", "The two passwords do not match.");
      }
      return bad;
    }
    function showServerError(e) {
      if (e.details && e.details.length) {
        var shown = 0;
        e.details.forEach(function (d) {
          var k = d.path && d.path[0] === "newPassword" ? "password" : d.path && d.path[0];
          if (k && fieldErr[k]) { fieldErr[k].textContent = d.message; shown++; }
        });
        if (shown) return;
      }
      if (step === 2 && /code|expired|attempts/i.test(e.message)) fieldErr.otp.textContent = e.message;
      else formErr.textContent = e.message;
    }

    btn.addEventListener("click", function () {
      clearErrors();
      if (validate()) return;
      btn.disabled = true;
      var email = input.email.value.trim();
      var call = step === 1
        ? request("POST", "/auth/forgot-password", { email: email })
        : request("POST", "/auth/reset-password", { email: email, otp: input.otp.value.trim(), newPassword: input.password.value });
      call.then(function () {
        if (step === 1) {
          step = 2; input.email.disabled = true;
          stage2.classList.remove("hidden");
          btn.textContent = "Reset password";
          info.textContent = "If this is an admin account, a code was sent to the VAPOGO support mailbox. It is valid for 10 minutes.";
          input.otp.focus();
        } else {
          showLogin();
          toast("Password changed. Log in with your new password.");
        }
      }).catch(showServerError).then(function () { btn.disabled = false; });
    });

    var card = h("div", { class: "login card" },
      h("h2", {}, "Reset your password"),
      h("p", { class: "muted" }, "Enter your admin email. A code is sent to the VAPOGO support team, who give it to you once they have checked it is you."));
    field("Your email", "email").forEach(function (n) { card.appendChild(n); });
    card.appendChild(stage2);
    card.appendChild(info);
    card.appendChild(formErr);
    card.appendChild(h("div", { class: "row" }, btn, h("button", { class: "btn ghost", type: "button", onclick: function () { showLogin(); } }, "Back")));
    mount(card);
  }

  // First-time / new-admin sign-up: details -> Request OTP -> enter OTP -> account created.
  // The OTP goes to the VAPOGO support mailbox, not to the person signing up.
  // Every problem is shown directly under the field it belongs to.
  function showCreate() {
    var keys = ["name", "email", "phone", "password", "password2", "otp"];
    var input = {
      name: h("input", { type: "text", autocomplete: "name" }),
      email: h("input", { type: "email", autocomplete: "email" }),
      phone: h("input", { type: "tel", autocomplete: "tel" }),
      password: h("input", { type: "password", autocomplete: "new-password" }),
      password2: h("input", { type: "password", autocomplete: "new-password" }),
      otp: h("input", { type: "text", inputmode: "numeric", maxlength: "6", autocomplete: "one-time-code" })
    };
    var fieldErr = {};
    keys.forEach(function (k) { fieldErr[k] = h("div", { class: "ferr" }); });
    function field(label, k) { return [h("label", {}, label), input[k], fieldErr[k]]; }

    var otpBox = h("div", { class: "hidden" });
    field("Enter the 6-digit OTP (ask the VAPOGO support team for it)", "otp").forEach(function (n) { otpBox.appendChild(n); });

    var formErr = h("div", { class: "err" });
    var info = h("div", { class: "muted" });
    var btn = h("button", { class: "btn", type: "button" }, "Request OTP");
    var step = 1;

    function clearErrors() { keys.forEach(function (k) { fieldErr[k].textContent = ""; }); formErr.textContent = ""; }
    function lock(on) { ["name", "email", "phone", "password", "password2"].forEach(function (k) { input[k].disabled = on; }); }
    function mark(k, msg) { fieldErr[k].textContent = msg; return 1; }

    // returns the number of problems found (each is shown under its own field)
    function validate() {
      var bad = 0;
      var v = function (k) { return input[k].value.trim(); };
      if (step === 1) {
        if (v("name").length < 2) bad += mark("name", "Required. Enter your name.");
        if (!v("email")) bad += mark("email", "Required. Enter your email.");
        else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v("email"))) bad += mark("email", "Enter a valid email address.");
        if (!v("phone")) bad += mark("phone", "Required. Enter your mobile number.");
        else if (!/^[6-9]\d{9}$/.test(v("phone"))) bad += mark("phone", "Enter a valid 10-digit Indian mobile number.");
        if (!input.password.value) bad += mark("password", "Required. Choose a password.");
        else if (input.password.value.length < 10) bad += mark("password", "Use at least 10 characters.");
        if (!input.password2.value) bad += mark("password2", "Required. Repeat the password.");
        else if (input.password2.value !== input.password.value) bad += mark("password2", "The two passwords do not match.");
      } else if (!/^\d{6}$/.test(v("otp"))) {
        bad += mark("otp", v("otp") ? "The OTP is 6 digits." : "Required. Enter the OTP.");
      }
      return bad;
    }

    // map a server error onto the right field when possible
    function showServerError(e) {
      if (e.details && e.details.length) {
        var shown = 0;
        e.details.forEach(function (d) {
          var k = d.path && d.path[0];
          if (k && fieldErr[k]) { fieldErr[k].textContent = d.message; shown++; }
        });
        if (shown) return;
      }
      var m = e.message || "";
      if (/mobile number/i.test(m) && !/email/i.test(m)) fieldErr.phone.textContent = m;
      else if (/email/i.test(m)) fieldErr.email.textContent = m;
      else if (/code|otp/i.test(m) && step === 2) fieldErr.otp.textContent = m;
      else formErr.textContent = m;
    }

    btn.addEventListener("click", function () {
      clearErrors();
      if (validate()) return;
      var body = { name: input.name.value.trim(), email: input.email.value.trim(), phone: input.phone.value.trim(), password: input.password.value };
      if (step === 2) body.otp = input.otp.value.trim();
      btn.disabled = true;
      request("POST", "/auth/register-admin", body)
        .then(function () {
          if (step === 1) {
            step = 2; lock(true);
            otpBox.classList.remove("hidden");
            btn.textContent = "Verify OTP and create account";
            info.textContent = "An OTP was sent to the VAPOGO support mailbox. It is valid for 10 minutes.";
            input.otp.focus();
          } else {
            setToken(null);
            showLogin();
            toast("Admin account created. Log in with your email and password.");
          }
        })
        .catch(showServerError)
        .then(function () { btn.disabled = false; });
    });

    var card = h("div", { class: "login card" },
      h("h2", {}, "Create admin account"),
      h("p", { class: "muted" }, "Enter your details and choose a password. We then ask the VAPOGO support team for an OTP to approve your account."));
    [].concat(field("Your name", "name"), field("Your email", "email"), field("Mobile number", "phone"),
      field("Password (10+ characters)", "password"), field("Repeat password", "password2"))
      .forEach(function (n) { card.appendChild(n); });
    card.appendChild(otpBox);
    card.appendChild(info);
    card.appendChild(formErr);
    card.appendChild(h("div", { class: "row" }, btn, h("button", { class: "btn ghost", type: "button", onclick: function () { showLogin(); } }, "Back")));
    mount(card);
  }

  // ---- console ----
  var view = "overview";
  function showConsole() {
    var body = h("div", { class: "wrap" });
    var nav = h("nav", {});
    [["overview", "Overview"], ["buses", "Bus approvals"], ["reports", "Reports"], ["terms", "Terms & Policies"], ["operators", "Operators"], ["customers", "Customers"], ["admins", "Admins"], ["account", "My account"]].forEach(function (t) {
      var b = h("button", { class: view === t[0] ? "on" : "", onclick: function () { view = t[0]; showConsole(); } }, t[1]);
      nav.appendChild(b);
    });
    mount(h("div", {},
      h("div", { class: "top" }, h("div", { class: "brand" }, "VAPOGO ADMIN"), nav,
        h("button", { class: "btn ghost", onclick: function () { setToken(null); showLogin(); } }, "Log out")),
      body));
    if (view === "overview") renderOverview(body);
    else if (view === "buses") renderBuses(body);
    else if (view === "reports") renderReports(body);
    else if (view === "terms") renderTerms(body);
    else if (view === "admins") renderAdmins(body);
    else if (view === "account") renderAccount(body);
    else renderUsers(body, view === "operators" ? "OPERATOR" : "CUSTOMER");
  }

  function loading(body) { body.replaceChildren(h("p", { class: "muted" }, "Loading...")); }
  function fail(body, e) { body.replaceChildren(h("p", { class: "err" }, e.message)); }

  function renderOverview(body) {
    loading(body);
    request("GET", "/admin/overview").then(function (o) {
      function stat(label, n, goto, filter) {
        return h("div", { class: goto ? "card stat clickable" : "card stat", onclick: goto ? function () { view = goto; if (filter) busFilter = filter; showConsole(); } : undefined },
          h("b", {}, n), h("span", {}, label));
      }
      body.replaceChildren(h("h2", {}, "Overview"), h("div", { class: "stats" },
        stat("Buses awaiting approval", o.pendingBuses, "buses"),
        stat("Verification requests", o.verifyRequests || 0, "buses", "VERIFY"),
        stat("Open customer reports", o.openReports || 0, "reports"),
        stat("Approved buses", o.approvedBuses),
        stat("Rejected buses", o.rejectedBuses),
        stat("Operators", o.operators, "operators"),
        stat("Customers", o.customers, "customers"),
        stat("Suspended accounts", o.suspended)));
    }).catch(function (e) { fail(body, e); });
  }

  var busFilter = "PENDING";
  var busSearch = "";
  function renderBuses(body) {
    loading(body);
    request("GET", "/admin/buses?status=" + busFilter).then(function (d) {
      var tabs = h("div", { class: "row" });
      ["PENDING", "APPROVED", "REJECTED", "VERIFY"].forEach(function (s) {
        var label = s === "VERIFY" ? "Verification requests" : s.charAt(0) + s.slice(1).toLowerCase();
        tabs.appendChild(h("button", { class: "btn " + (busFilter === s ? "" : "ghost"), onclick: function () { busFilter = s; renderBuses(body); } }, label));
      });
      var showSponsor = busFilter === "APPROVED";
      var head = h("tr", {}, h("th", {}, "Registration"), h("th", {}, "Bus"), h("th", {}, "Operator"), h("th", {}, busFilter === "VERIFY" ? "Requested" : "Added"));
      if (showSponsor) head.appendChild(h("th", {}, "Sponsored"));
      var tableCard = h("div", { class: "card" });
      var emptyNote = h("p", { class: "muted" });
      var search = h("input", { type: "search", placeholder: "Find a bus or operator: registration, bus name, company, name, phone, email, district, pincode", "aria-label": "Find a bus or operator" });
      search.value = busSearch;
      function rowText(b) {
        var o = b.operator || {};
        return [b.registrationNumber, b.displayName, o.companyName, o.name, o.phone, o.email, b.district, b.state, b.pincode].join(" ").toLowerCase();
      }
      function drawRows() {
        var words = busSearch.toLowerCase().split(/\s+/).filter(Boolean);
        var shown = d.buses.filter(function (b) { var t = rowText(b); return words.every(function (w) { return t.indexOf(w) !== -1; }); });
        var table = h("table", {}, head.cloneNode(true));
        shown.forEach(function (b) {
          var tr = h("tr", { class: "click", onclick: function () { renderBusReview(body, b.id); } },
            h("td", {}, b.registrationNumber, b.verification && b.verification.isVerified ? h("span", { class: "pill APPROVED" }, "✓ Verified") : null), h("td", {}, b.displayName),
            h("td", {}, (b.operator.companyName || b.operator.name)), h("td", {}, fmtDate(busFilter === "VERIFY" ? b.verificationRequestedAt : b.createdAt)));
          if (showSponsor) {
            var sp = b.sponsorship || {};
            var box = h("input", { type: "checkbox", class: "tick", "aria-label": "Sponsor this bus" });
            box.checked = !!sp.isSponsored;
            // the tick only changes after the dialog is saved, so put it back and open the dialog
            box.addEventListener("click", function (e) {
              e.preventDefault();
              sponsorDialog(b, function () { renderBuses(body); });
            });
            tr.appendChild(h("td", { onclick: function (e) { e.stopPropagation(); } }, box,
              sp.isSponsored ? h("span", { class: "muted" }, " position " + sp.position + ", until " + fmtDate(sp.until)) : null));
          }
          table.appendChild(tr);
        });
        tableCard.replaceChildren(table);
        tableCard.classList.toggle("hidden", shown.length === 0);
        emptyNote.textContent = shown.length ? "" : d.buses.length ? "No bus or operator matches \"" + busSearch + "\"." : busFilter === "VERIFY" ? "No verification requests waiting." : "No " + busFilter.toLowerCase() + " buses.";
      }
      search.addEventListener("input", function () { busSearch = search.value.trim(); drawRows(); });
      drawRows();
      body.replaceChildren(h("h2", {}, "Bus approvals"), tabs, h("div", { class: "mt12" }, search), tableCard, emptyNote);
    }).catch(function (e) { fail(body, e); });
  }

  // Sponsored placement: show the bus and its operator, ask for a position (1-10) and a number of days.
  // After the days are over the bus goes back to the normal random listing by itself.
  function sponsorDialog(b, done) {
    var o = b.operator || {};
    var sp = b.sponsorship || {};
    var position = h("select", {});
    for (var i = 1; i <= 10; i++) position.appendChild(h("option", { value: String(i) }, "Position " + i));
    if (sp.isSponsored) position.value = String(sp.position);
    var days = h("input", { type: "number", min: "1", max: "365", step: "1", placeholder: "Number of days" });
    var err = h("div", { class: "err" });
    var overlay = h("div", { class: "overlay" });
    function close() { overlay.remove(); }
    var save = h("button", { class: "btn ok", type: "button" }, sp.isSponsored ? "Update sponsorship" : "Sponsor this bus");
    save.addEventListener("click", function () {
      err.textContent = "";
      var n = Number(days.value);
      if (!days.value || !Number.isInteger(n) || n < 1 || n > 365) { err.textContent = "Enter the number of days (1 to 365)."; return; }
      save.disabled = true;
      request("POST", "/admin/buses/" + b.id + "/sponsor", { position: Number(position.value), days: n })
        .then(function () { close(); toast("Sponsored at position " + position.value + " for " + n + (n === 1 ? " day" : " days")); done(); })
        .catch(function (e) { err.textContent = e.message; save.disabled = false; });
    });
    var buttons = h("div", { class: "row" }, save);
    if (sp.isSponsored) {
      buttons.appendChild(h("button", { class: "btn bad", type: "button", onclick: function () {
        request("POST", "/admin/buses/" + b.id + "/unsponsor")
          .then(function () { close(); toast("Sponsorship removed"); done(); })
          .catch(function (e) { err.textContent = e.message; });
      } }, "Remove sponsorship"));
    }
    buttons.appendChild(h("button", { class: "btn ghost", type: "button", onclick: close }, "Cancel"));
    overlay.appendChild(h("div", { class: "card dialog", role: "dialog", "aria-modal": "true" },
      h("h3", {}, "Sponsor this bus"),
      kv([
        ["Bus", b.displayName], ["Registration no.", b.registrationNumber], ["Seats", b.seatCount],
        ["Location", [b.district, b.state, b.pincode].filter(Boolean).join(", ")],
        ["Operator", o.companyName || o.name], ["Operator phone", o.phone]]),
      sp.isSponsored ? h("p", { class: "muted" }, "Currently at position " + sp.position + " until " + fmtDate(sp.until) + ".") : null,
      h("p", { class: "muted" }, "Customers see it at this place in the search list with a small \"Sponsored\" label. When the days are over it goes back to the normal random listing."),
      h("label", {}, "Position (1 = first)"), position,
      h("label", {}, "For how many days?"), days,
      err, buttons));
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
  }

  function kv(pairs) {
    var dl = h("dl", { class: "kv" });
    pairs.forEach(function (p) {
      var empty = p[1] === undefined || p[1] === null || p[1] === "";
      dl.appendChild(h("dt", {}, p[0]));
      dl.appendChild(h("dd", { class: empty || p[2] ? "warn" : "" }, empty ? "Not entered" : p[1]));
    });
    return dl;
  }

  function renderBusReview(body, id) {
    loading(body);
    request("GET", "/admin/buses/" + id).then(function (d) {
      var b = d.bus, o = b.operator;
      var note = h("textarea", { rows: "3", placeholder: "Reason for rejection (shown to the operator)" });
      var err = h("div", { class: "err" });
      function act(path, payload, done) {
        err.textContent = "";
        request("POST", "/admin/buses/" + id + "/" + path, payload)
          .then(function () { toast(done); renderBuses(body); })
          .catch(function (e) { err.textContent = e.message; });
      }
      var mailto = "mailto:" + encodeURIComponent(o.email) + "?subject=" + encodeURIComponent("VAPOGO: please send documents for " + b.registrationNumber) +
        "&body=" + encodeURIComponent("Hello " + o.name + ",\n\nTo approve your bus " + b.displayName + " (" + b.registrationNumber + ") on VAPOGO, please reply with clear photos of the RC (registration certificate) and the tourist permit.\n\nThank you,\nVAPOGO team");
      body.replaceChildren(
        h("button", { class: "btn ghost", onclick: function () { renderBuses(body); } }, "← Back"),
        h("h2", { class: "mt12" }, b.registrationNumber, " ", h("span", { class: "pill " + b.approvalStatus }, b.approvalStatus)),
        b.takenDownAt ? h("p", { class: "warn" }, "This bus was taken down on " + fmtDate(b.takenDownAt) + ". The operator cannot edit it and has been told to ask the VAPOGO team to reopen it.") : null,
        b.approvalNote ? h("p", { class: "muted" }, "Note: " + b.approvalNote) : null,
        h("div", { class: "card" }, h("h3", {}, "Operator"), kv([
          ["Company", o.companyName], ["Name", o.name], ["Phone", o.phone], ["Email", o.email],
          ["Based in", [o.district, o.state, o.pincode].filter(Boolean).join(", ")]])),
        h("div", { class: "card" }, h("h3", {}, "Vehicle"), kv([
          ["Name", b.displayName], ["Registration no.", b.registrationNumber], ["Seats", b.seatCount],
          ["AC", b.isAC ? "Yes" : "No"], ["Location", [b.district, b.state, b.pincode].filter(Boolean).join(", ")]])),
        h("div", { class: "card" }, h("h3", {}, "Legal details entered by the operator"), kv([
          ["RC valid until", fmtDate(b.rcExpiryDate), isPast(b.rcExpiryDate)],
          ["Tourist permit no.", b.touristPermitNumber],
          ["Permit valid until", fmtDate(b.touristPermitExpiryDate), isPast(b.touristPermitExpiryDate)],
          ["Insurance valid until", fmtDate(b.insuranceExpiryDate), isPast(b.insuranceExpiryDate)],
          ["Road tax valid until", fmtDate(b.roadTaxExpiryDate), isPast(b.roadTaxExpiryDate)],
          ["Pollution cert. until", fmtDate(b.pollutionCertExpiryDate), isPast(b.pollutionCertExpiryDate)]]),
          h("p", { class: "muted" }, "Red = missing or already expired.")),
        verificationCard(b, id, body),
        h("div", { class: "card" },
          h("div", { class: "row" },
            h("a", { class: "btn ghost nolink", href: mailto }, "Email operator for documents"),
            b.approvalStatus === "APPROVED" ? null : h("button", { class: "btn ok", onclick: function () { act("approve", undefined, b.takenDownAt ? "Bus reopened" : "Approved and published"); } }, b.takenDownAt ? "Reopen this bus (end the take-down)" : "Approve and publish")),
          h("label", {}, "Reject"), note,
          h("div", { class: "row" }, h("button", { class: "btn bad", onclick: function () {
            if (note.value.trim().length < 3) { err.textContent = "Give the operator a reason."; return; }
            act("reject", { note: note.value.trim() }, "Rejected");
          } }, "Reject")),
          err));
    }).catch(function (e) { fail(body, e); });
  }

  // The green "Verified" tick: shown to customers until any legal date lapses. The admin checks the documents
  // the operator emailed, then verifies here.
  function verificationCard(b, id, body) {
    var v = b.verification || { state: "NONE" };
    var vnote = h("textarea", { rows: "2", placeholder: "Note (needed to decline; optional when verifying)" });
    var verr = h("div", { class: "err" });
    var status;
    if (v.state === "VERIFIED") status = h("p", {}, h("span", { class: "pill APPROVED" }, "✓ Verified"), " Customers see the green tick until " + fmtDate(v.verifiedUntil) + " (earliest document date).");
    else if (v.state === "EXPIRED") status = h("p", { class: "warn" }, "Was verified, but a document date has lapsed, so the tick is off. Ask the operator to renew and send the documents again.");
    else if (v.state === "REQUESTED") status = h("p", { class: "warn" }, "The operator emailed documents on " + fmtDate(b.verificationRequestedAt) + " and is waiting for the green tick.");
    else status = h("p", { class: "muted" }, "Not verified. The operator can ask for verification after emailing their documents.");
    var buttons = h("div", { class: "row" });
    if (b.approvalStatus === "APPROVED" && v.state !== "VERIFIED") {
      buttons.appendChild(h("button", { class: "btn ok", onclick: function () {
        verr.textContent = "";
        request("POST", "/admin/buses/" + id + "/verify", { note: vnote.value.trim() })
          .then(function () { toast("Verified - the green tick is on"); renderBusReview(body, id); })
          .catch(function (e) { verr.textContent = e.message; });
      } }, "Mark as verified (green tick)"));
    }
    buttons.appendChild(h("button", { class: "btn bad", onclick: function () {
      verr.textContent = "";
      if (vnote.value.trim().length < 3) { verr.textContent = "Write the reason for the operator."; return; }
      request("POST", "/admin/buses/" + id + "/unverify", { note: vnote.value.trim() })
        .then(function () { toast("Verification removed"); renderBusReview(body, id); })
        .catch(function (e) { verr.textContent = e.message; });
    } }, v.state === "VERIFIED" ? "Remove the tick" : "Decline verification"));
    return h("div", { class: "card" }, h("h3", {}, "Verified tick"), status,
      b.verificationNote ? h("p", { class: "muted" }, "Last note: " + b.verificationNote) : null,
      h("p", { class: "muted" }, "Verify only after checking the RC, tourist permit, insurance, road tax and pollution certificate the operator emailed. All five dates above must be in the future."),
      h("label", {}, "Note"), vnote, buttons, verr);
  }

  var REASONS = {
    UNSAFE_DRIVING: "Unsafe or rash driving", BUS_NOT_AS_LISTED: "Bus not as listed", POOR_CONDITION: "Dirty / poorly maintained",
    RUDE_BEHAVIOUR: "Rude or abusive behaviour", OVERCHARGING: "Asked for extra money", DID_NOT_SHOW_UP: "Did not show up",
    LAST_MINUTE_CANCELLATION: "Last-minute cancellation", OTHER: "Something else"
  };
  var reportFilter = "OPEN";
  var reportKind = "BUS"; // BUS = customers' reports about operators/buses, CUSTOMER = operators' reports about customers
  var CUSTOMER_REASONS = {
    FALSE_BOOKING: "False booking", SPAMMING: "Spamming requests", ABUSIVE_BEHAVIOUR: "Abusive behaviour",
    NO_SHOW: "Did not show up", FAKE_DETAILS: "Fake details", OTHER: "Something else"
  };
  function reportKindSwitch(body) {
    var row = h("div", { class: "row" });
    [["BUS", "About operators & buses"], ["CUSTOMER", "About customers"]].forEach(function (k) {
      row.appendChild(h("button", { class: "btn " + (reportKind === k[0] ? "" : "ghost"), onclick: function () { reportKind = k[0]; renderReports(body); } }, k[1]));
    });
    return row;
  }
  // Operators' reports about a customer (false bookings, spamming, ...). The admin decides: dismiss, mark
  // reviewed, or suspend the customer.
  function renderCustomerReports(body) {
    loading(body);
    request("GET", "/admin/customer-reports?status=" + reportFilter).then(function (d) {
      var tabs = h("div", { class: "row" });
      [["OPEN", "Open"], ["REVIEWED", "Reviewed"], ["ACTION_TAKEN", "Action taken"], ["DISMISSED", "Dismissed"]].forEach(function (s) {
        tabs.appendChild(h("button", { class: "btn " + (reportFilter === s[0] ? "" : "ghost"), onclick: function () { reportFilter = s[0]; renderReports(body); } }, s[1]));
      });
      var list = h("div", {});
      if (!d.reports.length) list.appendChild(h("p", { class: "muted" }, "No " + reportFilter.toLowerCase().replace("_", " ") + " reports about customers."));
      d.reports.forEach(function (r) {
        var note = h("textarea", { rows: "2", placeholder: "Note (needed to suspend the customer)" });
        var err = h("div", { class: "err" });
        function decide(action) {
          err.textContent = "";
          if (action === "SUSPEND_CUSTOMER" && note.value.trim().length < 3) { err.textContent = "Write the reason that will be recorded."; return; }
          request("POST", "/admin/customer-reports/" + r.id + "/action", { action: action, note: note.value.trim() || undefined })
            .then(function () { toast("Done"); renderReports(body); })
            .catch(function (e) { err.textContent = e.message; });
        }
        var c = r.customer, op = r.operator;
        var card = h("div", { class: "card" },
          h("h3", {}, CUSTOMER_REASONS[r.reason] || r.reason, " ", c.isSuspended ? h("span", { class: "pill susp" }, "Customer suspended") : null),
          h("p", {}, r.details),
          kv([
            ["Customer", c.name + " - " + c.phone + " - " + c.email],
            ["Reported by", (op.companyName || op.name) + " - " + op.phone + " - " + op.email],
            ["Booking", (r.booking.bus ? r.booking.bus.displayName + " (" + r.booking.bus.registrationNumber + "), " : "") + fmtDate(r.booking.tripStartDate) + " to " + fmtDate(r.booking.tripEndDate) + ", " + r.booking.pickupLocation + " to " + r.booking.dropLocation + " - " + r.booking.status],
            ["Reported on", fmtDate(r.createdAt)],
            ["Other reports", "This customer: " + r.customerReportCount + " in total (counted since they were last reinstated)."]]));
        if (r.status === "OPEN") {
          card.appendChild(h("label", {}, "Note")); card.appendChild(note);
          card.appendChild(h("div", { class: "row" },
            h("button", { class: "btn ghost", onclick: function () { decide("DISMISS"); } }, "Dismiss"),
            h("button", { class: "btn ghost", onclick: function () { decide("REVIEWED"); } }, "Mark reviewed"),
            h("button", { class: "btn bad", onclick: function () { decide("SUSPEND_CUSTOMER"); } }, "Suspend the customer")));
          card.appendChild(err);
        } else {
          card.appendChild(h("p", { class: "muted" }, "Decided " + fmtDate(r.resolvedAt) + (r.actionTaken === "CUSTOMER_SUSPENDED" ? " - customer suspended" : "") + (r.adminNote ? ". Note: " + r.adminNote : "")));
        }
        list.appendChild(card);
      });
      body.replaceChildren(h("h2", {}, "Reports"), reportKindSwitch(body), tabs, list);
    }).catch(function (e) { fail(body, e); });
  }

  // Customer reports about an operator and one of their buses. The admin decides: dismiss, mark reviewed,
  // take the bus down, or suspend the operator.
  function renderReports(body) {
    if (reportKind === "CUSTOMER") return renderCustomerReports(body);
    loading(body);
    request("GET", "/admin/reports?status=" + reportFilter).then(function (d) {
      var tabs = h("div", { class: "row" });
      [["OPEN", "Open"], ["REVIEWED", "Reviewed"], ["ACTION_TAKEN", "Action taken"], ["DISMISSED", "Dismissed"]].forEach(function (s) {
        tabs.appendChild(h("button", { class: "btn " + (reportFilter === s[0] ? "" : "ghost"), onclick: function () { reportFilter = s[0]; renderReports(body); } }, s[1]));
      });
      var list = h("div", {});
      if (!d.reports.length) list.appendChild(h("p", { class: "muted" }, "No " + reportFilter.toLowerCase().replace("_", " ") + " reports."));
      d.reports.forEach(function (r) {
        var note = h("textarea", { rows: "2", placeholder: "Note (needed to take the bus down or suspend the operator)" });
        var err = h("div", { class: "err" });
        function decide(action) {
          err.textContent = "";
          if ((action === "TAKE_BUS_DOWN" || action === "SUSPEND_OPERATOR") && note.value.trim().length < 3) { err.textContent = "Write the reason that will be recorded."; return; }
          request("POST", "/admin/reports/" + r.id + "/action", { action: action, note: note.value.trim() || undefined })
            .then(function () { toast("Done"); renderReports(body); })
            .catch(function (e) { err.textContent = e.message; });
        }
        var op = r.operator;
        var card = h("div", { class: "card" },
          h("h3", {}, REASONS[r.reason] || r.reason, " ", op.isSuspended ? h("span", { class: "pill susp" }, "Operator suspended") : null),
          h("p", {}, r.details),
          kv([
            ["Bus", r.bus.displayName + " (" + r.bus.registrationNumber + ")"],
            ["Operator", (op.companyName || op.name) + " - " + op.phone + " - " + op.email],
            ["Reported by", r.reporter.name + " - " + r.reporter.phone],
            ["Trip", fmtDate(r.booking.tripStartDate) + " to " + fmtDate(r.booking.tripEndDate) + ", " + r.booking.pickupLocation + " to " + r.booking.dropLocation],
            ["Reported on", fmtDate(r.createdAt)],
            ["Other reports", "This operator: " + r.operatorReportCount + " in total. This bus: " + r.busReportCount + " in total."]]),
          h("div", { class: "row" }, h("button", { class: "btn ghost", onclick: function () { renderBusReview(body, r.bus.id); } }, "Open the bus")));
        if (r.status === "OPEN") {
          card.appendChild(h("label", {}, "Note")); card.appendChild(note);
          card.appendChild(h("div", { class: "row" },
            h("button", { class: "btn ghost", onclick: function () { decide("DISMISS"); } }, "Dismiss"),
            h("button", { class: "btn ghost", onclick: function () { decide("REVIEWED"); } }, "Mark reviewed"),
            h("button", { class: "btn bad", onclick: function () { decide("TAKE_BUS_DOWN"); } }, "Take the bus down"),
            h("button", { class: "btn bad", onclick: function () { decide("SUSPEND_OPERATOR"); } }, "Suspend the operator")));
          card.appendChild(err);
        } else {
          card.appendChild(h("p", { class: "muted" }, "Decided " + fmtDate(r.resolvedAt) + (r.actionTaken === "BUS_TAKEN_DOWN" ? " - bus taken down" : r.actionTaken === "OPERATOR_SUSPENDED" ? " - operator suspended" : "") + (r.adminNote ? ". Note: " + r.adminNote : "")));
        }
        list.appendChild(card);
      });
      body.replaceChildren(h("h2", {}, "Reports"), reportKindSwitch(body), tabs, list);
    }).catch(function (e) { fail(body, e); });
  }

  // ---- Terms & Policies: every version of the customer / operator terms (kept for good) + who accepted what ----
  function fmtDateTime(v) {
    if (!v) return "";
    var d = new Date(v);
    if (isNaN(d.getTime())) return "";
    var h12 = d.getHours() % 12 === 0 ? 12 : d.getHours() % 12;
    var mm = ("0" + d.getMinutes()).slice(-2);
    return fmtDate(v) + ", " + h12 + ":" + mm + " " + (d.getHours() >= 12 ? "PM" : "AM");
  }
  var AUDIENCE_LABEL = { CUSTOMER: "Customer", OPERATOR: "Operator" };

  // the sections of a document <-> one text box:  heading, then paragraphs separated by a blank line; sections separated by a line with ---
  function sectionsToText(sections) {
    return sections.map(function (s) { return s.title + "\n" + s.paragraphs.join("\n\n"); }).join("\n---\n");
  }
  function textToSections(text) {
    var out = [];
    text.split(/\n\s*---\s*\n/).forEach(function (block) {
      block = block.trim();
      if (!block) return;
      var lines = block.split("\n");
      var title = lines.shift().trim();
      var paragraphs = lines.join("\n").split(/\n\s*\n/).map(function (p) { return p.trim(); }).filter(Boolean);
      out.push({ title: title, paragraphs: paragraphs });
    });
    return out;
  }

  function renderTermsDoc(v) {
    var c = v.content;
    var box = h("div", { class: "card" }, h("h3", {}, c.title), h("p", { class: "muted" }, "Version " + v.version + " - published " + fmtDateTime(v.publishedAt)),
      h("p", {}, h("b", {}, c.intro)), h("p", {}, c.lead));
    c.sections.forEach(function (s) {
      box.appendChild(h("h4", {}, s.title));
      s.paragraphs.forEach(function (p) { box.appendChild(h("p", {}, p)); });
    });
    box.appendChild(h("p", {}, h("b", {}, c.important)));
    box.appendChild(h("p", { class: "muted" }, "Tick-box text shown to the user:"));
    box.appendChild(h("p", {}, c.checkbox));
    return box;
  }

  function renderTerms(body) {
    loading(body);
    request("GET", "/admin/terms").then(function (d) {
      var table = h("table", {}, h("tr", {}, h("th", {}, "For"), h("th", {}, "Version"), h("th", {}, "Published"), h("th", {}, "Accepted by"), h("th", {}, "")));
      d.versions.forEach(function (v) {
        table.appendChild(h("tr", { class: "click", onclick: function () { renderTermsVersion(body, v); } },
          h("td", {}, AUDIENCE_LABEL[v.audience]), h("td", {}, v.version, " ", v.isCurrent ? h("span", { class: "pill APPROVED" }, "Current") : null),
          h("td", {}, fmtDateTime(v.publishedAt)), h("td", {}, v.acceptedCount + " people"), h("td", {}, "View")));
      });
      var current = {};
      d.versions.forEach(function (v) { if (v.isCurrent) current[v.audience] = v; });
      body.replaceChildren(h("h2", {}, "Terms & Policies"),
        h("p", { class: "muted" }, "Every version stays stored exactly as it was published. A new version must be accepted by every customer / operator the next time they open the app."),
        h("div", { class: "card" }, table),
        h("div", { class: "row" },
          h("button", { class: "btn", onclick: function () { renderTermsForm(body, current); } }, "Publish a new version"),
          h("button", { class: "btn ghost", onclick: function () { renderAcceptances(body); } }, "Acceptance records")));
    }).catch(function (e) { fail(body, e); });
  }

  function renderTermsVersion(body, v) {
    body.replaceChildren(h("button", { class: "btn ghost", onclick: function () { renderTerms(body); } }, "← Back"),
      h("h2", { class: "mt12" }, AUDIENCE_LABEL[v.audience] + " terms, version " + v.version, " ", v.isCurrent ? h("span", { class: "pill APPROVED" }, "Current") : null),
      h("p", { class: "muted" }, v.acceptedCount + " people accepted this version."),
      renderTermsDoc(v),
      h("div", { class: "row" }, h("button", { class: "btn ghost", onclick: function () { renderAcceptances(body, v.audience, v.version); } }, "Who accepted this version")));
  }

  function renderTermsForm(body, current) {
    var audience = h("select", {}, h("option", { value: "CUSTOMER" }, "Customer app"), h("option", { value: "OPERATOR" }, "Operator app (VAPOGO Partner)"));
    var version = h("input", { type: "text", placeholder: "e.g. 1.1" });
    var title = h("input", { type: "text" });
    var intro = h("textarea", { rows: "2" });
    var lead = h("textarea", { rows: "2" });
    var sections = h("textarea", { rows: "22" });
    var important = h("textarea", { rows: "2" });
    var checkbox = h("textarea", { rows: "4" });
    var err = h("div", { class: "err" });
    function fill() {
      var c = current[audience.value];
      if (!c) return;
      var x = c.content;
      title.value = x.title; intro.value = x.intro; lead.value = x.lead; important.value = x.important; checkbox.value = x.checkbox;
      sections.value = sectionsToText(x.sections);
      version.value = "";
      version.placeholder = "Current is " + c.version + ". Enter the new one, e.g. " + (parseFloat(c.version) ? (parseFloat(c.version) + 0.1).toFixed(1) : "2.0");
    }
    audience.addEventListener("change", fill);
    fill();
    var publish = h("button", { class: "btn bad", onclick: function () {
      err.textContent = "";
      var secs = textToSections(sections.value);
      if (!version.value.trim()) { err.textContent = "Enter the new version number."; return; }
      if (!secs.length || secs.some(function (s) { return !s.title || !s.paragraphs.length; })) { err.textContent = "Every section needs a heading line and at least one paragraph."; return; }
      if (!window.confirm("Publish version " + version.value.trim() + "? Every " + AUDIENCE_LABEL[audience.value].toLowerCase() + " must accept it before using the app again. This cannot be undone.")) return;
      publish.disabled = true;
      request("POST", "/admin/terms", { audience: audience.value, version: version.value.trim(), content: {
        title: title.value.trim(), intro: intro.value.trim(), lead: lead.value.trim(), sections: secs, important: important.value.trim(), checkbox: checkbox.value.trim() } })
        .then(function () { toast("Published - everyone will be asked to accept it"); renderTerms(body); })
        .catch(function (e) { err.textContent = e.message; publish.disabled = false; });
    } }, "Publish");
    body.replaceChildren(h("button", { class: "btn ghost", onclick: function () { renderTerms(body); } }, "← Back"), h("h2", { class: "mt12" }, "Publish a new version"),
      h("div", { class: "card" },
        h("p", { class: "muted" }, "The current text is filled in. Edit it, choose a new version number and publish. In the sections box: a heading on its own line, then the paragraphs (blank line between them); put --- on a line by itself between sections."),
        h("label", {}, "For"), audience, h("label", {}, "New version number"), version, h("label", {}, "Title"), title,
        h("label", {}, "Introduction"), intro, h("label", {}, "Lead-in line (before the sections)"), lead,
        h("label", {}, "Sections"), sections, h("label", {}, "Important note (last line)"), important,
        h("label", {}, "Tick-box text (shown next to the empty box)"), checkbox, err, h("div", { class: "row" }, publish)));
  }

  function renderAcceptances(body, audience, version) {
    var aud = h("select", {}, h("option", { value: "" }, "Customers and operators"), h("option", { value: "CUSTOMER" }, "Customers"), h("option", { value: "OPERATOR" }, "Operators"));
    aud.value = audience || "";
    var ver = h("input", { type: "text", placeholder: "Version (blank = all)", value: version || "" });
    var q = h("input", { type: "search", placeholder: "Search name, email or phone" });
    var results = h("div", {});
    var lastRows = [];
    function load() {
      results.replaceChildren(h("p", { class: "muted" }, "Loading..."));
      var qs = "?audience=" + encodeURIComponent(aud.value) + "&version=" + encodeURIComponent(ver.value.trim()) + "&q=" + encodeURIComponent(q.value.trim());
      request("GET", "/admin/terms/acceptances" + qs).then(function (d) {
        lastRows = d.acceptances;
        if (!d.acceptances.length) { results.replaceChildren(h("p", { class: "muted" }, "No acceptance records match.")); return; }
        var table = h("table", {}, h("tr", {}, h("th", {}, "Name"), h("th", {}, "Contact"), h("th", {}, "For"), h("th", {}, "Version"), h("th", {}, "Accepted on")));
        d.acceptances.forEach(function (a) {
          table.appendChild(h("tr", {}, h("td", {}, a.name), h("td", {}, a.email, h("div", { class: "muted" }, a.phone)),
            h("td", {}, AUDIENCE_LABEL[a.audience]), h("td", {}, a.version),
            h("td", {}, fmtDateTime(a.acceptedAt), a.deviceAcceptedAt ? h("div", { class: "muted" }, "ticked on the phone: " + fmtDateTime(a.deviceAcceptedAt)) : null)));
        });
        results.replaceChildren(h("p", { class: "muted" }, "Showing " + d.acceptances.length + " of " + d.total + " records, newest first."), h("div", { class: "card" }, table));
      }).catch(function (e) { results.replaceChildren(h("p", { class: "err" }, e.message)); });
    }
    function csvCell(v) { return '"' + String(v === null || v === undefined ? "" : v).replace(/"/g, '""') + '"'; }
    var download = h("button", { class: "btn ghost", onclick: function () {
      var lines = [["Name", "Email", "Phone", "Role", "For", "Version", "Accepted at", "Ticked on phone at"].map(csvCell).join(",")];
      lastRows.forEach(function (a) { lines.push([a.name, a.email, a.phone, a.role, a.audience, a.version, a.acceptedAt, a.deviceAcceptedAt].map(csvCell).join(",")); });
      var url = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/csv" }));
      var link = h("a", { href: url, download: "vapogo-terms-acceptances.csv" });
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } }, "Download as CSV");
    var timer;
    [aud, ver].forEach(function (el) { el.addEventListener("change", load); });
    q.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(load, 350); });
    body.replaceChildren(h("button", { class: "btn ghost", onclick: function () { renderTerms(body); } }, "← Back"), h("h2", { class: "mt12" }, "Acceptance records"),
      h("p", { class: "muted" }, "A permanent record of who accepted which version, and when. Records are kept even if the person later deletes their account."),
      aud, ver, q, h("div", { class: "row" }, download), results);
    load();
  }

  function renderAccount(body) {
    loading(body);
    request("GET", "/auth/me").then(function (d) {
      var u = d.user;
      var name = h("input", { type: "text", value: u.name });
      var phone = h("input", { type: "tel", value: u.phone });
      var profileMsg = h("div", { class: "err" });
      var saveProfile = h("button", { class: "btn", type: "button" }, "Save details");
      saveProfile.addEventListener("click", function () {
        saveProfile.disabled = true; profileMsg.textContent = "";
        request("PATCH", "/auth/admin/profile", { name: name.value.trim(), phone: phone.value.trim() })
          .then(function () { toast("Details saved"); })
          .catch(function (e) { profileMsg.textContent = e.message; })
          .then(function () { saveProfile.disabled = false; });
      });

      var cur = h("input", { type: "password", autocomplete: "current-password" });
      var nw = h("input", { type: "password", autocomplete: "new-password" });
      var again = h("input", { type: "password", autocomplete: "new-password" });
      var pwMsg = h("div", { class: "err" });
      var savePw = h("button", { class: "btn", type: "button" }, "Change password");
      savePw.addEventListener("click", function () {
        pwMsg.textContent = "";
        if (nw.value !== again.value) { pwMsg.textContent = "The new passwords do not match."; return; }
        savePw.disabled = true;
        request("POST", "/auth/change-password", { currentPassword: cur.value, newPassword: nw.value })
          .then(function () { cur.value = ""; nw.value = ""; again.value = ""; toast("Password changed"); })
          .catch(function (e) { pwMsg.textContent = e.message; })
          .then(function () { savePw.disabled = false; });
      });

      body.replaceChildren(
        h("h2", {}, "My account", u.adminNumber ? " (Admin " + u.adminNumber + ")" : ""),
        h("div", { class: "card" }, h("h3", {}, "Details"),
          h("label", {}, "Email (cannot be changed)"), h("input", { type: "text", value: u.email, disabled: "disabled" }),
          h("label", {}, "Name"), name,
          h("label", {}, "Mobile number"), phone,
          profileMsg, h("div", { class: "row" }, saveProfile)),
        h("div", { class: "card" }, h("h3", {}, "Change password"),
          h("label", {}, "Current password"), cur,
          h("label", {}, "New password (10+ characters)"), nw,
          h("label", {}, "Repeat new password"), again,
          pwMsg, h("div", { class: "row" }, savePw)));
    }).catch(function (e) { fail(body, e); });
  }

  function renderAdmins(body) {
    loading(body);
    request("GET", "/admin/users?role=ADMIN").then(function (d) {
      var table = h("table", {}, h("tr", {}, h("th", {}, "Admin"), h("th", {}, "Name"), h("th", {}, "Contact"), h("th", {}, "Joined")));
      d.users.forEach(function (u) {
        table.appendChild(h("tr", {}, h("td", {}, "Admin " + (u.adminNumber || "")), h("td", {}, u.name),
          h("td", {}, u.email, h("div", { class: "muted" }, u.phone)), h("td", {}, fmtDate(u.createdAt))));
      });
      body.replaceChildren(h("h2", {}, "Administrators"), h("div", { class: "card" }, table));
    }).catch(function (e) { fail(body, e); });
  }

  var query = "";
  function renderUsers(body, role) {
    var search = h("input", { type: "search", placeholder: "Search name, email, phone, company", value: query });
    var results = h("div", {});
    function load() {
      results.replaceChildren(h("p", { class: "muted" }, "Loading..."));
      request("GET", "/admin/users?role=" + role + "&q=" + encodeURIComponent(query)).then(function (d) {
        if (!d.users.length) { results.replaceChildren(h("p", { class: "muted" }, "No accounts found.")); return; }
        var table = h("table", {}, h("tr", {}, h("th", {}, "Name"), h("th", {}, "Contact"), h("th", {}, role === "OPERATOR" ? "Buses" : "Requests"), h("th", {}, "Joined"), h("th", {}, "")));
        d.users.forEach(function (u) {
          table.appendChild(h("tr", { class: "click", onclick: function () { renderUser(body, u, role); } },
            h("td", {}, u.name, u.companyName ? h("div", { class: "muted" }, u.companyName) : null),
            h("td", {}, u.email, h("div", { class: "muted" }, u.phone)),
            h("td", {}, role === "OPERATOR" ? u._count.buses : u._count.bookingRequests),
            h("td", {}, fmtDate(u.createdAt)),
            h("td", {}, u.isSuspended ? h("span", { class: "pill susp" }, "Suspended") : "")));
        });
        results.replaceChildren(h("div", { class: "card" }, table));
      }).catch(function (e) { results.replaceChildren(h("p", { class: "err" }, e.message)); });
    }
    var timer;
    search.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(function () { query = search.value.trim(); load(); }, 350); });
    body.replaceChildren(h("h2", {}, role === "OPERATOR" ? "Operators" : "Customers"), search, results);
    load();
  }

  function renderUser(body, u, role) {
    var confirmBox = h("input", { type: "text", placeholder: "Type DELETE to confirm" });
    var err = h("div", { class: "err" });
    function back() { renderUsers(body, role); }
    body.replaceChildren(
      h("button", { class: "btn ghost", onclick: back }, "← Back"),
      h("h2", { class: "mt12" }, u.name, " ", u.isSuspended ? h("span", { class: "pill susp" }, "Suspended") : null),
      h("div", { class: "card" }, kv([
        ["Company", u.companyName], ["Email", u.email], ["Phone", u.phone],
        ["Based in", [u.district, u.state, u.pincode].filter(Boolean).join(", ")],
        ["Joined", fmtDate(u.createdAt)],
        [role === "OPERATOR" ? "Buses" : "Booking requests", role === "OPERATOR" ? u._count.buses : u._count.bookingRequests]])),
      h("div", { class: "card" },
        h("div", { class: "row" }, h("button", { class: "btn", onclick: function () {
          request("POST", "/admin/users/" + u.id + "/suspend", { suspended: !u.isSuspended })
            .then(function () { toast(u.isSuspended ? "Account restored" : "Account suspended"); back(); })
            .catch(function (e) { err.textContent = e.message; });
        } }, u.isSuspended ? "Restore account" : "Suspend account")),
        h("label", {}, "Permanently delete this account and all its data"), confirmBox,
        h("div", { class: "row" }, h("button", { class: "btn bad", onclick: function () {
          if (confirmBox.value !== "DELETE") { err.textContent = "Type DELETE to confirm."; return; }
          request("DELETE", "/admin/users/" + u.id)
            .then(function () { toast("Account deleted"); back(); })
            .catch(function (e) { err.textContent = e.message; });
        } }, "Delete permanently")),
        err));
  }

  // ---- start ----
  // first-time setup is not linked from the login page: open  <site>/#setup  once
  if (location.hash === "#setup" && !getToken()) {
    showCreate();
  } else if (getToken()) {
    request("GET", "/admin/overview").then(showConsole).catch(function () { setToken(null); showLogin(); });
  } else {
    showLogin();
  }
})();
