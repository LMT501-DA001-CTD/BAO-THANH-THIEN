(function () {
  "use strict";

  const icons = window.SkyRescueDemo.ICONS;
  const AUTH_USERS_KEY = "skyrescue.auth.users.v2";
  const AUTH_SESSION_KEY = "skyrescue.auth.session.v1";
  // Login session lives in sessionStorage (per browser tab) so every new run/tab starts at Sign In.
  // Remove any session persisted in localStorage by older builds.
  try { localStorage.removeItem(AUTH_SESSION_KEY); } catch (_) {}

  const DEFAULT_USERS = [
    {
      id: "DISPATCH",
      idAliases: ["DISPATCH", "dispatcher", "USR-DISP-01", "USR-COORD-01"],
      name: "SkyRescue Dispatch",
      email: "dispatch@skyrescue.org",
      emailAliases: ["dispatcher@skyrescue.org", "ranjith@skyrescue.org"],
      password: "Dispatch#2025",
      passwordAliases: ["Dispatch#Sky2025", "Coord#Sky2025"],
      phone: "0901.234.567",
      role: "Dispatch",
      trustTier: "Dispatch Admin",
      trustScore: 100,
      verified: true,
      organization: "SkyRescue Dispatch Station",
      preferredPortal: "dispatch",
      badgeTone: "info",
      summary: "Dispatch workspace account for incident verification, team matching and mission coordination.",
      permissions: {
        canAccessDispatch: true,
        canVerify: true,
        canDispatch: true,
        canConfig: true,
        canFieldOps: true,
        canReport: false,
        canDroneTelemetry: false
      }
    },
    {
      id: "REPORTER",
      idAliases: ["REPORTER", "report", "USR-REPORTER-01", "USR-UAV-07"],
      name: "SkyRescue Reporter",
      email: "reporter@skyrescue.org",
      emailAliases: ["reports@skyrescue.org", "drone07@skyrescue.org"],
      password: "Reporter#2025",
      passwordAliases: ["Drone#UAV07", "Pilot#UAV07"],
      phone: "0987.654.321",
      role: "Reporter",
      trustTier: "Standard Reporter",
      trustScore: 50,
      verified: true,
      organization: "SkyRescue Field Reporting",
      preferredPortal: "reporter",
      badgeTone: "success",
      summary: "Reporter workspace account for submitting field evidence and tracking report progress.",
      permissions: {
        canAccessDispatch: false,
        canVerify: false,
        canDispatch: false,
        canConfig: false,
        canFieldOps: false,
        canReport: true,
        canDroneTelemetry: true
      }
    }
,
    {
      id: "CITIZEN",
      idAliases: ["CITIZEN", "citizen"],
      name: "Nguyen Van An (demo)",
      email: "citizen@demo.skyrescue.org",
      emailAliases: [],
      // Demo account: the server keeps the password hash (server/seed_users.json).
      phone: "0900.000.101",
      role: "Citizen",
      trustTier: "Unverified Citizen",
      trustScore: 30,
      verified: false,
      organization: "SkyRescue demo account",
      preferredPortal: "reporter",
      badgeTone: "warning",
      summary: "Seeded demo account.",
      permissions: { canAccessDispatch: false, canVerify: false, canDispatch: false, canConfig: false, canFieldOps: false, canReport: true, canDroneTelemetry: false }
    },
    {
      id: "UAV07",
      idAliases: ["UAV07", "uav07"],
      name: "UAV Operator 07 (demo)",
      email: "uav07@demo.skyrescue.org",
      emailAliases: [],
      // Demo account: the server keeps the password hash (server/seed_users.json).
      phone: "0900.000.107",
      role: "UAV Operator",
      trustTier: "Verified Specialist",
      trustScore: 80,
      verified: true,
      uavId: "AEGIS-UAV-07",
      organization: "SkyRescue demo account",
      preferredPortal: "reporter",
      badgeTone: "success",
      summary: "Seeded demo account.",
      permissions: { canAccessDispatch: false, canVerify: false, canDispatch: false, canConfig: false, canFieldOps: false, canReport: true, canDroneTelemetry: true }
    },
    {
      id: "CTV01",
      idAliases: ["CTV01", "ctv01"],
      name: "Specialist CTV 01 (demo)",
      email: "ctv01@demo.skyrescue.org",
      emailAliases: [],
      // Demo account: the server keeps the password hash (server/seed_users.json).
      phone: "0900.000.111",
      role: "UAV Specialist / CTV",
      trustTier: "Verified Specialist",
      trustScore: 80,
      verified: true,
      organization: "SkyRescue demo account",
      preferredPortal: "reporter",
      badgeTone: "success",
      summary: "Seeded demo account.",
      permissions: { canAccessDispatch: false, canVerify: false, canDispatch: false, canConfig: false, canFieldOps: false, canReport: true, canDroneTelemetry: false }
    }
  ];

  function canAccess(permissionKey, user = currentUser()) {
    if (!user) return false;
    return Boolean(user.permissions && user.permissions[permissionKey]);
  }

  function escape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function regionTimezoneInfo() {
    try {
      if (window.SkyRescueStore && typeof window.SkyRescueStore.regionMeta === "function") {
        const meta = window.SkyRescueStore.regionMeta();
        if (meta && meta.timeZone) {
          const shortCode = meta.timeZone === "America/Los_Angeles" ? "PDT" : "ICT";
          return {
            timeZone: meta.timeZone,
            tzShort: meta.tzShort || (shortCode === "PDT" ? "PDT (UTC-07:00)" : "ICT (UTC+07:00)"),
            shortCode,
            operatingArea: meta.operatingArea || "Vietnam",
            country: meta.country || "Vietnam"
          };
        }
      }
    } catch (_) {}
    return {
      timeZone: "Asia/Ho_Chi_Minh",
      tzShort: "ICT (UTC+07:00)",
      shortCode: "ICT",
      operatingArea: "Vietnam",
      country: "Vietnam"
    };
  }

  function formatDate(value, withTime = true) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    const tz = regionTimezoneInfo();
    const locale = getPreferences()?.language === "vi" ? "vi-VN" : "en-GB";
    try {
      const formatted = new Intl.DateTimeFormat(locale, {
        timeZone: tz.timeZone,
        day: "2-digit",
        month: "short",
        year: "numeric",
        ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {})
      }).format(date);
      return withTime ? `${formatted} ${tz.shortCode}` : formatted;
    } catch (_) {
      return new Intl.DateTimeFormat(locale, {
        day: "2-digit",
        month: "short",
        year: "numeric",
        ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {})
      }).format(date);
    }
  }

  function formatRegionClock(date = new Date()) {
    const tz = regionTimezoneInfo();
    const locale = getPreferences()?.language === "vi" ? "vi-VN" : "en-GB";
    try {
      const timeStr = new Intl.DateTimeFormat(locale, {
        timeZone: tz.timeZone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      }).format(date);
      const dateStr = new Intl.DateTimeFormat(locale, {
        timeZone: tz.timeZone,
        day: "2-digit",
        month: "short",
        year: "numeric"
      }).format(date);
      return `${dateStr} · ${timeStr} ${tz.tzShort}`;
    } catch (_) {
      return `${date.toLocaleTimeString(locale)} ${tz.tzShort}`;
    }
  }

  function formatDuration(milliseconds) {
    const total = Math.max(0, Math.floor(milliseconds / 1000));
    const pad = (number) => String(number).padStart(2, "0");
    return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
  }

  function statusTone(status) {
    if (["Resolved", "Completed", "Uploaded", "Available", "Accepted"].includes(status)) return "success";
    if (["Not Reviewed", "Pending Verification", "Unverified", "Unclassified", "Partial — Action Required"].includes(status)) return "warning";
    if (["Failed", "Offline"].includes(status)) return "danger";
    if (["In Progress", "Team Matched", "Sent", "New Assignment", "Result Submitted", "Matching Team"].includes(status)) return "info";
    return "neutral";
  }

  function badge(status, tone) {
    return `<span class="badge ${tone || statusTone(status)}"><span class="status-dot"></span>${escape(status)}</span>`;
  }

  function typeLabel(type) {
    const rawType = type || "Unclassified";
    const localizedType = getPreferences()?.language === "vi"
      ? ({
          Flood: "Ngập lụt / Triều cường",
          Fire: "Hỏa hoạn / Cháy nổ",
          "Building Collapse": "Sập công trình / Đổ sập",
          "Traffic Accident": "Tai nạn giao thông / Đường thủy",
          "Emergency Medical": "Cấp cứu y tế khẩn cấp",
          Normal: "Bình thường / Không có sự cố",
          Unclassified: "Chưa phân loại"
        })[rawType] || rawType
      : rawType;
    return `${icons[rawType] || "•"} ${escape(localizedType)}`;
  }

  function severity(score) {
    const number = Number(score);
    return `<span class="severity ${number >= 85 ? "high" : ""}">${number.toFixed(1)}<small>/100</small></span>`;
  }

  function ensureRegions() {
    if (!document.querySelector(".toast-region")) {
      document.body.insertAdjacentHTML("beforeend", '<div class="toast-region" aria-live="polite" aria-atomic="true"></div>');
    }
  }

  function toast(message, tone = "") {
    ensureRegions();
    try {
      const prefs = getPreferences();
      if (prefs?.language === "vi" && VI_DICTIONARY[message]) {
        message = VI_DICTIONARY[message];
      }
    } catch (_) {}
    const node = document.createElement("div");
    node.className = `toast ${tone}`;
    node.textContent = message;
    document.querySelector(".toast-region").appendChild(node);
    setTimeout(() => node.remove(), 2800);
  }

  function closeModal() {
    document.querySelector(".modal-backdrop")?.remove();
  }

  function modal({ title, subtitle = "", content = "", wide = false, actions = "" }) {
    closeModal();
    const prefs = getPreferences();
    if (prefs?.language === "vi") {
      if (VI_DICTIONARY[title]) title = VI_DICTIONARY[title];
      if (VI_DICTIONARY[subtitle]) subtitle = VI_DICTIONARY[subtitle];
    }
    const root = document.createElement("div");
    root.className = "modal-backdrop";
    root.innerHTML = `<div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${escape(title)}">
      <div class="modal-head"><div><h2>${escape(title)}</h2>${subtitle ? `<p class="muted">${escape(subtitle)}</p>` : ""}</div><button class="btn ghost icon" data-close-modal aria-label="Close">&times;</button></div>
      <div class="modal-body">${content}</div>${actions ? `<div class="row" style="justify-content:flex-end;margin-top:18px">${actions}</div>` : ""}
    </div>`;
    document.body.appendChild(root);
    if (prefs?.language === "vi") {
      setTimeout(() => applyLanguage("vi", root), 0);
    }
    root.addEventListener("click", (event) => {
      if (event.target === root || event.target.closest("[data-close-modal]")) closeModal();
    });
    root.querySelector("button, input, select, textarea")?.focus();
    return root;
  }

  function confirm({ title, message, confirmLabel = "Confirm", tone = "", onConfirm }) {
    const root = modal({
      title,
      content: `<p>${escape(message)}</p>`,
      actions: `<button class="btn ghost" data-close-modal>Cancel</button><button class="btn ${tone}" data-confirm>${escape(confirmLabel)}</button>`
    });
    root.querySelector("[data-confirm]").addEventListener("click", () => {
      closeModal();
      onConfirm();
    });
  }

  function empty(icon, title, text, action = "") {
    return `<div class="empty-state"><span class="empty-icon">${icon}</span><h3>${escape(title)}</h3><p>${escape(text)}</p>${action}</div>`;
  }

  function demoControls(compact = false) {
    const isVi = (getPreferences().language || "en") === "vi";
    return `<div class="demo-controls">
      ${compact ? "" : `<span class="eyebrow">${isVi ? "K\u1ecbch b\u1ea3n m\u1eabu" : "Demo controls"}</span>`}
      <select id="demo-scenario" aria-label="Select demo scenario">
        <option value="baseline">${isVi ? "K\u1ecbch b\u1ea3n Chu\u1ea9n / C\u1ee9u h\u1ed9 Th\u00e0nh c\u00f4ng" : "Baseline / Successful Rescue"}</option>
        <option value="ai-correction">${isVi ? "Hi\u1ec7u Ch\u1ec9nh Ph\u00e2n Lo\u1ea1i AI" : "AI Type Correction"}</option>
        <option value="no-teams">${isVi ? "Kh\u00f4ng C\u00f2n \u0110\u1ed9i S\u1eb5n S\u00e0ng" : "No Available Team"}</option>
        <option value="partial">${isVi ? "Nghi\u1ec7m Thu M\u1ed9t Ph\u1ea7n" : "Partial Completion"}</option>
      </select>
      <button class="btn ghost small" id="apply-scenario">${isVi ? "N\u1ea1p" : "Load"}</button>
      <button class="btn danger small" id="reset-demo">${isVi ? "\u0110\u1eb7t L\u1ea1i D\u1eef Li\u1ec7u G\u1ed1c" : "Reset Demo Data"}</button>
    </div>`;
  }

  function bindDemoControls(onChanged) {
    document.querySelector("#apply-scenario")?.addEventListener("click", () => {
      const name = document.querySelector("#demo-scenario").value;
      SkyRescueStore.applyScenario(name);
      const isVi = (getPreferences().language || "en") === "vi";
      toast(isVi ? "\u0110\u00e3 n\u1ea1p k\u1ecbch b\u1ea3n demo" : "Demo scenario loaded", "success");
      onChanged?.(name);
    });
    document.querySelector("#reset-demo")?.addEventListener("click", () => {
      confirm({
        title: "Reset demo data?",
        message: "All prototype changes, reports, dispatch orders and mission results will return to the deterministic baseline.",
        confirmLabel: "Reset demo",
        tone: "danger",
        onConfirm: () => {
          SkyRescueStore.reset();
          toast("Demo data reset", "success");
          onChanged?.("baseline");
        }
      });
    });
  }

  // =========================================================================
  // AUTHENTICATION & USER PROFILE MANAGEMENT
  // =========================================================================
  function loadUsers() {
    try {
      const parsed = JSON.parse(localStorage.getItem(AUTH_USERS_KEY));
      if (Array.isArray(parsed) && parsed.length) {
        let dirty = false;
        parsed.forEach((u) => {
          const def = DEFAULT_USERS.find((d) => d.id === u.id);
          if (def) {
            // Always sync default credentials, aliases, role and permissions
            if (u.email !== def.email) { u.email = def.email; dirty = true; }
            if (u.password !== def.password) { u.password = def.password; dirty = true; }
            if (JSON.stringify(u.emailAliases) !== JSON.stringify(def.emailAliases)) { u.emailAliases = def.emailAliases; dirty = true; }
            if (JSON.stringify(u.passwordAliases) !== JSON.stringify(def.passwordAliases)) { u.passwordAliases = def.passwordAliases; dirty = true; }
            if (JSON.stringify(u.idAliases) !== JSON.stringify(def.idAliases)) { u.idAliases = def.idAliases; dirty = true; }
            if (u.role !== def.role) { u.role = def.role; dirty = true; }
            if (u.preferredPortal !== def.preferredPortal) { u.preferredPortal = def.preferredPortal; dirty = true; }
            if (def.teamId && u.teamId !== def.teamId) { u.teamId = def.teamId; dirty = true; }
            if (JSON.stringify(u.permissions) !== JSON.stringify(def.permissions)) { u.permissions = def.permissions; dirty = true; }
          }
        });
        DEFAULT_USERS.forEach((def) => {
          if (!parsed.some((u) => u.id === def.id)) {
            parsed.push(JSON.parse(JSON.stringify(def)));
            dirty = true;
          }
        });
        if (dirty) localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(parsed));
        return parsed;
      }
    } catch (_) {}
    localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(DEFAULT_USERS));
    return JSON.parse(JSON.stringify(DEFAULT_USERS));
  }

  function authenticate(identifier, password) {
    if (!identifier || !password) {
      return { success: false, error: "Vui lòng nhập Email / User ID và Mật khẩu." };
    }
    const users = loadUsers();
    const query = String(identifier).trim().toLowerCase();
    const pass = String(password).trim();

    const matched = users.find((u) => {
      const email = String(u.email || "").trim().toLowerCase();
      const id = String(u.id || "").trim().toLowerCase();
      const aliases = Array.isArray(u.emailAliases)
        ? u.emailAliases.map((a) => String(a).trim().toLowerCase())
        : [];
      
      // Match ID, idAliases, email or emailAliases
      const idAliases = Array.isArray(u.idAliases)
        ? u.idAliases.map((a) => String(a).trim().toLowerCase())
        : [];
      if (email === query || id === query || aliases.includes(query) || idAliases.includes(query)) return true;
      // Match username prefix before @
      if (email.split("@")[0] === query) return true;
      for (const a of aliases) {
        if (a.split("@")[0] === query) return true;
      }
      return false;
    });

    if (!matched) {
      return { success: false, error: "Tài khoản không tồn tại: Không tìm thấy '" + query + "'." };
    }

    const validPasswords = [
      matched.password,
      ...(Array.isArray(matched.passwordAliases) ? matched.passwordAliases : [])
    ].filter(Boolean).map((p) => String(p).trim());

    if (!validPasswords.includes(pass)) {
      return { success: false, error: "Mật khẩu không chính xác." };
    }

    setSessionUser(matched.id);
    return { success: true, user: matched };
  }

  function authenticateForPortal(identifier, password, portal) {
    const result = authenticate(identifier, password);
    if (!result.success) return result;
    const expectedPortal = String(portal || "").toLowerCase();
    if (result.user.preferredPortal !== expectedPortal) {
      clearSession();
      return {
        success: false,
        error: expectedPortal === "dispatch"
          ? "Tài khoản này không thuộc cổng Dispatch."
          : "Tài khoản này không thuộc cổng Reporter."
      };
    }
    return result;
  }

  function saveUsers(users) {
    localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(users));
  }

  function defaultUserForPage() {
    const path = location.pathname.toLowerCase();
    if (path.includes("reporter")) return DEFAULT_USERS[1];
    return DEFAULT_USERS[0];
  }

  function currentUser() {
    const users = loadUsers();
    try {
      const raw = sessionStorage.getItem(AUTH_SESSION_KEY);
      if (raw) {
        const session = JSON.parse(raw);
        if (session && session.loggedOut) return null;
        if (session && session.userId) {
          const found = users.find((u) => u.id === session.userId);
          if (found) return found;
        }
      }
    } catch (_) {}
    // No implicit auto-login: each portal must show its own sign-in screen first.
    return null;
  }

  function canOpenDispatch(user = currentUser()) {
    return Boolean(user && user.preferredPortal === "dispatch" && user.permissions?.canAccessDispatch);
  }

  // Access is handled inline by each portal so users see its own login screen.
  function enforcePageAccess() {
    const path = location.pathname.toLowerCase();
    const isDispatch = path.startsWith("/dispatch/");
    const isReporter = path.startsWith("/reporter/");
    if (!isDispatch && !isReporter) return null;
    const user = currentUser();
    const portal = isDispatch ? "dispatch" : "reporter";
    return Boolean(user && user.preferredPortal === portal);
  }

  // The server owns accounts. Keep a local profile copy so the page can show the name and role.
  function ensureUser(serverUser) {
    if (!serverUser?.id) return null;
    const users = loadUsers();
    let user = users.find((u) => u.id === serverUser.id);
    if (!user) {
      const citizen = !serverUser.verified;
      user = {
        id: serverUser.id, idAliases: [serverUser.id], name: serverUser.name, email: "", emailAliases: [],
        phone: serverUser.phone || "", role: serverUser.role, trustTier: serverUser.trustTier || "Unverified Citizen",
        trustScore: citizen ? 30 : 80, verified: Boolean(serverUser.verified), teamId: serverUser.teamId || undefined,
        organization: "SkyRescue account", preferredPortal: serverUser.portal || "reporter", badgeTone: citizen ? "warning" : "success",
        summary: "Server account.",
        permissions: { canAccessDispatch: serverUser.portal === "dispatch", canVerify: false, canDispatch: false, canConfig: false, canFieldOps: false, canReport: true, canDroneTelemetry: false }
      };
      users.push(user);
      saveUsers(users);
    }
    return user;
  }

  function setSessionUser(userId) {
    const users = loadUsers();
    const user = users.find((u) => u.id === userId);
    if (!user) return null;
    sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({ userId: user.id, loggedOut: false, at: new Date().toISOString() }));
    mountHeaderProfile();
    window.dispatchEvent(new CustomEvent("skyrescue:auth:change", { detail: user }));
    return user;
  }

  function clearSession() {
    sessionStorage.removeItem(AUTH_SESSION_KEY);
    mountHeaderProfile();
    window.dispatchEvent(new CustomEvent("skyrescue:auth:change", { detail: null }));
  }

  function logoutUser() {
    window.SkyRescueSync?.logout();
    sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({ userId: null, loggedOut: true, at: new Date().toISOString() }));
    mountHeaderProfile();
    window.dispatchEvent(new CustomEvent("skyrescue:auth:change", { detail: null }));
    toast("Signed out of SkyRescue session.", "success");
  }

  function initialsFor(name) {
    const parts = String(name || "User").trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return String(name || "U").slice(0, 2).toUpperCase();
  }

  function openProfileModal() {
    const user = currentUser();
    if (!user) return openAuthModal("login");
    const tz = regionTimezoneInfo();
    const rootModal = modal({
      title: "Account Profile & Verification Credentials",
      subtitle: `${user.id} · Active Jurisdiction: ${tz.operatingArea} (${tz.tzShort})`,
      content: `<div class="stack">
        <div class="surface" style="display:flex;align-items:center;gap:14px;background:#f8fbff">
          <div class="profile-avatar large">${escape(initialsFor(user.name))}</div>
          <div style="flex:1">
            <div class="row" style="gap:8px">
              <strong style="font-size:17px">${escape(user.name)}</strong>
              <span class="badge ${user.verified ? "success" : "warning"}">${user.verified ? "✓ " + escape(user.trustTier) : "◌ Pending verification"}</span>
            </div>
            <div class="muted" style="font-size:12px;margin-top:3px">${escape(user.role)} · ${escape(user.organization || "SkyRescue Network")}</div>
          </div>
        </div>
        <div class="field-grid">
          <label class="field"><span>Full Name</span><input id="prof-name" value="${escape(user.name)}"></label>
          <label class="field"><span>Email / Login ID</span><input id="prof-email" value="${escape(user.email)}"></label>
          <label class="field"><span>Phone Number</span><input id="prof-phone" value="${escape(user.phone || "")}"></label>
          <label class="field"><span>Operational Role</span><input id="prof-role" readonly value="${escape(user.role)}"></label>
          <label class="field"><span>Source Verification Tier</span><input id="prof-tier" readonly value="${escape(user.trustTier)}"><small class="muted">Role and verification tier cannot be self-promoted in Profile.</small></label>
          <label class="field"><span>Organization / Unit</span><input id="prof-org" value="${escape(user.organization || "")}"></label>
        </div>
      </div>`,
      actions: `<button class="btn ghost" data-close-modal>Cancel</button><button class="btn" id="save-profile-btn">Save Profile</button>`
    });

    rootModal.querySelector("#save-profile-btn")?.addEventListener("click", () => {
      const name = rootModal.querySelector("#prof-name").value.trim();
      const email = rootModal.querySelector("#prof-email").value.trim();
      const phone = rootModal.querySelector("#prof-phone").value.trim();
      const role = rootModal.querySelector("#prof-role").value;
      const trustTier = rootModal.querySelector("#prof-tier").value;
      const organization = rootModal.querySelector("#prof-org").value.trim();
      if (!name || !email) return toast("Full Name and Email are required.", "error");
      const users = loadUsers();
      const target = users.find((u) => u.id === user.id);
      if (target) {
        target.name = name;
        target.email = email;
        target.phone = phone;
        target.role = role;
        target.trustTier = trustTier;
        target.organization = organization;
        saveUsers(users);
      }
      closeModal();
      mountHeaderProfile();
      toast("Profile settings updated.", "success");
    });
  }

  const VI_DICTIONARY = {"SkyRescue": "SkyRescue", "Vietnam": "Việt Nam", "Live upload": "Tải lên trực tiếp", "Seeded sample": "Dữ liệu mẫu (seed)", "Simulated metadata (demo)": "Siêu dữ liệu mô phỏng (demo)", "Decision pipeline": "Chuỗi quyết định", "Needs review": "Cần xem xét", "Reporter Declaration": "Khai báo của người báo tin", "4. What do you see?": "4. Bạn thấy gì?", "Register a Citizen account": "Đăng ký tài khoản Người dân", "Mission accepted. Check in when you arrive on scene.": "Đã tiếp nhận nhiệm vụ. Hãy check-in khi tới hiện trường.", "REPORTER PORTAL": "CỔNG BÁO CÁO", "AEGIS TACTICAL OS": "HỆ ĐIỀU HÀNH TÁC CHIẾN AEGIS", "Dispatch station": "Trạm điều phối tác chiến", "Station online": "Trạm trực tuyến", "Vietnam Command": "Sở Chỉ huy Việt Nam", "Prototype data channel": "Kênh truyền dữ liệu thử nghiệm", "Vietnam Dispatch Station": "Sở Chỉ huy Điều phối Cứu nạn Việt Nam", "Operational console": "Bàn điều hành tác chiến", "Reporter account": "Tài khoản Báo cáo", "Source trust is loaded from the active account": "Độ tin cậy nguồn tin tải từ tài khoản đang hoạt động", "Submit Report": "Gửi Báo Cáo", "My Reports": "Báo Cáo Của Tôi", "Switch role": "Đổi vai trò", "Tactical Map": "Bản Đồ Tác Chiến", "Active Queue": "Hàng Đợi Ca Sự Cố", "Verified / Pending Queues": "Hàng Đợi Ca Sự Cố (Đã duyệt / Chờ)", "Incident Triage": "Thẩm Định Ca AI", "Team Matching": "Điều Phối Đội Cứu Hộ", "Dispatch Approval": "Phê Duyệt Lệnh Xuất Kích", "Field Operations Monitor": "Giám Sát Tác Chiến Thực Địa", "Field Operations & Reports": "Tác Chiến Hiện Trường & Báo Cáo", "Field Operations": "Tác Chiến Hiện Trường", "Rescue Teams": "Đội Cứu Hộ", "Personnel & Fleet": "Lực Lượng & Thiết Bị", "Configuration": "Cấu Hình Hệ Thống", "Engine Configuration": "Cấu Hình Thuật Toán & Quy Tắc", "Reports & Export": "Báo Cáo & Xuất Dữ Liệu", "Incident Dossier": "Hồ Sơ Số Khép Kín", "Incident Dossier & FEMA Audit": "Hồ Sơ Số Sự Cố & Kiểm Toán FEMA", "My Mission (RT1)": "Nhiệm Vụ Của Đội (RT1)", "Field Rescue Report (RT2)": "Báo Cáo Thực Địa (RT2)", "Mission History (RT3)": "Lịch Sử Nhiệm Vụ (RT3)", "RT Mission": "Nhiệm Vụ RT", "RT Field Report": "Báo Cáo RT", "RT History": "Lịch Sử RT", "Command Coordinator": "Chỉ huy Điều phối", "Rescue Team (SAR-01)": "Đội Cứu hộ Tác chiến (SAR-01)", "Field Commander": "Chỉ huy Hiện trường", "UAV Specialist / CTV": "Chuyên viên Trinh sát UAV / CTV", "Public Citizen": "Người dân Cộng đồng", "Verified Command": "Chỉ huy Xác thực", "Verified Responder": "Lực lượng Hiện trường", "Verified Specialist": "Chuyên viên Xác thực", "Unverified Citizen": "Người dân Chưa thẩm định", "Verified (Drone Telemetry)": "Đã thẩm định (Telemetry UAV)", "Verified (Specialist/CTV)": "Đã thẩm định (Chuyên viên/CTV)", "Verified": "Đã Thẩm Định", "Unverified": "Chưa Thẩm Định", "Pending Verification": "Chờ Thẩm Định", "Pending": "Đang chờ", "Rejected": "Từ chối", "Flood": "Ngập lụt / Triều cường", "Building Collapse": "Sập công trình / Đổ sập", "Fire / Wildfire": "Hỏa hoạn / Cháy nổ", "Traffic / Maritime Accident": "Tai nạn giao thông / Đường thủy", "Emergency Medical": "Cấp cứu y tế khẩn cấp", "Normal": "Bình thường / Không có sự cố", "Normal / Non-Hazard": "Bình thường / Không nguy hiểm", "Critical": "Rất nghiêm trọng (Đặc biệt)", "High": "Nghiêm trọng (Cao)", "Moderate": "Trung bình", "Low": "Thấp", "Available": "Sẵn sàng (Available)", "On Mission": "Đang tác chiến (On Mission)", "Assigned": "Đã điều động", "In Progress": "Đang thực hiện", "Enroute": "Đang di chuyển", "Completed": "Đã hoàn thành", "Result Submitted": "Đã nộp báo cáo", "Resolved": "Đã xử lý xong", "Cancelled": "Đã hủy", "Full Resolution": "Hoàn tất 100%", "Partial Rescue": "Cứu nạn một phần", "Evacuated Only": "Chỉ di tản", "Handover to Medical": "Bàn giao y tế 115", "Passed": "Đạt chuẩn", "Failed": "Không đạt", "Unavailable": "Không khả dụng", "GPS available": "Đã có GPS", "GPS required": "Cần có GPS", "No Active Dispatch Missions Assigned": "Hiện Không Có Lệnh Điều Động Mới", "Rescue Unit SAR-01 is currently Available. No new emergencies require immediate dispatch.": "Đội Cứu hộ SAR-01 hiện đang ở trạng thái Sẵn Sàng (Available). Chưa có sự cố mới cần xuất kích khẩn cấp.", "View Completed Mission History": "Xem Lịch Sử Nhiệm Vụ Đã Thực Hiện", "FIELD TACTICAL AXIS · RESCUE TEAM OPERATIONS PORTAL": "TRỤC TÁC CHIẾN THỰC ĐỊA · CỔNG TÁC CHIẾN ĐỘI CỨU HỘ", "Dispatch Order:": "Lệnh Điều Động:", "Linked Incident:": "Sự Cố Liên Kết:", "Assigned Unit:": "Đội Đảm Nhiệm:", "Mission Completed & Closed": "Nhiệm Vụ Đã Hoàn Tất & Nghiệm Thu", "Active On-Scene Operations": "Đang Tác Chiến Tại Hiện Trường", "En Route to Scene": "Đang Di Chuyển Tới Hiện Trường", "Incident Overview & On-Scene Intelligence": "Thông Tin Sự Cố & Trinh Sát Thực Địa", "Operational Sector": "Địa Bàn / Khu Vực Tác Chiến", "Target GPS Coordinates": "Tọa Độ GPS Mục Tiêu", "Urgency Score (AHP / Golden Hour)": "Mức Độ Khẩn Cấp (AHP / Giờ Vàng)", "Detected Victims (AI Recon)": "Nạn Nhân Phát Hiện (AI Trinh Sát)", "Assigned Equipment Inventory:": "Trang Thiết Bị Đội Được Cấp:", "Standard Tactical Field Workflow": "Quy Trình Tác Chiến Hiện Trường Chuẩn", "1. Dispatch Order Issued (MIS)": "1. Nhận Lệnh Điều Động (MIS)", "Command Center assigned unit via AHP / Surge optimization": "Sở Chỉ huy phân bổ đội qua thuật toán AHP / Tối ưu hóa Surge", "2. Transit & Scene Arrival Check-in": "2. Di Chuyển & Check-in Tiếp Cận", "En route to designated incident coordinates": "Đang trên đường di chuyển đến tọa độ sự cố", "Confirmed on-scene arrival and secured perimeter": "Đã xác nhận tiếp cận hiện trường và thiết lập vành đai", "3. Casualty Extraction & Field Report (RT Report)": "3. Giải Cứu Nạn Nhân & Lập Báo Cáo Thực Địa (RT Report)", "Extract victims, photograph proof, report equipment surplus/deficit": "Cứu nạn nhân ra an toàn, chụp ảnh nghiệm thu, báo cáo thừa/thiếu thiết bị", "Tactical Actions": "Hành Động Tác Chiến", "Operational controls for on-scene unit commander:": "Thao tác dành riêng cho Chỉ huy Đội cứu hộ tại thực địa:", "Check-in: Arrived On Scene": "Check-in: Đã Tiếp Cận Hiện Trường", "Checked in on scene. Active rescue operations underway.": "Đã check-in hiện trường an toàn. Đang triển khai phương án cứu nạn.", "Create & Submit Field Report (RT Report) →": "Lập & Gửi Báo Cáo Hiện Trường (RT Report) →", "FIELD RESCUE REPORT · 5-POINT COMPLETION RECORD": "BÁO CÁO NGHIỆM THU CỨU HỘ · HỒ SƠ 5 KHỐI CHUẨN FEMA", "Submit Field Rescue Report:": "Gửi Báo Cáo Nghiệm Thu Hiện Trường:", "Back to Mission": "Quay Lại Nhiệm Vụ", "MISSION PARAMETERS & VERIFICATION AUDIT": "THÔNG SỐ ĐIỀU ĐỘNG & ĐỐI CHIẾU THẨM TRA", "Incident ID:": "Mã Sự Cố:", "Scene Coordinates:": "Tọa Độ Hiện Trường:", "Severity Index:": "Chỉ Số Nghiêm Trọng:", "Expected Victims:": "Số Nạn Nhân Dự Kiến:", "Block 1: On-Scene Evidence Photo (FEMA Photo Verification)": "Khối 1: Ảnh Bằng Chứng Hiện Trường (Xác Thực GPS)", "Upload photographic proof of casualty extraction. EXIF coordinates are automatically audited against dispatch target GPS.": "Tải lên ảnh chụp thực tế quá trình giải cứu. Tọa độ EXIF được tự động đối soát với tâm sự cố được điều động.", "GPS Proximity Verified:": "Đã Xác Thực Khoảng Cách GPS:", "Camera location is within 35m of reported incident coordinates (Acceptable tolerance < 100m).": "Vị trí máy ảnh cách tâm sự cố 35m (Sai số hợp lệ < 100m chuẩn FEMA).", "Take / Upload Scene Completion Photo": "Chụp / Tải Lên Ảnh Nghiệm Thu Hiện Trường", "Load Sample Evidence Photo (Demo)": "Nạp Ảnh Bằng Chứng Mẫu (Demo)", "Block 2: Casualty Extraction Outcomes (Victim Accounting)": "Khối 2: Kết Quả Giải Cứu Nạn Nhân (Đối Soát Thương Vong)", "Rescued victims safely evacuated": "Số nạn nhân đã đưa ra an toàn", "Victims transferred to EMS / Hospital": "Số nạn nhân chuyển viện cấp cứu 115", "Medical notes & triage observations": "Ghi chú y tế & Tình trạng thương vong", "Block 3: Equipment & Logistics Rebalancing (Surge Optimization Feed)": "Khối 3: Cân Bằng Thiết Bị & Hậu Cần (Dữ Liệu Hồi Tiếp ML Surge)", "Real-time equipment surplus and deficit reported here immediately feeds the Command Center's ML Rebalancing engine to restock adjacent surge clusters.": "Dữ liệu thừa/thiếu thiết bị gửi từ hiện trường sẽ kích hoạt động cơ ML Rebalancing tại Sở Chỉ huy để tái điều phối cho các cụm sự cố lân cận.", "[!] Deficit Equipment (Emergency supply requested)": "[!] Thiết bị ĐANG THIẾU (Cần chi viện khẩn cấp)", "[✓] Surplus Equipment (Available for immediate handover / adjacent mission)": "[✓] Thiết bị ĐANG THỪA (Sẵn sàng bàn giao / điều động cho ca khác)", "Block 4: Mission Conclusion & Closure (FEMA ICS-209 Outcome)": "Khối 4: Kết Luận & Nghiệm Thu Nhiệm Vụ (Chuẩn ICS-209)", "Select mission resolution status per Incident Command System criteria:": "Chọn trạng thái kết luận nhiệm vụ theo tiêu chí Hệ thống Chỉ huy Sự cố (ICS):", "Full Resolution — 100% Extraction Complete": "Hoàn Tất 100% — Toàn Bộ Nạn Nhân Đã An Toàn", "All casualties safely rescued and accounted for; scene hazards neutralized. Unit returning to Available status.": "Tất cả nạn nhân đã được giải cứu và bàn giao; hiện trường đã an toàn. Đội chuyển sang trạng thái Sẵn Sàng (Available).", "Partial Rescue — Secondary Reinforcement Needed": "Cứu Nạn Một Phần — Cần Đơn Vị Chi Viện", "Initial casualties extracted, but remaining deep-water or structural pockets require specialized secondary units.": "Đã đưa được một số nạn nhân ra ngoài; các vị trí ngập sâu hoặc sập kẹt hiểm trở cần đội chuyên dụng chi viện.", "Evacuated Only — Civilian Safe Haven Relocation": "Chỉ Di Tản — Đưa Dân Đến Điểm Tránh Nạn Tạm Thời", "Civilians escorted to elevated shelter; structural repairs or flood containment handed over to municipal public works.": "Đã sơ tán người dân lên vùng cao/trường học an toàn; bàn giao công tác công trình cho cơ quan đô thị.", "Handover to Medical — Full Transition to EMS 115": "Bàn Giao Y Tế — Chuyển Giao Toàn Diện Cho Cấp Cứu 115", "Victims successfully transferred to Emergency Medical Services ambulance corps for specialized clinical transport.": "Toàn bộ nạn nhân đã được sơ cứu, ổn định chỉ số sinh tồn và chuyển giao cho lực lượng Cấp cứu 115.", "Field Commander's Operational Debrief & Remarks": "Nhận Xét & Biên Bản Bàn Giao Của Chỉ Huy Hiện Trường", "Block 5: Verification & Submission": "Khối 5: Thẩm Tra & Gửi Nghiệm Thu", "Official dispatch report verification according to FEMA standard protocol:": "Xác nhận biên bản báo cáo thực địa theo quy trình chuẩn FEMA:", "Operational Audit Checklist:": "Danh Mục Kiểm Tra Hồ Sơ Tác Chiến:", "Verified on-scene GPS positioning": "Đã thẩm tra định vị GPS tại hiện trường", "Real-time casualty extraction accounting": "Đã kiểm đếm nạn nhân và số chuyển viện 115", "ML logistics rebalancing telemetry": "Dữ liệu hồi tiếp tái cân bằng thiết bị ML", "ICS-209 formal outcome categorization": "Phân loại kết quả nghiệp vụ theo chuẩn ICS-209", "Submit Official Field Rescue Report": "Gửi Báo Cáo Nghiệm Thu Cứu Hộ Chính Thức", "Save Draft Locally": "Lưu Bản Nháp Tại Máy", "Cancel & Return": "Hủy & Quay Lại", "FIELD RESCUE OPERATIONS HISTORY": "LỊCH SỬ TÁC CHIẾN CỦA ĐỘI CỨU HỘ", "Completed Missions Log:": "Nhật Ký Nhiệm Vụ Đã Hoàn Thành:", "Audit trail of all field deployments, casualty tallies, and FEMA completion reports filed with Command Center.": "Hồ sơ lưu trữ toàn bộ các đợt xuất kích, số liệu cứu nạn và báo cáo nghiệm thu gửi về Sở Chỉ huy.", "Active Mission →": "Nhiệm Vụ Đang Thực Hiện →", "Mission ID (MIS)": "Mã Lệnh (MIS)", "Incident (INC)": "Sự Cố (INC)", "Sector": "Địa Bàn / Quận Huyện", "Status": "Trạng Thái", "Rescued Count": "Số Nạn Nhân Cứu Được", "Outcome": "Kết Quả Nghiệm Thu", "Action": "Thao Tác", "View Report": "Xem Báo Cáo", "Submit Rescue Report": "Gửi Báo Cáo Cứu Hộ", "Choose exactly one source path. Trusted device/account sources auto-verify; citizen reports always require Coordinator verification.": "Chọn một phương thức nạp nguồn tin duy nhất. Nguồn thiết bị/tài khoản tin cậy được tự động xác minh; báo cáo từ người dân luôn cần Quản trị viên xác minh.", "Upload Method": "Phương Thức Nạp Tin", "1. Select report source": "1. Chọn nguồn nạp dữ liệu", "Direct Drone Telemetry Link": "Kết Nối Trực Tiếp Telemetry UAV", "Personal / Ground Upload": "Tải Ảnh Hiện Trường (Cá nhân / Mặt đất)", "Scan registered UAV links": "Quét kết nối UAV đã đăng ký", "Connect fixture": "Kết nối thiết bị", "Connected demo telemetry": "Đã kết nối telemetry UAV", "Disconnect": "Ngắt kết nối", "Real-time AML GPS Lock": "Khóa Định Vị AML GPS Thời Gian Thực", "Get Live GPS": "Lấy GPS Trực Tiếp", "⚡ Simulate In-Region GPS": "⚡ Giả Lập GPS Trong Vùng Tác Chiến", "Choose a Personal / Ground JPEG": "Chọn ảnh JPEG chụp tại hiện trường", "Choose Drone telemetry evidence": "Chọn ảnh trinh sát UAV có telemetry", "Drone upload locked": "Tải ảnh UAV đang khóa (Cần kết nối)", "Original JPEG with capture metadata · max 35 MB": "Ảnh JPEG gốc kèm metadata chụp · tối đa 35 MB", "Connect a registered AEGIS-UAV link first.": "Vui lòng quét và kết nối thiết bị UAV trước.", "2. Upload Image": "2. Tải Lên Ảnh Hiện Trường", "Choose JPEG": "Chọn Ảnh JPEG", "Change": "Đổi ảnh", "Remove": "Xóa ảnh", "Drone-only deterministic test fixtures": "Kịch bản kiểm thử cố định dành cho UAV", "Personal / Ground ML Pre-Filter Scenarios": "Kịch Bản Demo: Tiền Lọc ML Mặt Đất", "Metadata Gate": "Cổng Thẩm Định Metadata", "3. EXIF / GPS / Geofencing": "3. EXIF / GPS / Vùng Địa Lý", "GPS Latitude": "Vĩ độ GPS (Lat)", "GPS Longitude": "Kinh độ GPS (Lng)", "Capture Time": "Thời gian chụp", "District / Sector": "Quận / Khu vực", "Camera": "Máy ảnh", "UAV Serial": "Số Serial UAV", "UAV Altitude": "Độ cao UAV", "GPS Source": "Nguồn định vị GPS", "Group 2 · Pre-Upload Scene & Authenticity Analysis": "Nhóm 2 · Phân Tích Hiện Trường & Xác Thực Ảnh Tự Động (AI/ML)", "4. ML Noise Gate & Automated Scene Tagging": "4. Cổng Lọc Nhiễu ML & Gắn Nhãn Hiện Trường", "Gate 1 · Motion Blur & Smoke Occlusion": "Cổng 1 · Lọc Mờ Nhòe & Khói Che Khuất (Laplacian)", "Gate 2 · Anti-Meme / Social Screenshot Filter": "Cổng 2 · Lọc Ảnh Rác / Ảnh Chụp Màn Hình MXH", "Gate 3 · Real Disaster Evidence vs Normal Scene": "Cổng 3 · Xác Thực Sự Cố Thật vs Cảnh Bình Thường", "Automated Scene Tagging & MIS Resource Preview": "Gắn Nhãn Tự Động & Dự Báo Nhu Cầu Thiết Bị MIS", "Predicted Hazard": "Loại Sự Cố Dự Báo", "Estimated Severity": "Độ Khẩn Cấp Ước Tính", "Trapped Victims & Pose": "Nạn Nhân Mắc Kẹt & Tư Thế (AI)", "Suggested MIS Equipment Demand:": "Đề Xuất Nhu Cầu Thiết Bị MIS:", "Submit Report to Dispatch Queue": "Gửi Báo Cáo Vào Hàng Đợi Sở Chỉ Huy", "My Submitted Reports": "Báo Cáo Của Tôi Đã Gửi", "Review historical submissions, live verification status, and dispatch progress.": "Theo dõi danh sách báo cáo, trạng thái thẩm định và tiến độ điều động cứu hộ.", "All Reports": "Tất Cả Báo Cáo", "Filter by Status": "Lọc theo Trạng thái", "Search reports...": "Tìm kiếm báo cáo...", "Report ID": "Mã Báo Cáo", "Timestamp": "Thời Gian", "Location": "Địa Điểm", "Source Type": "Loại Nguồn Tin", "Verification Status": "Trạng Thái Xác Thực", "Dispatch Status": "Trạng Thái Điều Động", "View Details": "Xem Chi Tiết", "Tactical Operations Picture": "Bức Tranh Toàn Cảnh Tác Chiến", "Real-time geospatial intelligence, spatial clustering, and incident tracking.": "Thông tin trắc địa thời gian thực, phân cụm không gian và theo dõi sự cố.", "Filter by District": "Lọc theo Quận/Huyện", "All Districts": "Tất cả Quận/Huyện", "Filter by Severity": "Lọc theo Mức độ", "All Severities": "Tất cả mức độ", "Filter by Incident Type": "Lọc theo Loại sự cố", "All Hazard Types": "Tất cả loại sự cố", "Active Incidents": "Sự Cố Đang Xử Lý", "Critical Incidents": "Sự Cố Rất Nghiêm Trọng", "Active Teams": "Đội Đang Tác Chiến", "Incident Quick Look": "Xem Nhanh Sự Cố", "Select an incident marker or queue item to view details.": "Chọn một điểm sự cố trên bản đồ hoặc hàng đợi để xem chi tiết.", "Trigger Tactical Surge Simulation": "Kích Hoạt Giả Lập Quá Tải Cứu Nạn (Surge)", "Simulate Overload Surge": "Giả Lập Quá Tải Tác Chiến", "Golden Hour Surge Monitoring": "Giám Sát Giờ Vàng & Quá Tải", "Sort by Urgency": "Sắp xếp theo Độ khẩn cấp", "Sort by Time": "Sắp xếp theo Thời gian", "Time Remaining": "Thời Gian Còn Lại", "Severity Score": "Điểm Nghiêm Trọng", "Detected Victims": "Nạn Nhân Phát Hiện", "Review & Triage": "Thẩm Tra & Phân Loại", "Verify & Triage": "Xác Minh & Thẩm Định", "Instant Assign": "Điều Động Nhanh", "Auto-Matched Team": "Đội Khớp Tự Động", "AI Automated Recon & Triage": "Trinh Sát & Thẩm Định Tự Động Bằng AI", "YOLOv8 Detection Preview": "Kết Quả Nhận Diện YOLOv8", "Victim Accounting & Triage Breakdown": "Kiểm Đếm Nạn Nhân & Phân Loại Tư Thế", "Pose Classification: Non-Upright vs Upright": "Phân Loại Tư Thế: Nằm/Bất Động vs Đứng", "Source Verification & Review": "Xác Minh Nguồn Tin & Duyệt Báo Cáo", "Verification Status": "Trạng Thái Xác Minh", "Hazard Evidence": "Bằng Chứng Mối Nguy", "AHP Multi-Criteria Urgency Score": "Điểm Khẩn Cấp AHP Đa Tiêu Chí", "Override AI Triage": "Ghi Đè Kết Quả AI", "Confirm AI Triage & Proceed to Team Matching →": "Xác Nhận Thẩm Định AI & Chuyển Sang Ghép Đội →", "Back to Queue": "Quay Lại Hàng Đợi", "Reject as Spam / Non-Hazard": "Từ Chối (Tin Rác / Không Có Sự Cố)", "Rescue Unit Allocation & Coalition Matching": "Phân Bổ Lực Lượng & Ghép Liên Đội Cứu Nạn", "AHP Multi-Criteria Team Recommendation": "Đề Xuất Đội Tối Ưu Bằng Thuật Toán AHP", "Distance & ETA": "Khoảng Cách & Thời Gian Tiếp Cận (ETA)", "Equipment Capability Compatibility": "Độ Tương Thích Trang Thiết Bị", "Team Readiness Status": "Trạng Thái Sẵn Sàng Của Đội", "Equipment Balance & Logistics Rebalancing": "Cân Bằng Trang Thiết Bị & Tái Phân Bổ Hậu Cần", "Recommend Team": "Đội Đề Xuất Ưu Tiên", "Assign Unit & Generate Order →": "Điều Động Đội & Lập Lệnh Xuất Kích →", "Form Multi-Agency Coalition": "Thành Lập Liên Đội Nhiều Đơn Vị", "Official Dispatch Order Approval (MIS)": "Phê Duyệt Lệnh Xuất Kích Chính Thức (MIS)", "Mission ID": "Mã Lệnh Điều Động", "Target Location": "Vị Trí Mục Tiêu Hiện Trường", "Urgency Score": "Chỉ Số Khẩn Cấp", "Required Equipment Checklist": "Danh Mục Thiết Bị Bắt Buộc Mang Theo", "Commander Authorization Signature": "Chữ Ký Điện Tử Phê Duyệt Của Chỉ Huy", "Approve & Issue Order": "Phê Duyệt & Phát Lệnh Xuất Kích", "Cancel Dispatch": "Hủy Lệnh Điều Động", "Back to Matching": "Quay Lại Bước Ghép Đội", "Field Tactical Operations Monitor (Command Center)": "Màn Hình Giám Sát Tác Chiến Hiện Trường (Sở Chỉ Huy)", "Read-Only Mission Telemetry": "Dữ Liệu Telemetry Thực Địa (Chỉ Xem)", "Real-time reporting and equipment rebalancing are submitted directly by field rescue units.": "Báo cáo thực địa và số liệu thừa/thiếu thiết bị do các đội cứu nạn gửi trực tiếp từ hiện trường.", "Active Field Deployments": "Đợt Xuất Kích Đang Tác Chiến", "Field Casualties Rescued": "Nạn Nhân Đã Cứu Ra An Toàn", "Medical Transfers (EMS 115)": "Nạn Nhân Đã Chuyển Cấp Cứu 115", "Equipment Rebalancing Log": "Nhật Ký Tái Cân Bằng Thiết Bị", "Reported Deficit Equipment": "Thiết Bị Báo Thiếu (Cần Chi Viện)", "Reported Surplus Equipment": "Thiết Bị Báo Thừa (Có Thể Bàn Giao)", "Mission Outcome": "Kết Quả Nghiệm Thu Nhiệm Vụ", "Emergency Manual Radio Entry (Field Completion Backup)": "Nhập Thủ Công Bằng Bộ Đàm (Dự Phòng Khi Mất Mạng)", "Rescue Teams Readiness": "Độ Sẵn Sàng Của Các Đội Cứu Nạn", "UAV Drone Fleet Status": "Tình Trạng Đội Bay UAV Trinh Sát", "Logistics Depot Inventory": "Tồn Kho Thiết Bị Kho Hậu Cần Trung Tâm", "Team Name": "Tên Đội Cứu Hộ", "Base Location": "Trụ Sở / Trạm Trực", "Assigned Equipment": "Trang Thiết Bị Biên Chế", "Current Mission": "Nhiệm Vụ Hiện Tại", "Unit Status": "Trạng Thái Đội", "AHP Criteria Weights": "Trọng Số Tiêu Chí AHP", "Golden Hour Thresholds (minutes)": "Ngưỡng Giờ Vàng (Phút)", "DBSCAN Clustering Radius (km)": "Bán Kính Gom Cụm DBSCAN (km)", "ML Pre-Filter Laplasian Blur Threshold": "Ngưỡng Lọc Mờ Ảnh Laplacian Pre-Filter", "Save Configuration": "Lưu Cấu Hình", "Reset to Defaults": "Đặt Lại Mặc Định", "Incident Dossier & FEMA ICS-209 Audit Log": "Hồ Sơ Số Khép Kín & Nhật Ký Kiểm Toán FEMA ICS-209", "FEMA Incident Summary (ICS-209)": "Tóm Tắt Báo Cáo Sự Cố Chuẩn FEMA ICS-209", "Standardized Disaster Incident Record": "Hồ Sơ Sự Cố Thảm Họa Chuẩn Hóa", "Audit Trail & Digital Signatures": "Nhật Ký Dấu Vết & Chữ Ký Điện Tử", "Export PDF / JSON Dossier": "Xuất Hồ Sơ PDF / JSON", "Print Official ICS-209 Report": "In Báo Cáo ICS-209 Chính Thức", "Export ICS-209 Dossier": "Xuất Hồ Sơ ICS-209", "Tactical Visual Theme": "Giao Diện Thị Giác Tác Chiến", "Operational Alert Audio": "Âm Thanh Cảnh Báo Tác Chiến", "Play audio chime on Critical / Golden-Hour alerts": "Phát chuông báo động khi có ca Đặc biệt nguy cấp / Giờ vàng", "Telemetry & Sync Rate": "Tần Suất Đồng Bộ Dữ Liệu & Telemetry", "Real-time (5s)": "Thời gian thực (5 giây)", "Balanced (10s)": "Cân bằng tiêu chuẩn (10 giây)", "Conserve bandwidth (30s)": "Tiết kiệm băng thông (30 giây)", "Save Preferences": "Lưu Cài Đặt", "Close": "Đóng", "Cancel": "Hủy", "Edit Profile": "Chỉnh Sửa Hồ Sơ", "Settings": "Cài Đặt Hệ Thống", "Preferences": "Tùy Chọn", "Log Out": "Đăng Xuất", "Sign In": "Đăng nhập", "Register": "Đăng ký", "Email or User ID": "Email hoặc Mã định danh", "Password": "Mật khẩu", "Sign In to SkyRescue →": "Đăng nhập vào SkyRescue →", "Don't have an account?": "Chưa có tài khoản?", "Create an account →": "Tạo tài khoản mới →", "Full Name": "Họ và tên", "Phone Number": "Số điện thoại", "Role / Organization": "Vai trò / Đơn vị công tác", "Create Account & Sign In →": "Tạo tài khoản & Đăng nhập →", "Already have an account? Sign In": "Đã có tài khoản? Đăng nhập", "One operational picture.": "Một bức tranh tác chiến.", "Two unified portals.": "Hai cổng hợp nhất.", "Unified Operational Command & Ground Reconnaissance": "Chỉ huy Tác chiến Hợp nhất & Trắc địa Hiện trường", "Secure Operational Access": "Truy cập Tác chiến Bảo mật", "Operational Credentials & Role-Based Access (RBAC)": "Xác thực Định danh & Phân quyền Tác chiến", "Guest Browsing Mode": "Chế độ Khách xem", "Signed in as:": "Đã đăng nhập:", "Confirm Dispatch": "Xác nhận Điều động", "Accept Mission": "Tiếp nhận Nhiệm vụ", "Save Field Rescue Report": "Lưu Biên bản Hiện trường", "Return to Queue": "Quay lại Hàng đợi", "Operational Portals (Unified)": "Cổng Tác Chiến (Hợp nhất)", "Chief Incident Commander & Lead Dispatcher: Full authority across both portals, AHP/Surge algorithm overrides, system rule configuration, and official FEMA ICS-209 sign-off.": "Tổng Chỉ huy Sự cố & Trưởng kíp Điều phối: Toàn quyền trên cả hai cổng, ghi đè thuật toán AHP/Surge, cấu hình quy tắc hệ thống và ký số nghiệm thu FEMA ICS-209.", "Field Tactical Commander (SAR-01): Receives MIS dispatch orders, on-scene victim extraction, and submits Field Rescue Reports with equipment rebalancing feedback.": "Chỉ huy Tác chiến Thực địa (SAR-01): Nhận lệnh điều động MIS, trực tiếp cứu nạn nhân và gửi Báo cáo Nghiệm thu Hiện trường kèm phản hồi cân bằng thiết bị.", "Aerial Reconnaissance Specialist: Connects directly with AEGIS-UAV telemetry, submits verified geospatial imagery, and initiates high-priority dispatch queues.": "Chuyên viên Trinh sát Trên không: Kết nối trực tiếp telemetry UAV AEGIS, gửi ảnh trắc địa đã thẩm định và kích hoạt hàng đợi điều động ưu tiên.", "Community Citizen Reporter: Crowdsources ground-level emergency photos via mobile AML GPS lock; every citizen report is manually verified by a Coordinator.": "Người dân Báo cáo Cộng đồng: Thu thập ảnh sự cố mặt đất qua định vị GPS AML điện thoại; mọi báo cáo từ người dân đều được Quản trị viên xác minh thủ công.", "Field Rescue Report submitted successfully to Command Center!": "Báo cáo Nghiệm thu Cứu hộ Hiện trường đã được gửi thành công về Sở Chỉ huy!", "Confirmed safe on-scene arrival check-in!": "Đã check-in tiếp cận hiện trường an toàn!", "Draft field report saved locally.": "Đã lưu bản nháp báo cáo thực địa tại trình duyệt.", "Loaded sample verification photo.": "Đã nạp ảnh bằng chứng nghiệm thu mẫu.", "Field evidence photo loaded.": "Đã tải ảnh bằng chứng hiện trường.", "Active dispatch mission not found.": "Không tìm thấy lệnh điều động cần báo cáo.", "The former standalone Rescue Team portal has been unified directly into Dispatch Station and Reporter. Launch a portal below to experience complete multi-role coordination.": "Cổng tác chiến riêng của Đội cứu hộ trước đây đã được hợp nhất trực tiếp vào Trạm Điều Phối và Cổng Báo Cáo. Hãy chọn cổng tác chiến bên dưới để trải nghiệm quy trình phối hợp liên vai trò hoàn chỉnh.", "Portal 01": "Cổng 01", "Portal 02": "Cổng 02", "Reporter Portal": "Cổng Báo Cáo", "Dispatch Station & Field Operations": "Trạm Điều Phối & Tác Chiến Hiện Trường", "Dispatch Station": "Trạm Điều Phối", "Submit incident reports via registered Drone telemetry or Ground Upload with automated blur and GPS validation. Community citizen reports enter the Coordinator review queue.": "Gửi báo cáo sự cố qua liên kết telemetry UAV đã đăng ký hoặc tải ảnh hiện trường mặt đất với công nghệ tự động lọc mờ và thẩm tra GPS. Báo cáo từ người dân được đưa vào hàng đợi Quản trị viên xác minh.", "Complete tactical command center: Verified & Pending queues, multi-criteria team matching, real-time field mission tracking, 5-point field reports, and system configuration.": "Trung tâm chỉ huy tác chiến toàn diện: Hàng đợi ca đã duyệt & chờ thẩm định, ghép đội cứu hộ đa tiêu chí AHP, theo dõi nhiệm vụ hiện trường thời gian thực, nghiệm thu 5 khối FEMA và cấu hình hệ thống.", "Launch Reporter Portal": "Mở Cổng Báo Cáo", "Launch Dispatch Station": "Mở Trạm Điều Phối", "Sign in with your assigned Email/User ID and password to access authorized tactical consoles and verification tools.": "Đăng nhập bằng Email/Mã định danh và mật khẩu được cấp để truy cập các bàn điều hành tác chiến và công cụ thẩm tra được phân quyền.", "Signed in:": "Đã đăng nhập:", "Sign Out": "Đăng xuất", "✓ Signed in:": "✓ Đã đăng nhập:", "Sign In with Credentials": "Đăng nhập bằng Tài khoản", "Shared state ready": "Trạng thái dùng chung sẵn sàng", "Prototype only · UAV link, account credentials, SMS, radio, siren and tactical tracking use local demo data · No backend, physical UAV or ML image-filter service is connected": "Phiên bản mẫu thử nghiệm · Liên kết UAV, tài khoản đăng nhập, tin nhắn SMS, bộ đàm, còi hú và theo dõi tác chiến sử dụng dữ liệu mô phỏng cục bộ · Không kết nối máy chủ backend vật lý hay thiết bị bay thực tế", "AEGIS AI Disaster Coordination System": "Hệ thống Điều phối Cứu nạn Thiên tai AI AEGIS", "Multi-agency emergency rescue coordination and aerial reconnaissance system. Sign in to access the operational consoles.": "Hệ thống trinh sát trên không và điều phối cứu hộ khẩn cấp liên cơ quan. Đăng nhập để truy cập các bàn điều hành tác chiến.", "Email Address": "Địa chỉ Email", "Create a password": "Tạo mật khẩu", "Source Trust Tier": "Cấp Độ Tin Cậy Nguồn Tin", "Public Citizen — Unverified Crowdsource": "Người dân Cộng đồng — Nguồn tin đối chiếu", "Organization / Note (Optional)": "Cơ quan / Đơn vị (Không bắt buộc)", "Already have an account?": "Đã có tài khoản?", "Back to Sign In": "Quay lại Đăng nhập", "AEGIS COORDINATION SYSTEM": "HỆ THỐNG ĐIỀU PHỐI AEGIS", "Demo controls": "Kịch bản mẫu", "Baseline / Successful Rescue": "Kịch bản Chuẩn / Cứu hộ Thành công", "Disaster Surge (25+ Incidents)": "Quá Tải Thảm Họa (25+ Sự Cố)", "⚡ Disaster Surge (25+ Incidents)": "⚡ Quá Tải Thảm Họa (25+ Sự Cố)", "AI Type Correction": "Hiệu Chỉnh Phân Loại AI", "No Available Team": "Không Còn Đội Sẵn Sàng", "Partial Completion": "Nghiệm Thu Một Phần", "Load": "Nạp", "Surge Mode (25+)": "Chế Độ Quá Tải (25+)", "⚡ Surge Mode (25+)": "⚡ Chế Độ Quá Tải (25+)", "Reset Demo Data": "Đặt Lại Dữ Liệu Gốc", "Loading demo dataset…": "Đang tải dữ liệu mẫu…", "Loading demo dataset...": "Đang tải dữ liệu mẫu…", "active incidents": "sự cố đang xử lý", "open missions": "lệnh điều động mở", "DISPATCH STATION": "TRẠM ĐIỀU PHỐI", "✓ Valid Flood Scene": "✓ Cảnh Ngập Lụt Hợp Lệ", "✓ Valid Citizen Flood Scene": "✓ Cảnh Ngập Lụt Hợp Lệ Từ Người Dân", "✓ Major Collapse (7 Victims)": "✓ Sập Công Trình (7 Nạn Nhân)", "✕ Blurry / Smoke Occluded": "✕ Ảnh Mờ / Bị Khói Che", "✕ Meme / Social Screenshot": "✕ Ảnh Rác / Chụp Màn Hình", "✕ Normal Street (No Hazard)": "✕ Đường Phố Bình Thường (Không Sự Cố)", "Account Role": "Vai Trò Tài Khoản", "Public Citizen — Crowdsource Reporter (Ground Hazard Report)": "Người Dân Cộng Đồng (Báo Cáo Sự Cố Mặt Đất)", "Public registration is open for Citizen Reporters. Operational accounts for Rescue Teams and UAV Specialists are provisioned centrally by the Command Coordinator.": "Cổng đăng ký mở dành cho Người Dân. Tài khoản Đội Cứu Hộ và Phi Công UAV do Sở Chỉ Huy (Command Coordinator) cấp quyền tập trung.", "John Doe": "Nguyễn Văn A", "1. Site Access Status": "1. Tình Trạng Tiếp Cận Hiện Trường", "2. Victims Rescued": "2. Số Nạn Nhân Đã Cứu", "3. Equipment Requested": "3. Bổ Sung Thiết Bị Thiếu", "4. Surplus Returned": "4. Trả Lại Thiết Bị Thừa", "1. Site access status": "1. Tình trạng tiếp cận hiện trường", "2. Number of victims rescued": "2. Số nạn nhân đã cứu", "3. Missing equipment requested": "3. Yêu cầu bổ sung thiết bị còn thiếu", "4. Surplus equipment returned": "4. Thông tin trả lại thiết bị thừa", "5. Completion confirmation photo": "5. Ảnh xác nhận hoàn thành", "Patrol Drone (UAV Telemetry)": "Drone Tuần Tra (Telemetry UAV)", "Specialist / Recon CTV (Verified Reporter)": "Chuyên Viên / CTV Trinh Sát (Đã Xác Thực)", "Community Citizen (Crowdsource)": "Người Dân Cộng Đồng (Nguồn Đối Chiếu)", "Tier 1 · Multi-Tier Gatekeeping": "Khối 1 · Cổng Kiểm Soát Đa Cấp", "Target:": "Mục tiêu:", "Reporting Unit:": "Đơn vị Báo cáo:", "FEMA ICS-209 Field Standard": "Chuẩn Thực Địa FEMA ICS-209"};

  // Additional Vietnamese coverage for dynamic operational screens. These keys
  // deliberately contain display text only; application state and rule values stay unchanged.
  Object.assign(VI_DICTIONARY, {
    "Not available": "Không có thông tin",
    "Not found": "Không tìm thấy",
    "Image/UAV metadata": "Siêu dữ liệu ảnh/UAV",
    "Available": "Sẵn sàng",
    "On Mission": "Đang làm nhiệm vụ",
    "Fire": "Hỏa hoạn",
    "Traffic Accident": "Tai nạn giao thông",
    "Unclassified": "Chưa phân loại",
    "Offline": "Ngoại tuyến",
    "Not Reviewed": "Chưa thẩm định",
    "Matching Team": "Đang ghép đội",
    "Team Matched": "Đã ghép đội",
    "New Assignment": "Nhiệm vụ mới",
    "Dispatch Pending": "Chờ điều động",
    "Full Rescue": "Cứu hộ hoàn tất",
    "All": "Tất cả",
    "None": "Không có",
    "Details": "Chi tiết",
    "Open": "Mở",
    "Search": "Tìm kiếm",
    "Clear": "Xóa lọc",
    "Previous": "Trang trước",
    "Next": "Trang sau",
    "Edit": "Chỉnh sửa",
    "Reset": "Đặt lại",
    "Vietnam": "Việt Nam",
    "United States": "Hoa Kỳ",
    "Ho Chi Minh City": "Thành phố Hồ Chí Minh",
    "Binh Thanh District": "Quận Bình Thạnh",
    "District 1": "Quận 1",
    "District 4": "Quận 4",
    "District 7": "Quận 7",
    "Thu Duc City": "Thành phố Thủ Đức",
    "Can Tho": "Cần Thơ",
    "Ha Noi": "Hà Nội",
    "Da Nang": "Đà Nẵng",
    "Vung Tau": "Vũng Tàu",
    "Tay Ninh": "Tây Ninh",
    "Dong Nai": "Đồng Nai",
    "Ho Chi Minh City Command": "Sở Chỉ huy Thành phố Hồ Chí Minh",
    "SkyRescue Metro Command Center": "Trung tâm Chỉ huy Đô thị SkyRescue",
    "Team SAR-01 Rapid Response Unit": "Đội Phản ứng nhanh SAR-01",
    "Binh Thanh Fire & Rescue Unit": "Đội Cứu hỏa và Cứu nạn Bình Thạnh",
    "Saigon Volunteer Rescue Corps": "Đội Cứu hộ Tình nguyện Sài Gòn",
    "SAR-02 High Ground Search": "Đội Tìm kiếm Địa hình cao SAR-02",
    "Saigon Waterway Rescue Unit": "Đội Cứu hộ Đường thủy Sài Gòn",
    "Mobile Field Medical Unit": "Đội Y tế Hiện trường Cơ động",
    "UAV Technical Support Team": "Đội Hỗ trợ Kỹ thuật UAV",
    "Choose an operational portal": "Chọn một cổng tác chiến",
    "Select demo scenario": "Chọn kịch bản mẫu",
    "Account Profile & Role Switcher": "Hồ sơ tài khoản và chuyển vai trò",
    "Reporter navigation": "Điều hướng Cổng Báo cáo",
    "Dispatch navigation": "Điều hướng Trạm Điều phối",
    "e.g. Community relief volunteer": "Ví dụ: Tình nguyện viên cứu trợ cộng đồng",
    "e.g. Community Crowdsource Responder": "Ví dụ: Cộng tác viên cứu hộ cộng đồng",
    "This prototype discovers registered AEGIS-UAV fixtures; it does not claim a physical aircraft is connected.": "Bản mẫu này chỉ tìm các thiết bị AEGIS-UAV đã đăng ký; hệ thống không xác nhận có máy bay thật đang kết nối.",
    "Evidence": "Bằng chứng",
    "Personal Upload never requires a UAV connection.": "Tải ảnh cá nhân không yêu cầu kết nối UAV.",
    "Valid UAV Photo": "Ảnh UAV hợp lệ",
    "No GPS": "Không có GPS",
    "Phone Photo": "Ảnh chụp bằng điện thoại",
    "Old Photo": "Ảnh đã quá hạn",
    "Duplicate Photo": "Ảnh trùng lặp",
    "Ready to scan": "Sẵn sàng quét",
    "Select a photo or test scenario to run Laplacian sharpness analysis.": "Chọn ảnh hoặc kịch bản kiểm thử để phân tích độ sắc nét Laplacian.",
    "Blocks screenshots, memes, and social-media reuploads at the intake gate.": "Chặn ảnh chụp màn hình, ảnh chế và ảnh đăng lại từ mạng xã hội ngay tại cổng tiếp nhận.",
    "Verifies active flood, fire, collapse, or traffic hazard before queueing.": "Xác minh sự cố ngập lụt, hỏa hoạn, sập đổ hoặc tai nạn giao thông trước khi đưa vào hàng đợi.",
    "The ML Noise & Spam Gate filters out 70–80% of blurry, meme, and non-disaster uploads before they reach Dispatch, and auto-tags victim poses & required rescue equipment.": "Cổng lọc nhiễu và tin rác ML loại 70–80% ảnh mờ, ảnh chế và ảnh không có thảm họa trước khi chuyển tới Trạm Điều phối, đồng thời tự động gắn nhãn tư thế nạn nhân và thiết bị cứu hộ cần thiết.",
    "Submission Gate": "Cổng Gửi Báo Cáo",
    "5. Requirements": "5. Điều kiện bắt buộc",
    "Original JPEG image (max 35 MB)": "Ảnh JPEG gốc (tối đa 35 MB)",
    "Registered AEGIS-UAV link is connected (prototype telemetry link)": "Đã kết nối AEGIS-UAV đăng ký (liên kết telemetry mẫu)",
    "Camera make and serial match the connected UAV": "Hãng máy ảnh và số sê-ri khớp với UAV đang kết nối",
    "Telemetry GPS is inside the active operating-area geofence": "GPS telemetry nằm trong vùng địa lý tác chiến",
    "Captured within the last 30 minutes": "Ảnh được chụp trong 30 phút gần nhất",
    "ML Gate 1 — Blur & Smoke Occlusion (waiting)": "Cổng ML 1 — Ảnh mờ và khói che khuất (đang chờ)",
    "ML Gate 2 — Anti-Meme / Screenshot Authenticity (waiting)": "Cổng ML 2 — Xác thực chống ảnh chế / ảnh chụp màn hình (đang chờ)",
    "ML Gate 3 — Real Disaster Scene Evidence (waiting)": "Cổng ML 3 — Bằng chứng hiện trường thảm họa thật (đang chờ)",
    "Photo has not been submitted before (SHA-256 deduplication)": "Ảnh chưa từng được gửi trước đó (khử trùng lặp SHA-256)",
    "Submit Rescue Report →": "Gửi Báo Cáo Cứu Hộ →",
    "Upload Validation": "Kiểm tra dữ liệu tải lên",
    "Upload Rejected": "Nội dung tải lên bị từ chối",
    "The photo was not added to the report verification pipeline.": "Ảnh chưa được đưa vào quy trình xác minh báo cáo.",
    "Rejected Image": "Ảnh bị từ chối",
    "No file selected": "Chưa chọn tệp",
    "No image": "Không có ảnh",
    "An image was not attached to this attempt.": "Lần gửi này chưa đính kèm ảnh.",
    "Detected Error Details": "Chi tiết lỗi phát hiện",
    "Gatekeeping Result": "Kết quả kiểm soát đầu vào",
    "Report Verified": "Báo cáo đã xác minh",
    "This result is based on source credentials, registered device metadata, and the AI review gates.": "Kết quả này dựa trên thông tin xác thực nguồn, metadata thiết bị đã đăng ký và các cổng duyệt AI.",
    "Tier 1 · Source & Identity": "Tầng 1 · Nguồn tin và danh tính",
    "Source identity": "Định danh nguồn tin",
    "Verification basis": "Cơ sở xác minh",
    "Registered AEGIS-UAV demo telemetry source.": "Nguồn telemetry AEGIS-UAV mẫu đã đăng ký.",
    "Telemetry altitude": "Độ cao telemetry",
    "Tier 2 · Metadata & Image Pre-Filter": "Tầng 2 · Metadata và tiền lọc ảnh",
    "Real checks are shown separately from unavailable ML integrations.": "Kết quả kiểm tra thực tế được tách riêng khỏi các tích hợp ML chưa khả dụng.",
    "EXIF capture time": "Thời gian chụp EXIF",
    "GPS lock / geofence": "Khóa GPS / vùng địa lý",
    "Blur": "Độ mờ",
    "Meme / junk detection": "Phát hiện ảnh chế / ảnh rác",
    "Real incident evidence detection": "Phát hiện bằng chứng sự cố thực",
    "Group 2 · 3-Tier AI & Resource Demand Extraction": "Nhóm 2 · AI ba tầng và trích xuất nhu cầu nguồn lực",
    "Automated Scene Tagging & MIS Demand Vector": "Gắn nhãn hiện trường tự động và véc-tơ nhu cầu MIS",
    "Scene Classification (Tier 1)": "Phân loại hiện trường (Tầng 1)",
    "Victim Pose Scan (Tier 2 YOLOv8)": "Quét tư thế nạn nhân (YOLOv8 Tầng 2)",
    "Golden Hour Urgency (Tier 3)": "Mức khẩn cấp Giờ Vàng (Tầng 3)",
    "Suggested MIS Resource & Equipment Vector": "Véc-tơ nguồn lực và thiết bị MIS đề xuất",
    "Tier 3 · Queue Routing": "Tầng 3 · Phân luồng hàng đợi",
    "Trusted-source verification: registered device or verified account.": "Xác minh nguồn tin cậy: thiết bị đã đăng ký hoặc tài khoản đã xác thực.",
    "Verified Queue": "Hàng đợi đã xác minh",
    "Linked incident": "Sự cố liên kết",
    "Matched sources": "Nguồn khớp",
    "Dispatch eligibility": "Điều kiện điều động",
    "Ready for team matching": "Sẵn sàng ghép đội",
    "Latitude": "Vĩ độ",
    "Longitude": "Kinh độ",
    "Open Dispatch Queue →": "Mở Hàng Đợi Điều Phối →",
    "+ Submit Another Report": "+ Gửi Báo Cáo Khác",
    "Personal Report Log & Live Rescue Status": "Nhật ký báo cáo cá nhân và trạng thái cứu hộ trực tiếp",
    "Track real-time verification status, dispatched rescue units, and field rescue outcomes for every submitted report.": "Theo dõi trạng thái xác minh, đơn vị đã điều động và kết quả cứu hộ thực địa của từng báo cáo theo thời gian thực.",
    "+ Submit New Report": "+ Gửi Báo Cáo Mới",
    "Total Upload Attempts": "Tổng số lần tải lên",
    "Uploaded Successfully": "Tải lên thành công",
    "Active Rescue / Dispatched": "Đang cứu hộ / Đã điều động",
    "Resolved & Rescued": "Đã xử lý và cứu hộ",
    "Upload Status": "Trạng thái tải lên",
    "All Uploads": "Tất cả lượt tải",
    "Uploaded": "Đã tải lên",
    "Rescue Status": "Trạng thái cứu hộ",
    "All Rescue States": "Tất cả trạng thái cứu hộ",
    "Pending Review": "Chờ thẩm định",
    "Resolved / Completed": "Đã xử lý / Hoàn thành",
    "Submission Time": "Thời gian gửi",
    "Source": "Nguồn tin",
    "Verification Queue": "Hàng đợi xác minh",
    "Incident & Type": "Sự cố và loại",
    "Rescue Status & Field Progress": "Trạng thái cứu hộ và tiến độ hiện trường",
    "Awaiting Coordinator verification": "Đang chờ điều phối viên xác minh",
    "Upload Failed": "Tải lên thất bại",
    "Completed Missions Log": "Nhật ký nhiệm vụ đã hoàn thành",
    "Tactical Map Overview": "Tổng quan bản đồ tác chiến",
    "Operational Dashboard": "Bảng điều hành tác chiến",
    "Active Emergency Incidents": "Sự cố khẩn cấp đang xử lý",
    "Rescue Force": "Lực lượng cứu hộ",
    "Resolved Incidents": "Sự cố đã xử lý",
    "Time Window:": "Khoảng thời gian:",
    "Time Window": "Khoảng thời gian",
    "Last 24 Hours": "24 giờ qua",
    "Last 7 Days": "7 ngày qua",
    "Last 30 Days": "30 ngày qua",
    "All Time": "Toàn bộ thời gian",
    "All Emergency Types": "Tất cả loại sự cố khẩn cấp",
    "Focus marker": "Định vị điểm đánh dấu",
    "Inspect Incident": "Xem sự cố",
    "Multi-Tier Gatekeeping · Dispatch Queue": "Kiểm soát đa tầng · Hàng đợi điều phối",
    "Verified vs Unverified Dispatch Queues": "Hàng đợi điều phối đã xác minh và chưa xác minh",
    "Active Incidents": "Sự cố đang xử lý",
    "Unverified / Pending Verification": "Chưa xác minh / Chờ xác minh",
    "Local Team Shortage Alert": "Cảnh báo thiếu đội tại địa phương",
    "Group 2 · High-Volume Disaster Surge & ML Resource Optimizer": "Nhóm 2 · Quá tải thảm họa quy mô lớn và tối ưu nguồn lực ML",
    "Spatial Clustering, Golden Hour Triage & ML vs FIFO Optimizer (5 Active Clusters)": "Gom cụm không gian, phân loại Giờ Vàng và tối ưu ML so với FIFO (5 cụm đang hoạt động)",
    "Golden Hour Survival Decay": "Suy giảm khả năng sống sót trong Giờ Vàng",
    "Multi-Team Coalitions": "Liên minh nhiều đội",
    "⚡ Disaster Surge Simulation (25+ Incidents)": "⚡ Mô phỏng quá tải thảm họa (25+ sự cố)",
    "▸ Show Surge Clusters & ML vs FIFO": "▸ Hiện cụm quá tải và so sánh ML với FIFO",
    "📊 ML vs FIFO Benchmark Analysis:": "📊 Phân tích đối chuẩn ML với FIFO:",
    "Academic evaluation and comparison metrics have been relocated to": "Các chỉ số đánh giá học thuật và so sánh đã được chuyển đến",
    "to preserve an unencumbered tactical queue.": "để giữ hàng đợi tác chiến thông thoáng.",
    "✓ Verified Queue": "✓ Hàng đợi đã xác minh",
    "◌ Unverified / Pending Verification": "◌ Chưa xác minh / Chờ xác minh",
    "☰ Table View": "☰ Dạng bảng",
    "⊞ Grid View": "⊞ Dạng lưới",
    "Incident Type": "Loại sự cố",
    "All Incident Types": "Tất cả loại sự cố",
    "All Sectors": "Tất cả địa bàn",
    "Severity Band": "Nhóm mức độ nghiêm trọng",
    "All Severity Bands": "Tất cả mức độ",
    "85–100 Critical": "85–100 Rất nghiêm trọng",
    "70–84.9 High": "70–84,9 Nghiêm trọng",
    "Below 70 Moderate/Low": "Dưới 70 Trung bình/Thấp",
    "All Statuses": "Tất cả trạng thái",
    "Sort By": "Sắp xếp theo",
    "AHP/TOPSIS Priority Score ↓ (Default)": "Điểm ưu tiên AHP/TOPSIS ↓ (Mặc định)",
    "Nearest Distance ↑": "Khoảng cách gần nhất ↑",
    "Newest Timestamp ↓": "Thời gian mới nhất ↓",
    "Detected Victims ↓": "Số nạn nhân phát hiện ↓",
    "READY FOR DISPATCH": "SẴN SÀNG ĐIỀU ĐỘNG",
    "# Rank": "# Hạng",
    "Incident & Time": "Sự cố và thời gian",
    "Sector & GPS": "Địa bàn và GPS",
    "Source & Verification": "Nguồn tin và xác minh",
    "Severity (T2)": "Mức nghiêm trọng (T2)",
    "Distance & Free Teams (T3)": "Khoảng cách và đội sẵn sàng (T3)",
    "AHP Priority Score": "Điểm ưu tiên AHP",
    "Match Team →": "Ghép Đội →",
    "NO DISPATCH WHILE UNVERIFIED": "KHÔNG ĐIỀU ĐỘNG KHI CHƯA XÁC MINH",
    "No incidents in this queue": "Không có sự cố trong hàng đợi này",
    "All incidents in this group have been processed or filtered out.": "Tất cả sự cố trong nhóm này đã được xử lý hoặc lọc ra.",
    "Incident Detail": "Chi tiết sự cố",
    "Incident Detail & Review": "Chi tiết và thẩm định sự cố",
    "Review source verification, linked evidence, detections and operational state.": "Kiểm tra xác minh nguồn tin, bằng chứng liên kết, kết quả phát hiện và trạng thái tác chiến.",
    "Tiers 1–3 · Source Verification": "Tầng 1–3 · Xác minh nguồn tin",
    "Source type": "Loại nguồn tin",
    "Source verification rule": "Quy tắc xác minh nguồn",
    "Matching reports": "Báo cáo khớp",
    "Incident Information": "Thông tin sự cố",
    "Report": "Báo cáo",
    "Original AI Type": "Loại AI ban đầu",
    "AI Confidence": "Độ tin cậy AI",
    "Detected People": "Số người phát hiện",
    "District": "Địa bàn",
    "Incident GPS": "GPS sự cố",
    "Optional Incident Type Review": "Thẩm định tùy chọn loại sự cố",
    "Type correction is separate from source verification and never blocks a report that already satisfies the Markdown verification rule.": "Việc hiệu chỉnh loại sự cố tách biệt với xác minh nguồn tin và không chặn báo cáo đã đáp ứng quy tắc xác minh.",
    "Type After Review": "Loại sau thẩm định",
    "Save Type Review": "Lưu kết quả thẩm định loại",
    "Evidence Viewer": "Trình xem bằng chứng",
    "Select a bounding box or table row to link the same target.": "Chọn khung nhận diện hoặc hàng trong bảng để liên kết cùng một mục tiêu.",
    "SIMULATED DETECTION GPS": "GPS PHÁT HIỆN MÔ PHỎNG",
    "Victim Identification": "Nhận dạng nạn nhân",
    "Coordinates below are explicitly simulated from the demo dataset.": "Các tọa độ bên dưới được mô phỏng rõ ràng từ bộ dữ liệu mẫu.",
    "Target ID": "Mã mục tiêu",
    "Pose": "Tư thế",
    "Detection Confidence": "Độ tin cậy phát hiện",
    "Field Status": "Trạng thái hiện trường",
    "Simulated GPS": "GPS mô phỏng",
    "Field Rescue Team Matching": "Ghép đội cứu hộ hiện trường",
    "Match Rescue Team (Multi-Criteria + Rule Engine + Coalition)": "Ghép đội cứu hộ (Đa tiêu chí + Bộ quy tắc + Liên đội)",
    "Severity": "Mức nghiêm trọng",
    "Group 2 · MIS Resource Demand Vector, Coalition Matching & Equipment Rebalancing": "Nhóm 2 · Véc-tơ nhu cầu nguồn lực MIS, ghép liên đội và tái cân bằng thiết bị",
    "PRIMARY LEAD UNIT": "ĐƠN VỊ CHỦ LỰC",
    "SUPPORT UNIT #1": "ĐƠN VỊ HỖ TRỢ #1",
    "Resource / Specialized Equipment": "Nguồn lực / Thiết bị chuyên dụng",
    "Relevance to Fire": "Mức phù hợp với hỏa hoạn",
    "MIS Demand (Required)": "Nhu cầu MIS (Bắt buộc)",
    "Support Units (TN-SG)": "Đơn vị hỗ trợ (TN-SG)",
    "Assigned to MIS": "Phân bổ cho MIS",
    "Rebalancing Action (Deficit / Surplus Trimming)": "Tác vụ tái cân bằng (Bù thiếu / Cắt phần dư)",
    "Personnel (Rescue Officers)": "Nhân sự (Cứu hộ viên)",
    "Mandatory": "Bắt buộc",
    "Rescue Boats": "Thuyền cứu hộ",
    "0-Weight (Not needed)": "Trọng số 0 (Không cần)",
    "High-Capacity Pumps": "Máy bơm công suất lớn",
    "Hydraulic Cutters & Debris Gear": "Kìm thủy lực và thiết bị xử lý đổ nát",
    "High-Angle Rope Rescue Sets": "Bộ cứu hộ dây góc cao",
    "Required for Fire": "Bắt buộc cho hỏa hoạn",
    "Thermal EO/IR UAVs": "UAV ảnh nhiệt EO/IR",
    "Trauma & Triage Medical Kits": "Bộ y tế chấn thương và phân loại",
    "Evacuation Stretchers": "Cáng sơ tán",
    "Controlled Extensible Custom Tags & Configurable Rules (v2.5.0-controlled)": "Nhãn tùy chỉnh mở rộng có kiểm soát và quy tắc cấu hình (v2.5.0-controlled)",
    "Context Attributes Applied to Team Selection (Post-Ranking Step)": "Thuộc tính ngữ cảnh áp dụng khi chọn đội (Bước sau xếp hạng)",
    "Data Type": "Kiểu dữ liệu",
    "Provider Source": "Nguồn cung cấp",
    "Target Entity": "Đối tượng áp dụng",
    "⚡ Test Narrow Alley (2.0m)": "⚡ Kiểm thử hẻm hẹp (2,0 m)",
    "⚠️ Test Missing Data (road_width_m = null)": "⚠️ Kiểm thử thiếu dữ liệu (road_width_m = null)",
    "🛑 Test Hard-Constraint Deadlock (0 Eligible)": "🛑 Kiểm thử bế tắc ràng buộc cứng (0 đội hợp lệ)",
    "↺ Reset Attributes": "↺ Đặt lại thuộc tính",
    "Target: Report": "Đối tượng: Báo cáo",
    "Boolean": "Luận lý",
    "Number": "Số",
    "Enum": "Liệt kê",
    "Narrow Alley Entrance": "Lối vào hẻm hẹp",
    "Source: Reporter": "Nguồn: Người báo tin",
    "Approach Road Width": "Chiều rộng đường tiếp cận",
    "Estimated Flood Depth": "Độ sâu ngập ước tính",
    "Source: External Sensor": "Nguồn: Cảm biến ngoài",
    "Detected People Count": "Số người phát hiện",
    "Source: AI Model 2": "Nguồn: Mô hình AI 2",
    "Target: Location": "Đối tượng: Địa điểm",
    "Sector Access Terrain": "Địa hình tiếp cận địa bàn",
    "Source: Location GIS": "Nguồn: GIS địa điểm",
    "Population Density Tier": "Cấp mật độ dân số",
    "Waterway Current Speed": "Tốc độ dòng chảy",
    "1. Eligible Rescue Teams (Passed All Hard Constraints)": "1. Đội cứu hộ hợp lệ (Đạt mọi ràng buộc cứng)",
    "Team & Sector": "Đội và địa bàn",
    "Members": "Thành viên",
    "Distance": "Khoảng cách",
    "Soft Rules Δ": "Điều chỉnh quy tắc mềm",
    "Final Match Score": "Điểm ghép đội cuối cùng",
    "Same Sector": "Cùng địa bàn",
    "2. Filtered Out by Hard Constraints (1 Disqualified Unit)": "2. Bị loại bởi ràng buộc cứng (1 đơn vị không đạt)",
    "HARD CONSTRAINT BLOCKED": "BỊ CHẶN BỞI RÀNG BUỘC CỨNG",
    "Team & Area": "Đội và khu vực",
    "RescueTeam Attributes": "Thuộc tính Đội cứu hộ",
    "Hard Constraint Violation Reason": "Lý do vi phạm ràng buộc cứng",
    "Selected Team & Rule Audit": "Đội đã chọn và kiểm toán quy tắc",
    "Team (Eligible)": "Đội (Hợp lệ)",
    "Commander": "Chỉ huy",
    "Vehicle & Clearance": "Phương tiện và bề rộng yêu cầu",
    "Base Multi-Criteria Score": "Điểm đa tiêu chí cơ sở",
    "Soft Constraints Adjustment": "Điều chỉnh ràng buộc mềm",
    "Recorded Rule Engine Justification": "Giải trình bộ quy tắc đã ghi nhận",
    "Confirm Rescue Dispatch": "Xác nhận điều động cứu hộ",
    "The selected team is no longer available.": "Đội đã chọn không còn sẵn sàng.",
    "Team selection expired": "Lựa chọn đội đã hết hiệu lực",
    "Return to Team Matching and select an available team.": "Quay lại bước ghép đội và chọn một đội đang sẵn sàng.",
    "Tactical Force Tracking · Read-Only": "Theo dõi lực lượng tác chiến · Chỉ xem",
    "Field Operations Monitor (Live Mission Status)": "Giám sát tác chiến hiện trường (Trạng thái nhiệm vụ trực tiếp)",
    "Read-Only Command Console:": "Bàn điều hành chỉ xem:",
    "LIVE DISPATCH FEED": "LUỒNG ĐIỀU ĐỘNG TRỰC TIẾP",
    "Total Dispatched Missions": "Tổng nhiệm vụ đã điều động",
    "Active / In Progress": "Đang hoạt động / Đang thực hiện",
    "Completed Missions": "Nhiệm vụ đã hoàn thành",
    "Total Victims Rescued": "Tổng số nạn nhân đã cứu",
    "Select Field Mission to Inspect": "Chọn nhiệm vụ hiện trường để xem",
    "Click any active or completed mission to review tactical deployment and on-scene evidence.": "Chọn nhiệm vụ đang hoạt động hoặc đã hoàn thành để xem điều động tác chiến và bằng chứng hiện trường.",
    "Active Mission Selector (MIS)": "Chọn nhiệm vụ đang hoạt động (MIS)",
    "Target Incident": "Sự cố mục tiêu",
    "Assigned Tactical Force": "Lực lượng tác chiến được phân công",
    "AWAITING FIELD SUBMISSION": "ĐANG CHỜ BÁO CÁO HIỆN TRƯỜNG",
    "None requested": "Không yêu cầu",
    "None returned": "Không có thiết bị trả lại",
    "Inspect Incident in C3 →": "Xem sự cố tại C3 →",
    "📄 View Full FEMA Dossier (C9D) →": "📄 Xem đầy đủ hồ sơ FEMA (C9D) →",
    "🛠️ Emergency Coordinator Manual Entry (Radio Backup Log)": "🛠️ Nhập thủ công khẩn cấp của điều phối viên (Nhật ký bộ đàm dự phòng)",
    "5. Completion Photo Evidence": "5. Ảnh bằng chứng hoàn thành",
    "Tamper-evident photographic proof captured on site.": "Ảnh bằng chứng chống chỉnh sửa được chụp tại hiện trường.",
    "PENDING": "ĐANG CHỜ",
    "No completion photo uploaded yet": "Chưa tải lên ảnh xác nhận hoàn thành",
    "Shared Rescue Force": "Lực lượng cứu hộ dùng chung",
    "+ Add Rescue Team": "+ Thêm Đội Cứu Hộ",
    "Total Teams": "Tổng số đội",
    "Offline / Pending": "Ngoại tuyến / Đang chờ",
    "ID": "Mã",
    "Team": "Đội",
    "Area": "Địa bàn",
    "Personnel": "Nhân sự",
    "Equipment & RescueTeam Custom Tags": "Thiết bị và nhãn tùy chỉnh Đội cứu hộ",
    "Edit Status & Tags": "Sửa trạng thái và nhãn",
    "View / Locked": "Xem / Đã khóa",
    "System Configuration": "Cấu hình hệ thống",
    "Configuration · Tag Normalization & Context Scoring Weights": "Cấu hình · Chuẩn hóa nhãn và trọng số chấm điểm theo ngữ cảnh",
    "Operating Area & Global Regional Dataset": "Khu vực tác chiến và bộ dữ liệu vùng toàn cục",
    "🌐 Vietnam": "🌐 Việt Nam",
    "Ho Chi Minh City Active": "Thành phố Hồ Chí Minh đang hoạt động",
    "Operating Command Zone (State / Province / Metro)": "Vùng chỉ huy tác chiến (Bang / Tỉnh / Đô thị)",
    "Active Dataset": "Bộ dữ liệu đang hoạt động",
    "⚡ Load Regional Dataset (Ho Chi Minh City)": "⚡ Nạp bộ dữ liệu vùng (Thành phố Hồ Chí Minh)",
    "📥 Import JSON Dataset (.json)": "📥 Nhập bộ dữ liệu JSON (.json)",
    "📤 Export Dataset JSON": "📤 Xuất bộ dữ liệu JSON",
    "Country / Sovereign Tier (Tier 0):": "Quốc gia / Cấp chủ quyền (Tầng 0):",
    "Jurisdiction Boundary (Tier 2):": "Ranh giới thẩm quyền (Tầng 2):",
    "Map Center & Regional Clock:": "Tâm bản đồ và đồng hồ khu vực:",
    "Coverage Bounds:": "Giới hạn vùng phủ:",
    "Alert Preview": "Xem trước cảnh báo",
    "Report overload limit": "Giới hạn quá tải báo cáo",
    "Administrative Sectors / Districts (5 Sectors)": "Địa bàn hành chính / Quận huyện (5 địa bàn)",
    "+ Add Sector": "+ Thêm địa bàn",
    "Controlled Extensible Custom Tags Schema": "Lược đồ nhãn tùy chỉnh mở rộng có kiểm soát",
    "+ Register Custom Tag": "+ Đăng ký nhãn tùy chỉnh",
    "Tag Key": "Khóa nhãn",
    "Label & Description": "Nhãn và mô tả",
    "Data Type & Domain": "Kiểu dữ liệu và miền giá trị",
    "Mathematical Normalization & Mapping": "Chuẩn hóa toán học và ánh xạ",
    "AI Model Output?": "Đầu ra mô hình AI?",
    "Reporter": "Người báo tin",
    "Report": "Báo cáo",
    "No (External / Human)": "Không (Nguồn ngoài / Con người)",
    "External Sensor": "Cảm biến ngoài",
    "Location GIS": "GIS địa điểm",
    "Primary Deployment Vehicle": "Phương tiện triển khai chính",
    "Admin": "Quản trị viên",
    "Min Road Clearance Required": "Bề rộng đường tối thiểu yêu cầu",
    "Water Rescue Certified": "Đủ điều kiện cứu hộ dưới nước",
    "Heavy Extrication & Shoring Gear": "Thiết bị phá dỡ nặng và chống đỡ",
    "Post-Ranking Rescue Team Selection Rules": "Quy tắc chọn đội cứu hộ sau xếp hạng",
    "Configurable Rule Engine — Hard & Soft Constraints": "Bộ quy tắc cấu hình — Ràng buộc cứng và mềm",
    "✓ Schema & Conflict Check Passed": "✓ Đã kiểm tra lược đồ và xung đột",
    "+ Add Configurable Rule": "+ Thêm quy tắc cấu hình",
    "Rule Configuration Version": "Phiên bản cấu hình quy tắc",
    "Missing-Attribute Policy (Handling Null/Missing Tags)": "Chính sách thuộc tính thiếu (Xử lý nhãn rỗng/thiếu)",
    "Soft Warning — Convert missing Hard Gate to caution flag (Recommended)": "Cảnh báo mềm — Chuyển cổng cứng bị thiếu thành cờ cảnh báo (Khuyến nghị)",
    "Strict Block — Disqualify team when required tag is missing": "Chặn nghiêm ngặt — Loại đội khi thiếu nhãn bắt buộc",
    "Ignore — Skip rules with missing attributes": "Bỏ qua — Không áp dụng quy tắc có thuộc tính bị thiếu",
    "Conflict Resolution Policy": "Chính sách giải quyết xung đột",
    "Hard Constraints always override Soft Constraints": "Ràng buộc cứng luôn ưu tiên hơn ràng buộc mềm",
    "Hard Constraints (Mandatory Eligibility Gates)": "Ràng buộc cứng (Cổng điều kiện bắt buộc)",
    "Soft Constraints (Base Scoring Modifiers +/- Pts)": "Ràng buộc mềm (Điều chỉnh điểm cơ sở +/- điểm)",
    "Context-Aware Scoring Weights & Conditional Zero-Weight Matrix": "Trọng số theo ngữ cảnh và ma trận trọng số 0 có điều kiện",
    "Incident Type Scoring Matrix (Context Overrides)": "Ma trận chấm điểm theo loại sự cố (Ghi đè ngữ cảnh)",
    "🔄 Reset to Recommended Context Matrix": "🔄 Đặt lại ma trận ngữ cảnh khuyến nghị",
    "Soft Rule / Capability": "Quy tắc mềm / Năng lực",
    "Base Weight": "Trọng số cơ sở",
    "Context Rule Logic": "Logic quy tắc ngữ cảnh",
    "ACTIVE": "ĐANG BẬT",
    "ZERO (0 pts)": "BẰNG 0 (0 điểm)",
    "Standard Context Enabled": "Đã bật ngữ cảnh chuẩn",
    "Mathematical Scoring Integration:": "Tích hợp chấm điểm toán học:",
    "Escalation Rules": "Quy tắc nâng cấp cảnh báo",
    "Notification Channels": "Kênh thông báo",
    "Command center siren": "Còi báo động trung tâm chỉ huy",
    "Simulation only · no external service connected": "Chỉ mô phỏng · không kết nối dịch vụ ngoài",
    "Browser push notifications": "Thông báo đẩy trên trình duyệt",
    "Commander SMS alert": "Cảnh báo SMS cho chỉ huy",
    "Emergency radio (VHF/UHF)": "Bộ đàm khẩn cấp (VHF/UHF)",
    "Severity Threshold by Incident Type": "Ngưỡng mức độ nghiêm trọng theo loại sự cố",
    "Operational Analytics & Digital Dossiers": "Phân tích tác chiến và hồ sơ số",
    "Operational Summary Reports & Digital Evidence Dossiers": "Báo cáo tổng hợp tác chiến và hồ sơ bằng chứng số",
    "Print Preview": "Xem trước bản in",
    "Export CSV": "Xuất CSV",
    "Print PDF Report": "In báo cáo PDF",
    "7 days": "7 ngày",
    "30 days": "30 ngày",
    "Rescue Team": "Đội cứu hộ",
    "Reset Filters": "Đặt lại bộ lọc",
    "Processed / Reported Dossiers": "Hồ sơ đã xử lý / báo cáo",
    "Total Rescued Victims": "Tổng số nạn nhân đã cứu",
    "Avg Operation Duration": "Thời lượng tác chiến trung bình",
    "Group 2 · Academic Benchmark & Research Evaluation": "Nhóm 2 · Đối chuẩn học thuật và đánh giá nghiên cứu",
    "Disaster Surge & ML Resource Optimizer Benchmark Analysis": "Phân tích đối chuẩn quá tải thảm họa và bộ tối ưu nguồn lực ML",
    "AHP + DBSCAN + GOLDEN HOUR": "AHP + DBSCAN + GIỜ VÀNG",
    "⚡ Re-run Surge Sim (25+)": "⚡ Chạy lại mô phỏng quá tải (25+)",
    "⚡ With ML Resource Optimizer (Cluster + Rebalancing)": "⚡ Có bộ tối ưu nguồn lực ML (Gom cụm + Tái cân bằng)",
    "PROPOSED ML PIPELINE": "QUY TRÌNH ML ĐỀ XUẤT",
    "Incidents Resolved / Served": "Sự cố đã xử lý / phục vụ",
    "Avg Golden-Hour Response Time": "Thời gian phản ứng Giờ Vàng trung bình",
    "Specialized Equipment Utilization": "Hiệu suất sử dụng thiết bị chuyên dụng",
    "Multi-Team Coalitions Formed": "Số liên đội được thành lập",
    "Surplus Equipment Trimmed": "Thiết bị dư được cắt giảm",
    "Zero Resource Deadlock:": "Không bế tắc nguồn lực:",
    "📋 Without ML (Manual FIFO Baseline)": "📋 Không có ML (Đường cơ sở FIFO thủ công)",
    "CONVENTIONAL BOTTLENECK": "NÚT THẮT PHƯƠNG PHÁP THÔNG THƯỜNG",
    "Avg Response Time (FIFO Queue)": "Thời gian phản ứng trung bình (Hàng đợi FIFO)",
    "Wasted / Locked Surplus Gear": "Thiết bị dư bị lãng phí / khóa",
    "Equipment Deadlock at #5:": "Bế tắc thiết bị tại vị trí #5:",
    "Mathematical Formulation & Proof:": "Mô hình toán học và chứng minh:",
    "Incident Status Summary · Form FEMA ICS-209 (v3.2) / UN INSARAG Form B-1": "Tổng hợp trạng thái sự cố · Biểu mẫu FEMA ICS-209 (v3.2) / UN INSARAG B-1",
    "1. Incident Name & Agency": "1. Tên sự cố và cơ quan",
    "2. Operational Period": "2. Kỳ tác chiến",
    "3. Incident Commander": "3. Chỉ huy sự cố",
    "Chief Duty Controller": "Trưởng điều hành trực",
    "Mobilized Rescue Forces": "Lực lượng cứu hộ đã huy động",
    "Casualties Extracted (Alive)": "Nạn nhân được đưa ra an toàn",
    "Fatalities / Missing": "Tử vong / Mất tích",
    "Sector / District": "Địa bàn / Quận huyện",
    "Primary Hazard": "Mối nguy chính",
    "Active / Resolved": "Đang xử lý / Đã xử lý",
    "Field Teams Deployed": "Đội hiện trường đã triển khai",
    "Victims Rescued": "Nạn nhân đã cứu",
    "ICS-209 Status": "Trạng thái ICS-209",
    "MONITORED": "ĐANG GIÁM SÁT",
    "Chart 01 · Incident Taxonomy & Severity": "Biểu đồ 01 · Phân loại và mức độ nghiêm trọng sự cố",
    "Incident Type & Victim Distribution": "Loại sự cố và phân bố nạn nhân",
    "Chart 02 · Regional Sector Hotspots": "Biểu đồ 02 · Điểm nóng theo địa bàn",
    "Sector Hotspots & Force Readiness": "Điểm nóng địa bàn và mức sẵn sàng lực lượng",
    "Dispatched / Active Ops": "Đã điều động / Đang tác chiến",
    "Pending Review / Matching": "Chờ thẩm định / Ghép đội",
    "Chart 03 · Rescue Force Utilization & SLA": "Biểu đồ 03 · Sử dụng lực lượng cứu hộ và SLA",
    "Rescue Team Performance & Response Time": "Hiệu suất đội cứu hộ và thời gian phản ứng",
    "Chart 04 · Operational Funnel & AI Audit": "Biểu đồ 04 · Phễu tác chiến và kiểm toán AI",
    "SAR Lifecycle Funnel & AI Accuracy Audit": "Phễu vòng đời SAR và kiểm toán độ chính xác AI",
    "Operational Performance & Coordinator Interventions": "Hiệu suất tác chiến và can thiệp của điều phối viên",
    "Leading Rescue Unit": "Đơn vị cứu hộ dẫn đầu",
    "AI Classification Corrections": "Số lần hiệu chỉnh phân loại AI",
    "Rescue Outcomes": "Kết quả cứu hộ",
    "Incident Case Dossiers & Closed-Loop Evidence": "Hồ sơ sự cố và bằng chứng khép kín",
    "Digital Dossier": "Hồ sơ số",
    "📄 Open Digital Dossier": "📄 Mở hồ sơ số",
    "Coordinator AI Type Corrections (Model Retrain Queue)": "Hiệu chỉnh loại AI của điều phối viên (Hàng đợi huấn luyện lại mô hình)",
    "Verified Type": "Loại đã xác minh",
    "FEMA ICS-201 Digital Dossier": "Hồ sơ số FEMA ICS-201",
    "Incident Briefing & Evidence Dossier (FEMA ICS-201 / UN INSARAG)": "Hồ sơ tóm tắt sự cố và bằng chứng (FEMA ICS-201 / UN INSARAG)",
    "Export Dossier CSV": "Xuất hồ sơ CSV",
    "Print PDF Dossier": "In hồ sơ PDF",
    "1. UAV Reconnaissance": "1. Trinh sát UAV",
    "2. Metadata & Available Pre-Filter": "2. Metadata và tiền lọc khả dụng",
    "3. Source Verification": "3. Xác minh nguồn tin",
    "4. Dispatch Order": "4. Lệnh điều động",
    "Not Sent": "Chưa gửi",
    "5. Field Operation": "5. Tác chiến hiện trường",
    "Awaiting Departure": "Chờ xuất phát",
    "6. Final Sign-off & Closure": "6. Ký xác nhận cuối và đóng hồ sơ",
    "Pending Closure": "Chờ đóng hồ sơ",
    "SECTION 01 · SOURCE EVIDENCE": "MỤC 01 · BẰNG CHỨNG NGUỒN TIN",
    "Reporter Source & Evidence": "Nguồn người báo tin và bằng chứng",
    "Incident ID": "Mã sự cố",
    "Source Report ID": "Mã báo cáo nguồn",
    "Original Image File": "Tệp ảnh gốc",
    "Source Identity": "Định danh nguồn tin",
    "Registered UAV": "UAV đã đăng ký",
    "EXIF Capture Timestamp": "Thời điểm chụp EXIF",
    "Scene GPS Coordinates": "Tọa độ GPS hiện trường",
    "Administrative Sector": "Địa bàn hành chính",
    "SECTION 02 · MULTI-TIER GATEKEEPING": "MỤC 02 · KIỂM SOÁT ĐA TẦNG",
    "Metadata, Pre-Filter & Queue Audit": "Kiểm toán metadata, tiền lọc và hàng đợi",
    "VERIFIED QUEUE": "HÀNG ĐỢI ĐÃ XÁC MINH",
    "Tier 1 · Verification Basis": "Tầng 1 · Cơ sở xác minh",
    "Tier 2 · EXIF Capture Time": "Tầng 2 · Thời gian chụp EXIF",
    "Tier 2 · GPS Lock / Geofence": "Tầng 2 · Khóa GPS / Vùng địa lý",
    "Tier 2 · Blur Check": "Tầng 2 · Kiểm tra độ mờ",
    "Tier 2 · Meme / Junk ML": "Tầng 2 · ML phát hiện ảnh chế / ảnh rác",
    "Tier 2 · Incident Evidence ML": "Tầng 2 · ML phát hiện bằng chứng sự cố",
    "Tier 3 · Code Red Policy": "Tầng 3 · Quy tắc xác minh nguồn",
    "Tier 3 · Queue": "Tầng 3 · Hàng đợi",
    "Matched Reports": "Báo cáo khớp",
    "SECTION 03 · COMMAND REVIEW LOG": "MỤC 03 · NHẬT KÝ THẨM ĐỊNH CHỈ HUY",
    "Coordinator Verification Decision": "Quyết định xác minh của điều phối viên",
    "Duty Coordinator": "Điều phối viên trực",
    "Verification Timestamp": "Thời điểm xác minh",
    "Not verified": "Chưa xác minh",
    "Verified Incident Type": "Loại sự cố đã xác minh",
    "Review / Resolution Notes": "Ghi chú thẩm định / xử lý",
    "Awaiting coordinator inspection.": "Đang chờ điều phối viên kiểm tra.",
    "Incident Status": "Trạng thái sự cố",
    "SECTION 04 · FORCE DISPATCH ORDER": "MỤC 04 · LỆNH ĐIỀU ĐỘNG LỰC LƯỢNG",
    "Dispatch Order & Assigned Rescue Unit": "Lệnh điều động và đơn vị cứu hộ được phân công",
    "Not Dispatched": "Chưa điều động",
    "Dispatch Order ID": "Mã lệnh điều động",
    "Order Issued At": "Thời điểm phát lệnh",
    "Assigned Rescue Unit": "Đơn vị cứu hộ được phân công",
    "Unit Commander": "Chỉ huy đơn vị",
    "Deployed Personnel": "Nhân sự triển khai",
    "Specialized Equipment": "Thiết bị chuyên dụng",
    "Dispatch Distance": "Khoảng cách điều động",
    "Capability Match Score": "Điểm phù hợp năng lực",
    "Rule Config Version": "Phiên bản cấu hình quy tắc",
    "Selection Rule Audit": "Kiểm toán quy tắc lựa chọn",
    "SECTION 05 · FIELD OPERATIONS LOG": "MỤC 05 · NHẬT KÝ TÁC CHIẾN HIỆN TRƯỜNG",
    "Field Operations Log & Individual Victim Tracking": "Nhật ký tác chiến hiện trường và theo dõi từng nạn nhân",
    "AWAITING APPROACH": "ĐANG CHỜ TIẾP CẬN",
    "Field Mission ID": "Mã nhiệm vụ hiện trường",
    "Not Initialized": "Chưa khởi tạo",
    "Field Approach Started At": "Thời điểm bắt đầu tiếp cận",
    "Awaiting team start": "Đang chờ đội bắt đầu",
    "Target Rescue Progress": "Tiến độ cứu hộ mục tiêu",
    "Detected Pose (AI Tier 2)": "Tư thế phát hiện (AI Tầng 2)",
    "UAV GPS Coordinates": "Tọa độ GPS UAV",
    "Triage Priority": "Ưu tiên phân loại",
    "Recorded Evacuation Route": "Tuyến sơ tán đã ghi nhận",
    "• Unreached": "• Chưa tiếp cận",
    "SECTION 06 · MISSION COMPLETION & CLOSURE": "MỤC 06 · HOÀN THÀNH VÀ ĐÓNG NHIỆM VỤ",
    "Mission Completion Report & Dossier Closure": "Báo cáo hoàn thành nhiệm vụ và đóng hồ sơ",
    "Awaiting Field Report": "Đang chờ báo cáo hiện trường",
    "Actual Victims Rescued": "Số nạn nhân thực tế đã cứu",
    "Not yet submitted": "Chưa gửi",
    "Field Departure Time": "Thời gian rời hiện trường",
    "Mission Completion Time": "Thời gian hoàn thành nhiệm vụ",
    "Official Dossier Closed At": "Thời điểm chính thức đóng hồ sơ",
    "Active / Open": "Đang hoạt động / Mở",
    "Closure Verification": "Xác minh đóng hồ sơ",
    "In progress": "Đang thực hiện",
    "Field Report & Handover Notes (From Team Commander):": "Báo cáo hiện trường và ghi chú bàn giao (Từ chỉ huy đội):",
    "Describe access condition…": "Mô tả tình trạng tiếp cận…",
    "Enter needed gear…": "Nhập thiết bị cần bổ sung…",
    "Enter returned gear…": "Nhập thiết bị trả lại…"
  });

  Object.assign(VI_DICTIONARY, {
    "All casualties safely rescued and accounted for; scene hazards neutralized. Unit returning to Available status.": "Tất cả nạn nhân đã được giải cứu và bàn giao; hiện trường đã an toàn. Đội chuyển sang trạng thái sẵn sàng.",
    "Command Center assigned unit via AHP / Surge optimization": "Sở Chỉ huy phân bổ đội bằng AHP / tối ưu quá tải",
    "2. Transit & Scene Arrival Check-in": "2. Di chuyển và xác nhận tiếp cận hiện trường",
    "3. Casualty Extraction & Field Report (RT Report)": "3. Giải cứu nạn nhân và lập báo cáo hiện trường",
    "Real-time equipment surplus and deficit reported here immediately feeds the Command Center's ML Rebalancing engine to restock adjacent surge clusters.": "Dữ liệu thừa/thiếu thiết bị từ hiện trường được chuyển ngay tới bộ máy tái cân bằng ML của Sở Chỉ huy để bổ sung cho các cụm quá tải lân cận.",
    "Group 2 · Pre-Upload Scene & Authenticity Analysis": "Nhóm 2 · Phân tích hiện trường và xác thực ảnh trước khi tải lên",
    "Gate 3 · Real Disaster Evidence vs Normal Scene": "Cổng 3 · Bằng chứng sự cố thật so với cảnh bình thường",
    "0 validation requirements failed. Your selected input is preserved.": "Không có điều kiện kiểm tra nào thất bại. Dữ liệu đã chọn vẫn được giữ nguyên.",
    "critical": "nguy kịch",
    "Survival Est.": "Khả năng sống sót ước tính",
    "Golden Window Peak (<= 20m)": "Đỉnh khung Giờ Vàng (≤ 20 phút)",
    "Officers": "Cứu hộ viên",
    "Trauma & Triage Medical Kits": "Bộ y tế chấn thương và phân loại",
    "Evacuation Stretchers": "Cáng sơ tán",
    "Rescue completed": "Cứu hộ hoàn tất",
    "rescued": "đã cứu",
    "Report ID, INC ID, type, UAV, team or rescue status": "Mã báo cáo, mã sự cố, loại, UAV, đội hoặc trạng thái cứu hộ",
    "Đội Cứu Hộ SAR-01 Rapid Response": "Đội Cứu hộ Phản ứng nhanh SAR-01",
    "High-contrast grayscale tactical map": "Bản đồ tác chiến thang xám tương phản cao",
    "Normal non-emergency reports are excluded from the map.": "Các báo cáo bình thường, không khẩn cấp không được hiển thị trên bản đồ.",
    "Tactical Incident Map": "Bản đồ sự cố tác chiến",
    "Verification comes from trusted Drone/CTV/identified Reporter sources. Citizen reports always require Coordinator verification. Team-priority ordering is applied only after queue assignment.": "Việc xác minh dựa trên nguồn Drone/CTV/Reporter định danh đáng tin cậy. Báo cáo từ người dân luôn cần Quản trị viên xác minh. Thứ tự ưu tiên đội chỉ được áp dụng sau khi báo cáo vào hàng đợi.",
    "Trusted source · ready for team matching": "Nguồn tin đáng tin cậy · sẵn sàng ghép đội",
    "When dozens of reports arrive simultaneously, ML clusters nearby incidents (≤ 550m), ranks by": "Khi hàng chục báo cáo đến đồng thời, ML gom các sự cố lân cận (≤ 550 m) và xếp hạng theo",
    ", trims unneeded heavy gear, and forms": ", cắt thiết bị nặng không cần thiết và thành lập",
    "Reports & Export (C9)": "Báo cáo và Xuất dữ liệu (C9)",
    "Verified by registered Drone telemetry, a verified Specialist/CTV account, or a verified identified Reporter account. Ready for team matching.": "Được xác minh bằng telemetry Drone đã đăng ký, tài khoản Chuyên viên/CTV đã xác minh hoặc tài khoản Reporter định danh đã xác minh. Sẵn sàng ghép đội.",
    "All citizen reports stay here until a Coordinator reviews and verifies them.": "Mọi báo cáo từ người dân ở lại đây cho đến khi Quản trị viên xem xét và xác minh.",
    "Queue view mode": "Chế độ xem hàng đợi",
    "Zoom in": "Phóng to",
    "Zoom out": "Thu nhỏ",
    "A JavaScript library for interactive maps": "Thư viện JavaScript dành cho bản đồ tương tác",
    "Trusted-source auto-verification is separate from citizen review; every citizen report still requires Coordinator approval.": "Tự động xác minh nguồn tin cậy tách biệt với duyệt báo cáo người dân; mọi báo cáo từ người dân vẫn cần Quản trị viên phê duyệt.",
    "UAV EO feed · BBox overlay simulation": "Luồng EO từ UAV · mô phỏng lớp phủ khung nhận diện",
    "targets": "mục tiêu",
    "Hard Constraints filter out ineligible units; Soft Constraints adjust scores; ML Rebalancing trims surplus gear and forms coalitions when a single unit is insufficient.": "Ràng buộc cứng loại các đơn vị không hợp lệ; ràng buộc mềm điều chỉnh điểm; tái cân bằng ML cắt thiết bị dư và lập liên đội khi một đơn vị không đủ năng lực.",
    "Golden Hour Urgency:": "Mức khẩn cấp Giờ Vàng:",
    "Recommended quota:": "Quân số khuyến nghị:",
    "Multi-Team Coalition Proposed:": "Đề xuất liên đội:",
    "Primary Only:": "Chỉ đội chủ lực:",
    "With Coalition:": "Có liên đội:",
    "Joint Coalition Dispatch: ON": "Điều động liên đội: BẬT",
    "Primary (SAR-01)": "Đội chủ lực (SAR-01)",
    "pumps": "máy bơm",
    "sets": "bộ",
    "kits": "bộ",
    "units": "thiết bị",
    "persons": "người",
    "knots": "hải lý/giờ",
    "eligible": "hợp lệ",
    "available": "sẵn sàng",
    "RescueTeam Custom Tags (Source: Admin)": "Nhãn tùy chỉnh Đội cứu hộ (Nguồn: Quản trị viên)",
    "Road Width vs Vehicle Clearance Gate:": "Cổng kiểm tra chiều rộng đường và bề rộng phương tiện:",
    "Narrow Entrance Heavy Truck Restriction:": "Hạn chế xe tải nặng tại lối vào hẹp:",
    "Approach road (2.4m) is narrower than vehicle clearance (3.5m).": "Đường tiếp cận (2,4 m) hẹp hơn bề rộng phương tiện yêu cầu (3,5 m).",
    "Heavy truck cannot enter incident with narrow_entrance = true.": "Xe tải nặng không thể tiếp cận sự cố khi narrow_entrance = true.",
    "Pass HC-01: Road Width vs Vehicle Clearance Gate": "Đạt HC-01: Cổng kiểm tra chiều rộng đường và bề rộng phương tiện",
    "Road width 2.4m ≥ required 2.0m": "Đường rộng 2,4 m ≥ mức yêu cầu 2,0 m",
    "Pass HC-02: Narrow Entrance Heavy Truck Restriction": "Đạt HC-02: Hạn chế xe tải nặng tại lối vào hẹp",
    "Vehicle (rescue_boat) permitted in narrow entrance": "Phương tiện (rescue_boat) được phép vào lối hẹp",
    "Pass HC-03: Deep Flood & Riverine Water Capability Gate": "Đạt HC-03: Cổng năng lực cứu hộ ngập sâu và đường thủy",
    "Water gate satisfied": "Đạt điều kiện cứu hộ dưới nước",
    "Pass HC-04: Critical Structural Collapse Extrication Gate": "Đạt HC-04: Cổng năng lực phá dỡ sự cố sập công trình nghiêm trọng",
    "Extrication gate satisfied": "Đạt điều kiện phá dỡ cứu nạn",
    "External / Human source — not AI output": "Nguồn bên ngoài / Con người — không phải đầu ra AI",
    "Inferred by AI Tier 2": "Do AI Tầng 2 suy luận"
  });

  Object.assign(VI_DICTIONARY, {
    "Real-time command overview of on-scene rescue forces, deployed coalition units, and verified completion reports submitted by field teams.": "Tổng quan chỉ huy theo thời gian thực về lực lượng cứu hộ tại hiện trường, các đơn vị liên đội đã triển khai và báo cáo hoàn thành đã xác minh do đội hiện trường gửi.",
    "Completed": "Đã hoàn thành",
    "Severity": "Mức nghiêm trọng",
    "Lead:": "Chỉ huy:",
    "On-Scene Field Report (Submitted by Responders)": "Báo cáo hiện trường (Do lực lượng cứu hộ gửi)",
    "Save Field Rescue Report on": "Lưu báo cáo cứu hộ hiện trường vào",
    "03 fire engines · thermal kit": "03 xe chữa cháy · bộ thiết bị ảnh nhiệt",
    "rope rescue · drone": "thiết bị cứu hộ dây · drone",
    "03 rescue boats": "03 thuyền cứu hộ",
    "field triage module": "mô-đun phân loại hiện trường",
    "UAV repair module": "mô-đun sửa chữa UAV",
    "Team ID, name or commander": "Mã đội, tên đội hoặc chỉ huy",
    "Switch built-in multi-country regional datasets (Vietnam / United States) or import any custom JSON dataset.": "Chuyển đổi bộ dữ liệu vùng tích hợp của nhiều quốc gia (Việt Nam / Hoa Kỳ) hoặc nhập bộ dữ liệu JSON tùy chỉnh.",
    "Metro Command Zone (5 Sub-Sectors)": "Vùng chỉ huy đô thị (5 địa bàn trực thuộc)",
    "Registered Custom Tags & Mathematical Normalization (11 Attributes)": "Nhãn tùy chỉnh đã đăng ký và chuẩn hóa toán học (11 thuộc tính)",
    "Each Custom Tag explicitly defines its": "Mỗi nhãn tùy chỉnh xác định rõ",
    "Mathematical Normalization Scale [0.0..1.0]": "Thang chuẩn hóa toán học [0,0..1,0]",
    "Attributes are never assumed by default to be AI outputs.": "Mặc định không thuộc tính nào được coi là đầu ra AI.",
    "Indicates whether the incident scene is inside a narrow alley or restricted corridor.": "Cho biết hiện trường sự cố nằm trong hẻm hẹp hoặc lối đi hạn chế hay không.",
    "Measured or reported width of the access road in meters (not inferred by UAV AI).": "Chiều rộng đường tiếp cận tính bằng mét, do đo hoặc báo cáo (không do AI UAV suy luận).",
    "Flood water depth from hydrological gauge or field reporter.": "Độ sâu nước ngập từ thước thủy văn hoặc người báo tin hiện trường.",
    "Number of victims detected by Tier 2 YOLO human/pose model.": "Số nạn nhân do mô hình YOLO phát hiện người/tư thế Tầng 2 nhận diện.",
    "AI Model 2": "Mô hình AI 2",
    "Yes (Tier 2 AI)": "Có (AI Tầng 2)",
    "Primary geographic terrain classification of the administrative sector.": "Phân loại địa hình chính của địa bàn hành chính.",
    "Label Factor Scale [0..1]:": "Thang hệ số nhãn [0..1]:",
    "Census-based population density tier maintained by GIS administrators.": "Cấp mật độ dân số dựa trên điều tra dân số, do quản trị viên GIS duy trì.",
    "Tidal or river current speed measured by hydrological station sensors.": "Tốc độ dòng triều hoặc dòng sông do cảm biến trạm thủy văn đo.",
    "Primary response vehicle class updated by fleet administrators.": "Loại phương tiện ứng cứu chính do quản trị viên đội xe cập nhật.",
    "Minimum road width in meters required for the unit's primary vehicle to pass.": "Chiều rộng đường tối thiểu tính bằng mét để phương tiện chính của đơn vị đi qua.",
    "Indicates whether the rescue team is equipped and certified for deep-water operations.": "Cho biết đội cứu hộ có thiết bị và chứng nhận tác chiến vùng nước sâu hay không.",
    "Hydraulic cutters, airbags, and structural shoring equipment for building collapse.": "Kìm cắt thủy lực, túi khí và thiết bị chống đỡ kết cấu dùng cho sự cố sập công trình.",
    "Applied during Rescue Team Matching without modifying the core Tier 3 AHP/TOPSIS incident ranking algorithm.": "Được áp dụng khi ghép đội cứu hộ mà không thay đổi thuật toán xếp hạng sự cố AHP/TOPSIS Tầng 3 cốt lõi.",
    "Version:": "Phiên bản:",
    "Teams failing any active Hard Constraint are filtered out of automatic proposal.": "Các đội không đạt bất kỳ ràng buộc cứng đang bật nào sẽ bị loại khỏi đề xuất tự động.",
    "Tags:": "Nhãn:",
    "Deep Flood & Riverine Water Capability Gate": "Cổng năng lực cứu hộ ngập sâu và đường thủy",
    "Critical Structural Collapse Extrication Gate": "Cổng năng lực phá dỡ sự cố sập công trình nghiêm trọng",
    "Adjusts Match Score among eligible teams that passed all Hard Constraints.": "Điều chỉnh điểm ghép giữa các đội hợp lệ đã đạt mọi ràng buộc cứng.",
    "Agile Vehicle Bonus for Narrow Alley": "Điểm thưởng phương tiện linh hoạt trong hẻm hẹp",
    "Base Weight:": "Trọng số cơ sở:",
    "High-Power Rescue Boat for Strong Current": "Thuyền cứu hộ công suất lớn cho dòng chảy mạnh",
    "Ultra-Dense Sector Local Unit Priority": "Ưu tiên đơn vị địa phương tại khu vực mật độ cực cao",
    "Missing Access Width Caution Penalty": "Điểm trừ cảnh báo thiếu chiều rộng đường tiếp cận",
    "Define tailored scoring points per incident type. Equipment/tags incompatible with an incident are automatically or manually set to": "Xác định điểm riêng theo từng loại sự cố. Thiết bị/nhãn không phù hợp với sự cố được tự động hoặc thủ công đặt thành",
    "to prevent invalid bonus scoring.": "để ngăn cộng điểm không hợp lệ.",
    "Active for Fire/Collapse/Flood;": "Áp dụng cho Hỏa hoạn/Sập công trình/Ngập lụt;",
    "Zero for Traffic": "Bằng 0 cho Tai nạn giao thông",
    "Active for Flood;": "Áp dụng cho Ngập lụt;",
    "Zero for non-water": "Bằng 0 cho sự cố không liên quan đến nước",
    "Active for Collapse & Accident;": "Áp dụng cho Sập công trình và Tai nạn;",
    "Zero for Flood/Fire": "Bằng 0 cho Ngập lụt/Hỏa hoạn",
    "Total Match Score = Base Score + Σ ( ContextWeight(Rule, Incident.Type) × NormalizedValue )": "Tổng điểm ghép = Điểm cơ sở + Σ ( Trọng số ngữ cảnh(Quy tắc, Loại sự cố) × Giá trị chuẩn hóa )",
    "ContextWeight = 0": "Trọng số ngữ cảnh = 0",
    "the capability is deactivated for that incident type, eliminating artificial score inflation.": "năng lực này bị vô hiệu hóa cho loại sự cố đó, loại bỏ việc tăng điểm giả tạo.",
    "DEFCON 1 alert (>15 simultaneous severe incidents)": "Cảnh báo DEFCON 1 (>15 sự cố nghiêm trọng đồng thời)",
    "Auto-push severe incidents to Priority Queue": "Tự động đưa sự cố nghiêm trọng vào Hàng đợi Ưu tiên",
    "Minimum Severity Score for Level 1 alert. No new scoring formula is applied.": "Điểm mức độ nghiêm trọng tối thiểu cho cảnh báo Cấp 1. Không áp dụng công thức chấm điểm mới.",
    "Time Range": "Khoảng thời gian",
    "Estimated Victims Rescued": "Số nạn nhân ước tính đã cứu",
    "units retained at station pool": "thiết bị được giữ lại tại kho trạm",
    "Isolated team dispatch": "Điều động đội đơn lẻ",
    "Spatial clustering via DBSCAN": "Gom cụm không gian bằng DBSCAN",
    "radius ≤ 550m": "bán kính ≤ 550 m",
    "FEDERAL EMERGENCY MANAGEMENT AGENCY (FEMA) · NATIONAL INCIDENT MANAGEMENT SYSTEM (NIMS)": "CƠ QUAN QUẢN LÝ KHẨN CẤP LIÊN BANG (FEMA) · HỆ THỐNG QUẢN LÝ SỰ CỐ QUỐC GIA (NIMS)",
    "FORM ICS-209 APPROVED": "BIỂU MẪU ICS-209 ĐÃ PHÊ DUYỆT",
    "OMB CONTROL NO. 1660-0076": "MÃ KIỂM SOÁT OMB 1660-0076",
    "Ho Chi Minh City Multi-Hazard Monsoon Response": "Ứng phó đa hiểm họa mùa mưa tại Thành phố Hồ Chí Minh",
    "SkyRescue Metro Tactical Command": "Bộ Chỉ huy Tác chiến Đô thị SkyRescue",
    "07:00 – 19:00 Tactical Shift": "Ca tác chiến 07:00 – 19:00",
    "Total Incidents Logged": "Tổng số sự cố đã ghi nhận",
    "Units": "Đơn vị",
    "operating on scene": "đang tác chiến tại hiện trường",
    "verified field outcomes": "kết quả hiện trường đã xác minh",
    "Golden Hour protocol preserved": "Đã bảo đảm quy trình Giờ Vàng",
    "CERTIFICATION & APPROVAL OF INCIDENT COMMANDER (ICS-209 SECTION 42):": "XÁC NHẬN VÀ PHÊ DUYỆT CỦA CHỈ HUY SỰ CỐ (MỤC 42 ICS-209):",
    "I certify that the above information is complete, accurate, and reflects the current operational picture of this shift.": "Tôi xác nhận thông tin trên đầy đủ, chính xác và phản ánh tình hình tác chiến hiện tại của ca trực.",
    "Incident Commander Signature Seal": "Dấu chữ ký Chỉ huy Sự cố",
    "✓ CERTIFIED & TRANSMITTED": "✓ ĐÃ XÁC NHẬN VÀ GỬI",
    "Incident type donut chart": "Biểu đồ vành khuyên loại sự cố",
    "Rescued (4)": "Đã cứu (4)",
    "Rescued (3)": "Đã cứu (3)",
    "Rescued (1)": "Đã cứu (1)",
    "Rescued (0)": "Đã cứu (0)",
    "1. UAV Intake & 3-Tier AI Inference": "1. Tiếp nhận UAV và suy luận AI ba tầng",
    "2. Coordinator Verification": "2. Điều phối viên xác minh",
    "3. Force Dispatch & Field Operation": "3. Điều động lực lượng và tác chiến hiện trường",
    "4. Rescue Finalized & Dossier Closed (Resolved)": "4. Hoàn tất cứu hộ và đóng hồ sơ (Đã xử lý)",
    "Tier 1 AI Classification vs Coordinator Review (Domain Shift Monitor)": "Phân loại AI Tầng 1 so với thẩm định của điều phối viên (Giám sát dịch chuyển miền)",
    "DSS AUDIT LOG": "NHẬT KÝ KIỂM TOÁN DSS",
    "Coordinator overrode AI label (Logged for Model Retrain)": "Điều phối viên ghi đè nhãn AI (Đã ghi nhận để huấn luyện lại mô hình)",
    "Partial Completion (follow-up required)": "Hoàn thành một phần (cần theo dõi tiếp)",
    "dossiers": "hồ sơ",
    "AHP Score": "Điểm AHP",
    "FEDERAL EMERGENCY MANAGEMENT AGENCY": "CƠ QUAN QUẢN LÝ KHẨN CẤP LIÊN BANG",
    "UNITED STATES NATIONAL INCIDENT MANAGEMENT SYSTEM (NIMS) / FEMA GUIDELINES": "HỆ THỐNG QUẢN LÝ SỰ CỐ QUỐC GIA HOA KỲ (NIMS) / HƯỚNG DẪN FEMA",
    "FORM FEMA ICS-201 · INCIDENT BRIEFING & DIGITAL EVIDENCE CHAIN OF CUSTODY": "BIỂU MẪU FEMA ICS-201 · TÓM TẮT SỰ CỐ VÀ CHUỖI QUẢN LÝ BẰNG CHỨNG SỐ",
    "Document Control ID:": "Mã kiểm soát tài liệu:",
    "Security Classification:": "Phân loại bảo mật:",
    "UNCLASSIFIED / EMERGENCY OPERATIONS": "KHÔNG MẬT / TÁC CHIẾN KHẨN CẤP",
    "FEMA ICS-201 COMPLIANT": "TUÂN THỦ FEMA ICS-201",
    "UN INSARAG VERIFIED": "UN INSARAG ĐÃ XÁC MINH",
    "EXIF/GPS checked · Blur: Unavailable": "Đã kiểm tra EXIF/GPS · Độ mờ: Chưa khả dụng",
    "Drone Telemetry": "Telemetry Drone",
    "Duty Controller": "Điều hành viên trực",
    "Not yet submitted": "Chưa gửi"
  });

  Object.assign(VI_DICTIONARY, {
    "and": "và",
    "Enter password": "Nhập mật khẩu",
    "e.g. ranjith@skyrescue.org or USR-COORD-01": "Ví dụ: ranjith@skyrescue.org hoặc USR-COORD-01",
    "Los Angeles County, CA": "Hạt Los Angeles, California",
    "Grouped by administrative sector, resolution progress, and local free teams.": "Được nhóm theo địa bàn hành chính, tiến độ xử lý và số đội địa phương sẵn sàng.",
    "Deficit & surplus rebalancing unassigns 0-weight gear (e.g. leaving heavy debris shears at base during floods) to prevent inventory exhaustion.": "Tái cân bằng thừa/thiếu thu hồi thiết bị có trọng số 0 (ví dụ để kìm cắt đổ nát hạng nặng tại căn cứ khi xảy ra ngập lụt) nhằm tránh cạn kiệt kho.",
    "Audit trail of cases where coordinators corrected the initial AI label, serving as a domain-shift retraining dataset.": "Dấu vết kiểm toán các ca điều phối viên hiệu chỉnh nhãn AI ban đầu, dùng làm bộ dữ liệu huấn luyện lại khi miền dữ liệu thay đổi.",
    "Critical narrow lane": "Làn đường hẹp nghiêm trọng",
    "Standard 1-lane access": "Lối tiếp cận một làn tiêu chuẩn",
    "Multi-lane arterial access": "Lối tiếp cận trục đường nhiều làn",
    "Shallow (<0.5m, passable)": "Nông (<0,5 m, có thể đi qua)",
    "Moderate (wading gear required)": "Trung bình (cần thiết bị lội nước)",
    "Deep/Severe (boat mandatory)": "Sâu/Nghiêm trọng (bắt buộc có thuyền)",
    "Small squad": "Tổ nhỏ",
    "Medium dispatch": "Lực lượng điều động trung bình",
    "Mass casualty protocol": "Quy trình thương vong hàng loạt",
    "Mild current": "Dòng chảy nhẹ",
    "Swift current": "Dòng chảy xiết",
    "Torrential hazard": "Nguy cơ dòng chảy dữ dội",
    "(Boolean, Number, Enum)": "(Luận lý, Số, Liệt kê)",
    ". When": ". Khi",
    "Zoom": "Thu phóng",
    "4/4 active": "4/4 đang bật",
    "5/5 active": "5/5 đang bật"
  });

  // C2 admin-review detail (C9R). Keep these strings in the shared catalog so
  // the screen is translated both on first render and after preference changes.
  Object.assign(VI_DICTIONARY, {
    "UAV Serial Number": "Số Serial UAV",
    "Field reporting workspace": "Không gian báo cáo hiện trường",
    "Dispatch": "Điều phối",
    "Every accepted submission enters the Unverified queue. An Admin must inspect the evidence and confirm the incident data before team matching.": "Mọi báo cáo được tiếp nhận đều vào hàng đợi Chưa xác minh. Quản trị viên phải kiểm tra bằng chứng và xác nhận dữ liệu sự cố trước khi ghép đội.",
    "Verified (Admin Review)": "Đã xác minh (Quản trị viên duyệt)",
    "Verified (Matched Trusted Source)": "Đã xác minh (Khớp nguồn tin cậy)",
    "Verified (Admin Review)": "Đã xác minh (Quản trị viên duyệt)",
    "No Pending Report": "Không Có Báo Cáo Chờ Duyệt",
    "The Unverified review queue is currently clear.": "Hàng đợi báo cáo chưa xác thực hiện đang trống.",
    "All reports reviewed": "Tất cả báo cáo đã được duyệt",
    "There are no Unverified reports waiting for Admin verification.": "Không có báo cáo chưa xác thực nào đang chờ Quản trị viên duyệt.",
    "Report Link Error": "Lỗi Liên Kết Báo Cáo",
    "This report has no linked incident record.": "Báo cáo này không có hồ sơ sự cố được liên kết.",
    "Linked incident not found": "Không tìm thấy sự cố được liên kết",
    "Admin Review Completed": "Đã Hoàn Tất Duyệt Báo Cáo",
    "Review & Verify Report": "Xem Xét & Xác Thực Báo Cáo",
    "The corrected incident data is locked and ready for the next operational step.": "Dữ liệu sự cố đã hiệu chỉnh được khóa và sẵn sàng cho bước tác nghiệp tiếp theo.",
    "Inspect the evidence, correct any model errors, and verify the report before team matching.": "Kiểm tra bằng chứng, hiệu chỉnh lỗi mô hình và xác thực báo cáo trước khi ghép đội cứu hộ.",
    "Evidence Inspection": "Kiểm Tra Bằng Chứng",
    "Submitted Image": "Ảnh Đã Gửi",
    "Reporter & Trust Score": "Người Báo Tin & Điểm Tin Cậy",
    "Citizen": "Người dân",
    "Standard Reporter": "Người Báo Tin Tiêu Chuẩn",
    "Standard": "Tiêu chuẩn",
    "District 2": "Quận 2",
    "District 3": "Quận 3",
    "District 5": "Quận 5",
    "District 6": "Quận 6",
    "District 8": "Quận 8",
    "District 9": "Quận 9",
    "District 10": "Quận 10",
    "District 11": "Quận 11",
    "District 12": "Quận 12",
    "Go Vap District": "Quận Gò Vấp",
    "Phu Nhuan District": "Quận Phú Nhuận",
    "Tan Binh District": "Quận Tân Bình",
    "Tan Phu District": "Quận Tân Phú",
    "Binh Tan District": "Quận Bình Tân",
    "Binh Chanh District": "Huyện Bình Chánh",
    "Hoc Mon District": "Huyện Hóc Môn",
    "Cu Chi District": "Huyện Củ Chi",
    "Nha Be District": "Huyện Nhà Bè",
    "Can Gio District": "Huyện Cần Giờ",
    "Browser Geolocation API": "GPS thật từ trình duyệt/thiết bị",
    "Mobile AML Hardware Lock (Simulated)": "GPS AML mô phỏng (không phải vị trí thật)",
    "⚡ Simulate In-Region GPS": "⚡ GPS Mô Phỏng (Không Phải GPS Thật)",
    "Live GPS lock acquired for this Personal Upload.": "Đã lấy GPS thật từ trình duyệt/thiết bị cho ảnh hiện trường.",
    "Submitted": "Thời Điểm Gửi",
    "Model Output · Read Only": "Kết Quả Mô Hình · Chỉ Đọc",
    "Original Recognition Result": "Kết Quả Nhận Diện Ban Đầu",
    "Preserved for audit and model retraining.": "Được lưu giữ để kiểm toán và huấn luyện lại mô hình.",
    "Victims": "Nạn Nhân",
    "Admin Decision": "Quyết Định Của Quản Trị Viên",
    "Verified Incident Data": "Dữ Liệu Sự Cố Đã Xác Thực",
    "Correct Model Errors": "Hiệu Chỉnh Lỗi Mô Hình",
    "Incident type, severity, and victim count drive downstream team matching.": "Loại sự cố, mức độ nghiêm trọng và số nạn nhân là cơ sở để ghép đội cứu hộ ở bước tiếp theo.",
    "Dispatch Admin": "Quản trị viên Điều phối",
    "Victim Count": "Số Nạn Nhân",
    "Corrections": "Nội Dung Hiệu Chỉnh",
    "Model output confirmed": "Đã xác nhận kết quả mô hình",
    "Admin Notes": "Ghi Chú Của Quản Trị Viên",
    "Verified as Normal": "Đã Xác Thực Là Bình Thường",
    "No rescue-team matching is required.": "Không cần ghép đội cứu hộ.",
    "Close Normal Report": "Đóng Báo Cáo Bình Thường",
    "Team Matching Unlocked": "Đã Mở Khóa Ghép Đội Cứu Hộ",
    "This verified emergency can now be matched with a rescue team.": "Sự cố khẩn cấp đã xác thực này hiện có thể được ghép với một đội cứu hộ.",
    "Unverified reports cannot be matched": "Báo cáo chưa xác thực không thể ghép đội",
    "Verification becomes available only after a concrete incident type or Normal is selected.": "Chỉ có thể xác thực sau khi chọn một loại sự cố cụ thể hoặc trạng thái Bình thường.",
    "Incident Type": "Loại Sự Cố",
    "Number of Victims": "Số Nạn Nhân",
    "Review Notes": "Ghi Chú Duyệt Báo Cáo",
    "Describe corrections or evidence considered…": "Mô tả nội dung hiệu chỉnh hoặc bằng chứng đã xem xét…",
    "Verify is locked": "Chức năng xác thực đang bị khóa",
    "Change Unclassified to Flood, Fire, Building Collapse, Traffic Accident, or Normal.": "Hãy đổi Chưa phân loại thành Ngập lụt, Hỏa hoạn, Sập công trình, Tai nạn giao thông hoặc Bình thường.",
    "Verify Report": "Xác Thực Báo Cáo",
    "Delete Redundant Report": "Xóa Báo Cáo Trùng Lặp",
    "This action records the Admin decision in the audit log and cannot be skipped before Match Team.": "Thao tác này ghi quyết định của Quản trị viên vào nhật ký kiểm toán và bắt buộc phải hoàn tất trước khi ghép đội cứu hộ."
  });

  const COMPOUND_REPLACEMENTS = [[" victims (Non-Upright Priority)"," n\u1ea1n nh\u00e2n (\u01afu ti\u00ean N\u1eb1m/B\u1ea5t \u0111\u1ed9ng)"],[" victims ("," n\u1ea1n nh\u00e2n ("],[" victim ("," n\u1ea1n nh\u00e2n ("],[" victims"," n\u1ea1n nh\u00e2n"],[" victim"," n\u1ea1n nh\u00e2n"],["Non-Upright Priority","\u01afu ti\u00ean N\u1eb1m/B\u1ea5t \u0111\u1ed9ng"],["Non-Upright","N\u1eb1m/B\u1ea5t \u0111\u1ed9ng"],["Upright","\u0110\u1ee9ng/T\u1ec9nh t\u00e1o"],[" min remaining"," ph\u00fat c\u00f2n l\u1ea1i"],[" mins remaining"," ph\u00fat c\u00f2n l\u1ea1i"],[" seconds remaining"," gi\u00e2y c\u00f2n l\u1ea1i"],[" sec remaining"," gi\u00e2y c\u00f2n l\u1ea1i"],["Total Incidents","T\u1ed5ng s\u1ed1 s\u1ef1 c\u1ed1"],["Critical Incidents","S\u1ef1 c\u1ed1 r\u1ea5t nghi\u00eam tr\u1ecdng"],["Active Teams","\u0110\u1ed9i \u0111ang t\u00e1c chi\u1ebfn"],["Estimated Victims","N\u1ea1n nh\u00e2n \u01b0\u1edbc t\u00ednh"],["Severity Score","\u0110i\u1ec3m m\u1ee9c \u0111\u1ed9 nghi\u00eam tr\u1ecdng"],["Urgency Score","Ch\u1ec9 s\u1ed1 kh\u1ea9n c\u1ea5p"],["Time Remaining","Th\u1eddi gian c\u00f2n l\u1ea1i"],["Time Remaining:","Th\u1eddi gian c\u00f2n l\u1ea1i:"],["Search incidents...","T\u00ecm ki\u1ebfm s\u1ef1 c\u1ed1..."],["Search reports...","T\u00ecm ki\u1ebfm b\u00e1o c\u00e1o..."],["Enter password","Nh\u1eadp m\u1eadt kh\u1ea9u"],["Describe victim medical condition...","M\u00f4 t\u1ea3 t\u00ecnh tr\u1ea1ng y t\u1ebf v\u00e0 s\u01a1 c\u1ee9u n\u1ea1n nh\u00e2n..."],["List equipment required urgently...","Nh\u1eadp danh s\u00e1ch thi\u1ebft b\u1ecb c\u1ea7n chi vi\u1ec7n kh\u1ea9n c\u1ea5p..."],["List available surplus equipment...","Nh\u1eadp danh s\u00e1ch thi\u1ebft b\u1ecb \u0111ang th\u1eeba s\u1eb5n s\u00e0ng b\u00e0n giao..."],["Enter debrief notes...","Nh\u1eadp bi\u00ean b\u1ea3n nh\u1eadn x\u00e9t t\u00e1c chi\u1ebfn c\u1ee7a ch\u1ec9 huy..."]];

  COMPOUND_REPLACEMENTS.push(
    ["Public registration is open for ", "Cổng đăng ký dành cho "],
    ["Citizen Reporters", "người dân báo tin"],
    ["Standard Reporter", "Người Báo Tin Tiêu Chuẩn"],
    ["Browser Geolocation API", "GPS thật từ trình duyệt/thiết bị"],
    ["Mobile AML Hardware Lock (Simulated)", "GPS AML mô phỏng (không phải vị trí thật)"],
    ["Operational accounts for ", "Tài khoản nghiệp vụ cho "],
    ["Rescue Teams", "đội cứu hộ"],
    ["UAV Specialists", "chuyên viên UAV"],
    [" are provisioned centrally by the Command Coordinator.", " được Chỉ huy Điều phối cấp tập trung."],
    ["Ho Chi Minh City Dispatch Station", "Trạm Điều phối Thành phố Hồ Chí Minh"],
    ["Operational console ·", "Bàn điều hành tác chiến ·"],
    ["Ho Chi Minh City Command", "Sở Chỉ huy Thành phố Hồ Chí Minh"],
    ["Ho Chi Minh City", "Thành phố Hồ Chí Minh"],
    ["C2 Queue · Admin Review", "Hàng đợi C2 · Duyệt báo cáo"],
    ["Verified by ", "Được xác thực bởi "],
    [" confidence", " độ tin cậy"],
    ["Binh Thanh District", "Quận Bình Thạnh"],
    ["Thu Duc City", "Thành phố Thủ Đức"],
    ["District 1", "Quận 1"],
    ["District 4", "Quận 4"],
    ["District 7", "Quận 7"],
    ["United States", "Hoa Kỳ"],
    ["Vietnam", "Việt Nam"],
    ["Not Reviewed", "Chưa thẩm định"],
    ["Matching Team", "Đang ghép đội"],
    ["Team Matched", "Đã ghép đội"],
    ["Dispatch Pending", "Chờ điều động"],
    ["New Assignment", "Nhiệm vụ mới"],
    ["Pending Review", "Chờ thẩm định"],
    ["Completed Missions Log:", "Nhật ký nhiệm vụ đã hoàn thành:"],
    ["Assigned Unit:", "Đội đảm nhiệm:"],
    ["Team SAR-01 Rapid Response Unit", "Đội Phản ứng nhanh SAR-01"],
    ["Binh Thanh Fire & Rescue Unit", "Đội Cứu hỏa và Cứu nạn Bình Thạnh"],
    ["Saigon Volunteer Rescue Corps", "Đội Cứu hộ Tình nguyện Sài Gòn"],
    ["SAR-02 High Ground Search", "Đội Tìm kiếm Địa hình cao SAR-02"],
    ["Saigon Waterway Rescue Unit", "Đội Cứu hộ Đường thủy Sài Gòn"],
    ["Mobile Field Medical Unit", "Đội Y tế Hiện trường Cơ động"],
    ["UAV Technical Support Team", "Đội Hỗ trợ Kỹ thuật UAV"],
    ["All Uploads", "Tất cả lượt tải"],
    ["All Rescue States", "Tất cả trạng thái cứu hộ"],
    ["all records", "tất cả bản ghi"],
    ["rejected at validation", "bị từ chối khi kiểm tra"],
    ["in dispatch or field ops", "đang điều phối hoặc tác chiến hiện trường"],
    ["completed operations", "nhiệm vụ đã hoàn thành"],
    ["Awaiting Coordinator verification", "Đang chờ điều phối viên xác minh"],
    ["Upload rejected", "Tải lên bị từ chối"],
    ["Showing ", "Đang hiển thị "],
    ["Page ", "Trang "],
    ["(Flood)", "(Ngập lụt)"],
    ["(Fire)", "(Hỏa hoạn)"],
    ["(Building Collapse)", "(Sập công trình)"],
    ["(Traffic Accident)", "(Tai nạn giao thông)"],
    [" officers", " cứu hộ viên"],
    [" boats", " thuyền cứu hộ"],
    [" rescue boats", " thuyền cứu hộ"],
    [" personnel", " nhân sự"],
    [" people detected", " người được phát hiện"],
    [" people initially detected by UAV", " người ban đầu được UAV phát hiện"],
    [" free team(s)", " đội sẵn sàng"],
    [" FREE TEAMS", " ĐỘI SẴN SÀNG"],
    [" critical severity (excl. Normal)", " sự cố rất nghiêm trọng (không tính báo cáo bình thường)"],
    ["available, excluding pending assignments", "đang sẵn sàng, không tính nhiệm vụ chờ tiếp nhận"],
    ["from shared demo history", "từ lịch sử dữ liệu mẫu dùng chung"],
    ["active operational period", "trong kỳ tác chiến hiện tại"],
    ["units operating on scene", "đơn vị đang tác chiến tại hiện trường"],
    ["verified field sign-offs", "biên bản hiện trường đã xác minh"],
    ["reported by field units", "do đơn vị hiện trường báo cáo"],
    ["Total Incidents", "Tổng số sự cố"],
    ["Total Teams", "Tổng số đội"],
    ["All Incident Types", "Tất cả loại sự cố"],
    ["All Sectors", "Tất cả địa bàn"],
    ["All Severity Bands", "Tất cả mức độ"],
    ["All Statuses", "Tất cả trạng thái"],
    ["Verified Queue (", "Hàng đợi đã xác minh ("],
    ["Unverified / Pending Verification (", "Chưa xác minh / Chờ xác minh ("],
    [" cases)", " ca)"],
    [" case(s)", " ca"],
    [" cases", " ca"],
    [" resolved", " đã xử lý"],
    [" unit(s) assigned", " đơn vị được phân công"],
    ["Registered AEGIS-UAV demo telemetry source.", "Nguồn telemetry AEGIS-UAV mẫu đã đăng ký."],
    ["No result recorded", "Chưa ghi nhận kết quả"],
    ["No model/API connected", "Chưa kết nối mô hình/API"],
    ["Trusted source verified", "Nguồn tin cậy đã xác minh"],
    ["manual Coordinator review", "Quản trị viên duyệt thủ công"],
    ["AI confidence ≥ 85%", "Độ tin cậy AI ≥ 85%"],
    ["Evaluated under baseline post-ranking rules", "Được đánh giá theo bộ quy tắc cơ sở sau xếp hạng"],
    ["victims safely extracted", "nạn nhân đã được đưa ra an toàn"],
    ["Priority 1 (Critical)", "Ưu tiên 1 (Rất nghiêm trọng)"],
    ["Priority 2 (Stable)", "Ưu tiên 2 (Ổn định)"],
    ["Rescue team approached the scene using UAV reconnaissance coordinates. All ", "Đội cứu hộ tiếp cận hiện trường theo tọa độ trinh sát UAV. Tất cả "],
    [" were triaged on site and safely handed over to local medical authorities.", " đã được phân loại tại chỗ và bàn giao an toàn cho cơ sở y tế địa phương."],
    ["active incidents", "sự cố đang xử lý"],
    ["matching team", "đang ghép đội"],
    ["Citizen reports awaiting Coordinator review", "Báo cáo từ người dân đang chờ Quản trị viên duyệt"],
    ["Sector has 0 free local teams (cross-district)", "Địa bàn không còn đội sẵn sàng (cần điều động liên quận)"],
    [" filtered incidents", " sự cố sau lọc"],
    ["rescue missions completed", "nhiệm vụ cứu hộ đã hoàn thành"],
    ["verified from field completion reports", "được xác minh từ báo cáo hoàn thành hiện trường"],
    ["from field start to completion", "từ khi bắt đầu đến khi hoàn thành hiện trường"],
    ["spatial clusters", "cụm không gian"],
    ["joint dispatches", "lệnh điều động liên đội"],
    ["retained at station pool", "được giữ lại tại kho trạm"],
    ["incidents stalled", "sự cố bị đình trệ"],
    ["unneeded items locked on wrong missions", "thiết bị không cần thiết bị giữ ở sai nhiệm vụ"],
    ["free teams", "đội sẵn sàng"],
    ["done", "đã hoàn thành"],
    ["Avg Sev", "Mức nghiêm trọng TB"],
    ["Avg Time", "Thời gian TB"],
    ["Resolved:", "Đã xử lý:"],
    ["Active Ops:", "Đang tác chiến:"],
    ["Pending:", "Đang chờ:"],
    ["Sector Load:", "Tải địa bàn:"],
    ["Retrain Case(s)", "ca cần huấn luyện lại"],
    ["AI Match", "AI khớp"],
    ["Corrected (Retrain)", "Đã hiệu chỉnh (Huấn luyện lại)"],
    ["Unverified", "Chưa xác minh"],
    ["completed rescue mission(s)", "nhiệm vụ cứu hộ đã hoàn thành"],
    ["corrected case(s)", "ca đã hiệu chỉnh"],
    ["days", "ngày"],
    ["min (Golden Window Peak)", "phút (Đỉnh khung Giờ Vàng)"],
    ["min (Critical Delay)", "phút (Chậm trễ nghiêm trọng)"],
    ["Trusted-source auto-verification is separate from citizen review; every citizen report still requires Coordinator approval.", "Tự động xác minh nguồn tin cậy tách biệt với duyệt báo cáo người dân; mọi báo cáo từ người dân vẫn cần Quản trị viên phê duyệt."],
    ["Hard Constraints filter out ineligible units; Soft Constraints adjust scores; ML Rebalancing trims surplus gear and forms coalitions when a single unit is insufficient.", "Ràng buộc cứng loại các đơn vị không hợp lệ; ràng buộc mềm điều chỉnh điểm; tái cân bằng ML cắt thiết bị dư và lập liên đội khi một đơn vị không đủ năng lực."],
    ["Offline, on-mission, dispatch-pending, and Hard-Constraint-violating teams are excluded from automatic proposal.", "Các đội ngoại tuyến, đang làm nhiệm vụ, chờ điều động hoặc vi phạm ràng buộc cứng bị loại khỏi đề xuất tự động."],
    ["These teams are Available in Rescue Teams force registry but failed one or more mandatory Hard Constraints.", "Các đội này đang sẵn sàng trong danh mục lực lượng nhưng không đạt một hoặc nhiều ràng buộc cứng bắt buộc."],
    ["Field reports and completion photos are submitted directly by field rescue units via the mobile/tablet portal (", "Báo cáo hiện trường và ảnh hoàn thành được đơn vị cứu hộ gửi trực tiếp qua cổng di động/máy tính bảng ("],
    ["). Command coordinators monitor mission progress and ", "). Điều phối viên chỉ huy theo dõi tiến độ nhiệm vụ và số "],
    [" rescue counts in real-time.", " được cứu theo thời gian thực."],
    ["Recorded via Mobile Responder Portal (FEMA ICS-209 Field Standard).", "Được ghi nhận qua Cổng Lực lượng Hiện trường trên thiết bị di động (Chuẩn FEMA ICS-209)."],
    ["Responder en route. Site access telemetry pending arrival confirmation.", "Lực lượng đang di chuyển. Telemetry tiếp cận hiện trường đang chờ xác nhận đến nơi."],
    ["Use this panel only if on-scene responders report completion via tactical voice radio instead of the mobile responder app.", "Chỉ dùng bảng này khi lực lượng hiện trường báo hoàn thành qua bộ đàm tác chiến thay vì ứng dụng di động."],
    ["When the tactical rescue team submits their field report via the mobile responder app, the photographic proof will appear here automatically.", "Khi đội cứu hộ gửi báo cáo hiện trường qua ứng dụng di động, ảnh bằng chứng sẽ tự động xuất hiện tại đây."],
    ["This mission is cryptographically logged inside Digital Evidence Dossier", "Nhiệm vụ này được ghi nhật ký mã hóa trong Hồ sơ Bằng chứng Số"],
    ["under FEMA ICS-209 regulations.", "theo quy định FEMA ICS-209."],
    ["Availability and RescueTeam Custom Tags (Source: Admin) are shared with rule matching and the Rescue Team Portal.", "Trạng thái sẵn sàng và nhãn tùy chỉnh Đội cứu hộ (Nguồn: Quản trị viên) được dùng chung cho ghép quy tắc và Cổng Đội Cứu hộ."],
    ["Manage global regional datasets, geographic timezones, Controlled Extensible Custom Tags, Mathematical Normalization, and Context-Aware Zero-Weight Overrides.", "Quản lý bộ dữ liệu vùng, múi giờ địa lý, nhãn tùy chỉnh mở rộng có kiểm soát, chuẩn hóa toán học và ghi đè trọng số 0 theo ngữ cảnh."],
    ["Switch built-in multi-country regional datasets (Vietnam / United States) or import any custom JSON dataset.", "Chuyển đổi bộ dữ liệu vùng tích hợp của nhiều quốc gia (Việt Nam / Hoa Kỳ) hoặc nhập bộ dữ liệu JSON tùy chỉnh."],
    ["Recomputed from ", "Được tính lại từ "],
    [" and the staged thresholds.", " và các ngưỡng đã thiết lập."],
    ["reports / sector / week", "báo cáo / địa bàn / tuần"],
    ["Extracted from active dataset & used across C2/C9 filters and UAV GPS auto-tracking (R1–R3)", "Trích xuất từ bộ dữ liệu đang hoạt động và dùng cho bộ lọc C2/C9 cùng tính năng tự theo dõi GPS UAV (R1–R3)"],
    ["Dynamic filters recompute KPIs, visual analytics charts, CSV exports, and end-to-end Digital Evidence Chain of Custody dossiers.", "Bộ lọc động tính lại KPI, biểu đồ phân tích trực quan, dữ liệu xuất CSV và hồ sơ chuỗi quản lý bằng chứng số đầu-cuối."],
    ["Rigorous comparison answering:", "So sánh chặt chẽ để trả lời:"],
    ["Why is Machine Learning necessary? How does it prevent resource starvation during 25+ simultaneous incidents?", "Vì sao cần Học máy? Công nghệ này ngăn thiếu hụt nguồn lực thế nào khi có hơn 25 sự cố đồng thời?"],
    ["None — spatial clustering & surplus equipment trimming prevented resource starvation.", "Không — gom cụm không gian và cắt giảm thiết bị dư đã ngăn tình trạng thiếu hụt nguồn lực."],
    ["Exhausted standalone teams after 7 FIFO dispatches without spatial clustering or equipment trimming.", "Cạn kiệt đội độc lập sau 7 lượt điều động FIFO do không gom cụm không gian hoặc cắt giảm thiết bị dư."],
    ["Standardized inter-agency operational summary for regional disaster management, resource accounting, and executive briefing.", "Bản tổng hợp tác chiến liên cơ quan được chuẩn hóa để quản lý thảm họa vùng, kiểm kê nguồn lực và báo cáo chỉ huy."],
    ["Proportion of verified incident types and detected ", "Tỷ lệ loại sự cố đã xác minh và mật độ "],
    [" density.", " được phát hiện."],
    ["Grouped by administrative sector, resolution progress, and local free teams.", "Được nhóm theo địa bàn hành chính, tiến độ xử lý và số đội địa phương sẵn sàng."],
    ["Comparison of rescued ", "So sánh số "],
    [" and average mission duration (SLA target ≤ 90m).", " đã cứu và thời lượng nhiệm vụ trung bình (mục tiêu SLA ≤ 90 phút)."],
    ["Conversion rate from UAV reconnaissance to closure and AI model label correction audit.", "Tỷ lệ chuyển đổi từ trinh sát UAV đến đóng hồ sơ và kiểm toán hiệu chỉnh nhãn mô hình AI."],
    ["Live metrics aggregated from active shifts and coordinator review overrides.", "Chỉ số trực tiếp được tổng hợp từ ca trực hiện tại và các lần điều phối viên ghi đè kết quả thẩm định."],
    ["Every case preserves the full digital evidence chain from UAV imagery and 3-Tier AI inference to field completion sign-off.", "Mỗi ca lưu toàn bộ chuỗi bằng chứng số từ ảnh UAV, suy luận AI ba tầng đến ký xác nhận hoàn thành hiện trường."],
    ["Audit trail of cases where coordinators corrected the initial AI label, serving as a domain-shift retraining dataset.", "Dấu vết kiểm toán các ca điều phối viên hiệu chỉnh nhãn AI ban đầu, dùng làm bộ dữ liệu huấn luyện lại khi miền dữ liệu thay đổi."],
    ["Standardized multi-tier chain of custody: From UAV/AML sensor capture and 3-Tier ML inference to tactical coalition dispatch, field operations, and commander sign-off.", "Chuỗi quản lý đa tầng được chuẩn hóa: từ dữ liệu cảm biến UAV/AML và suy luận ML ba tầng đến điều động liên đội, tác chiến hiện trường và chỉ huy ký xác nhận."],
    ["Real-time approach and medical evacuation status for each detected target updated by the field team.", "Trạng thái tiếp cận và sơ tán y tế theo thời gian thực của từng mục tiêu do đội hiện trường cập nhật."],
    [" validation requirement", " điều kiện kiểm tra"],
    [" failed. Your selected input is preserved.", " không đạt. Dữ liệu đã chọn vẫn được giữ nguyên."],
    ["Gatekeeping Result ·", "Kết quả kiểm soát đầu vào ·"],
    [" critical", " nguy kịch"],
    ["Survival Est.", "Khả năng sống sót ước tính"],
    ["Golden Window Peak", "Đỉnh khung Giờ Vàng"],
    [" Officers", " Cứu hộ viên"],
    [" UAVs", " UAV"],
    ["Rescue completed", "Cứu hộ hoàn tất"],
    [" rescued", " đã cứu"],
    ["Rapid Response", "Phản ứng nhanh"],
    ["Tactical Incident Map", "Bản đồ sự cố tác chiến"],
    ["High-contrast grayscale tactical map ·", "Bản đồ tác chiến thang xám tương phản cao ·"],
    ["Normal non-emergency reports are excluded from the map.", "Báo cáo bình thường, không khẩn cấp không được hiển thị trên bản đồ."],
    ["Monochrome grayscale basemap highlights active emergency markers ·", "Bản đồ nền thang xám đơn sắc làm nổi bật các điểm sự cố khẩn cấp đang hoạt động ·"],
    [" active sectors · Center", " địa bàn đang hoạt động · Tâm"],
    ["Timezone:", "Múi giờ:"],
    [" unreviewed", " chưa thẩm định"],
    ["Incident Detail ·", "Chi tiết sự cố ·"],
    [" minutes", " phút"],
    [" distinct sources", " nguồn độc lập"],
    ["UAV EO feed · BBox overlay simulation ·", "Luồng EO từ UAV · mô phỏng lớp phủ khung nhận diện ·"],
    [" targets", " mục tiêu"],
    ["Golden Hour Urgency:", "Mức khẩn cấp Giờ Vàng:"],
    ["Recommended quota:", "Quân số khuyến nghị:"],
    ["Multi-Team Coalition Proposed:", "Đề xuất liên đội:"],
    ["Primary unit short by ", "Đội chủ lực thiếu "],
    [" (needs ", " (cần "],
    ["Primary Only:", "Chỉ đội chủ lực:"],
    ["With Coalition:", "Có liên đội:"],
    ["Coverage", "mức đáp ứng"],
    ["Joint Coalition Dispatch: ON", "Điều động liên đội: BẬT"],
    ["Primary (SAR-01)", "Đội chủ lực (SAR-01)"],
    ["Deficit", "Bù thiếu"],
    ["filled by Support Team", "do đội hỗ trợ bổ sung"],
    ["Unassign", "Thu hồi"],
    ["Keep at Base for other MIS", "Giữ tại căn cứ cho MIS khác"],
    ["Trim", "Cắt giảm"],
    ["surplus", "dư thừa"],
    ["Retained at station", "Giữ lại tại trạm"],
    ["supplied by Coalition", "do liên đội cung cấp"],
    [" rescue van", " xe cứu hộ"],
    ["medical kit", "bộ y tế"],
    [" pumps", " máy bơm"],
    [" sets", " bộ"],
    [" kits", " bộ"],
    [" persons", " người"],
    [" knots", " hải lý/giờ"],
    [" eligible", " hợp lệ"],
    [" available", " sẵn sàng"],
    [" pts", " điểm"],
    ["Req ≥", "Yêu cầu ≥"],
    ["Same Sector", "Cùng địa bàn"],
    ["Each Custom Tag specifies its", "Mỗi nhãn tùy chỉnh xác định"],
    [", and", ", và"],
    ["Non-AI attributes are never assumed to be AI model outputs.", "Thuộc tính không phải AI không bao giờ được coi là đầu ra của mô hình AI."],
    ["These teams are Available in Rescue Teams force registry but failed one or more mandatory Hard Constraints.", "Các đội này đang sẵn sàng trong danh mục lực lượng cứu hộ nhưng không đạt một hoặc nhiều ràng buộc cứng bắt buộc."],
    ["Road Width vs Vehicle Clearance Gate", "Cổng kiểm tra chiều rộng đường và bề rộng phương tiện"],
    ["Narrow Entrance Heavy Truck Restriction", "Hạn chế xe tải nặng tại lối vào hẹp"],
    ["Heavy truck cannot enter incident with narrow_entrance = true.", "Xe tải nặng không thể tiếp cận sự cố khi narrow_entrance = true."],
    ["Same-sector rapid response in ultra-dense zone", "Ưu tiên phản ứng nhanh cùng địa bàn ở khu vực mật độ cực cao"],
    ["Context Overridden", "Đã ghi đè theo ngữ cảnh"],
    ["Heavy Extrication Gear Readiness Bonus", "Điểm thưởng mức sẵn sàng của thiết bị phá dỡ nặng"],
    ["Context Zero-Weight Override: Inactive for Fire", "Ghi đè trọng số 0 theo ngữ cảnh: Không áp dụng cho hỏa hoạn"],
    ["(Completed)", "(Đã hoàn thành)"],
    ["(🚗 Traffic Accident)", "(🚗 Tai nạn giao thông)"],
    ["Severity ", "Mức nghiêm trọng "],
    ["Lead: ", "Chỉ huy: "],
    [" · On-Scene Field Report (Submitted by Responders)", " · Báo cáo hiện trường (Do lực lượng cứu hộ gửi)"],
    ["Save Field Rescue Report on ", "Lưu báo cáo cứu hộ hiện trường vào "],
    ["Can Tho", "Cần Thơ"],
    ["Ha Noi", "Hà Nội"],
    ["Da Nang", "Đà Nẵng"],
    ["Vung Tau", "Vũng Tàu"],
    ["Tay Ninh", "Tây Ninh"],
    ["Dong Nai", "Đồng Nai"],
    ["Active Dataset (", "Bộ dữ liệu đang hoạt động ("],
    [" incidents · ", " sự cố · "],
    [" rescue teams · ", " đội cứu hộ · "],
    [" administrative sectors.", " địa bàn hành chính."],
    [" severe active", " sự cố nghiêm trọng đang hoạt động"],
    ["out of ", "trên tổng số "],
    [" filtered incidents", " sự cố sau lọc"],
    [" units retained at station pool", " thiết bị được giữ lại tại kho trạm"],
    ["Isolated team dispatch", "Điều động đội đơn lẻ"],
    ["Spatial clustering via DBSCAN", "Gom cụm không gian bằng DBSCAN"],
    ["radius ≤ 550m", "bán kính ≤ 550 m"],
    [") collapses 25+ incidents into 7 manageable cluster centroids. Urgency ranking incorporates the Golden Hour survival function:", ") thu gọn hơn 25 sự cố thành 7 tâm cụm có thể quản lý. Xếp hạng khẩn cấp sử dụng hàm sống sót Giờ Vàng:"],
    [". Deficit & surplus rebalancing unassigns 0-weight gear (e.g. leaving heavy debris shears at base during floods) to prevent inventory exhaustion.", ". Tái cân bằng thừa/thiếu thu hồi thiết bị có trọng số 0 (ví dụ để kìm cắt đổ nát hạng nặng tại căn cứ khi xảy ra ngập lụt) nhằm tránh cạn kiệt kho."],
    [" Multi-Hazard Monsoon Response", " ứng phó đa hiểm họa mùa mưa"],
    [" active, ", " đang xử lý, "],
    [" operating on scene", " đang tác chiến tại hiện trường"],
    [" Rescued", " đã cứu"],
    [" verified field outcomes", " kết quả hiện trường đã xác minh"],
    ["Golden Hour protocol preserved", "Đã bảo đảm quy trình Giờ Vàng"],
    ["Fire:", "Hỏa hoạn:"],
    ["Flood:", "Ngập lụt:"],
    ["Building Collapse:", "Sập công trình:"],
    ["Traffic Accident:", "Tai nạn giao thông:"],
    ["Unclassified:", "Chưa phân loại:"],
    ["Normal:", "Bình thường:"],
    [" incidents", " sự cố"],
    [" sectors", " địa bàn"],
    [" detected", " được phát hiện"],
    [" AI label correction(s)", " lần hiệu chỉnh nhãn AI"],
    [" field mission(s) completed", " nhiệm vụ hiện trường đã hoàn thành"],
    [" safely rescued", " được cứu an toàn"],
    [" corrected case(s)", " ca đã hiệu chỉnh"],
    ["FEMA ICS-201 Digital Dossier ·", "Hồ sơ số FEMA ICS-201 ·"],
    [" · Duty Controller", " · Điều hành viên trực"],
    ["Matched AI classification:", "Phân loại AI khớp:"],
    ["Coordinator corrected AI type:", "Điều phối viên hiệu chỉnh loại AI:"],
    ["Unverified:", "Chưa xác minh:"],
    [" units được giữ lại", " thiết bị được giữ lại"],
    ["unneeded items locked on wrong missions", "các thiết bị không cần thiết lại bị giữ ở sai nhiệm vụ"],
    ["NonĐứng/Tỉnh táoRatio", "TỷLệTưThếKhôngĐứng"],
    ["rebalancing unassigns 0-weight gear", "tái cân bằng thu hồi thiết bị có trọng số 0"],
    ["e.g. leaving heavy debris shears at base during floods", "ví dụ để kìm cắt đổ nát hạng nặng tại căn cứ khi xảy ra ngập lụt"],
    ["to prevent inventory exhaustion", "nhằm tránh cạn kiệt kho"],
    [" Units", " Đơn vị"],
    [" active /", " đang xử lý /"],
    [" safely đã cứu", " được cứu an toàn"],
    [" Full Rescue", " cứu hộ hoàn tất"],
    [" Partial Completion (follow-up required)", " hoàn thành một phần (cần theo dõi tiếp)"],
    [" dossiers", " hồ sơ"],
    ["Audit trail of ca where coordinators corrected the initial AI label, serving as a domain-shift retraining dataset.", "Dấu vết kiểm toán các ca điều phối viên hiệu chỉnh nhãn AI ban đầu, dùng làm bộ dữ liệu huấn luyện lại khi miền dữ liệu thay đổi."],
    [" corrected ca", " ca đã hiệu chỉnh"],
    ["Version:", "Phiên bản:"],
    [" active,", " đang xử lý,"],
    [". When", ". Khi"],
    ["(Boolean, Number, Enum)", "(Luận lý, Số, Liệt kê)"],
    ["If Flood &", "Nếu Ngập lụt &"],
    ["If Building Collapse & Severity", "Nếu Sập công trình & Mức độ nghiêm trọng"]
  );

  function getPreferences() {
    // One-time migration: English is the default language. Reset the "vi" value saved
    // automatically by older builds; a language chosen later in Settings is kept.
    try {
      if (localStorage.getItem("skyrescue.lang.defaultEn") !== "1") {
        localStorage.setItem("skyrescue.lang", "en");
        const saved = JSON.parse(localStorage.getItem("skyrescue.preferences.v1") || "null");
        if (saved) { saved.language = "en"; localStorage.setItem("skyrescue.preferences.v1", JSON.stringify(saved)); }
        localStorage.setItem("skyrescue.lang.defaultEn", "1");
      }
    } catch (_) {}
    try {
      const raw = localStorage.getItem("skyrescue.preferences.v1");
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return {
      language: localStorage.getItem("skyrescue.lang") || "en",
      theme: localStorage.getItem("skyrescue.theme") || "light",
      audioCritical: true,
      desktopNotif: false,
      syncInterval: "10000"
    };
  }

  function savePreferences(prefs) {
    try {
      localStorage.setItem("skyrescue.preferences.v1", JSON.stringify(prefs));
      if (prefs.language) localStorage.setItem("skyrescue.lang", prefs.language);
      if (prefs.theme) localStorage.setItem("skyrescue.theme", prefs.theme);
    } catch (_) {}
  }

  function applyTheme(theme = "light") {
    if (theme === "dark" || theme === "contrast") {
      document.documentElement.setAttribute("data-theme", theme);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    try {
      const prefs = getPreferences();
      prefs.theme = theme;
      localStorage.setItem("skyrescue.preferences.v1", JSON.stringify(prefs));
      localStorage.setItem("skyrescue.theme", theme);
    } catch (_) {}
  }

  function applyLanguage(lang = "en", targetRoot = document.body) {
    document.documentElement.lang = lang;
    try {
      const prefs = getPreferences();
      prefs.language = lang;
      localStorage.setItem("skyrescue.preferences.v1", JSON.stringify(prefs));
      localStorage.setItem("skyrescue.lang", lang);
    } catch (_) {}

    if (lang === "vi") {
      document.documentElement.dataset.translated = "true";
      const rootNode = targetRoot || document.body;

      // 1. Navigation buttons with data-nav and data-screen
      rootNode.querySelectorAll?.("button[data-nav], button[data-screen]").forEach((btn) => {
        const code = btn.dataset.nav || btn.dataset.screen;
        const navKeys = {
          R1: "Submit Report",
          R4: "My Reports",
          C1: "Tactical Map",
          C2: "Active Queue",
          C3: "Incident Triage",
          C4: "Team Matching",
          C5: "Dispatch Approval",
          FieldReport: "Field Operations Monitor",
          C7: "Rescue Teams",
          Configuration: "Configuration",
          C9: "Reports & Export",
          RT1: "My Mission (RT1)",
          RT2: "Field Rescue Report (RT2)",
          RT3: "Mission History (RT3)"
        };
        const key = navKeys[code];
        if (key && VI_DICTIONARY[key]) {
          const raw = btn.textContent.trim();
          const prefixMatch = raw.match(/^([^\p{L}\p{N}]+)/u);
          const icon = prefixMatch ? prefixMatch[1].trim() + " " : "";
          btn.textContent = icon + VI_DICTIONARY[key];
        }
      });

      // 2. Input / Textarea Placeholders
      rootNode.querySelectorAll?.("input[placeholder], textarea[placeholder]").forEach((el) => {
        const ph = el.getAttribute("placeholder")?.trim();
        if (ph && VI_DICTIONARY[ph]) {
          el.setAttribute("placeholder", VI_DICTIONARY[ph]);
        }
      });

      // Read-only fields display generated status/metadata rather than user input.
      rootNode.querySelectorAll?.("input[readonly]").forEach((el) => {
        const value = el.value?.trim();
        if (value && VI_DICTIONARY[value]) {
          el.value = VI_DICTIONARY[value];
        }
      });

      // Accessible labels and hover text use the same translation catalog.
      rootNode.querySelectorAll?.("[aria-label], [title]").forEach((el) => {
        ["aria-label", "title"].forEach((attribute) => {
          const value = el.getAttribute(attribute)?.trim();
          if (!value) return;
          if (VI_DICTIONARY[value]) {
            el.setAttribute(attribute, VI_DICTIONARY[value]);
            return;
          }
          let translated = value;
          COMPOUND_REPLACEMENTS.forEach(([en, vi]) => { translated = translated.replaceAll(en, vi); });
          if (translated !== value) el.setAttribute(attribute, translated);
        });
      });

      // 3. Select Option Texts
      rootNode.querySelectorAll?.("select option").forEach((opt) => {
        const t = opt.textContent.trim();
        if (VI_DICTIONARY[t]) opt.textContent = VI_DICTIONARY[t];
      });

      // 4. Text Nodes via TreeWalker
      const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const p = node.parentElement;
          if (!p) return NodeFilter.FILTER_REJECT;
          const tag = p.tagName;
          if (tag === "SCRIPT" || tag === "STYLE") return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }, false);

      let textNode;
      while ((textNode = walker.nextNode())) {
        let raw = textNode.nodeValue;
        if (!raw || !raw.trim()) continue;
        const trimmed = raw.trim();

        // Direct exact match
        if (VI_DICTIONARY[trimmed]) {
          textNode.nodeValue = raw.replace(trimmed, VI_DICTIONARY[trimmed]);
          continue;
        }

        // Prefix-stripped match for icons/emojis/punctuation
        const prefixMatch = trimmed.match(/^([^\p{L}\p{N}]+)([\p{L}\p{N}].*)$/u);
        if (prefixMatch) {
          const sym = prefixMatch[1];
          const core = prefixMatch[2].trim();
          if (VI_DICTIONARY[core]) {
            textNode.nodeValue = raw.replace(trimmed, sym + VI_DICTIONARY[core]);
            continue;
          }
        }

        // Compound phrase replacements
        let modified = raw;
        for (let i = 0; i < COMPOUND_REPLACEMENTS.length; i++) {
          const [en, vi] = COMPOUND_REPLACEMENTS[i];
          if (modified.includes(en)) {
            modified = modified.replaceAll(en, vi);
          }
        }
        if (modified !== raw) {
          textNode.nodeValue = modified;
        }
      }
    } else {
      if (document.documentElement.dataset.translated === "true") {
        document.documentElement.removeAttribute("data-translated");
        location.reload();
      }
    }
  }

  function openSettingsModal() {
    const prefs = getPreferences();
    const lang = prefs.language || "en";
    const theme = prefs.theme || "light";
    const syncInterval = prefs.syncInterval || "10000";
    const audioCritical = prefs.audioCritical !== false;
    const desktopNotif = prefs.desktopNotif === true;

    const isVi = lang === "vi";

    const rootModal = modal({
      title: isVi ? "Cài Đặt Hệ Thống & Tùy Chọn" : "System Preferences & Settings",
      subtitle: isVi ? "Tùy chỉnh ngôn ngữ hiển thị, độ tương phản tác chiến, còi báo động và tần suất cập nhật." : "Personalize operational language, visual contrast, audible alarms, and telemetry sync rates.",
      content: `
        <div class="stack" style="gap:14px">
          <section class="surface" style="border:1px solid var(--line);border-radius:10px;padding:14px;background:var(--soft)">
            <h4 style="margin:0 0 4px;font-size:14px;color:var(--navy);display:flex;align-items:center;gap:6px">🌐 ${isVi ? "Ngôn ngữ hiển thị" : "Language & Localization"}</h4>
            <p class="muted" style="margin:0 0 10px;font-size:12px">${isVi ? "Chọn ngôn ngữ giao diện chính cho hệ thống:" : "Select your preferred user interface language:"}</p>
            <label class="field">
              <span>${isVi ? "Ngôn ngữ" : "Display Language"}</span>
              <select id="pref-language">
                <option value="vi" ${lang === "vi" ? "selected" : ""}>${isVi ? "Tiếng Việt (Việt Nam - Bản địa hóa tác chiến cứu hộ)" : "Vietnamese (Vietnam / Localized Rescue Operations)"}</option>
                <option value="en" ${lang === "en" ? "selected" : ""}>${isVi ? "Tiếng Anh (Mỹ / Chuẩn tác chiến quốc tế)" : "English (US / International Operational Standard)"}</option>
              </select>
            </label>
            <small class="muted" style="display:block;margin-top:6px;font-size:11px">${isVi ? "Thay đổi ngôn ngữ sẽ cập nhật toàn bộ tiêu đề, nút bấm, thông báo và biên bản tác chiến." : "Changing language updates UI headers, buttons, alert thresholds, and operational instructions."}</small>
          </section>

          <section class="surface" style="border:1px solid var(--line);border-radius:10px;padding:14px;background:var(--soft)">
            <h4 style="margin:0 0 4px;font-size:14px;color:var(--navy);display:flex;align-items:center;gap:6px">🎨 ${isVi ? "Chế độ Giao diện & Độ tương phản" : "Display Theme & Contrast"}</h4>
            <p class="muted" style="margin:0 0 10px;font-size:12px">${isVi ? "Tối ưu khả năng hiển thị ngoài trời nắng gắt hoặc ban đêm:" : "Optimize screen readability for bright sunlight or night field operations:"}</p>
            <label class="field">
              <span>${isVi ? "Chế độ hiển thị" : "Theme Mode"}</span>
              <select id="pref-theme">
                <option value="light" ${theme === "light" ? "selected" : ""}>☀️ ${isVi ? "Sáng tiêu chuẩn" : "Standard Tactical Daylight (Light)"}</option>
                <option value="dark" ${theme === "dark" ? "selected" : ""}>🌙 ${isVi ? "Tác chiến ban đêm" : "Night Operations (Low-Glare Dark)"}</option>
                <option value="contrast" ${theme === "contrast" ? "selected" : ""}>⚡ ${isVi ? "Tương phản cao ngoài trời" : "High-Contrast Field Mode (Direct Sunlight)"}</option>
              </select>
            </label>
          </section>

          <section class="surface" style="border:1px solid var(--line);border-radius:10px;padding:14px;background:var(--soft)">
            <h4 style="margin:0 0 4px;font-size:14px;color:var(--navy);display:flex;align-items:center;gap:6px">🔔 ${isVi ? "Cảnh báo Âm thanh & Báo động" : "Audible Alarms & Notifications"}</h4>
            <p class="muted" style="margin:0 0 10px;font-size:12px">${isVi ? "Kiểm soát âm thanh còi hú khi có sự cố khẩn cấp nguy kịch:" : "Control acoustic siren alerts for high-risk flood & collapse events:"}</p>
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;margin-bottom:8px">
              <input type="checkbox" id="pref-audio" ${audioCritical ? "checked" : ""}>
              <span>${isVi ? "Phát âm thanh còi hú khi có ca Nguy kịch (Cấp 4/5)" : "Play audible siren for Level 4/5 Critical Emergency Incidents"}</span>
            </label>
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
              <input type="checkbox" id="pref-desktop-notif" ${desktopNotif ? "checked" : ""}>
              <span>${isVi ? "Bật thông báo đẩy khi có báo cáo mới từ người dân vào hàng đợi duyệt" : "Enable browser push alerts when a new citizen report enters the review inbox"}</span>
            </label>
          </section>

          <section class="surface" style="border:1px solid var(--line);border-radius:10px;padding:14px;background:var(--soft)">
            <h4 style="margin:0 0 4px;font-size:14px;color:var(--navy);display:flex;align-items:center;gap:6px">⚡ ${isVi ? "Tần suất Đồng bộ Dữ liệu Viễn thám & Bản đồ" : "Telemetry & Live Map Refresh Rate"}</h4>
            <label class="field">
              <span>${isVi ? "Chu kỳ làm mới" : "Refresh Interval"}</span>
              <select id="pref-sync">
                <option value="3000" ${syncInterval === "3000" ? "selected" : ""}>${isVi ? "Tác chiến Thời gian thực (Mỗi 3 giây — Nhanh)" : "Tactical Realtime (Every 3 seconds — Fast)"}</option>
                <option value="10000" ${syncInterval === "10000" ? "selected" : ""}>${isVi ? "Trung tâm Chỉ huy Tiêu chuẩn (Mỗi 10 giây)" : "Standard Mission Control (Every 10 seconds)"}</option>
                <option value="30000" ${syncInterval === "30000" ? "selected" : ""}>${isVi ? "Tiết kiệm pin (Mỗi 30 giây)" : "Battery Saver / Eco (Every 30 seconds)"}</option>
              </select>
            </label>
          </section>
        </div>
      `,
      actions: `
        <button class="btn ghost" data-close-modal>${isVi ? "Hủy" : "Cancel"}</button>
        <button class="btn" id="save-settings-btn">${isVi ? "Lưu Cài Đặt" : "Save Preferences"}</button>
      `
    });

    rootModal.querySelector("#save-settings-btn")?.addEventListener("click", () => {
      const selectedLang = rootModal.querySelector("#pref-language")?.value || "en";
      const selectedTheme = rootModal.querySelector("#pref-theme")?.value || "light";
      const selectedAudio = rootModal.querySelector("#pref-audio")?.checked;
      const selectedNotif = rootModal.querySelector("#pref-desktop-notif")?.checked;
      const selectedSync = rootModal.querySelector("#pref-sync")?.value || "10000";

      const updatedPrefs = {
        language: selectedLang,
        theme: selectedTheme,
        audioCritical: selectedAudio,
        desktopNotif: selectedNotif,
        syncInterval: selectedSync,
        updatedAt: new Date().toISOString()
      };
      savePreferences(updatedPrefs);
      applyTheme(selectedTheme);
      applyLanguage(selectedLang);
      closeModal();
      mountHeaderProfile();
      window.dispatchEvent(new CustomEvent("skyrescue:preferences:change", { detail: updatedPrefs }));
      const msg = selectedLang === "vi"
        ? `Đã lưu cài đặt: Ngôn ngữ Tiếng Việt, Chế độ hiển thị: ${selectedTheme === "dark" ? "Ban đêm" : selectedTheme === "contrast" ? "Tương phản cao" : "Sáng tiêu chuẩn"}.`
        : `Preferences saved: Language set to English, theme set to ${selectedTheme}.`;
      toast(msg, "success");
    });
  }


  function openAuthModal(initialTab = "login") {
    let activeTab = initialTab === "register" ? "register" : "login";

    const renderModalBody = () => {
      const rootModal = modal({
        title: activeTab === "login" ? "Sign In to SkyRescue" : "Register Citizen Account",
        subtitle: "Role-Based Access Control (RBAC): Enter your operational credentials to access system consoles.",
        wide: false,
        content: `
          <div class="queue-tabs" style="margin-bottom:16px">
            <button class="queue-tab ${activeTab === "login" ? "active" : ""}" data-auth-tab="login">Sign In with Credentials</button>
            <button class="queue-tab ${activeTab === "register" ? "active" : ""}" data-auth-tab="register">Register Citizen Account</button>
          </div>

          ${activeTab === "login" ? `
            <div class="stack">
              <div id="login-error-alert" class="alert danger" style="display:none;margin-bottom:8px"></div>
              <div class="field-grid">
                <label class="field" style="grid-column:1/-1">
                  <span>Email or User ID</span>
                  <input id="login-identifier" type="text" placeholder="e.g. ranjith@skyrescue.org or USR-COORD-01" autocomplete="username">
                </label>
                <label class="field" style="grid-column:1/-1">
                  <span>Password</span>
                  <input id="login-pass" type="password" placeholder="Enter password" autocomplete="current-password">
                </label>
              </div>
              <button class="btn full" id="submit-login-btn" style="margin-top:12px">Sign In to Console →</button>
              <div class="row-between" style="margin-top:14px;font-size:12px">
                <span class="muted">Public citizen without credentials?</span>
                <a href="javascript:void(0)" id="switch-to-register" style="color:var(--blue);font-weight:600">Register Crowdsource Account</a>
              </div>
            </div>
          ` : `
            <div class="stack">
              <div id="reg-error-alert" class="alert danger" style="display:none;margin-bottom:8px"></div>
              <div class="field-grid">
                <label class="field"><span>Full Name</span><input id="reg-name" placeholder="e.g. Tran Minh Khoa"></label>
                <label class="field"><span>Phone Number (your sign-in name)</span><input id="reg-phone" type="tel" placeholder="0909123456"></label>
                <label class="field"><span>Password</span><input id="reg-pass" type="password" placeholder="Create a password"></label>
                <label class="field" style="grid-column:1/-1">
                  <span>Account Type & Source Trust Tier</span>
                  <select id="reg-role-tier"><option value="Public Citizen|Unverified Citizen">Public Citizen — Unverified Crowdsource</option></select>
                  <small class="muted">Specialist/CTV and Commander credentials require verified administrative authorization.</small>
                </label>
              </div>
              <button class="btn full" id="submit-register-btn" style="margin-top:12px">Create Account & Sign In →</button>
              <div class="row-between" style="margin-top:14px;font-size:12px">
                <span class="muted">Already have operational credentials?</span>
                <a href="javascript:void(0)" id="switch-to-login" style="color:var(--blue);font-weight:600">Sign In with Credentials</a>
              </div>
            </div>
          `}
        `
      });

      rootModal.querySelectorAll("[data-auth-tab]").forEach((btn) => {
        btn.addEventListener("click", () => {
          activeTab = btn.dataset.authTab;
          renderModalBody();
        });
      });

      rootModal.querySelector("#switch-to-register")?.addEventListener("click", () => {
        activeTab = "register";
        renderModalBody();
      });

      rootModal.querySelector("#switch-to-login")?.addEventListener("click", () => {
        activeTab = "login";
        renderModalBody();
      });

      const handleLogin = async () => {
        const idInput = rootModal.querySelector("#login-identifier");
        const passInput = rootModal.querySelector("#login-pass");
        const errBox = rootModal.querySelector("#login-error-alert");
        const identifier = idInput?.value.trim() || "";
        const password = passInput?.value.trim() || "";

        if (!identifier || !password) {
          if (errBox) {
            errBox.style.display = "flex";
            errBox.innerHTML = `<span>!</span><div>Please enter both <strong>Email / User ID</strong> and <strong>Password</strong>.</div>`;
          }
          return;
        }

        const res = await window.SkyRescueSync.login(identifier, password);
        if (!res.success) {
          if (errBox) {
            errBox.style.display = "flex";
            errBox.innerHTML = `<span>!</span><div>${escape(res.error)}</div>`;
          }
          if (passInput) {
            passInput.value = "";
            passInput.focus();
          }
          return;
        }
        ensureUser(res.user);
        setSessionUser(res.user.id);
        location.reload();
      };

      rootModal.querySelector("#submit-login-btn")?.addEventListener("click", handleLogin);
      rootModal.querySelector("#login-identifier")?.addEventListener("keydown", (e) => { if (e.key === "Enter") handleLogin(); });
      rootModal.querySelector("#login-pass")?.addEventListener("keydown", (e) => { if (e.key === "Enter") handleLogin(); });

      const handleRegister = async () => {
        const name = rootModal.querySelector("#reg-name")?.value.trim();
        const phone = rootModal.querySelector("#reg-phone")?.value.trim();
        const password = rootModal.querySelector("#reg-pass")?.value || "";
        const errBox = rootModal.querySelector("#reg-error-alert");
        const fail = (message) => {
          if (!errBox) return;
          errBox.style.display = "flex";
          errBox.innerHTML = `<span>!</span><div>${escape(message)}</div>`;
        };
        if (!name || !phone || password.length < 8) return fail("Enter your full name, a phone number and a password of 8 or more characters.");
        const res = await fetch("/api/register", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, phone, password })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return fail(typeof data.detail === "string" ? data.detail : "Check the name, the phone number (digits only) and the password.");
        ensureUser(data.user);
        setSessionUser(data.user.id);
        if (location.pathname.startsWith("/reporter/")) location.reload();
        else location.href = "/reporter/";
      };

      rootModal.querySelector("#submit-register-btn")?.addEventListener("click", handleRegister);
    };

    renderModalBody();
  }

    function openStaffProvisionModal() {
    closeModal();
    const isVi = (getPreferences().language || "en") === "vi";
    const title = isVi ? "Cấp Tài Khoản Nghiệp Vụ (Chỉ Huy Thực Hiện)" : "Provision Reporter Account";
    const subtitle = isVi ? "Chỉ huy cấp tài khoản Chuyên viên Trinh sát (UAV/CTV) hoặc Điều phối viên." : "Operational Command: provision a UAV Specialist/CTV reporter or a Command Coordinator.";

    const content = `
      <form id="form-provision-staff" onsubmit="return false;" class="stack">
        <div id="prov-error-alert" class="alert danger" style="display:none;margin-bottom:8px"></div>
        <div id="prov-success-alert" class="alert success" style="display:none;margin-bottom:8px"></div>

        <div class="field-grid">
          <label class="field" style="grid-column:1/-1">
            <span>${isVi ? "Vai trò nghiệp vụ cần cấp" : "Target Operational Role"} <strong style="color:var(--danger)">*</strong></span>
            <select id="prov-role" style="font-weight:600">
              <option value="UAV Specialist / CTV">${isVi ? "🛸 Chuyên Viên Trinh Sát Drone (UAV / CTV)" : "🛸 UAV Specialist / CTV — Drone Aerial Recon"}</option>
              <option value="Command Coordinator">${isVi ? "⭐ Chỉ Huy / Điều Phối Viên Tác Chiến" : "⭐ Command Coordinator — Deputy Dispatcher"}</option>
            </select>
          </label>

          <label class="field" style="grid-column:1/-1">
            <span>${isVi ? "Họ và tên nhân sự / Đội trưởng" : "Full Name / Officer In Charge"} <strong style="color:var(--danger)">*</strong></span>
            <input id="prov-name" placeholder="${isVi ? 'e.g. Đội Trưởng Lê Văn B hoặc Phi Công Trần C' : 'e.g. Capt. Le Van B or Pilot Tran C'}" required>
          </label>

          <label class="field">
            <span>${isVi ? "Email đăng nhập" : "Email Address"} <strong style="color:var(--danger)">*</strong></span>
            <input id="prov-email" type="email" placeholder="e.g. sar02@skyrescue.org" required>
          </label>

          <label class="field">
            <span>${isVi ? "Số điện thoại tác chiến" : "Operational Phone"}</span>
            <input id="prov-phone" placeholder="0908.xxx.xxx">
          </label>

          <label class="field">
            <span>${isVi ? "Mật khẩu khởi tạo" : "Initial Password"} <strong style="color:var(--danger)">*</strong></span>
            <input id="prov-pass" type="text" value="Rescue#2026" required>
          </label>

          <label class="field">
            <span>${isVi ? "Đơn vị / Phân đội / Trạm" : "Unit / Assigned Squad / Sector"}</span>
            <input id="prov-org" placeholder="${isVi ? 'e.g. Đội Phản Ứng Nhanh SAR-02' : 'e.g. Rapid Response Unit SAR-02'}">
          </label>
        </div>

        <div class="row-between" style="margin-top:16px;padding-top:12px;border-top:1px solid var(--line);align-items:center">
          <button type="button" class="btn ghost" data-close-modal>${isVi ? "Đóng" : "Cancel"}</button>
          <button type="button" class="btn primary" id="btn-submit-provision">
            <span>✓</span> ${isVi ? "Cấp Quyền & Kích Hoạt Tài Khoản" : "Provision & Activate Account"}
          </button>
        </div>
      </form>
    `;

    const rootModal = modal({
      title,
      subtitle,
      content,
      wide: true
    });

    const roleSelect = rootModal.querySelector("#prov-role");
    const orgInput = rootModal.querySelector("#prov-org");
    const emailInput = rootModal.querySelector("#prov-email");
    const passInput = rootModal.querySelector("#prov-pass");

    roleSelect?.addEventListener("change", () => {
      const r = roleSelect.value;
      if (r.includes("Rescue Team")) {
        if (orgInput) orgInput.placeholder = isVi ? "e.g. Đội Cứu Hộ SAR-02 Bến Cát" : "e.g. SAR-02 Rapid Rescue Squad";
        if (emailInput && !emailInput.value) emailInput.placeholder = "sar02@skyrescue.org";
        if (passInput) passInput.value = "Rescue#2026";
      } else if (r.includes("UAV Specialist")) {
        if (orgInput) orgInput.placeholder = isVi ? "e.g. CERT Aerial Reconnaissance Squad 08" : "e.g. CERT Aerial Reconnaissance Squad 08";
        if (emailInput && !emailInput.value) emailInput.placeholder = "drone08@skyrescue.org";
        if (passInput) passInput.value = "Drone#2026";
      } else {
        if (orgInput) orgInput.placeholder = "SkyRescue Metro Command Center";
        if (passInput) passInput.value = "Coord#2026";
      }
    });

    rootModal.querySelector("#btn-submit-provision")?.addEventListener("click", () => {
      const name = rootModal.querySelector("#prov-name")?.value.trim();
      const email = rootModal.querySelector("#prov-email")?.value.trim();
      const phone = rootModal.querySelector("#prov-phone")?.value.trim() || "0900.000.000";
      const password = rootModal.querySelector("#prov-pass")?.value.trim();
      const role = roleSelect?.value || "UAV Specialist / CTV";
      const org = rootModal.querySelector("#prov-org")?.value.trim();
      const errBox = rootModal.querySelector("#prov-error-alert");
      const succBox = rootModal.querySelector("#prov-success-alert");

      if (errBox) errBox.style.display = "none";
      if (succBox) succBox.style.display = "none";

      if (!name || !email || !password) {
        if (errBox) {
          errBox.style.display = "flex";
          errBox.innerHTML = `<span>!</span><div>${isVi ? "Vui lòng nhập đầy đủ <strong>Họ tên</strong>, <strong>Email</strong> và <strong>Mật khẩu</strong>." : "Please fill in Name, Email and Password."}</div>`;
        }
        return;
      }

      const allUsers = loadUsers();
      if (allUsers.some((u) => (u.email || "").toLowerCase() === email.toLowerCase())) {
        if (errBox) {
          errBox.style.display = "flex";
          errBox.innerHTML = `<span>!</span><div>Email <strong>${escape(email)}</strong> ${isVi ? "đã tồn tại trong hệ thống." : "is already registered."}</div>`;
        }
        return;
      }

      let newUser;
      const randNum = Math.floor(10 + Math.random() * 89);
      if (role.includes("UAV Specialist")) {
        newUser = {
          id: `USR-UAV-${randNum}`,
          name,
          email,
          emailAliases: [email],
          phone,
          password,
          passwordAliases: [password],
          role: "UAV Specialist / CTV",
          trustTier: "Verified Specialist",
          verified: true,
          organization: org || "CERT Aerial Reconnaissance Unit",
          preferredPortal: "reporter",
          badgeTone: "success",
          summary: "Aerial Reconnaissance Specialist: Connects with drone telemetry and provides verified reports.",
          permissions: {
            canAccessDispatch: false,
            canVerify: false,
            canDispatch: false,
            canConfig: false,
            canFieldOps: false,
            canReport: true,
            canDroneTelemetry: true
          }
        };
      } else {
        newUser = {
          id: `USR-COORD-${randNum}`,
          name,
          email,
          emailAliases: [email],
          phone,
          password,
          passwordAliases: [password],
          role: "Command Coordinator",
          trustTier: "Verified Command",
          verified: true,
          organization: org || "SkyRescue Metro Command Center",
          preferredPortal: "dispatch",
          badgeTone: "info",
          summary: "Incident Commander & Operations Dispatcher: Dispatches teams and manages emergency queues.",
          permissions: {
            canAccessDispatch: true,
            canVerify: true,
            canDispatch: true,
            canConfig: true,
            canFieldOps: true,
            canReport: true,
            canDroneTelemetry: true
          }
        };
      }

      allUsers.push(newUser);
      saveUsers(allUsers);
      toast(isVi ? `Đã cấp tài khoản thành công cho ${newUser.name} (${newUser.role})` : `Provisioned account for ${newUser.name}`, "success");

      if (succBox) {
        succBox.style.display = "block";
        succBox.innerHTML = `
          <strong>✓ ${isVi ? "Cấp tài khoản nghiệp vụ thành công!" : "Account Provisioned Successfully!"}</strong>
          <div style="margin-top:6px;font-size:13px;line-height:1.5">
            <div>• <strong>User ID:</strong> <span class="mono">${newUser.id}</span></div>
            <div>• <strong>Email:</strong> ${escape(newUser.email)}</div>
            <div>• <strong>${isVi ? "Mật khẩu" : "Password"}:</strong> <span class="mono">${escape(newUser.password)}</span></div>
            <div>• <strong>${isVi ? "Vai trò" : "Role"}:</strong> ${escape(newUser.role)}</div>
          </div>
          <div class="muted" style="margin-top:6px;font-size:12px">${isVi ? "Nhân sự có thể đăng nhập ngay bằng Email hoặc User ID trên bất kỳ thiết bị nào." : "The officer can now sign in immediately using Email or User ID on any device."}</div>
        `;
      }

      rootModal.querySelector("#prov-name").value = "";
      rootModal.querySelector("#prov-email").value = "";
      rootModal.querySelector("#prov-phone").value = "";

      mountHeaderProfile();
    });
  }


  function mountHeaderProfile() {
    let container = document.querySelector("#header-profile-slot") || document.querySelector("[data-user-profile-slot]");
    if (!container) {
      const dispatchTopRow = document.querySelector(".portal-top > .row:last-child");
      const appHeaderTools = document.querySelector(".app-header .header-tools");
      if (dispatchTopRow) {
        dispatchTopRow.querySelectorAll(".badge.neutral, a, button").forEach((el) => {
          if (el.textContent.includes("Switch role") || el.classList.contains("badge")) el.remove();
        });
        container = document.createElement("div");
        container.id = "header-profile-slot";
        container.className = "header-profile-slot";
        dispatchTopRow.appendChild(container);
      } else if (appHeaderTools) {
        appHeaderTools.querySelectorAll("a, button").forEach((el) => {
          if (el.textContent.includes("Switch role")) el.remove();
        });
        const oldUser = document.querySelector(".app-header .header-user");
        if (oldUser) oldUser.style.display = "none";
        container = document.createElement("div");
        container.id = "header-profile-slot";
        container.className = "header-profile-slot";
        appHeaderTools.appendChild(container);
      }
    }
    if (!container) return;

    const user = currentUser();
    const users = loadUsers();
    const tz = regionTimezoneInfo();
    const isVi = (getPreferences().language || "en") === "vi";
    const roleLabel = (isVi && VI_DICTIONARY[user?.role]) ? VI_DICTIONARY[user.role] : (user?.role || "");
    const tierLabel = (isVi && VI_DICTIONARY[user?.trustTier]) ? VI_DICTIONARY[user.trustTier] : (user?.trustTier || "");

    if (!user) {
      const path = location.pathname.toLowerCase();
      const loginHref = path.startsWith("/dispatch/") ? "/dispatch/?login=1" : "/reporter/?login=1";
      container.innerHTML = `
        <div class="profile-guest-bar">
          <a class="btn secondary small" href="${loginHref}">${isVi ? "Đăng nhập" : "Sign in"}</a>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="row" style="align-items:center;gap:8px">
        <div class="profile-dropdown-wrap">
          <button type="button" class="profile-trigger" id="profile-menu-trigger" aria-expanded="false" title="Account profile">
            <span class="profile-avatar">${escape(initialsFor(user.name))}</span>
            <span class="profile-trigger-text">
              <strong>${escape(user.name)}</strong>
              <small>${user.verified ? "\u2713 " : "\u25cc "}${escape(roleLabel)}</small>
            </span>
            <span class="profile-caret">\u25BE</span>
          </button>
          <div class="profile-dropdown-menu" id="profile-dropdown-menu">
          <div class="profile-menu-head">
            <span class="profile-avatar lg">${escape(initialsFor(user.name))}</span>
            <div style="flex:1;min-width:0">
              <div class="row-between" style="gap:6px">
                <strong style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escape(user.name)}</strong>
                <span class="badge ${user.verified ? "success" : "warning"}" style="font-size:10px;padding:2px 6px">${user.verified ? (isVi ? "\u2713 \u0110\u00e3 x\u00e1c th\u1ef1c" : "\u2713 Verified") : (isVi ? "\u25cc Ch\u01b0a x\u00e1c th\u1ef1c" : "\u25cc Unverified")}</span>
              </div>
              <div class="muted" style="font-size:11px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escape(user.email)} \u00B7 ${escape(user.phone || "")}</div>
              <div class="muted" style="font-size:11px">${escape(user.organization || "SkyRescue Network")}</div>
            </div>
          </div>

          <div class="profile-menu-meta">
            <span class="badge neutral" style="font-size:10px">${escape(tierLabel)}</span>
            <span class="badge neutral mono" style="font-size:10px">\uD83D\uDD52 ${escape(tz.tzShort)}</span>
          </div>

          <div class="profile-menu-section-title">${isVi ? "Cổng hiện tại" : "Current portal"}</div>
          <div class="row" style="gap:6px">
            <span class="badge neutral" style="font-size:11px">${user.preferredPortal === "dispatch" ? "Dispatch" : "Reporter"}</span>
            <a class="btn ghost small" style="flex:1;padding:6px 8px" href="${user.preferredPortal === "dispatch" ? "/reporter/?login=1" : "/dispatch/?login=1"}">${isVi ? "Mở cổng còn lại" : "Open other portal"}</a>
          </div>

          <div class="profile-menu-actions" style="display:flex;flex-wrap:wrap;gap:6px">
            <button type="button" class="btn ghost small" style="flex:1" id="menu-edit-profile">\u2699 ${isVi ? "Ch\u1ec9nh S\u1eeda H\u1ed3 S\u01a1" : "Edit Profile"}</button>
            <button type="button" class="btn secondary small" style="flex:1" id="menu-settings">\uD83D\uDEE0 ${isVi ? "C\u00e0i \u0110\u1eb7t H\u1ec7 Th\u1ed1ng" : "Settings"}</button>
            <button type="button" class="btn danger small" style="flex:1" id="menu-logout">${isVi ? "\u0110\u0103ng Xu\u1ea5t" : "Log Out"}</button>
          </div>
        </div>
      </div>
      </div>
    `;

    const trigger = container.querySelector("#profile-menu-trigger");
    const menu = container.querySelector("#profile-dropdown-menu");
    if (trigger && menu) {
      trigger.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const isOpen = menu.classList.toggle("open");
        trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
      });
    }

    container.querySelectorAll("[data-switch-user]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const switched = setSessionUser(btn.dataset.switchUser);
        if (switched) toast(`Switched active account to ${switched.name} (${switched.role})`, "success");
      });
    });

    container.querySelector("#header-btn-provision-staff")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      openStaffProvisionModal();
    });

    container.querySelector("#menu-provision-staff")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      menu?.classList.remove("open");
      openStaffProvisionModal();
    });

    container.querySelector("#menu-edit-profile")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      menu?.classList.remove("open");
      openProfileModal();
    });

    container.querySelector("#menu-settings")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      menu?.classList.remove("open");
      openSettingsModal();
    });

    container.querySelector("#menu-logout")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      menu?.classList.remove("open");
      logoutUser();
    });
  }

  document.addEventListener("click", (ev) => {
    const menu = document.querySelector("#profile-dropdown-menu");
    if (menu && menu.classList.contains("open") && !ev.target.closest(".profile-dropdown-wrap")) {
      menu.classList.remove("open");
      document.querySelector("#profile-menu-trigger")?.setAttribute("aria-expanded", "false");
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountHeaderProfile);
  } else {
    setTimeout(mountHeaderProfile, 0);
  }

  if (window.SkyRescueStore && typeof window.SkyRescueStore.subscribe === "function") {
    window.SkyRescueStore.subscribe(() => mountHeaderProfile());
  }


  function mountLandingDemoAccounts(containerSelector = "#landing-demo-accounts", statusSelector = "#landing-auth-status") {
    const container = document.querySelector(containerSelector);
    const statusNode = document.querySelector(statusSelector);
    const active = currentUser();
    const isVi = (getPreferences().language || "en") === "vi";

    if (statusNode) {
      if (active) {
        const roleLabel = (isVi && VI_DICTIONARY[active.role]) ? VI_DICTIONARY[active.role] : active.role;
        const signedInText = isVi ? "\u2713 \u0110\u00e3 \u0111\u0103ng nh\u1eadp:" : "\u2713 Signed in:";
        const signOutText = isVi ? "\u0110\u0103ng xu\u1ea5t" : "Sign Out";
        statusNode.innerHTML = `
          <div class="row" style="gap:8px;align-items:center">
            <span class="badge success" style="font-size:12px;padding:4px 8px">${signedInText} <strong>${escape(active.name)}</strong> (${escape(roleLabel)})</span>
            <button type="button" class="btn ghost small" onclick="SkyUI.logoutUser()">${signOutText}</button>
          </div>
        `;
      } else {
        const guestText = isVi ? "Ch\u1ebf \u0111\u1ed9 Kh\u00e1ch xem" : "Guest Browsing Mode";
        const signInText = isVi ? "\u0110\u0103ng nh\u1eadp b\u1eb1ng T\u00e0i kho\u1ea3n" : "Sign In with Credentials";
        statusNode.innerHTML = `
          <div class="row" style="gap:8px;align-items:center">
            <span class="badge neutral" style="font-size:12px;padding:4px 8px">${guestText}</span>
            <button type="button" class="btn secondary small" onclick="SkyUI.openAuthModal('login')">${signInText} <span>\u2192</span></button>
          </div>
        `;
      }
    }

    if (container) {
      container.innerHTML = "";
      container.style.display = "none";
    }
  }

  
  // Auto-apply initial theme & language
  try {
    const _p = getPreferences();
    if (_p.theme && _p.theme !== "light") document.documentElement.setAttribute("data-theme", _p.theme);
    if (_p.language === "vi") {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => { applyTheme(_p.theme); applyLanguage(_p.language); });
      } else {
        setTimeout(() => { applyTheme(_p.theme); applyLanguage(_p.language); }, 0);
      }
    }
  } catch (_) {}

  enforcePageAccess(); // Run the login / Dispatch access guard as soon as ui.js loads.
  window.SkyUI = {
    escape,
    formatDate,
    formatRegionClock,
    regionTimezoneInfo,
    formatDuration,
    badge,
    typeLabel,
    severity,
    toast,
    modal,
    closeModal,
    confirm,
    empty,
    demoControls,
    bindDemoControls,
    currentUser,
    setSessionUser,
    clearSession,
    logoutUser,
    authenticate,
    authenticateForPortal,
    openAuthModal,
    ensureUser,
    openProfileModal,
    openSettingsModal,
    openStaffProvisionModal,
    applyLanguage,
    applyTheme,
    getPreferences,
    savePreferences,
    mountHeaderProfile,
    canAccess,
    canOpenDispatch,
    enforcePageAccess,
    loadUsers,
    saveUsers,
    mountLandingDemoAccounts,
    DEFAULT_USERS
  };
})();
