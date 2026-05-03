(() => {
  const CLIENT_ID_SESSION_KEY = "mirs:clientId:session:v2";

  async function fetchUsers() {
    const res = await fetch("/api/users");
    if (!res.ok) throw new Error("Failed to load users");
    return await res.json();
  }

  // Note: we don't load snapshots client-side anymore; dashboard fetches from DB.

  function fmt(ts) {
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return ts;
    }
  }

  function rowHtml(u, idx) {
    const score = u.lastScore ?? 0;
    return `
      <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap">
        <div style="min-width:220px">
          <div style="font-weight:700">User ${idx + 1}</div>
          <div style="font-size:12px;color:var(--text-muted)">Last seen: ${fmt(u.lastSeen)}</div>
          <div style="font-size:12px;color:var(--text-muted)">Score: ${score || 0}/100</div>
          <div style="font-size:11px;color:var(--text-dim);margin-top:4px">clientId: ${u.clientId}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn-secondary" data-load="${u.clientId}">Load</button>
        </div>
      </div>
    `;
  }

  async function render() {
    const mount = document.getElementById("usersList");
    if (!mount) return;
    mount.innerHTML = `<div style="color:var(--text-muted);font-size:13px">Loading…</div>`;

    try {
      const data = await fetchUsers();
      const users = data?.users || [];
      if (!users.length) {
        mount.innerHTML = `<div style="color:var(--text-muted);font-size:13px">No saved users yet. Complete an assessment first.</div>`;
        return;
      }

      mount.innerHTML = users.map((u, i) => `<div class="card" style="padding:14px;margin:0">${rowHtml(u, i)}</div>`).join("");

      mount.querySelectorAll("button[data-load]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const clientId = btn.getAttribute("data-load");
          btn.disabled = true;
          try {
            sessionStorage.setItem(CLIENT_ID_SESSION_KEY, clientId);
            // Dashboard will fetch latest from DB using clientId
            window.location.href = `dashboard.html?clientId=${encodeURIComponent(clientId)}`;
          } catch (e) {
            alert(String(e?.message || e));
          } finally {
            btn.disabled = false;
          }
        });
      });
    } catch (e) {
      mount.innerHTML = `<div style="color:var(--red);font-size:13px">Failed to load users: ${String(e?.message || e)}</div>`;
    }
  }

  document.addEventListener("DOMContentLoaded", render);
})();

