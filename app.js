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

  function fmtDate(d) { return d ? new Date(d).toLocaleDateString("en-IN") : ""; }
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
      h("div", { class: "row" }, btn)
    ));
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
    [["overview", "Overview"], ["buses", "Bus approvals"], ["operators", "Operators"], ["customers", "Customers"], ["admins", "Admins"], ["account", "My account"]].forEach(function (t) {
      var b = h("button", { class: view === t[0] ? "on" : "", onclick: function () { view = t[0]; showConsole(); } }, t[1]);
      nav.appendChild(b);
    });
    mount(h("div", {},
      h("div", { class: "top" }, h("div", { class: "brand" }, "VAPOGO ADMIN"), nav,
        h("button", { class: "btn ghost", onclick: function () { setToken(null); showLogin(); } }, "Log out")),
      body));
    if (view === "overview") renderOverview(body);
    else if (view === "buses") renderBuses(body);
    else if (view === "admins") renderAdmins(body);
    else if (view === "account") renderAccount(body);
    else renderUsers(body, view === "operators" ? "OPERATOR" : "CUSTOMER");
  }

  function loading(body) { body.replaceChildren(h("p", { class: "muted" }, "Loading...")); }
  function fail(body, e) { body.replaceChildren(h("p", { class: "err" }, e.message)); }

  function renderOverview(body) {
    loading(body);
    request("GET", "/admin/overview").then(function (o) {
      function stat(label, n, goto) {
        return h("div", { class: goto ? "card stat clickable" : "card stat", onclick: goto ? function () { view = goto; showConsole(); } : undefined },
          h("b", {}, n), h("span", {}, label));
      }
      body.replaceChildren(h("h2", {}, "Overview"), h("div", { class: "stats" },
        stat("Buses awaiting approval", o.pendingBuses, "buses"),
        stat("Approved buses", o.approvedBuses),
        stat("Rejected buses", o.rejectedBuses),
        stat("Operators", o.operators, "operators"),
        stat("Customers", o.customers, "customers"),
        stat("Suspended accounts", o.suspended)));
    }).catch(function (e) { fail(body, e); });
  }

  var busFilter = "PENDING";
  function renderBuses(body) {
    loading(body);
    request("GET", "/admin/buses?status=" + busFilter).then(function (d) {
      var tabs = h("div", { class: "row" });
      ["PENDING", "APPROVED", "REJECTED"].forEach(function (s) {
        tabs.appendChild(h("button", { class: "btn " + (busFilter === s ? "" : "ghost"), onclick: function () { busFilter = s; renderBuses(body); } }, s.charAt(0) + s.slice(1).toLowerCase()));
      });
      var table = h("table", {}, h("tr", {}, h("th", {}, "Registration"), h("th", {}, "Bus"), h("th", {}, "Operator"), h("th", {}, "Added")));
      d.buses.forEach(function (b) {
        table.appendChild(h("tr", { class: "click", onclick: function () { renderBusReview(body, b.id); } },
          h("td", {}, b.registrationNumber), h("td", {}, b.displayName),
          h("td", {}, (b.operator.companyName || b.operator.name)), h("td", {}, fmtDate(b.createdAt))));
      });
      body.replaceChildren(h("h2", {}, "Bus approvals"), tabs,
        d.buses.length ? h("div", { class: "card" }, table) : h("p", { class: "muted" }, "No " + busFilter.toLowerCase() + " buses."));
    }).catch(function (e) { fail(body, e); });
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
        h("div", { class: "card" },
          h("div", { class: "row" },
            h("a", { class: "btn ghost nolink", href: mailto }, "Email operator for documents"),
            b.approvalStatus === "APPROVED" ? null : h("button", { class: "btn ok", onclick: function () { act("approve", undefined, "Approved and published"); } }, "Approve and publish")),
          h("label", {}, "Reject"), note,
          h("div", { class: "row" }, h("button", { class: "btn bad", onclick: function () {
            if (note.value.trim().length < 3) { err.textContent = "Give the operator a reason."; return; }
            act("reject", { note: note.value.trim() }, "Rejected");
          } }, "Reject")),
          err));
    }).catch(function (e) { fail(body, e); });
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
