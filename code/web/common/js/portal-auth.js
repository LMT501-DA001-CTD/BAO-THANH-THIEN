(function () {
  "use strict";

  function init(options) {
    const portal = options.portal;
    const loginView = document.getElementById(options.loginView);
    const appView = document.getElementById(options.appView);
    const form = document.getElementById(options.form);
    const identifierInput = document.getElementById(options.identifier);
    const passwordInput = document.getElementById(options.password);
    const errorBox = document.getElementById(options.error);

    if (!loginView || !appView || !form || !identifierInput || !passwordInput || !errorBox) return;

    const url = new URL(window.location.href);
    if (url.searchParams.get("login") === "1") {
      SkyUI.clearSession();
      url.searchParams.delete("login");
      history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
    // The server session decides. Clear a page session that the server does not know.
    if (window.SkyRescueSync?.user) SkyUI.ensureUser(window.SkyRescueSync.user);
    const pageUser = SkyUI.currentUser();
    const serverUser = window.SkyRescueSync?.user;
    if (pageUser && (!serverUser || serverUser.id !== pageUser.id)) SkyUI.clearSession();

    function isAllowed(user) {
      return Boolean(user && user.preferredPortal === portal);
    }

    function renderAccess() {
      const allowed = isAllowed(SkyUI.currentUser());
      loginView.style.display = allowed ? "none" : "grid";
      appView.style.display = allowed ? "" : "none";
      document.body.classList.toggle("portal-auth-active", !allowed);
      if (allowed) {
        errorBox.style.display = "none";
        errorBox.textContent = "";
        SkyUI.mountHeaderProfile?.();
      }
    }

    function showError(message) {
      errorBox.style.display = "flex";
      errorBox.innerHTML = `<span aria-hidden="true">!</span><div>${SkyUI.escape(message)}</div>`;
    }

    function loginErrorInEnglish(message) {
      if (message.includes("không thuộc cổng Dispatch")) return "This account does not belong to the Dispatch portal.";
      if (message.includes("không thuộc cổng Reporter")) return "This account does not belong to the Reporter portal.";
      if (message.includes("Mật khẩu không chính xác")) return "Incorrect password.";
      if (message.includes("Tài khoản không tồn tại")) return "Account not found.";
      return message;
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const identifier = identifierInput.value.trim();
      const password = passwordInput.value.trim();

      if (!identifier || !password) {
        showError("Please enter your username and password.");
        (!identifier ? identifierInput : passwordInput).focus();
        return;
      }

      const result = await SkyRescueSync.login(identifier, password);
      if (!result.success) {
        showError(loginErrorInEnglish(result.error));
        passwordInput.value = "";
        passwordInput.focus();
        return;
      }

      passwordInput.value = "";
      SkyUI.ensureUser(result.user);
      SkyUI.setSessionUser(result.user.id);
      // Reload so that /api/boot.js gives the shared state for this session.
      location.reload();
    });

    window.addEventListener("skyrescue:auth:change", renderAccess);
    renderAccess();
  }

  window.SkyPortalAuth = { init };
})();
