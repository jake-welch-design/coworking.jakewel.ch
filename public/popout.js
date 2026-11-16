// Pop a pane out into an always-on-top Picture-in-Picture window (Document PiP: Chrome / Edge).
// The real pane element moves into the window, so it keeps updating live; closing the window
// puts it back. Browsers without Document PiP get no button.

(function () {
  "use strict";
  if (!("documentPictureInPicture" in window)) return;
  const workspace = document.getElementById("workspace");
  if (!workspace || !window.CoworkingLayout) return;

  document.documentElement.classList.add("has-popout");

  const ICON =
    '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">' +
    '<path d="M9 2h5v5M14 2 7.5 8.5M12 9.5V14H2V4h4.5" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
    "</svg>";

  let current = null; // { pane, win, observers }

  // While a pane is popped out, lookups made by app.js / timer.js also search its window
  const getById = document.getElementById.bind(document);
  const qs = document.querySelector.bind(document);
  document.getElementById = (id) =>
    getById(id) || (current && current.win.document.getElementById(id)) || null;
  document.querySelector = (sel) =>
    qs(sel) || (current && current.win.document.querySelector(sel)) || null;

  function paneName(pane) {
    const h = pane.querySelector("h2");
    return (h && h.textContent.trim()) || "Pane";
  }

  // One small button in each pane's top-right corner (over the title bar)
  workspace.querySelectorAll(".pane[data-pane]").forEach((pane) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pane-popout-btn";
    btn.innerHTML = ICON;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (current && current.pane === pane) close();
      else open(pane);
    });
    pane.appendChild(btn);
    label(pane, false);
  });

  function label(pane, out) {
    const btn = pane.querySelector(":scope > .pane-popout-btn");
    if (!btn) return;
    btn.title = out ? "Put back" : "Pop out";
    btn.setAttribute("aria-label", `${btn.title}: ${paneName(pane)}`);
  }

  async function open(pane) {
    const r = pane.getBoundingClientRect();
    // Must start inside the click; Chrome closes any existing PiP window itself
    const request = documentPictureInPicture.requestWindow({
      width: Math.round(Math.max(280, r.width)),
      height: Math.round(Math.max(200, r.height)),
    });
    restore();
    let win;
    try {
      win = await request;
    } catch (err) {
      console.warn("Pop-out failed:", err);
      return;
    }
    const doc = win.document;
    doc.title = paneName(pane);

    // Same stylesheets, theme and body classes (e.g. the timer alarm) as the main page
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((n) => {
      const c = n.cloneNode(true);
      if (n.href) c.href = n.href;
      doc.head.appendChild(c);
    });
    const syncTheme = () => {
      const t = document.documentElement.getAttribute("data-theme");
      if (t) doc.documentElement.setAttribute("data-theme", t);
      else doc.documentElement.removeAttribute("data-theme");
    };
    const syncBody = () => {
      doc.body.className = `pip-body ${document.body.className}`;
    };
    syncTheme();
    syncBody();
    const themeObs = new MutationObserver(syncTheme);
    themeObs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const bodyObs = new MutationObserver(syncBody);
    bodyObs.observe(document.body, { attributes: true, attributeFilter: ["class"] });

    // Page-wide handlers (Escape, click-outside menus) and activity for presence
    for (const [type, fn] of window.CoworkingDocListeners || []) {
      doc.addEventListener(type, fn);
    }
    const bump = () => window.dispatchEvent(new Event("pointermove"));
    ["pointerdown", "keydown"].forEach((t) =>
      doc.addEventListener(t, bump, { capture: true, passive: true }),
    );

    // Placeholder holds the pane's spot in the layout
    const placeholder = document.createElement("section");
    placeholder.className = "pane pane-placeholder";
    placeholder.dataset.pane = pane.dataset.pane;
    const msg = document.createElement("p");
    msg.textContent = `${paneName(pane)} is popped out.`;
    const back = document.createElement("button");
    back.type = "button";
    back.textContent = "Put back";
    back.addEventListener("click", close);
    placeholder.append(msg, back);

    const chat = pane.querySelector("#chat-messages");
    const atBottom = chat && chat.scrollHeight - chat.scrollTop - chat.clientHeight < 8;

    current = { pane, win, observers: [themeObs, bodyObs] };
    doc.body.appendChild(pane);
    window.CoworkingLayout.setSlot(pane.dataset.pane, placeholder);
    label(pane, true);
    if (atBottom) chat.scrollTop = chat.scrollHeight;

    win.addEventListener("pagehide", () => {
      if (current && current.win === win) restore();
    });
  }

  // Put the pane back into the layout (the window may already be closing)
  function restore() {
    if (!current) return;
    const { pane, observers } = current;
    current = null;
    observers.forEach((o) => o.disconnect());
    const chat = pane.querySelector("#chat-messages");
    const atBottom = chat && chat.scrollHeight - chat.scrollTop - chat.clientHeight < 8;
    window.CoworkingLayout.setSlot(pane.dataset.pane, null);
    label(pane, false);
    if (atBottom) chat.scrollTop = chat.scrollHeight;
  }

  function close() {
    if (!current) return;
    const { win } = current;
    restore();
    win.close();
  }
})();
