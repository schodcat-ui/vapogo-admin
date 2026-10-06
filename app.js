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
            var err = new Error(msg); err.status = res.status; throw err;
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
    var otp = h("input", { type: "text", inputmode: "numeric", maxlength: "6", autocomplete: "one-time-code" });
    var otpBox = h("div", { style: "display:none" }, h("label", {}, "6-digit code emailed to the admin address"), otp);
    var err = h("div", { class: "err" }, message || "");
    var btn = h("button", { class: "btn", type: "button" }, "Log in");
    var step = 1;
    function reset() {
      step = 1; email.disabled = false; pass.disabled = false;
      otpBox.style.display = "none"; otp.value = ""; btn.textContent = "Log in";
    }
    function go() {
      btn.disabled = true; err.textContent = "";
      var body = { email: email.value.trim(), password: pass.value };
      if (step === 2) body.otp = otp.value.trim();
      request("POST", "/auth/login", body)
        .then(function (d) {
          if (d.adminVerification) {
            step = 2; otpBox.style.display = "block"; btn.textContent = "Verify and log in";
            email.disabled = true; pass.disabled = true; otp.focus();
            toast("Code sent to the admin email");
            return;
          }
          if (d.user.role !== "ADMIN") { setToken(null); throw new Error("This site is for the administrator only."); }
          setToken(d.token); showConsole();
        })
        .catch(function (e) {
          err.textContent = e.message;
          if (step === 2 && /Log in again/.test(e.message)) reset();
        })
        .then(function () { btn.disabled = false; });
    }
    btn.addEventListener("click", go);
    pass.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
    otp.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
    mount(h("div", { class: "login card" },
      h("h2", {}, "VAPOGO Admin"),
      h("p", { class: "muted" }, "Administrator access only."),
      h("label", {}, "Email"), email,
      h("label", {}, "Password"), pass,
      otpBox,
      err,
      h("div", { class: "row" }, btn)
    ));
  }

  function showCreate() {
    var f = {
      name: h("input", { type: "text" }),
      email: h("input", { type: "email" }),
      phone: h("input", { type: "tel" }),
      password: h("input", { type: "password", autocomplete: "new-password" }),
      otp: h("input", { type: "text", inputmode: "numeric", maxlength: "6" })
    };
    var otpBox = h("div", { style: "display:none" }, h("label", {}, "6-digit code emailed to the admin address"), f.otp);
    var err = h("div", { class: "err" });
    var btn = h("button", { class: "btn", type: "button" }, "Send code");
    var step = 1;
    btn.addEventListener("click", function () {
      btn.disabled = true; err.textContent = "";
      var body = { name: f.name.value.trim(), email: f.email.value.trim(), phone: f.phone.value.trim(), password: f.password.value };
      if (step === 2) body.otp = f.otp.value.trim();
      request("POST", "/auth/register-operator", body)
        .then(function (d) {
          if (step === 1) {
            step = 2; otpBox.style.display = "block"; btn.textContent = "Verify and create";
            toast("Code sent to " + body.email);
          } else { setToken(d.token); showConsole(); }
        })
        .catch(function (e) { err.textContent = e.message; })
        .then(function () { btn.disabled = false; });
    });
    mount(h("div", { class: "login card" },
      h("h2", {}, "Create admin account"),
      h("p", { class: "muted" }, "Use the official support email. A code is emailed to it first. Only one admin can exist."),
      h("label", {}, "Name"), f.name,
      h("label", {}, "Email"), f.email,
      h("label", {}, "Mobile number"), f.phone,
      h("label", {}, "Password (10+ characters)"), f.password,
      otpBox, err,
      h("div", { class: "row" }, btn, h("button", { class: "btn ghost", type: "button", onclick: function () { showLogin(); } }, "Back"))
    ));
  }

  // ---- console ----
  var view = "overview";
  function showConsole() {
    var body = h("div", { class: "wrap" });
    var nav = h("nav", {});
    [["overview", "Overview"], ["buses", "Bus approvals"], ["operators", "Operators"], ["customers", "Customers"]].forEach(function (t) {
      var b = h("button", { class: view === t[0] ? "on" : "", onclick: function () { view = t[0]; showConsole(); } }, t[1]);
      nav.appendChild(b);
    });
    mount(h("div", {},
      h("div", { class: "top" }, h("div", { class: "brand" }, "VAPOGO ADMIN"), nav,
        h("button", { class: "btn ghost", onclick: function () { setToken(null); showLogin(); } }, "Log out")),
      body));
    if (view === "overview") renderOverview(body);
    else if (view === "buses") renderBuses(body);
    else renderUsers(body, view === "operators" ? "OPERATOR" : "CUSTOMER");
  }

  function loading(body) { body.replaceChildren(h("p", { class: "muted" }, "Loading...")); }
  function fail(body, e) { body.replaceChildren(h("p", { class: "err" }, e.message)); }

  function renderOverview(body) {
    loading(body);
    request("GET", "/admin/overview").then(function (o) {
      function stat(label, n, goto) {
        return h("div", { class: "card stat", style: goto ? "cursor:pointer" : "", onclick: goto ? function () { view = goto; showConsole(); } : undefined },
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
        h("h2", { style: "margin-top:12px" }, b.registrationNumber, " ", h("span", { class: "pill " + b.approvalStatus }, b.approvalStatus)),
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
            h("a", { class: "btn ghost", href: mailto, style: "text-decoration:none" }, "Email operator for documents"),
            b.approvalStatus === "APPROVED" ? null : h("button", { class: "btn ok", onclick: function () { act("approve", undefined, "Approved and published"); } }, "Approve and publish")),
          h("label", {}, "Reject"), note,
          h("div", { class: "row" }, h("button", { class: "btn bad", onclick: function () {
            if (note.value.trim().length < 3) { err.textContent = "Give the operator a reason."; return; }
            act("reject", { note: note.value.trim() }, "Rejected");
          } }, "Reject")),
          err));
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
      h("h2", { style: "margin-top:12px" }, u.name, " ", u.isSuspended ? h("span", { class: "pill susp" }, "Suspended") : null),
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
