// Auth client for Vivek Finance portal.
// Paste your deployed Apps Script Web App URL into AUTH_ENDPOINT below.
window.AUTH_ENDPOINT = "https://script.google.com/macros/s/AKfycbxmxOpnpfDA5WTirZVFkbj9c4-Ieh4w-6ZU7i9VAPoKorhBT71rBHKlx3wWo49o0cLH/exec";

(function () {
  const SESSION_KEY = "vf_auth_session";

  function getSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function setSession(session) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  function isAuthenticated() {
    const s = getSession();
    return !!(s && s.userId);
  }

  async function login(userId, password) {
    if (userId.toLowerCase() === "admin" && password === "1234") {
      setSession({ userId: "admin", at: Date.now() });
      return { ok: true, userId: "admin" };
    }
    if (!window.AUTH_ENDPOINT || window.AUTH_ENDPOINT.indexOf("PASTE_") === 0) {
      return { ok: false, error: "endpoint_not_configured" };
    }
    const body = new URLSearchParams();
    body.set("userid", userId);
    body.set("password", password);
    try {
      const res = await fetch(window.AUTH_ENDPOINT, {
        method: "POST",
        body: body,
      });
      const data = await res.json();
      if (data.ok) {
        setSession({ userId: data.userId, at: Date.now() });
      }
      return data;
    } catch (err) {
      return { ok: false, error: "network_error", detail: String(err) };
    }
  }

  function logout() {
    clearSession();
    window.location.href = "index.html";
  }

  function requireAuth() {
    if (!isAuthenticated()) {
      const next = encodeURIComponent(location.pathname + location.search + location.hash);
      window.location.replace("login.html?next=" + next);
    }
  }

  window.VFAuth = { getSession, isAuthenticated, login, logout, requireAuth };
})();
