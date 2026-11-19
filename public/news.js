// Newspaper pane: headlines per category from /api/news (several outlets' RSS, mixed and cached on the server).

(function () {
  "use strict";

  const CATEGORIES = [
    ["top", "Top"],
    ["us", "U.S."],
    ["politics", "Politics"],
    ["world", "World"],
    ["business", "Business"],
    ["tech", "Tech"],
    ["science", "Science"],
    ["arts", "Arts"],
  ];
  const REFRESH_MS = 15 * 60 * 1000;
  const STORAGE_KEY = "coworking.news.category";

  const cats = document.getElementById("news-cats");
  const list = document.getElementById("news-list");
  const status = document.getElementById("news-status");
  if (!cats || !list) return;

  let active = "top";
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (CATEGORIES.some(([k]) => k === saved)) active = saved;
  } catch {}
  let requestId = 0;

  CATEGORIES.forEach(([key, label]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "news-cat";
    btn.dataset.category = key;
    btn.setAttribute("role", "tab");
    btn.textContent = label;
    btn.addEventListener("click", () => {
      if (key === active) return;
      active = key;
      try {
        localStorage.setItem(STORAGE_KEY, key);
      } catch {}
      load();
    });
    cats.appendChild(btn);
  });

  function setStatus(text) {
    status.textContent = text || "";
    status.hidden = !text;
  }

  function fmtTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const sameDay = d.toDateString() === new Date().toDateString();
    return sameDay
      ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : d.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  function render(items) {
    list.innerHTML = "";
    items.forEach((it) => {
      const li = document.createElement("li");
      li.className = "news-item";
      const a = document.createElement("a");
      a.href = it.link;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className = "news-title";
      a.textContent = it.title;
      li.appendChild(a);
      const meta = [it.source, fmtTime(it.published_at)].filter(Boolean).join(" · ");
      if (meta) {
        const time = document.createElement("span");
        time.className = "news-time";
        time.textContent = ` ${meta}`;
        li.appendChild(time);
      }
      if (it.summary) {
        const p = document.createElement("p");
        p.className = "news-summary";
        p.textContent = it.summary;
        li.appendChild(p);
      }
      list.appendChild(li);
    });
  }

  async function load() {
    cats.querySelectorAll(".news-cat").forEach((b) => {
      const on = b.dataset.category === active;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
    });
    const id = ++requestId;
    if (!list.children.length) setStatus("Loading…");
    try {
      const res = await fetch(
        `/api/news?category=${encodeURIComponent(active)}`,
        { credentials: "same-origin" },
      );
      const data = await res.json().catch(() => ({}));
      if (id !== requestId) return; // a newer category was picked meanwhile
      if (res.status === 401) {
        list.innerHTML = "";
        setStatus("Log in to read the news.");
        return;
      }
      if (!res.ok) throw new Error(data.error || "Could not load news.");
      render(data.items || []);
      setStatus(data.items && data.items.length ? "" : "No stories right now.");
      list.scrollTop = 0;
    } catch (err) {
      if (id !== requestId) return;
      setStatus(err.message || "Could not load news.");
    }
  }

  load();
  setInterval(load, REFRESH_MS);
})();
