// Server sync adapter for SkyRescueStore.
// The page loads /api/boot.js first, so the first read is synchronous.
// Writes go to the server as entity ops. Changes from other users come by SSE and by polling.
(function () {
  "use strict";

  const PORTAL = location.pathname.startsWith("/dispatch/") ? "dispatch" : "reporter";
  const POLL_MS = 2000; // some proxies (Cloudflare Quick Tunnel) block SSE, so polling always runs
  const LOCAL_KEYS = new Set(["audit", "auditSeq", "updatedAt"]); // the server owns these keys
  const boot = window.__SKY_BOOT__ || { version: 0, state: null, user: null };

  let state = boot.state;
  let version = boot.version;
  let pending = 0;
  let queue = Promise.resolve();
  let refreshing = false;
  let onRemote = () => {};

  function api(path, options = {}) {
    return fetch(path, {
      ...options,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Portal": PORTAL, ...(options.headers || {}) }
    });
  }

  function isCollection(value) {
    return Array.isArray(value) && value.length > 0 && value.every((item) => item && typeof item === "object" && typeof item.id === "string");
  }

  // Make entity ops from two states. Without "before", send every key as "set".
  function diffOps(before, after) {
    const ops = [];
    const keys = new Set([...Object.keys(before || {}), ...Object.keys(after)]);
    keys.forEach((key) => {
      if (LOCAL_KEYS.has(key)) return;
      const a = before ? before[key] : undefined;
      const b = after[key];
      if (before && JSON.stringify(a) === JSON.stringify(b)) return;
      if (before && isCollection(a) && (isCollection(b) || (Array.isArray(b) && b.length === 0))) {
        const old = new Map(a.map((item) => [item.id, JSON.stringify(item)]));
        const ids = new Set();
        b.forEach((item, index) => {
          ids.add(item.id);
          if (old.get(item.id) !== JSON.stringify(item)) ops.push({ op: "upsert", key, id: item.id, index, value: item });
        });
        a.forEach((item) => { if (!ids.has(item.id)) ops.push({ op: "delete", key, id: item.id }); });
        return;
      }
      ops.push({ op: "set", key, value: b === undefined ? null : b });
    });
    return ops;
  }

  function signedOut(message) {
    window.SkyUI?.toast?.(message, "danger");
    window.SkyUI?.clearSession?.();
  }

  async function refresh() {
    if (!boot.user || refreshing || pending > 0) return;
    refreshing = true;
    try {
      const res = await api("/api/state");
      if (res.status === 401) return signedOut("Your session ended. Sign in again.");
      if (!res.ok) return;
      const data = await res.json();
      if (pending > 0 || data.version === version || !data.state) return;
      state = data.state;
      version = data.version;
      onRemote(state);
    } catch (_) {
      // The network can fail for a short time. The next poll tries again.
    } finally {
      refreshing = false;
    }
  }

  function write(after, before, audit) {
    state = after;
    if (!boot.user) return; // not signed in on the server: keep the change on this page only
    const ops = diffOps(before, after);
    if (!ops.length && !audit) return;
    pending += 1;
    queue = queue.then(async () => {
      try {
        const res = await api("/api/sync", { method: "POST", body: JSON.stringify({ ops, audit }) });
        if (res.status === 401) return signedOut("Your session ended. Sign in again.");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const missed = data.version !== version + 1; // another user changed the state in between
        version = data.version;
        if (missed) setTimeout(refresh, 0);
      } catch (error) {
        window.SkyUI?.toast?.(`Server did not save the change (${error.message}).`, "danger");
        setTimeout(refresh, 0);
      } finally {
        pending -= 1;
      }
    });
  }

  function check(serverVersion) {
    if (serverVersion !== version) refresh();
  }

  function start() {
    if (!boot.user) return;
    if ("EventSource" in window) {
      const events = new EventSource(`/api/events?portal=${PORTAL}`);
      events.onmessage = (event) => check(Number(event.data));
    }
    setInterval(async () => {
      if (pending > 0) return;
      try {
        const res = await api("/api/version");
        if (res.ok) check((await res.json()).version);
      } catch (_) {}
    }, POLL_MS);
  }

  async function login(identifier, password) {
    const res = await api("/api/login", { method: "POST", body: JSON.stringify({ identifier, password, portal: PORTAL }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { success: false, error: data.detail || `Sign-in failed (HTTP ${res.status}).` };
    return { success: true, user: data.user };
  }

  function logout() {
    return api("/api/logout", { method: "POST" }).catch(() => {});
  }

  window.SkyRescueSync = {
    portal: PORTAL,
    user: boot.user,
    read: () => state,
    write,
    login,
    logout,
    diffOps,
    setRemoteHandler: (fn) => { onRemote = fn; }
  };
  start();
})();
