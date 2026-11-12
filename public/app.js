// Coworking frontend — directory, DMs, chat tabs, NTS radio

(function () {
  "use strict";

  const state = {
    user: null,
    config: { arenaConfigured: false, passcodeRequired: false },
    messages: [], // group chat
    users: [], // directory
    folders: [],
    activeFolderId: null,
    activeFolderBlocks: [],
    events: [],
    calYear: new Date().getFullYear(),
    calMonth: new Date().getMonth(),
    selectedDateKey: null,
    stateToken: "",
    // Chat tabs
    activeTab: "group", // 'group' or a user id (number)
    dmTabs: [], // array of { id, username, name_color, name_font }
    dmMessages: {}, // { [userId]: [...messages] }
    dmPolling: {}, // { [userId]: intervalId }
    pendingInvite: null, // directory user being invited via "Invite to call"
    openUserMenu: null, // directory user id whose ••• menu is open
  };

  const el = {
    workspace: document.getElementById("workspace"),
    authBar: document.getElementById("auth-bar"),
    nextCallContent: document.getElementById("next-call-content"),
    foldersListView: document.getElementById("folders-list-view"),
    folderDetailView: document.getElementById("folder-detail-view"),
    newFolderDetails: document.getElementById("new-folder-details"),
    newFolderForm: document.getElementById("new-folder-form"),
    folderTitleInput: document.getElementById("folder-title-input"),
    folderSlugInput: document.getElementById("folder-slug-input"),
    folderFormError: document.getElementById("folder-form-error"),
    foldersList: document.getElementById("folders-list"),
    backToFoldersLink: document.getElementById("back-to-folders-link"),
    syncFolderLink: document.getElementById("sync-folder-link"),
    activeFolderMeta: document.getElementById("active-folder-meta"),
    blockDropzone: document.getElementById("block-dropzone"),
    addBlockForm: document.getElementById("add-block-form"),
    blockInput: document.getElementById("block-input"),
    blockTitleInput: document.getElementById("block-title-input"),
    blockFileInput: document.getElementById("block-file-input"),
    blockNoteInput: document.getElementById("block-note-input"),
    activeFolderTitle: document.getElementById("active-folder-title"),
    toggleAddBlockBtn: document.getElementById("toggle-add-block-btn"),
    addBlockSubmitBtn: document.getElementById("add-block-submit-btn"),
    blockUploadStatus: document.getElementById("block-upload-status"),
    blockFormError: document.getElementById("block-form-error"),
    blocksList: document.getElementById("blocks-list"),
    chatTabs: document.getElementById("chat-tabs"),
    chatMessages: document.getElementById("chat-messages"),
    chatForm: document.getElementById("chat-form"),
    chatInput: document.getElementById("chat-input"),
    chatSendBtn: document.getElementById("chat-send-btn"),
    directoryList: document.getElementById("directory-list"),
    newEventDetails: document.getElementById("new-event-details"),
    newEventForm: document.getElementById("new-event-form"),
    eventTitleInput: document.getElementById("event-title-input"),
    eventDateInput: document.getElementById("event-date-input"),
    eventTimeInput: document.getElementById("event-time-input"),
    eventDurationInput: document.getElementById("event-duration-input"),
    eventLocationInput: document.getElementById("event-location-input"),
    eventNotesInput: document.getElementById("event-notes-input"),
    eventFormError: document.getElementById("event-form-error"),
    calPrevLink: document.getElementById("cal-prev-link"),
    calNextLink: document.getElementById("cal-next-link"),
    calTodayLink: document.getElementById("cal-today-link"),
    calAscii: document.getElementById("calendar-ascii"),
    eventsListHeading: document.getElementById("events-list-heading"),
    clearDateFilterLink: document.getElementById("clear-date-filter-link"),
    eventsList: document.getElementById("events-list"),
  };

  async function api(path, options = {}) {
    const opts = {
      credentials: "same-origin",
      ...options,
      headers: { ...(options.headers || {}) },
    };
    if (
      opts.body &&
      typeof opts.body === "object" &&
      !(opts.body instanceof FormData)
    ) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    // Members only: a lapsed session sends you back to log in
    if (res.status === 401) {
      window.location.replace("/login.html");
      return new Promise(() => {}); // never settles, so no error alerts flash before the redirect
    }
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  }

  function isVeryLightHex(hex) {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex || "")) return false;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b > 225;
  }

  // Picks readable text color for a user-colored background
  function isLightHex(hex) {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex || "")) return true;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b > 150;
  }

  function applyUserStyle(node, color, font) {
    const c = /^#[0-9a-fA-F]{6}$/.test(color || "") ? color : "#000000";
    node.style.color = c;
    node.style.fontFamily = font || "Georgia, serif";
    node.style.textShadow = isVeryLightHex(c) ? "0 0 1px #000000" : "none";
  }

  function badge(username, color, font) {
    const span = document.createElement("span");
    span.textContent = username || "unknown";
    applyUserStyle(span, color, font);
    return span;
  }

  function actionLink(label, onClick) {
    const a = document.createElement("a");
    a.href = "#";
    a.textContent = label;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      onClick(e);
    });
    return a;
  }

  function linkify(container, text) {
    const raw = String(text || "");
    const re = /(https?:\/\/[^\s<>"']+)/gi;
    let last = 0,
      m;
    while ((m = re.exec(raw)) !== null) {
      if (m.index > last)
        container.appendChild(
          document.createTextNode(raw.slice(last, m.index)),
        );
      let url = m[0],
        trail = "";
      while (/[.,;:!?)]$/.test(url)) {
        trail = url.slice(-1) + trail;
        url = url.slice(0, -1);
      }
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = url;
      container.appendChild(a);
      if (trail) container.appendChild(document.createTextNode(trail));
      last = re.lastIndex;
    }
    if (last < raw.length)
      container.appendChild(document.createTextNode(raw.slice(last)));
  }

  function dateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function fmtBytes(b) {
    if (!b || b < 1024) return `${b || 0} B`;
    if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1048576).toFixed(1)} MB`;
  }

  // Chat day separator: "DD Month YYYY", e.g. "11 November 2026"
  function fmtDay(d) {
    const month = d.toLocaleDateString([], { month: "long" });
    return `${String(d.getDate()).padStart(2, "0")} ${month} ${d.getFullYear()}`;
  }

  function fmtDT(iso) {
    return new Date(iso).toLocaleString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  }

  function nextEvent() {
    const now = Date.now();
    for (const ev of state.events) {
      const s = Date.parse(ev.starts_at);
      if (!isNaN(s) && s + (ev.duration_minutes || 60) * 60000 > now) return ev;
    }
    return null;
  }

  function openMailto(to, subject = "", body = "") {
    const params = new URLSearchParams();
    if (subject) params.set("subject", subject);
    if (body) params.set("body", body);
    const qs = params.toString().replace(/\+/g, "%20");
    window.location.href = `mailto:${encodeURIComponent(to)}${qs ? `?${qs}` : ""}`;
  }

  // Pre-filled invite email for a call that was just scheduled
  function emailInvite(invitee, ev) {
    const lines = [
      `Hi ${invitee.username},`,
      "",
      `You're invited to "${ev.title}".`,
      "",
      `When: ${fmtDT(ev.starts_at)} (${ev.duration_minutes} min)`,
      `Where: ${ev.location}`,
    ];
    if (ev.notes) lines.push(`Notes: ${ev.notes}`);
    lines.push(
      "",
      `Calendar: ${location.origin}`,
      "",
      `— ${state.user?.username || ""}`,
    );
    openMailto(invitee.email, `Invite: ${ev.title}`, lines.join("\n"));
  }

  // Directory drawer inside the Lounge pane
  function setDirectoryOpen(open) {
    const drawer = document.getElementById("directory-drawer");
    const btn = document.getElementById("directory-toggle-btn");
    drawer.classList.toggle("open", open);
    drawer.setAttribute("aria-hidden", String(!open));
    btn.setAttribute("aria-expanded", String(open));
  }

  // On mobile all panes are stacked; bring the requested one into view
  function setMobileView(v) {
    if (!window.matchMedia("(max-width: 768px)").matches) return;
    const pane = document.getElementById(`${v}-pane`);
    if (pane) pane.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function requireAuth() {
    if (state.user) return true;
    window.location.href = "/login.html";
    return false;
  }

  // --- Chat Tabs ---

  function openDMTab(user) {
    if (!state.dmTabs.some((t) => t.id === user.id)) {
      state.dmTabs.push({
        id: user.id,
        username: user.username,
        name_color: user.name_color,
        name_font: user.name_font,
      });
    }
    state.activeTab = user.id;
    renderChatTabs();
    loadDM(user.id);
  }

  function closeDMTab(userId) {
    state.dmTabs = state.dmTabs.filter((t) => t.id !== userId);
    delete state.dmMessages[userId];
    if (state.dmPolling[userId]) {
      clearInterval(state.dmPolling[userId]);
      delete state.dmPolling[userId];
    }
    if (state.activeTab === userId) state.activeTab = "group";
    renderChatTabs();
    renderActiveChat();
  }

  async function loadDM(userId) {
    try {
      const d = await api(`/api/dm/${userId}`);
      state.dmMessages[userId] = d.messages || [];
    } catch {
      state.dmMessages[userId] = [];
    }
    renderActiveChat(true);
    // start polling for this DM
    if (!state.dmPolling[userId]) {
      state.dmPolling[userId] = setInterval(() => pollDM(userId), 4000);
    }
  }

  async function pollDM(userId) {
    if (document.hidden || state.activeTab !== userId) return;
    try {
      const d = await api(`/api/dm/${userId}`);
      const prev = state.dmMessages[userId] || [];
      const sig = (list) =>
        `${list.length}:${list.length ? list[list.length - 1].id : 0}`;
      if (d.messages && sig(d.messages) !== sig(prev)) {
        state.dmMessages[userId] = d.messages;
        renderActiveChat(false);
      }
    } catch {}
  }

  function renderChatTabs() {
    el.chatTabs.innerHTML = "";
    // Group tab (always present, can't be closed)
    const groupTab = document.createElement("span");
    groupTab.className =
      "chat-tab" + (state.activeTab === "group" ? " active" : "");
    groupTab.textContent = "Group";
    groupTab.addEventListener("click", () => {
      state.activeTab = "group";
      renderChatTabs();
      renderActiveChat();
    });
    el.chatTabs.appendChild(groupTab);

    // DM tabs
    for (const t of state.dmTabs) {
      const tab = document.createElement("span");
      tab.className =
        "chat-tab chat-tab-dm" + (state.activeTab === t.id ? " active" : "");
      tab.dataset.tab = t.id;

      const bg = /^#[0-9a-fA-F]{6}$/.test(t.name_color || "")
        ? t.name_color
        : "#000000";
      tab.style.background = bg;
      tab.style.color = isLightHex(bg) ? "#000000" : "#ffffff";

      const nameSpan = document.createElement("span");
      nameSpan.textContent = t.username;
      nameSpan.style.fontFamily = t.name_font || "Georgia, serif";
      nameSpan.style.cursor = "pointer";
      nameSpan.addEventListener("click", () => {
        state.activeTab = t.id;
        renderChatTabs();
        renderActiveChat();
      });
      tab.appendChild(nameSpan);

      const closeBtn = document.createElement("span");
      closeBtn.className = "chat-tab-close";
      closeBtn.textContent = " ×";
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        closeDMTab(t.id);
      });
      tab.appendChild(closeBtn);

      el.chatTabs.appendChild(tab);
    }
  }

  function renderActiveChat(forceBottom = false) {
    if (state.activeTab === "group") {
      renderChat(forceBottom);
    } else {
      renderDMChat(state.activeTab, forceBottom);
    }
  }

  // --- Render ---

  function renderAuthBar() {
    el.authBar.innerHTML = "";
    if (!state.user) {
      el.authBar.innerHTML =
        '<a href="/login.html">Log in</a> / <a href="/signup.html">Sign up</a>';
      el.chatInput.placeholder = "Log in to post";
      return;
    }
    el.authBar.appendChild(
      badge(state.user.username, state.user.name_color, state.user.name_font),
    );
    el.authBar.appendChild(document.createTextNode(" "));
    // Opt in to letting other members email you from the directory
    const allowLabel = document.createElement("label");
    allowLabel.id = "allow-emails-label";
    const allowBox = document.createElement("input");
    allowBox.type = "checkbox";
    allowBox.checked = Boolean(state.user.allow_emails);
    allowBox.addEventListener("change", async () => {
      allowBox.disabled = true;
      try {
        const d = await api("/api/auth/profile", {
          method: "PATCH",
          body: { allow_emails: allowBox.checked },
        });
        state.user = { ...state.user, ...d.user };
        const ur = await api("/api/users");
        state.users = ur.users || [];
        renderDirectory();
      } catch (e) {
        allowBox.checked = !allowBox.checked;
        alert(e.message);
      } finally {
        allowBox.disabled = false;
      }
    });
    allowLabel.appendChild(allowBox);
    allowLabel.appendChild(document.createTextNode(" allow emails"));
    el.authBar.appendChild(document.createTextNode("· "));
    const styleLink = document.createElement("a");
    styleLink.href = "/style.html";
    styleLink.textContent = "Style";
    el.authBar.appendChild(styleLink);
    el.authBar.appendChild(document.createTextNode(" · "));
    el.authBar.appendChild(allowLabel);
    if ("Notification" in window) {
      el.authBar.appendChild(document.createTextNode(" · "));
      el.authBar.appendChild(notifyCheckbox());
    }
    el.authBar.appendChild(document.createTextNode(" · "));
    el.authBar.appendChild(
      actionLink("Log out", async () => {
        await api("/api/auth/logout", { method: "POST" }).catch(() => {});
        state.user = null;
        state.dmMaxId = undefined;
        renderAll();
      }),
    );
    el.chatInput.placeholder = "Message";
  }

  // --- Browser notifications for chat (opt-in per browser, since permission is per browser) ---
  const NOTIFY_KEY = "coworking.notify";
  function notifyEnabled() {
    if (!("Notification" in window) || Notification.permission !== "granted")
      return false;
    try {
      return localStorage.getItem(NOTIFY_KEY) === "1";
    } catch {
      return false;
    }
  }
  function setNotifyPref(on) {
    try {
      localStorage.setItem(NOTIFY_KEY, on ? "1" : "0");
    } catch {}
  }

  function notifyCheckbox() {
    const label = document.createElement("label");
    label.id = "notify-label";
    label.className = "header-check";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = notifyEnabled();
    box.addEventListener("change", async () => {
      if (!box.checked) {
        setNotifyPref(false);
        return;
      }
      let perm = Notification.permission;
      if (perm === "default") perm = await Notification.requestPermission();
      if (perm !== "granted") {
        box.checked = false;
        setNotifyPref(false);
        alert(
          "Notifications are blocked for this site. Allow them in your browser's site settings, then try again.",
        );
        return;
      }
      setNotifyPref(true);
    });
    label.appendChild(box);
    label.appendChild(document.createTextNode(" notifications"));
    return label;
  }

  // Only pop up when the person isn't looking at the page
  function shouldNotify() {
    return notifyEnabled() && (document.hidden || !document.hasFocus());
  }

  function showNotification(title, body, onClick) {
    body = String(body || "").trim() || "Sent an attachment";
    try {
      const n = new Notification(title, {
        body: body.length > 140 ? body.slice(0, 139) + "…" : body,
        tag: "coworking-chat",
      });
      n.onclick = () => {
        window.focus();
        n.close();
        onClick?.();
      };
    } catch {}
  }

  function notifyGroup(msgs) {
    const mine = state.user?.id;
    const others = msgs.filter((m) => m.user_id !== mine);
    if (!others.length || !shouldNotify()) return;
    const last = others[others.length - 1];
    const title =
      others.length > 1
        ? `${others.length} new messages in Lounge`
        : `${last.username} in Lounge`;
    showNotification(
      title,
      others.length > 1 ? `${last.username}: ${last.body}` : last.body,
      () => {
        state.activeTab = "group";
        renderChatTabs();
        renderActiveChat(true);
        setMobileView("lounge");
      },
    );
  }

  function notifyDMs(dms) {
    if (!dms.length) return;
    // Keep any open conversation with these senders up to date
    for (const id of new Set(dms.map((d) => d.from_user_id))) {
      if (state.dmTabs.some((t) => t.id === id)) {
        api(`/api/dm/${id}`)
          .then((d) => {
            state.dmMessages[id] = d.messages || [];
            if (state.activeTab === id) renderActiveChat(false);
          })
          .catch(() => {});
      }
    }
    if (!shouldNotify()) return;
    const last = dms[dms.length - 1];
    const title =
      dms.length > 1
        ? `${dms.length} new direct messages`
        : `${last.username} (direct message)`;
    showNotification(
      title,
      dms.length > 1 ? `${last.username}: ${last.body}` : last.body,
      () => {
        const u = state.users.find((x) => x.id === last.from_user_id) || {
          id: last.from_user_id,
          username: last.username,
          name_color: last.name_color,
          name_font: last.name_font,
        };
        openDMTab(u);
        setMobileView("lounge");
      },
    );
  }

  // Rebuild the banner loop after the window is resized so it still spans the screen
  let bannerResizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(bannerResizeTimer);
    bannerResizeTimer = setTimeout(renderBanner, 200);
  });

  // Builds one copy of the banner text; repeated to make a continuous loop
  function bannerItem(ev) {
    const item = document.createElement("span");
    item.className = "banner-item";
    const label = document.createElement("strong");
    label.textContent = "Next call:";
    item.appendChild(label);
    item.appendChild(document.createTextNode(" "));
    if (!ev) {
      item.appendChild(document.createTextNode("none"));
      return item;
    }
    const now = Date.now(),
      s = Date.parse(ev.starts_at),
      e = s + (ev.duration_minutes || 60) * 60000;
    if (now >= s && now < e)
      item.appendChild(document.createTextNode("[Now] "));
    item.appendChild(
      actionLink(ev.title, () => {
        setMobileView("calendar");
        state.calYear = new Date(ev.starts_at).getFullYear();
        state.calMonth = new Date(ev.starts_at).getMonth();
        renderCalendar();
      }),
    );
    item.appendChild(document.createTextNode(` — ${fmtDT(ev.starts_at)} — `));
    linkify(item, ev.location || "FaceTime");
    if (ev.creator_username) {
      item.appendChild(document.createTextNode(" — Hosted by "));
      // Username chip: the creator's chosen color as background; white text, or black if the color is too bright
      const chip = badge(
        ev.creator_username,
        ev.creator_color,
        ev.creator_font,
      );
      const bg = /^#[0-9a-fA-F]{6}$/.test(ev.creator_color || "")
        ? ev.creator_color
        : "#000000";
      chip.className = "banner-user";
      chip.style.background = bg;
      chip.style.color = isLightHex(bg) ? "#000000" : "#ffffff";
      chip.style.textShadow = "none";
      item.appendChild(chip);
    }
    return item;
  }

  function renderBanner() {
    const ev = nextEvent();
    // Seamless loop: the track holds two identical halves and scrolls left by exactly one half,
    // so the end joins the start with no gap. Each half repeats the item enough to span the screen.
    const sample = bannerItem(ev);
    const track = el.nextCallContent;
    const sig = `${sample.outerHTML}|${window.innerWidth}`;
    if (track.dataset.sig === sig) return; // unchanged: leave the animation running smoothly
    track.dataset.sig = sig;
    track.innerHTML = "";
    const half = document.createElement("div");
    half.className = "banner-half";
    half.appendChild(sample);
    track.appendChild(half);
    const itemW = sample.getBoundingClientRect().width || 300;
    const copies = Math.max(1, Math.ceil(window.innerWidth / itemW));
    for (let i = 1; i < copies; i++) half.appendChild(bannerItem(ev));
    const second = half.cloneNode(true);
    second.setAttribute("aria-hidden", "true");
    track.appendChild(second);
    // Constant speed (~60px/s) whatever the text length
    const halfW = half.getBoundingClientRect().width;
    track.style.animationDuration = `${Math.max(5, halfW / 60)}s`;
  }

  // --- Chat attachments ---
  const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

  function fmtBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  // Images show as a thumbnail; anything else as a link with its size
  function attachmentEl(msg) {
    const href = `/api/files/${msg.attachment_id}/${encodeURIComponent(msg.attachment_name || "file")}`;
    const wrap = document.createElement("div");
    wrap.className = "chat-attachment";
    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    const type = String(msg.attachment_type || "").toLowerCase();
    if (type.startsWith("image/") && type !== "image/svg+xml") {
      const img = document.createElement("img");
      img.src = href;
      img.alt = msg.attachment_name || "image";
      img.loading = "lazy";
      img.className = "chat-image";
      a.appendChild(img);
    } else {
      a.textContent = `${msg.attachment_name || "file"} (${fmtBytes(msg.attachment_size || 0)})`;
    }
    wrap.appendChild(a);
    return wrap;
  }

  function setPendingFile(file) {
    if (file && file.size > MAX_ATTACHMENT_BYTES) {
      alert(
        `That file is ${fmtBytes(file.size)}. Attachments can be up to 10 MB.`,
      );
      file = null;
    }
    state.pendingFile = file || null;
    const box = document.getElementById("chat-pending");
    box.hidden = !state.pendingFile;
    document.getElementById("chat-pending-name").textContent = state.pendingFile
      ? `Attached: ${state.pendingFile.name} (${fmtBytes(state.pendingFile.size)})`
      : "";
  }

  async function uploadPendingFile() {
    const fd = new FormData();
    fd.append("file", state.pendingFile, state.pendingFile.name);
    const d = await api("/api/chat-attachments", { method: "POST", body: fd });
    return d.attachment.id;
  }

  // One chat line; your own messages get a × delete button that shows on hover
  function chatLine(msg, d, authorId, onDelete) {
    const line = document.createElement("div");
    line.className = "chat-line";
    const t = document.createElement("small");
    t.className = "chat-time";
    t.textContent = d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    line.appendChild(t);
    const who = badge(msg.username, msg.name_color, msg.name_font);
    who.classList.add("chat-user");
    line.appendChild(who);
    line.appendChild(document.createTextNode(": "));
    linkify(line, msg.body);
    if (msg.attachment_id) line.appendChild(attachmentEl(msg));
    if (state.user && authorId === state.user.id) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "chat-delete";
      del.textContent = "×";
      del.title = "Delete message";
      del.setAttribute("aria-label", "Delete message");
      del.addEventListener("click", async () => {
        if (!confirm("Delete this message?")) return;
        try {
          await onDelete();
        } catch (e) {
          alert(e.message);
        }
      });
      line.appendChild(del);
    }
    return line;
  }

  function renderChat(forceBottom = false) {
    const stick =
      forceBottom ||
      el.chatMessages.scrollHeight -
        el.chatMessages.scrollTop -
        el.chatMessages.clientHeight <
        60;
    el.chatMessages.innerHTML = "";
    // Chat is members-only
    el.chatForm.hidden = !state.user;
    if (!state.user) {
      el.chatMessages.innerHTML =
        '<p class="chat-login"><a href="/login.html">Login to join</a></p>';
      return;
    }
    if (!state.messages.length) {
      el.chatMessages.innerHTML = "<p>No messages.</p>";
      return;
    }
    let prevDay = "";
    for (const msg of state.messages) {
      const d = new Date(msg.created_at);
      const day = fmtDay(d);
      if (day !== prevDay) {
        prevDay = day;
        const p = document.createElement("p");
        p.className = "chat-day";
        p.textContent = day;
        el.chatMessages.appendChild(p);
      }
      el.chatMessages.appendChild(
        chatLine(msg, d, msg.user_id, async () => {
          await api(`/api/messages/${msg.id}`, { method: "DELETE" });
          state.messages = state.messages.filter((m) => m.id !== msg.id);
          renderChat(false);
        }),
      );
    }
    if (stick) el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  }

  function renderDMChat(userId, forceBottom = false) {
    const msgs = state.dmMessages[userId] || [];
    const stick =
      forceBottom ||
      el.chatMessages.scrollHeight -
        el.chatMessages.scrollTop -
        el.chatMessages.clientHeight <
        60;
    el.chatMessages.innerHTML = "";
    if (!msgs.length) {
      el.chatMessages.innerHTML = "<p>No messages yet.</p>";
      return;
    }
    let prevDay = "";
    for (const msg of msgs) {
      const d = new Date(msg.created_at);
      const day = fmtDay(d);
      if (day !== prevDay) {
        prevDay = day;
        const p = document.createElement("p");
        p.className = "chat-day";
        p.textContent = day;
        el.chatMessages.appendChild(p);
      }
      el.chatMessages.appendChild(
        chatLine(msg, d, msg.from_user_id, async () => {
          await api(`/api/dm-messages/${msg.id}`, { method: "DELETE" });
          state.dmMessages[userId] = (state.dmMessages[userId] || []).filter(
            (m) => m.id !== msg.id,
          );
          renderDMChat(userId, false);
        }),
      );
    }
    if (stick) el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  }

  function renderDirectory() {
    el.directoryList.innerHTML = "";
    if (!state.users.length) {
      el.directoryList.innerHTML = "<li>No users yet.</li>";
      return;
    }
    for (const u of state.users) {
      const li = document.createElement("li");
      const status = u.status || "offline";
      const dot = document.createElement("span");
      dot.className = `presence-dot presence-${status}`;
      dot.title = status.charAt(0).toUpperCase() + status.slice(1);
      dot.setAttribute("aria-label", dot.title);
      li.appendChild(dot);
      li.appendChild(badge(u.username, u.name_color, u.name_font));
      if (state.user && u.id === state.user.id) {
        li.appendChild(document.createTextNode(" (you)"));
        el.directoryList.appendChild(li);
        continue;
      }
      // Options live behind a ••• toggle at the right of the row
      const moreBtn = document.createElement("button");
      moreBtn.type = "button";
      moreBtn.className = "user-more-btn";
      moreBtn.textContent = "•••";
      moreBtn.title = `Options for ${u.username}`;
      moreBtn.setAttribute("aria-label", `Options for ${u.username}`);
      const isOpen = state.openUserMenu === u.id;
      moreBtn.setAttribute("aria-expanded", String(isOpen));
      moreBtn.addEventListener("click", () => {
        state.openUserMenu = isOpen ? null : u.id;
        renderDirectory();
      });
      li.appendChild(moreBtn);

      const menu = document.createElement("div");
      menu.className = "user-menu";
      menu.hidden = !isOpen;

      const chatBtn = document.createElement("button");
      chatBtn.textContent = "Chat";
      chatBtn.addEventListener("click", () => {
        if (!requireAuth()) return;
        state.openUserMenu = null;
        setDirectoryOpen(false);
        openDMTab(u);
      });
      menu.appendChild(chatBtn);

      if (u.email) {
        const emailBtn = document.createElement("button");
        emailBtn.textContent = "Email";
        emailBtn.addEventListener("click", () => openMailto(u.email));
        menu.appendChild(emailBtn);
      }

      const callBtn = document.createElement("button");
      callBtn.textContent = "Invite to call";
      callBtn.addEventListener("click", () => {
        if (!requireAuth()) return;
        state.openUserMenu = null;
        // Pre-fill a new event and open the form
        setEventFormMode(null);
        el.eventTitleInput.value = `Call with ${u.username}`;
        state.pendingInvite = u; // emailed the call details once it's created (if they allow emails)
        ensureEventDefaults();
        el.newEventDetails.open = true;
        setDirectoryOpen(false);
        setMobileView("calendar");
      });
      menu.appendChild(callBtn);
      li.appendChild(menu);

      el.directoryList.appendChild(li);
    }
  }

  function renderFolders() {
    el.foldersList.innerHTML = "";
    if (!state.folders.length) {
      el.foldersList.innerHTML = "<li>No folders.</li>";
      return;
    }
    for (const f of state.folders) {
      const li = document.createElement("li");
      li.appendChild(actionLink(f.title, () => openFolder(f.id)));
      li.appendChild(document.createTextNode(` (${f.block_count || 0})`));
      attachDrop(li, async (p) => {
        await dropInFolder(f.id, p);
        await openFolder(f.id);
      });
      el.foldersList.appendChild(li);
    }
  }

  // Where clicking a block goes: its external link if it has one, otherwise the block on Are.na
  function blockHref(b) {
    const src = b.source_url || "";
    const isOwnFile =
      src.startsWith(`${location.origin}/api/files/`) ||
      src.startsWith("/api/files/");
    if (src && !isOwnFile && b.block_type !== "image") return src;
    if (b.arena_block_id) return `https://www.are.na/block/${b.arena_block_id}`;
    return src || b.image_url || null;
  }

  function newTabLink(href, text) {
    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    if (text != null) a.textContent = text;
    return a;
  }

  // Rename form for a folder you made (also renames its Are.na channel)
  function folderEditForm(f) {
    const form = document.createElement("form");
    form.className = "block-edit";
    const label = document.createElement("label");
    label.textContent = "Folder name";
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 100;
    input.value = f.title;
    const row = document.createElement("p");
    row.className = "block-edit-actions";
    const save = document.createElement("button");
    save.type = "submit";
    save.textContent = "Save";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    row.append(save, cancel);
    form.append(label, input, row);
    cancel.addEventListener("click", () => {
      state.editingFolderId = null;
      renderFolder();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") cancel.click();
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      save.disabled = true;
      save.textContent = "Saving…";
      try {
        const d = await api(`/api/folders/${f.id}`, {
          method: "PATCH",
          body: { title: input.value },
        });
        state.folders = d.folders || state.folders;
        state.editingFolderId = null;
        renderFolders();
        renderFolder();
      } catch (err) {
        alert(err.message);
        save.disabled = false;
        save.textContent = "Save";
      }
    });
    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
    return form;
  }

  // Inline edit form for a block you shared: title, text (text blocks) and note
  function blockEditForm(b) {
    const form = document.createElement("form");
    form.className = "block-edit";
    const field = (labelText, el) => {
      const label = document.createElement("label");
      label.textContent = labelText;
      form.append(label, el);
      return el;
    };
    const title = field("Title", document.createElement("input"));
    title.type = "text";
    title.maxLength = 300;
    title.value = b.title || "";
    let content = null;
    if (b.block_type === "text") {
      content = field("Text", document.createElement("textarea"));
      content.rows = 4;
      content.value = b.content || "";
    }
    const note = field("Note (optional)", document.createElement("textarea"));
    note.rows = 2;
    note.maxLength = 2000;
    note.value = b.note || "";
    const row = document.createElement("p");
    row.className = "block-edit-actions";
    const save = document.createElement("button");
    save.type = "submit";
    save.textContent = "Save";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    row.append(save, cancel);
    form.appendChild(row);
    cancel.addEventListener("click", () => {
      state.editingBlockId = null;
      renderFolder();
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      save.disabled = true;
      save.textContent = "Saving…";
      try {
        const body = { title: title.value, note: note.value };
        if (content) body.content = content.value;
        const d = await api(`/api/blocks/${b.id}`, { method: "PATCH", body });
        state.activeFolderBlocks = d.blocks || state.activeFolderBlocks;
        state.editingBlockId = null;
        renderFolder();
      } catch (err) {
        alert(err.message);
        save.disabled = false;
        save.textContent = "Save";
      }
    });
    setTimeout(() => title.focus(), 0);
    return form;
  }

  function blockLI(b) {
    const li = document.createElement("li");
    if (state.editingBlockId === b.id) {
      li.appendChild(blockEditForm(b));
      return li;
    }
    const href = blockHref(b);
    if (b.image_url) {
      const a = newTabLink(href || b.image_url);
      const img = document.createElement("img");
      img.className = "block-thumb";
      img.src = b.image_url;
      img.alt = b.title || "";
      img.loading = "lazy";
      a.appendChild(img);
      li.appendChild(a);
    }
    if (b.block_type === "text") {
      if (b.title) {
        const s = document.createElement("strong");
        s.appendChild(
          href ? newTabLink(href, b.title) : document.createTextNode(b.title),
        );
        li.appendChild(s);
      }
      const q = document.createElement("blockquote");
      linkify(q, b.content || "");
      li.appendChild(q);
      if (!b.title && href) {
        li.appendChild(newTabLink(href, "Open on Are.na"));
        li.appendChild(document.createElement("br"));
      }
    } else if (b.block_type === "file") {
      const label = `${b.title || b.file_name || "File"}${b.file_size ? ` (${fmtBytes(b.file_size)})` : ""}`;
      li.appendChild(
        href ? newTabLink(href, label) : document.createTextNode(label),
      );
      li.appendChild(document.createElement("br"));
    } else if (href) {
      li.appendChild(
        newTabLink(href, b.title || b.source_url || "Open on Are.na"),
      );
      li.appendChild(document.createElement("br"));
    } else if (b.title) {
      li.appendChild(document.createTextNode(b.title));
      li.appendChild(document.createElement("br"));
    }
    if (b.note) {
      const n = document.createElement("p");
      n.className = "block-note";
      linkify(n, b.note);
      li.appendChild(n);
    }
    const sm = document.createElement("small");
    if (b.creator_username)
      sm.appendChild(
        badge(b.creator_username, b.creator_color, b.creator_font),
      );
    else if (b.arena_author)
      sm.appendChild(document.createTextNode(b.arena_author));
    const af = state.folders.find((f) => f.id === state.activeFolderId);
    if (state.user && b.created_by === state.user.id) {
      if (sm.childNodes.length) sm.appendChild(document.createTextNode(" · "));
      sm.appendChild(
        actionLink("Edit", () => {
          state.editingBlockId = b.id;
          renderFolder();
        }),
      );
    }
    if (
      state.user &&
      (b.created_by === state.user.id ||
        (af && af.created_by === state.user.id))
    ) {
      if (sm.childNodes.length) sm.appendChild(document.createTextNode(" · "));
      sm.appendChild(
        actionLink("Delete", async () => {
          if (!confirm("Delete block?")) return;
          const d = await api(`/api/blocks/${b.id}`, { method: "DELETE" });
          state.activeFolderBlocks = d.blocks || [];
          state.folders = d.folders || state.folders;
          renderFolders();
          renderFolder();
        }),
      );
    }
    li.appendChild(sm);
    return li;
  }

  function renderFolder() {
    const f = state.folders.find((f) => f.id === state.activeFolderId);
    if (!f) {
      state.activeFolderId = null;
      el.foldersListView.hidden = false;
      el.folderDetailView.hidden = true;
      return;
    }
    el.foldersListView.hidden = true;
    el.folderDetailView.hidden = false;
    el.activeFolderTitle.textContent = f.title;
    el.activeFolderMeta.innerHTML = "";
    const p = document.createElement("p");
    const sm = document.createElement("small");
    if (f.creator_username)
      sm.appendChild(
        badge(f.creator_username, f.creator_color, f.creator_font),
      );
    if (f.arena_channel_slug) {
      if (sm.childNodes.length) sm.appendChild(document.createTextNode(" · "));
      const a = document.createElement("a");
      a.href = `https://www.are.na/channel/${encodeURIComponent(f.arena_channel_slug)}`;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "Are.na";
      sm.appendChild(a);
    }
    if (state.user && f.created_by === state.user.id) {
      if (sm.childNodes.length) sm.appendChild(document.createTextNode(" · "));
      sm.appendChild(
        actionLink("Edit folder", () => {
          state.editingFolderId = f.id;
          renderFolder();
        }),
      );
      sm.appendChild(document.createTextNode(" · "));
      sm.appendChild(
        actionLink("Delete folder", async () => {
          if (!confirm(`Delete "${f.title}"?`)) return;
          const d = await api(`/api/folders/${f.id}`, { method: "DELETE" });
          state.folders = d.folders || [];
          state.activeFolderId = null;
          renderFolders();
          renderFolder();
        }),
      );
    }
    p.appendChild(sm);
    el.activeFolderMeta.appendChild(p);
    if (state.editingFolderId === f.id)
      el.activeFolderMeta.appendChild(folderEditForm(f));
    el.blocksList.innerHTML = "";
    if (!state.activeFolderBlocks.length) {
      el.blocksList.innerHTML = "<li>No blocks.</li>";
      return;
    }
    for (const b of state.activeFolderBlocks)
      el.blocksList.appendChild(blockLI(b));
  }

  // The add-block form stays hidden until "+ Add block" is pressed
  function setAddBlockOpen(open) {
    el.blockDropzone.hidden = !open;
    el.toggleAddBlockBtn.textContent = open ? "×" : "+";
    el.toggleAddBlockBtn.title = open ? "Close" : "Add block";
    el.toggleAddBlockBtn.setAttribute("aria-label", el.toggleAddBlockBtn.title);
    el.toggleAddBlockBtn.setAttribute("aria-expanded", String(open));
    if (open) el.blockInput.focus();
  }

  async function openFolder(id, sync = false) {
    state.activeFolderId = id;
    state.editingBlockId = null;
    state.editingFolderId = null;
    el.blockFormError.hidden = true;
    setAddBlockOpen(false);
    renderFolder();
    try {
      const d = await api(`/api/folders/${id}${sync ? "?sync=1" : ""}`);
      if (state.activeFolderId === id) {
        state.activeFolderBlocks = d.blocks || [];
        renderFolder();
      }
    } catch (e) {
      el.blockFormError.textContent = e.message;
      el.blockFormError.hidden = false;
    }
  }

  function attachDrop(el, cb) {
    let depth = 0;
    el.addEventListener("dragenter", (e) => {
      e.preventDefault();
      e.stopPropagation();
      depth++;
      el.classList.add("drag-over");
    });
    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.add("drag-over");
    });
    el.addEventListener("dragleave", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (--depth <= 0) {
        depth = 0;
        el.classList.remove("drag-over");
      }
    });
    el.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      depth = 0;
      el.classList.remove("drag-over");
      if (!requireAuth()) return;
      const files = Array.from(e.dataTransfer?.files || []);
      const text = (
        e.dataTransfer?.getData("text/uri-list") ||
        e.dataTransfer?.getData("text/plain") ||
        ""
      ).trim();
      await cb({ files, text });
    });
  }

  async function dropInFolder(id, { files, text, title, note }) {
    el.blockFormError.hidden = true;
    el.blockUploadStatus.textContent = "Saving...";
    el.blockUploadStatus.hidden = false;
    el.addBlockSubmitBtn.disabled = true;
    try {
      let d;
      if (files && files.length) {
        const form = new FormData();
        for (const f of files) form.append("file", f);
        if (title) form.append("title", title);
        if (note) form.append("note", note);
        d = await api(`/api/folders/${id}/blocks`, {
          method: "POST",
          body: form,
        });
      } else if (text) {
        d = await api(`/api/folders/${id}/blocks`, {
          method: "POST",
          body: { input: text, title: title || "", note: note || "" },
        });
      } else return;
      if (d.folders) state.folders = d.folders;
      if (state.activeFolderId === id && d.blocks)
        state.activeFolderBlocks = d.blocks;
      renderFolders();
      if (state.activeFolderId === id) renderFolder();
    } catch (e) {
      setAddBlockOpen(true);
      el.blockFormError.textContent = e.message;
      el.blockFormError.hidden = false;
    } finally {
      el.blockUploadStatus.hidden = true;
      el.addBlockSubmitBtn.disabled = false;
    }
  }

  function fmtDuration(min) {
    const h = Math.floor(min / 60),
      m = min % 60;
    if (!h) return `${m} min`;
    return m ? `${h} hr ${m} min` : `${h} hr`;
  }

  // Edit reuses the Schedule call form: fill it with the call, and Save sends a PATCH
  function setEventFormMode(editingId) {
    state.editingEventId = editingId || null;
    el.newEventForm.querySelector('button[type="submit"]').textContent =
      editingId ? "Save" : "Add";
  }

  function startEditEvent(ev) {
    if (!requireAuth()) return;
    const d = new Date(ev.starts_at);
    state.pendingInvite = null;
    setEventFormMode(ev.id);
    el.eventTitleInput.value = ev.title;
    el.eventDateInput.value = dateKey(d);
    el.eventTimeInput.value = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const dur = String(ev.duration_minutes || 60);
    if (![...el.eventDurationInput.options].some((o) => o.value === dur)) {
      el.eventDurationInput.appendChild(new Option(`${dur}m`, dur));
    }
    el.eventDurationInput.value = dur;
    el.eventLocationInput.value = ev.location || "FaceTime";
    el.eventNotesInput.value = ev.notes || "";
    el.eventFormError.hidden = true;
    el.newEventDetails.open = true;
    el.newEventDetails.scrollIntoView({ block: "nearest", behavior: "smooth" });
    el.eventTitleInput.focus();
  }

  function ensureEventDefaults() {
    if (!el.eventDateInput.value)
      el.eventDateInput.value = state.selectedDateKey || dateKey(new Date());
    if (!el.eventTimeInput.value) {
      const h = new Date();
      h.setHours(h.getHours() + 1, 0, 0, 0);
      el.eventTimeInput.value = `${String(h.getHours()).padStart(2, "0")}:00`;
    }
  }

  // Box-drawing month grid (6 weeks x 7 days, 22 characters wide). Today gets a double-line box.
  function renderAsciiGrid(startDow, dim, evByDate, today) {
    const W = 22;
    const monthName = new Date(
      state.calYear,
      state.calMonth,
      1,
    ).toLocaleDateString([], { month: "long" });
    const yearStr = String(state.calYear);
    const fill = Math.max(1, W - 2 - monthName.length - yearStr.length - 4);
    const title = ` ${monthName} ${"░".repeat(fill)} ${yearStr} `;

    // Border line between week rows: ╟──┼──┼…──╢ (index 0, then "──" + junction per column)
    const boundary = (l, j, r, seg = "─") => {
      const chars = [l];
      for (let c = 0; c < 7; c++) chars.push(seg, seg, c < 6 ? j : r);
      return chars;
    };
    const lines = []; // each line: array of chars (borders) or day objects
    lines.push(["╔", ..."═".repeat(W - 2), "╗"]);
    lines.push(["║", ...[...title].slice(0, W - 2), "║"]);
    lines.push(boundary("╟", "┬", "╢"));
    const dows = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
    lines.push(["║", ...dows.flatMap((d, i) => [d, i < 6 ? "│" : "║"])]);
    const weekLines = []; // index of the boundary line above each week
    let dc = 1;
    for (let r = 0; r < 6; r++) {
      weekLines.push(lines.length);
      lines.push(boundary("╟", "┼", "╢"));
      const row = ["║"];
      for (let c = 0; c < 7; c++) {
        const i = r * 7 + c;
        if (i < startDow || dc > dim) row.push("░░");
        else {
          const dk = dateKey(new Date(state.calYear, state.calMonth, dc));
          row.push({ day: dc, key: dk, events: evByDate.get(dk) || 0 });
          dc++;
        }
        row.push(c < 6 ? "│" : "║");
      }
      lines.push(row);
    }
    lines.push(boundary("╚", "╧", "╝", "═"));

    // Double-line box around today
    for (let r = 0; r < 6; r++) {
      const row = lines[weekLines[r] + 1];
      const c = row.findIndex((x) => typeof x === "object" && x.key === today);
      if (c === -1) continue;
      const col = (c - 1) / 2; // row layout: ║ cell │ cell │ … ║
      const above = lines[weekLines[r]],
        below = lines[weekLines[r] + 2];
      const L = col * 3,
        R = col * 3 + 3; // junction indexes on boundary lines
      above[L] = "╔";
      above[L + 1] = "═";
      above[L + 2] = "═";
      above[R] = "╗";
      below[L] = "╚";
      below[L + 1] = "═";
      below[L + 2] = "═";
      below[R] = "╝";
      row[c - 1] = "║";
      row[c + 1] = "║";
    }

    el.calAscii.innerHTML = "";
    const frag = document.createDocumentFragment();
    lines.forEach((line, li) => {
      let text = "";
      const flush = () => {
        if (text) {
          frag.appendChild(document.createTextNode(text));
          text = "";
        }
      };
      for (const part of line) {
        if (typeof part === "string") {
          text += part;
          continue;
        }
        flush();
        const span = document.createElement("span");
        span.className =
          "cal-day" +
          (part.key === today ? " is-today" : "") +
          (part.events ? " has-events" : "") +
          (part.key === state.selectedDateKey ? " is-selected" : "");
        span.textContent = String(part.day).padStart(2, "0");
        span.tabIndex = 0;
        span.setAttribute("role", "button");
        span.setAttribute(
          "aria-label",
          `${part.key}${part.events ? `, ${part.events} call${part.events > 1 ? "s" : ""}` : ""}`,
        );
        const pick = () => {
          state.selectedDateKey =
            state.selectedDateKey === part.key ? null : part.key;
          if (state.selectedDateKey)
            el.eventDateInput.value = state.selectedDateKey;
          renderCalendar();
        };
        span.addEventListener("click", pick);
        span.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            pick();
          }
        });
        frag.appendChild(span);
      }
      text += li < lines.length - 1 ? "\n" : "";
      flush();
    });
    el.calAscii.appendChild(frag);
  }

  function renderCalendar() {
    const first = new Date(state.calYear, state.calMonth, 1);
    const evByDate = new Map();
    for (const ev of state.events) {
      const k = dateKey(new Date(ev.starts_at));
      evByDate.set(k, (evByDate.get(k) || 0) + 1);
    }
    const startDow = first.getDay(),
      dim = new Date(state.calYear, state.calMonth + 1, 0).getDate();
    const today = dateKey(new Date());
    renderAsciiGrid(startDow, dim, evByDate, today);
    // Events list
    el.eventsList.innerHTML = "";
    const now = Date.now();
    let filtered;
    if (state.selectedDateKey) {
      el.eventsListHeading.textContent = state.selectedDateKey;
      el.clearDateFilterLink.hidden = false;
      filtered = state.events.filter(
        (ev) => dateKey(new Date(ev.starts_at)) === state.selectedDateKey,
      );
    } else {
      el.eventsListHeading.textContent = "Upcoming";
      el.clearDateFilterLink.hidden = true;
      filtered = state.events.filter(
        (ev) =>
          Date.parse(ev.starts_at) + (ev.duration_minutes || 60) * 60000 > now,
      );
    }
    if (!filtered.length) {
      el.eventsList.innerHTML = `<li>${state.selectedDateKey ? "No calls on this date." : "No upcoming calls."}</li>`;
      return;
    }
    for (const ev of filtered) {
      // Title / date, time / location (duration) / notes / Hosted by / Attending list / actions
      const li = document.createElement("li");
      li.className = "event-item";
      const line = (cls) => {
        const d = document.createElement("div");
        if (cls) d.className = cls;
        li.appendChild(d);
        return d;
      };

      const ts = document.createElement("strong");
      ts.textContent = ev.title;
      line("event-title").appendChild(ts);
      line().textContent = fmtDT(ev.starts_at);
      const loc = line();
      linkify(loc, ev.location || "FaceTime");
      loc.appendChild(
        document.createTextNode(` (${fmtDuration(ev.duration_minutes || 60)})`),
      );
      if (ev.notes) linkify(line("event-notes"), ev.notes);
      if (ev.creator_username) {
        const host = line("event-host");
        host.appendChild(document.createTextNode("Hosted by "));
        host.appendChild(
          badge(ev.creator_username, ev.creator_color, ev.creator_font),
        );
      }
      const att = ev.attendees || [];
      if (att.length) {
        line().textContent = "Attending:";
        const ul = document.createElement("ul");
        ul.className = "event-attendees";
        for (const a of att) {
          const ali = document.createElement("li");
          ali.appendChild(badge(a.username, a.name_color, a.name_font));
          ul.appendChild(ali);
        }
        li.appendChild(ul);
      }

      const actions = line("event-actions");
      const sep = () => actions.appendChild(document.createTextNode(" • "));
      const joining = state.user && att.some((a) => a.id === state.user.id);
      actions.appendChild(
        actionLink(joining ? "Leave" : "Join", async () => {
          if (!requireAuth()) return;
          const d = await api(`/api/events/${ev.id}/rsvp`, { method: "POST" });
          state.events = d.events || [];
          renderCalendar();
          renderBanner();
        }),
      );
      if (state.user && ev.created_by === state.user.id) {
        sep();
        actions.appendChild(
          actionLink("Delete", async () => {
            if (!confirm(`Delete "${ev.title}"?`)) return;
            const d = await api(`/api/events/${ev.id}`, { method: "DELETE" });
            state.events = d.events || [];
            renderCalendar();
            renderBanner();
          }),
        );
        sep();
        actions.appendChild(actionLink("Edit", () => startEditEvent(ev)));
      }
      el.eventsList.appendChild(li);
    }
  }

  function renderAll(forceBottom = false) {
    renderAuthBar();
    renderBanner();
    renderChatTabs();
    renderActiveChat(forceBottom);
    renderFolders();
    renderDirectory();
    if (state.activeFolderId) renderFolder();
    renderCalendar();
    renderGoals();
  }

  // --- Goals: shared checklist of editable rows ---
  // Open goals on top, then blank rows to type new ones; ticking a goal moves it to "Complete" at the bottom.
  // Each row shows who added it on the right. You can edit your own goals, or delete them with the × on hover.
  let goalsRenderPending = false;

  function renderGoals() {
    const list = document.getElementById("goals-list");
    // Don't rebuild under someone who's typing; catch up when they leave the field
    const active = document.activeElement;
    if (
      list.contains(active) &&
      active.classList.contains("goal-input") &&
      !active.readOnly
    ) {
      goalsRenderPending = true;
      return;
    }
    goalsRenderPending = false;
    list.innerHTML = "";
    const goals = state.goals || [];
    const open = goals.filter((g) => !g.done);
    const done = goals.filter((g) => g.done);

    if (!state.user) {
      const p = document.createElement("p");
      p.className = "goals-login";
      p.innerHTML = '<a href="/login.html">Log in</a> to add goals.';
      list.appendChild(p);
    }

    const ul = document.createElement("ul");
    ul.className = "goal-group";
    for (const g of open) ul.appendChild(goalRow(g));
    if (state.user) ul.appendChild(goalRow(null));
    list.appendChild(ul);

    if (done.length) {
      const h = document.createElement("p");
      h.className = "goals-complete-heading";
      h.textContent = "Complete";
      list.appendChild(h);
      const dl = document.createElement("ul");
      dl.className = "goal-group";
      for (const g of done) dl.appendChild(goalRow(g));
      list.appendChild(dl);
    }
    if (state.user) fillGoalRows(ul);
  }

  // Add blank rows until the pane's visible area is full (Complete stays in view below them)
  function fillGoalRows(ul) {
    const list = document.getElementById("goals-list");
    const row = ul.lastElementChild;
    const rowH = row?.getBoundingClientRect().height || 0;
    if (!rowH || !list.clientHeight) return;
    const free = list.clientHeight - list.scrollHeight;
    const extra = Math.floor(free / rowH);
    for (let i = 0; i < extra; i++) ul.appendChild(goalRow(null));
  }

  // Refill when the pane is resized (dragging gutters, window resize)
  let goalsResizeTimer = null;
  new ResizeObserver(() => {
    clearTimeout(goalsResizeTimer);
    goalsResizeTimer = setTimeout(() => {
      if (state.user) renderGoals();
    }, 100);
  }).observe(document.getElementById("goals-list"));

  async function goalRequest(path, method, body) {
    try {
      const d = await api(path, { method, body });
      state.goals = d.goals || [];
    } catch (e) {
      alert(e.message);
    }
    renderGoals();
  }

  // Entered goals show as wrapping text; blank rows are inputs for new goals.
  // Click your own open goal to edit it (a textarea that grows with the text).
  function goalRow(g) {
    const li = document.createElement("li");
    li.className = "goal" + (g?.done ? " done" : "");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = Boolean(g?.done);
    box.disabled = !g || !state.user;
    box.setAttribute(
      "aria-label",
      g ? `Mark "${g.body}" ${g.done ? "not done" : "done"}` : "New goal",
    );
    li.appendChild(box);

    if (!g) {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "goal-input goal-blank";
      input.maxLength = 280;
      input.readOnly = !state.user;
      input.setAttribute("aria-label", "New goal");
      li.appendChild(input);
      let committed = false;
      const commit = (keepFocus) => {
        const text = input.value.trim();
        if (committed || !text) return;
        committed = true;
        input.readOnly = true;
        goalRequest("/api/goals", "POST", { body: text }).then(() => {
          // Keep typing: jump to the next blank row
          if (keepFocus)
            document.querySelector("#goals-list .goal-blank")?.focus();
        });
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit(true);
        }
        if (e.key === "Escape") {
          input.value = "";
          input.blur();
        }
      });
      input.addEventListener("blur", () => {
        commit(false);
        if (goalsRenderPending) setTimeout(renderGoals, 0);
      });
      input.addEventListener("focus", () => {
        if (!state.user) requireAuth();
      });
      return li;
    }

    const text = document.createElement("span");
    text.className = "goal-text";
    linkify(text, g.body);
    li.appendChild(text);
    const who = badge(g.username || "former member", g.name_color, g.name_font);
    who.classList.add("goal-user");
    li.appendChild(who);
    box.addEventListener("change", () => {
      if (!requireAuth()) {
        box.checked = g.done;
        return;
      }
      box.disabled = true;
      goalRequest(`/api/goals/${g.id}`, "PATCH", { done: box.checked });
    });

    const mine = state.user && g.created_by === state.user.id;
    if (mine) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "chat-delete goal-delete";
      del.textContent = "×";
      del.title = "Delete goal";
      del.setAttribute("aria-label", `Delete goal "${g.body}"`);
      del.addEventListener("click", () => {
        if (!confirm("Delete this goal?")) return;
        del.disabled = true;
        goalRequest(`/api/goals/${g.id}`, "DELETE");
      });
      li.appendChild(del);
    }
    if (mine && !g.done) {
      text.classList.add("editable");
      text.title = "Click to edit";
      text.addEventListener("click", (e) => {
        if (e.target.closest("a")) return; // links open normally
        const ta = document.createElement("textarea");
        ta.className = "goal-input goal-edit";
        ta.maxLength = 280;
        ta.rows = 1;
        ta.value = g.body;
        ta.setAttribute("aria-label", "Edit goal");
        const grow = () => {
          ta.style.height = "auto";
          ta.style.height = `${ta.scrollHeight}px`;
        };
        ta.addEventListener("input", grow);
        text.replaceWith(ta);
        grow();
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);

        let done = false;
        const finish = (save) => {
          if (done) return;
          const val = ta.value.replace(/\s+/g, " ").trim();
          if (!save || val === g.body) {
            done = true;
            ta.replaceWith(text);
            if (goalsRenderPending) renderGoals();
            return;
          }
          if (!val && !confirm("Delete this goal?")) {
            ta.value = g.body;
            ta.focus();
            return;
          }
          done = true;
          ta.readOnly = true;
          goalRequest(
            `/api/goals/${g.id}`,
            val ? "PATCH" : "DELETE",
            val ? { body: val } : undefined,
          );
        };
        ta.addEventListener("keydown", (e2) => {
          if (e2.key === "Enter") {
            e2.preventDefault();
            finish(true);
          }
          if (e2.key === "Escape") {
            e2.preventDefault();
            finish(false);
          }
        });
        ta.addEventListener("blur", () => finish(true));
      });
    }
    return li;
  }

  function bind() {
    ensureEventDefaults();

    el.chatInput.addEventListener("focus", () => {
      if (!state.user) window.location.href = "/login.html";
    });
    // Attachments: paperclip picker, or paste a file/image into the message box
    const fileInput = document.getElementById("chat-file");
    document.getElementById("chat-attach-btn").addEventListener("click", () => {
      if (requireAuth()) fileInput.click();
    });
    fileInput.addEventListener("change", () => {
      setPendingFile(fileInput.files[0]);
      fileInput.value = "";
      el.chatInput.focus();
    });
    document
      .getElementById("chat-pending-remove")
      .addEventListener("click", () => {
        setPendingFile(null);
        el.chatInput.focus();
      });
    el.chatInput.addEventListener("paste", (e) => {
      const file = e.clipboardData?.files?.[0];
      if (!file) return; // plain text pastes as usual
      e.preventDefault();
      // Pasted screenshots arrive as "image.png"; give them a unique name
      const named = /^image\.\w+$/.test(file.name)
        ? new File(
            [file],
            `pasted-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${file.name.split(".").pop()}`,
            { type: file.type },
          )
        : file;
      setPendingFile(named);
    });

    // Drag a file or image onto the chat to attach it; a dragged link (e.g. an image from
    // another site, which browsers hand over as a URL) is added to the message text instead
    attachDrop(
      document.getElementById("lounge-pane"),
      async ({ files, text }) => {
        if (files.length) {
          if (files.length > 1)
            alert("One attachment per message. Attaching the first file.");
          setPendingFile(files[0]);
        } else if (/^https?:\/\//i.test(text)) {
          const url = text.split(/\s+/)[0];
          el.chatInput.value = el.chatInput.value
            ? `${el.chatInput.value} ${url}`
            : url;
        }
        el.chatInput.focus();
      },
    );

    el.chatForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!requireAuth()) return;
      const text = el.chatInput.value.trim();
      if (!text && !state.pendingFile) return;
      el.chatSendBtn.disabled = true;
      try {
        const payload = { body: text };
        if (state.pendingFile) {
          el.chatSendBtn.textContent = "Uploading…";
          payload.attachment_id = await uploadPendingFile();
        }
        if (state.activeTab === "group") {
          const d = await api("/api/messages", {
            method: "POST",
            body: payload,
          });
          el.chatInput.value = "";
          setPendingFile(null);
          if (d.message && !state.messages.some((m) => m.id === d.message.id)) {
            state.messages.push(d.message);
            renderChat(true);
          }
        } else {
          // DM
          const userId = state.activeTab;
          const d = await api(`/api/dm/${userId}`, {
            method: "POST",
            body: payload,
          });
          el.chatInput.value = "";
          setPendingFile(null);
          if (d.message) {
            if (!state.dmMessages[userId]) state.dmMessages[userId] = [];
            if (!state.dmMessages[userId].some((m) => m.id === d.message.id)) {
              state.dmMessages[userId].push(d.message);
            }
            renderDMChat(userId, true);
          }
        }
      } catch (e) {
        alert(e.message);
      } finally {
        el.chatSendBtn.disabled = false;
        el.chatSendBtn.textContent = "Send";
        el.chatInput.focus();
      }
    });

    el.newFolderDetails.addEventListener("toggle", () => {
      if (el.newFolderDetails.open && !state.user) {
        el.newFolderDetails.open = false;
        window.location.href = "/login.html";
      }
    });
    document
      .getElementById("folder-cancel-btn")
      .addEventListener("click", () => {
        el.newFolderForm.reset();
        el.folderFormError.hidden = true;
        el.newFolderDetails.open = false;
      });
    el.newFolderForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!requireAuth()) return;
      el.folderFormError.hidden = true;
      try {
        const d = await api("/api/folders", {
          method: "POST",
          body: {
            title: el.folderTitleInput.value.trim(),
            existing_arena_slug: el.folderSlugInput.value.trim(),
          },
        });
        el.newFolderForm.reset();
        el.newFolderDetails.open = false;
        const lr = await api("/api/folders");
        state.folders = lr.folders || [];
        renderFolders();
        if (d.folder?.id) await openFolder(d.folder.id);
        if (d.arenaWarning) alert(d.arenaWarning);
      } catch (e) {
        el.folderFormError.textContent = e.message;
        el.folderFormError.hidden = false;
      }
    });

    el.backToFoldersLink.addEventListener("click", (e) => {
      e.preventDefault();
      state.activeFolderId = null;
      renderFolder();
    });
    el.syncFolderLink.addEventListener("click", async (e) => {
      e.preventDefault();
      if (state.activeFolderId) {
        await openFolder(state.activeFolderId, true);
        const r = await api("/api/folders");
        state.folders = r.folders || state.folders;
        renderFolders();
      }
    });

    el.toggleAddBlockBtn.addEventListener("click", () => {
      if (!requireAuth()) return;
      setAddBlockOpen(el.blockDropzone.hidden);
    });

    // Drops work anywhere in the open folder, even with the form closed
    attachDrop(el.folderDetailView, async (p) => {
      if (!state.activeFolderId) return;
      await dropInFolder(state.activeFolderId, {
        ...p,
        title: el.blockTitleInput.value.trim(),
        note: el.blockNoteInput.value.trim(),
      });
      el.blockTitleInput.value = "";
      el.blockNoteInput.value = "";
    });
    el.blockFileInput.addEventListener("change", async () => {
      if (!requireAuth()) {
        el.blockFileInput.value = "";
        return;
      }
      const files = Array.from(el.blockFileInput.files || []);
      if (files.length && state.activeFolderId) {
        await dropInFolder(state.activeFolderId, {
          files,
          title: el.blockTitleInput.value.trim(),
          note: el.blockNoteInput.value.trim(),
        });
        el.blockFileInput.value = "";
        el.blockTitleInput.value = "";
        el.blockNoteInput.value = "";
      }
    });
    el.blockDropzone.addEventListener("paste", async (e) => {
      const files = Array.from(e.clipboardData?.files || []);
      if (files.length && state.activeFolderId) {
        e.preventDefault();
        if (!requireAuth()) return;
        await dropInFolder(state.activeFolderId, {
          files,
          title: el.blockTitleInput.value.trim(),
          note: el.blockNoteInput.value.trim(),
        });
      }
    });
    el.addBlockForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!requireAuth() || !state.activeFolderId) return;
      const text = el.blockInput.value.trim(),
        title = el.blockTitleInput.value.trim(),
        note = el.blockNoteInput.value.trim();
      if (!text) return;
      await dropInFolder(state.activeFolderId, { text, title, note });
      el.blockInput.value = "";
      el.blockTitleInput.value = "";
      el.blockNoteInput.value = "";
    });

    document
      .getElementById("directory-toggle-btn")
      .addEventListener("click", () => {
        setDirectoryOpen(
          !document
            .getElementById("directory-drawer")
            .classList.contains("open"),
        );
      });
    document
      .getElementById("directory-close-btn")
      .addEventListener("click", () => setDirectoryOpen(false));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setDirectoryOpen(false);
    });

    // Cancel: clear everything typed into the new-call form and close it
    document
      .getElementById("event-cancel-btn")
      .addEventListener("click", () => {
        el.newEventForm.reset();
        el.eventFormError.hidden = true;
        el.newEventDetails.open = false;
        state.pendingInvite = null;
        setEventFormMode(null);
      });

    document
      .getElementById("schedule-call-btn")
      .addEventListener("click", () => {
        state.pendingInvite = null;
        // Coming from an edit: start a fresh call instead
        if (state.editingEventId) {
          el.newEventForm.reset();
          setEventFormMode(null);
          el.newEventDetails.open = false;
        }
        el.newEventDetails.open = !el.newEventDetails.open;
      });
    el.newEventDetails.addEventListener("toggle", () => {
      if (el.newEventDetails.open) {
        if (!state.user) {
          el.newEventDetails.open = false;
          window.location.href = "/login.html";
          return;
        }
        ensureEventDefaults();
      }
    });
    el.calPrevLink.addEventListener("click", (e) => {
      e.preventDefault();
      if (--state.calMonth < 0) {
        state.calMonth = 11;
        state.calYear--;
      }
      renderCalendar();
    });
    el.calNextLink.addEventListener("click", (e) => {
      e.preventDefault();
      if (++state.calMonth > 11) {
        state.calMonth = 0;
        state.calYear++;
      }
      renderCalendar();
    });
    el.calTodayLink.addEventListener("click", (e) => {
      e.preventDefault();
      const n = new Date();
      state.calYear = n.getFullYear();
      state.calMonth = n.getMonth();
      state.selectedDateKey = null;
      renderCalendar();
    });
    el.clearDateFilterLink.addEventListener("click", (e) => {
      e.preventDefault();
      state.selectedDateKey = null;
      renderCalendar();
    });
    el.newEventForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!requireAuth()) return;
      el.eventFormError.hidden = true;
      const ld = new Date(
        `${el.eventDateInput.value}T${el.eventTimeInput.value}`,
      );
      if (isNaN(ld.getTime())) {
        el.eventFormError.textContent = "Invalid date or time.";
        el.eventFormError.hidden = false;
        return;
      }
      try {
        const payload = {
          title: el.eventTitleInput.value.trim(),
          starts_at: ld.toISOString(),
          duration_minutes: parseInt(el.eventDurationInput.value, 10) || 60,
          location: el.eventLocationInput.value.trim() || "FaceTime",
          notes: el.eventNotesInput.value.trim(),
        };
        const editingId = state.editingEventId;
        const d = editingId
          ? await api(`/api/events/${editingId}`, {
              method: "PATCH",
              body: payload,
            })
          : await api("/api/events", { method: "POST", body: payload });
        state.events = d.events || [];
        const invitee = state.pendingInvite;
        state.pendingInvite = null;
        if (invitee?.email && !editingId) emailInvite(invitee, payload);
        el.eventTitleInput.value = "";
        el.eventNotesInput.value = "";
        el.newEventDetails.open = false;
        setEventFormMode(null);
        state.calYear = ld.getFullYear();
        state.calMonth = ld.getMonth();
        renderCalendar();
        renderBanner();
      } catch (e) {
        el.eventFormError.textContent = e.message;
        el.eventFormError.hidden = false;
      }
    });
  }

  async function refreshFull(initial = false) {
    const d = await api("/api/bootstrap");
    if (!d.user) {
      window.location.replace("/login.html");
      return false;
    }
    state.user = d.user;
    state.config = { ...state.config, ...(d.config || {}) };
    state.messages = d.messages || [];
    state.folders = d.folders || [];
    state.events = d.events || [];
    state.users = d.users || [];
    state.goals = d.goals || [];
    state.stateToken = d.stateToken || "";
    if (d.timer) window.CoworkingTimer?.set(d.timer);
    renderAll(initial);
    if (state.activeFolderId) {
      const fd = await api(`/api/folders/${state.activeFolderId}`).catch(
        () => null,
      );
      if (fd) {
        state.activeFolderBlocks = fd.blocks || [];
        renderFolder();
      }
    }
  }

  const HIDDEN_POLL_MS = 15000;
  let lastPollAt = 0;
  async function poll() {
    // In a background tab, keep checking (more slowly) only if notifications are on
    if (
      document.hidden &&
      (!notifyEnabled() || Date.now() - lastPollAt < HIDDEN_POLL_MS)
    )
      return;
    lastPollAt = Date.now();
    try {
      const last = state.messages.length
        ? state.messages[state.messages.length - 1].id
        : 0;
      const dmParam =
        state.user && typeof state.dmMaxId === "number"
          ? `&after_dm=${state.dmMaxId}`
          : "";
      const d = await api(`/api/poll?after_msg=${last}${dmParam}`);
      if (d.messages?.length) {
        const added = [];
        for (const m of d.messages)
          if (!state.messages.some((x) => x.id === m.id)) {
            state.messages.push(m);
            added.push(m);
          }
        if (added.length && state.activeTab === "group") renderChat(false);
        // last > 0: don't notify for the initial history on first load
        if (added.length && last > 0) notifyGroup(added);
      }
      if (state.user && typeof d.dmMaxId === "number") {
        // The first poll only sets a baseline; later polls report new DMs
        if (typeof state.dmMaxId === "number" && d.dms?.length)
          notifyDMs(d.dms);
        state.dmMaxId = Math.max(state.dmMaxId || 0, d.dmMaxId);
      }
      if (d.stateToken && d.stateToken !== state.stateToken) {
        state.stateToken = d.stateToken;
        const [fr, er, ur, mr, tr, gr] = await Promise.all([
          api("/api/folders"),
          api("/api/events"),
          api("/api/users"),
          state.user ? api("/api/messages") : { messages: [] },
          api("/api/timer"),
          api("/api/goals"),
        ]);
        state.folders = fr.folders || [];
        state.events = er.events || [];
        state.users = ur.users || [];
        state.goals = gr.goals || [];
        renderGoals();
        if (tr.timer) window.CoworkingTimer?.set(tr.timer);
        // Full reload catches messages deleted by others
        if (mr.messages) {
          state.messages = mr.messages;
          if (state.activeTab === "group") renderChat(false);
        }
        renderFolders();
        renderCalendar();
        renderBanner();
        renderDirectory();
        if (state.activeFolderId) {
          const ad = await api(`/api/folders/${state.activeFolderId}`).catch(
            () => null,
          );
          // Don't rebuild the list under an open edit form
          if (ad) {
            state.activeFolderBlocks = ad.blocks || [];
            if (!state.editingBlockId && !state.editingFolderId) renderFolder();
          }
        }
      }
    } catch {}
  }

  // NTS radio + infinite mixtapes: one audio element, only one stream plays at a time
  const NTS_MIXTAPES = [
    ["Poolside", "mixtape4"],
    ["Slow Focus", "mixtape"],
    ["Low Key", "mixtape2"],
    ["Memory Lane", "mixtape6"],
    ["4 To The Floor", "mixtape5"],
    ["Island Time", "mixtape21"],
    ["The Tube", "mixtape26"],
    ["Sheet Music", "mixtape35"],
    ["Feelings", "mixtape27"],
    ["Expansions", "mixtape3"],
    ["Rap House", "mixtape22"],
    ["Labyrinth", "mixtape31"],
    ["Sweat", "mixtape24"],
    ["Otaku", "mixtape36"],
    ["The Pit", "mixtape34"],
    ["Field Recordings", "mixtape23"],
  ].map(([title, path]) => ({
    title,
    src: `https://stream-mixtape-geo.ntslive.net/${path}`,
  }));

  const ICON_PLAY =
    '<svg class="radio-icon" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 0 L10 5 L1 10 Z" fill="currentColor"/></svg>';
  const ICON_STOP =
    '<svg class="radio-icon" viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" fill="currentColor"/></svg>';

  function bindRadio() {
    const audio = new Audio();
    const btns = document.querySelectorAll(".radio-btn");
    btns.forEach((b) => {
      b.dataset.n = b.textContent.trim().charAt(0);
    });
    const mixBtn = document.getElementById("mixtape-btn");
    const mixMenu = document.getElementById("mixtape-menu");
    const volBtn = document.getElementById("volume-btn");
    const volPop = document.getElementById("volume-pop");
    const volRange = document.getElementById("volume-range");
    const volValue = document.getElementById("volume-value");

    // Volume is a per-listener preference, so it stays in this browser
    let vol = 80;
    try {
      const v = parseInt(localStorage.getItem("coworking.volume"), 10);
      if (v >= 0 && v <= 100) vol = v;
    } catch {}
    const setVol = (v) => {
      vol = v;
      audio.volume = v / 100;
      volRange.value = v;
      volValue.textContent = v;
      try {
        localStorage.setItem("coworking.volume", String(v));
      } catch {}
    };
    setVol(vol);
    volRange.addEventListener("input", () =>
      setVol(parseInt(volRange.value, 10)),
    );

    // Mixtape menu items
    mixMenu.innerHTML = "";
    for (const m of NTS_MIXTAPES) {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mixtape-item";
      b.dataset.src = m.src;
      b.textContent = m.title;
      li.appendChild(b);
      mixMenu.appendChild(li);
    }
    const items = mixMenu.querySelectorAll(".mixtape-item");

    const render = () => {
      const cur = !audio.paused && audio.dataset.src ? audio.dataset.src : "";
      btns.forEach((b) => {
        const n = b.dataset.n;
        const on = cur === b.dataset.src;
        b.innerHTML = `${n} ${on ? ICON_STOP : ICON_PLAY}`;
        b.setAttribute("aria-label", `${on ? "Stop" : "Play"} NTS ${n}`);
      });
      // While a mixtape plays, the button shows its name plus a stop icon that stops it directly
      const mix = NTS_MIXTAPES.find((m) => m.src === cur);
      mixBtn.innerHTML = mix
        ? `<span class="mix-name">${mix.title}</span> <span class="mix-stop" title="Stop">${ICON_STOP}</span>`
        : "Mixtapes \u25BE";
      mixBtn.setAttribute(
        "aria-label",
        mix ? `${mix.title} playing. Open mixtapes` : "Mixtapes",
      );
      items.forEach((i) => i.classList.toggle("active", i.dataset.src === cur));
    };

    // NTS's stream servers sometimes return 404/503 for a mixtape; each request can land on a
    // different server, so retry a few times before giving up and flagging it unavailable.
    const MAX_RETRIES = 4;
    let retries = 0,
      retryTimer = null;
    const start = (src) => {
      audio.src = src;
      audio.dataset.src = src;
      audio.volume = vol / 100;
      render();
      audio.play().then(render).catch(render);
    };
    audio.addEventListener("playing", () => {
      retries = 0;
    });
    audio.addEventListener("error", () => {
      const src = audio.dataset.src;
      if (!src) return;
      if (retries < MAX_RETRIES) {
        retries++;
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
          if (audio.dataset.src === src) start(src);
        }, 1500);
        return;
      }
      retries = 0;
      delete audio.dataset.src;
      audio.removeAttribute("src");
      render();
      const item = [...items].find((i) => i.dataset.src === src);
      const btn = item ? mixBtn : [...btns].find((b) => b.dataset.src === src);
      if (btn) {
        btn.textContent = "Unavailable";
        setTimeout(render, 3000);
      }
    });

    const toggle = (src) => {
      const playingThis =
        audio.dataset.src === src && (!audio.paused || retries > 0);
      clearTimeout(retryTimer);
      retries = 0;
      audio.pause();
      if (playingThis) {
        audio.removeAttribute("src");
        delete audio.dataset.src;
        audio.load();
        render();
        return;
      }
      start(src);
    };

    btns.forEach((b) =>
      b.addEventListener("click", () => toggle(b.dataset.src)),
    );
    items.forEach((i) =>
      i.addEventListener("click", () => {
        toggle(i.dataset.src);
        closePops();
      }),
    );

    const pops = [
      [mixBtn, mixMenu],
      [volBtn, volPop],
    ];
    const closePops = () =>
      pops.forEach(([b, p]) => {
        p.hidden = true;
        b.setAttribute("aria-expanded", "false");
      });
    pops.forEach(([b, p]) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        if (b === mixBtn && e.target.closest(".mix-stop")) {
          toggle(audio.dataset.src);
          closePops();
          return;
        }
        const open = p.hidden;
        closePops();
        p.hidden = !open;
        b.setAttribute("aria-expanded", String(open));
      }),
    );
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".radio-pop")) closePops();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closePops();
    });
    // The timer's alarm mutes the radio while it plays (timer.js calls this)
    window.CoworkingRadio = {
      setMuted: (m) => {
        audio.muted = !!m;
      },
    };
    render();
  }

  // --- Presence: heartbeat every 30s; "away" when the tab is hidden or idle for 5 min ---
  const PRESENCE_INTERVAL_MS = 30000;
  const IDLE_MS = 5 * 60000;
  let lastActivity = Date.now();

  function myStatus() {
    return document.hidden || Date.now() - lastActivity > IDLE_MS
      ? "away"
      : "online";
  }

  // Logged in: report status and get the directory back. Logged out: just refresh the directory.
  async function sendPresence() {
    try {
      const d = state.user
        ? await api("/api/presence", {
            method: "POST",
            body: { status: myStatus() },
          })
        : await api("/api/users");
      if (d.users) {
        state.users = d.users;
        renderDirectory();
      }
    } catch {}
  }

  function startPresence() {
    sendPresence();
    setInterval(sendPresence, PRESENCE_INTERVAL_MS);
    // Coming back from idle flips straight to online (at most one extra request)
    const bump = () => {
      const wasIdle = Date.now() - lastActivity > IDLE_MS;
      lastActivity = Date.now();
      if (wasIdle) sendPresence();
    };
    ["pointerdown", "keydown", "pointermove", "scroll", "focus"].forEach((ev) =>
      window.addEventListener(ev, bump, { passive: true, capture: true }),
    );
    document.addEventListener("visibilitychange", sendPresence);
    // Leaving the page: mark offline right away
    window.addEventListener("pagehide", () => {
      if (!state.user) return;
      const blob = new Blob([JSON.stringify({ status: "offline" })], {
        type: "application/json",
      });
      navigator.sendBeacon("/api/presence", blob);
    });
  }

  async function init() {
    bind();
    bindRadio();
    try {
      if ((await refreshFull(true)) === false) return; // logged out: off to the login page
    } catch (e) {
      el.nextCallContent.textContent = `Error: ${e.message}`;
    }
    setInterval(poll, 3000);
    setInterval(renderBanner, 30000);
    startPresence();
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) poll();
    });
  }

  init();
})();
