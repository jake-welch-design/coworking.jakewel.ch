// Coworking frontend — directory, DMs, chat tabs, NTS radio

(function () {
  'use strict';

  const state = {
    user: null,
    config: { arenaConfigured: false, passcodeRequired: false },
    messages: [],       // group chat
    users: [],          // directory
    folders: [],
    activeFolderId: null,
    activeFolderBlocks: [],
    events: [],
    calYear: new Date().getFullYear(),
    calMonth: new Date().getMonth(),
    selectedDateKey: null,
    stateToken: '',
    // Chat tabs
    activeTab: 'group',   // 'group' or a user id (number)
    dmTabs: [],           // array of { id, username, name_color, name_font }
    dmMessages: {},       // { [userId]: [...messages] }
    dmPolling: {},        // { [userId]: intervalId }
    pendingInvite: null   // directory user being invited via "Invite to call"
  };

  const el = {
    workspace: document.getElementById('workspace'),
    authBar: document.getElementById('auth-bar'),
    nextCallContent: document.getElementById('next-call-content'),
    foldersListView: document.getElementById('folders-list-view'),
    folderDetailView: document.getElementById('folder-detail-view'),
    newFolderDetails: document.getElementById('new-folder-details'),
    newFolderForm: document.getElementById('new-folder-form'),
    folderTitleInput: document.getElementById('folder-title-input'),
    folderSlugInput: document.getElementById('folder-slug-input'),
    folderFormError: document.getElementById('folder-form-error'),
    foldersList: document.getElementById('folders-list'),
    backToFoldersLink: document.getElementById('back-to-folders-link'),
    syncFolderLink: document.getElementById('sync-folder-link'),
    activeFolderMeta: document.getElementById('active-folder-meta'),
    blockDropzone: document.getElementById('block-dropzone'),
    addBlockForm: document.getElementById('add-block-form'),
    blockInput: document.getElementById('block-input'),
    blockTitleInput: document.getElementById('block-title-input'),
    blockFileInput: document.getElementById('block-file-input'),
    blockNoteInput: document.getElementById('block-note-input'),
    activeFolderTitle: document.getElementById('active-folder-title'),
    toggleAddBlockBtn: document.getElementById('toggle-add-block-btn'),
    addBlockSubmitBtn: document.getElementById('add-block-submit-btn'),
    blockUploadStatus: document.getElementById('block-upload-status'),
    blockFormError: document.getElementById('block-form-error'),
    blocksList: document.getElementById('blocks-list'),
    chatTabs: document.getElementById('chat-tabs'),
    chatMessages: document.getElementById('chat-messages'),
    chatForm: document.getElementById('chat-form'),
    chatInput: document.getElementById('chat-input'),
    chatSendBtn: document.getElementById('chat-send-btn'),
    directoryList: document.getElementById('directory-list'),
    newEventDetails: document.getElementById('new-event-details'),
    newEventForm: document.getElementById('new-event-form'),
    eventTitleInput: document.getElementById('event-title-input'),
    eventDateInput: document.getElementById('event-date-input'),
    eventTimeInput: document.getElementById('event-time-input'),
    eventDurationInput: document.getElementById('event-duration-input'),
    eventLocationInput: document.getElementById('event-location-input'),
    eventNotesInput: document.getElementById('event-notes-input'),
    eventFormError: document.getElementById('event-form-error'),
    calPrevLink: document.getElementById('cal-prev-link'),
    calNextLink: document.getElementById('cal-next-link'),
    calTodayLink: document.getElementById('cal-today-link'),
    calMonthLabel: document.getElementById('cal-month-label'),
    calGridBody: document.getElementById('calendar-grid-body'),
    eventsListHeading: document.getElementById('events-list-heading'),
    clearDateFilterLink: document.getElementById('clear-date-filter-link'),
    eventsList: document.getElementById('events-list')
  };

  async function api(path, options = {}) {
    const opts = { credentials: 'same-origin', ...options, headers: { ...(options.headers || {}) } };
    if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  }

  function isVeryLightHex(hex) {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex || '')) return false;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b > 225;
  }

  // Picks readable text color for a user-colored background
  function isLightHex(hex) {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex || '')) return true;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b > 150;
  }

  function applyUserStyle(node, color, font) {
    const c = /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : '#000000';
    node.style.color = c;
    node.style.fontFamily = font || 'Georgia, serif';
    node.style.textShadow = isVeryLightHex(c) ? '0 0 1px #000000' : 'none';
  }

  function badge(username, color, font) {
    const span = document.createElement('span');
    span.textContent = username || 'unknown';
    applyUserStyle(span, color, font);
    return span;
  }

  function actionLink(label, onClick) {
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = label;
    a.addEventListener('click', (e) => { e.preventDefault(); onClick(e); });
    return a;
  }

  function linkify(container, text) {
    const raw = String(text || '');
    const re = /(https?:\/\/[^\s<>"']+)/gi;
    let last = 0, m;
    while ((m = re.exec(raw)) !== null) {
      if (m.index > last) container.appendChild(document.createTextNode(raw.slice(last, m.index)));
      let url = m[0], trail = '';
      while (/[.,;:!?)]$/.test(url)) { trail = url.slice(-1) + trail; url = url.slice(0, -1); }
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = url;
      container.appendChild(a);
      if (trail) container.appendChild(document.createTextNode(trail));
      last = re.lastIndex;
    }
    if (last < raw.length) container.appendChild(document.createTextNode(raw.slice(last)));
  }

  function dateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function fmtBytes(b) {
    if (!b || b < 1024) return `${b||0} B`;
    if (b < 1048576) return `${(b/1024).toFixed(1)} KB`;
    return `${(b/1048576).toFixed(1)} MB`;
  }

  // Chat day separator: "DD Month YYYY", e.g. "11 November 2026"
  function fmtDay(d) {
    const month = d.toLocaleDateString([], { month: 'long' });
    return `${String(d.getDate()).padStart(2,'0')} ${month} ${d.getFullYear()}`;
  }

  function fmtDT(iso) {
    return new Date(iso).toLocaleString([], { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short' });
  }

  function nextEvent() {
    const now = Date.now();
    for (const ev of state.events) {
      const s = Date.parse(ev.starts_at);
      if (!isNaN(s) && s + (ev.duration_minutes||60)*60000 > now) return ev;
    }
    return null;
  }

  function openMailto(to, subject = '', body = '') {
    const params = new URLSearchParams();
    if (subject) params.set('subject', subject);
    if (body) params.set('body', body);
    const qs = params.toString().replace(/\+/g, '%20');
    window.location.href = `mailto:${encodeURIComponent(to)}${qs ? `?${qs}` : ''}`;
  }

  // Pre-filled invite email for a call that was just scheduled
  function emailInvite(invitee, ev) {
    const lines = [
      `Hi ${invitee.username},`,
      '',
      `You're invited to "${ev.title}".`,
      '',
      `When: ${fmtDT(ev.starts_at)} (${ev.duration_minutes} min)`,
      `Where: ${ev.location}`
    ];
    if (ev.notes) lines.push(`Notes: ${ev.notes}`);
    lines.push('', `Calendar: ${location.origin}`, '', `— ${state.user?.username || ''}`);
    openMailto(invitee.email, `Invite: ${ev.title}`, lines.join('\n'));
  }

  // Directory drawer inside the Lounge pane
  function setDirectoryOpen(open) {
    const drawer = document.getElementById('directory-drawer');
    const btn = document.getElementById('directory-toggle-btn');
    drawer.classList.toggle('open', open);
    drawer.setAttribute('aria-hidden', String(!open));
    btn.setAttribute('aria-expanded', String(open));
  }

  // On mobile all panes are stacked; bring the requested one into view
  function setMobileView(v) {
    if (!window.matchMedia('(max-width: 768px)').matches) return;
    const pane = document.getElementById(`${v}-pane`);
    if (pane) pane.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function requireAuth() {
    if (state.user) return true;
    window.location.href = '/login.html';
    return false;
  }

  // --- Chat Tabs ---

  function openDMTab(user) {
    if (!state.dmTabs.some(t => t.id === user.id)) {
      state.dmTabs.push({ id: user.id, username: user.username, name_color: user.name_color, name_font: user.name_font });
    }
    state.activeTab = user.id;
    renderChatTabs();
    loadDM(user.id);
  }

  function closeDMTab(userId) {
    state.dmTabs = state.dmTabs.filter(t => t.id !== userId);
    delete state.dmMessages[userId];
    if (state.dmPolling[userId]) { clearInterval(state.dmPolling[userId]); delete state.dmPolling[userId]; }
    if (state.activeTab === userId) state.activeTab = 'group';
    renderChatTabs();
    renderActiveChat();
  }

  async function loadDM(userId) {
    try {
      const d = await api(`/api/dm/${userId}`);
      state.dmMessages[userId] = d.messages || [];
    } catch { state.dmMessages[userId] = []; }
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
      if (d.messages && d.messages.length !== prev.length) {
        state.dmMessages[userId] = d.messages;
        renderActiveChat(false);
      }
    } catch {}
  }

  function renderChatTabs() {
    el.chatTabs.innerHTML = '';
    // Group tab (always present, can't be closed)
    const groupTab = document.createElement('span');
    groupTab.className = 'chat-tab' + (state.activeTab === 'group' ? ' active' : '');
    groupTab.textContent = 'Group';
    groupTab.addEventListener('click', () => {
      state.activeTab = 'group';
      renderChatTabs();
      renderActiveChat();
    });
    el.chatTabs.appendChild(groupTab);

    // DM tabs
    for (const t of state.dmTabs) {
      const tab = document.createElement('span');
      tab.className = 'chat-tab chat-tab-dm' + (state.activeTab === t.id ? ' active' : '');
      tab.dataset.tab = t.id;

      const bg = /^#[0-9a-fA-F]{6}$/.test(t.name_color || '') ? t.name_color : '#000000';
      tab.style.background = bg;
      tab.style.color = isLightHex(bg) ? '#000000' : '#ffffff';

      const nameSpan = document.createElement('span');
      nameSpan.textContent = t.username;
      nameSpan.style.fontFamily = t.name_font || 'Georgia, serif';
      nameSpan.style.cursor = 'pointer';
      nameSpan.addEventListener('click', () => {
        state.activeTab = t.id;
        renderChatTabs();
        renderActiveChat();
      });
      tab.appendChild(nameSpan);

      const closeBtn = document.createElement('span');
      closeBtn.className = 'chat-tab-close';
      closeBtn.textContent = ' ×';
      closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeDMTab(t.id); });
      tab.appendChild(closeBtn);

      el.chatTabs.appendChild(tab);
    }
  }

  function renderActiveChat(forceBottom = false) {
    if (state.activeTab === 'group') {
      renderChat(forceBottom);
    } else {
      renderDMChat(state.activeTab, forceBottom);
    }
  }

  // --- Render ---

  function renderAuthBar() {
    el.authBar.innerHTML = '';
    if (!state.user) {
      el.authBar.innerHTML = '<a href="/login.html">Log in</a> / <a href="/signup.html">Sign up</a>';
      el.chatInput.placeholder = 'Log in to post';
      return;
    }
    el.authBar.appendChild(badge(state.user.username, state.user.name_color, state.user.name_font));
    el.authBar.appendChild(document.createTextNode(' '));
    // Opt in to letting other members email you from the directory
    const allowLabel = document.createElement('label');
    allowLabel.id = 'allow-emails-label';
    const allowBox = document.createElement('input');
    allowBox.type = 'checkbox';
    allowBox.checked = Boolean(state.user.allow_emails);
    allowBox.addEventListener('change', async () => {
      allowBox.disabled = true;
      try {
        const d = await api('/api/auth/profile', { method: 'PATCH', body: { allow_emails: allowBox.checked } });
        state.user = { ...state.user, ...d.user };
        const ur = await api('/api/users');
        state.users = ur.users || [];
        renderDirectory();
      } catch (e) {
        allowBox.checked = !allowBox.checked;
        alert(e.message);
      } finally { allowBox.disabled = false; }
    });
    allowLabel.appendChild(allowBox);
    allowLabel.appendChild(document.createTextNode(' allow emails'));
    el.authBar.appendChild(allowLabel);
    el.authBar.appendChild(document.createTextNode(' · '));
    const styleLink = document.createElement('a');
    styleLink.href = '/style.html';
    styleLink.textContent = 'Style';
    el.authBar.appendChild(styleLink);
    el.authBar.appendChild(document.createTextNode(' · '));
    el.authBar.appendChild(actionLink('Log out', async () => {
      await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
      state.user = null;
      renderAll();
    }));
    el.chatInput.placeholder = 'Message';
  }

  const BANNER_REPEATS = 6;

  // Builds one copy of the banner text; repeated so the marquee reads as a continuous loop
  function bannerItem(ev) {
    const item = document.createElement('span');
    item.className = 'banner-item';
    const label = document.createElement('strong');
    label.textContent = 'Next call:';
    item.appendChild(label);
    item.appendChild(document.createTextNode(' '));
    if (!ev) { item.appendChild(document.createTextNode('none')); return item; }
    const now = Date.now(), s = Date.parse(ev.starts_at), e = s + (ev.duration_minutes||60)*60000;
    if (now >= s && now < e) item.appendChild(document.createTextNode('[Now] '));
    item.appendChild(actionLink(ev.title, () => {
      setMobileView('calendar');
      state.calYear = new Date(ev.starts_at).getFullYear();
      state.calMonth = new Date(ev.starts_at).getMonth();
      renderCalendar();
    }));
    item.appendChild(document.createTextNode(` — ${fmtDT(ev.starts_at)} — `));
    linkify(item, ev.location || 'FaceTime');
    if (ev.creator_username) {
      item.appendChild(document.createTextNode(' — Hosted by '));
      // Username chip: the creator's chosen color as background; white text, or black if the color is too bright
      const chip = badge(ev.creator_username, ev.creator_color, ev.creator_font);
      const bg = /^#[0-9a-fA-F]{6}$/.test(ev.creator_color || '') ? ev.creator_color : '#000000';
      chip.className = 'banner-user';
      chip.style.background = bg;
      chip.style.color = isLightHex(bg) ? '#000000' : '#ffffff';
      chip.style.textShadow = 'none';
      item.appendChild(chip);
    }
    return item;
  }

  function renderBanner() {
    const ev = nextEvent();
    el.nextCallContent.innerHTML = '';
    for (let i = 0; i < BANNER_REPEATS; i++) el.nextCallContent.appendChild(bannerItem(ev));
  }

  function renderChat(forceBottom = false) {
    const stick = forceBottom || el.chatMessages.scrollHeight - el.chatMessages.scrollTop - el.chatMessages.clientHeight < 60;
    el.chatMessages.innerHTML = '';
    if (!state.messages.length) { el.chatMessages.innerHTML = '<p>No messages.</p>'; return; }
    let prevDay = '';
    for (const msg of state.messages) {
      const d = new Date(msg.created_at);
      const day = fmtDay(d);
      if (day !== prevDay) {
        prevDay = day;
        const p = document.createElement('p');
        p.className = 'chat-day';
        p.textContent = day;
        el.chatMessages.appendChild(p);
      }
      const line = document.createElement('div');
      const t = document.createElement('small');
      t.className = 'chat-time';
      t.textContent = d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
      line.appendChild(t);
      line.appendChild(badge(msg.username, msg.name_color, msg.name_font));
      line.appendChild(document.createTextNode(': '));
      linkify(line, msg.body);
      el.chatMessages.appendChild(line);
    }
    if (stick) el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  }

  function renderDMChat(userId, forceBottom = false) {
    const msgs = state.dmMessages[userId] || [];
    const stick = forceBottom || el.chatMessages.scrollHeight - el.chatMessages.scrollTop - el.chatMessages.clientHeight < 60;
    el.chatMessages.innerHTML = '';
    if (!msgs.length) { el.chatMessages.innerHTML = '<p>No messages yet.</p>'; return; }
    let prevDay = '';
    for (const msg of msgs) {
      const d = new Date(msg.created_at);
      const day = fmtDay(d);
      if (day !== prevDay) {
        prevDay = day;
        const p = document.createElement('p');
        p.className = 'chat-day';
        p.textContent = day;
        el.chatMessages.appendChild(p);
      }
      const line = document.createElement('div');
      const t = document.createElement('small');
      t.className = 'chat-time';
      t.textContent = d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
      line.appendChild(t);
      line.appendChild(badge(msg.username, msg.name_color, msg.name_font));
      line.appendChild(document.createTextNode(': '));
      linkify(line, msg.body);
      el.chatMessages.appendChild(line);
    }
    if (stick) el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  }

  function renderDirectory() {
    el.directoryList.innerHTML = '';
    if (!state.users.length) { el.directoryList.innerHTML = '<li>No users yet.</li>'; return; }
    for (const u of state.users) {
      const li = document.createElement('li');
      const status = u.status || 'offline';
      const dot = document.createElement('span');
      dot.className = `presence-dot presence-${status}`;
      dot.title = status.charAt(0).toUpperCase() + status.slice(1);
      dot.setAttribute('aria-label', dot.title);
      li.appendChild(dot);
      li.appendChild(badge(u.username, u.name_color, u.name_font));
      if (state.user && u.id === state.user.id) {
        li.appendChild(document.createTextNode(' (you)'));
        el.directoryList.appendChild(li);
        continue;
      }
      li.appendChild(document.createTextNode(' '));

      const chatBtn = document.createElement('button');
      chatBtn.textContent = 'Chat';
      chatBtn.addEventListener('click', () => {
        if (!requireAuth()) return;
        setDirectoryOpen(false);
        openDMTab(u);
      });
      li.appendChild(chatBtn);

      li.appendChild(document.createTextNode(' '));

      if (u.email) {
        const emailBtn = document.createElement('button');
        emailBtn.textContent = 'Email';
        emailBtn.addEventListener('click', () => openMailto(u.email));
        li.appendChild(emailBtn);
        li.appendChild(document.createTextNode(' '));
      }

      const callBtn = document.createElement('button');
      callBtn.textContent = 'Invite to call';
      callBtn.addEventListener('click', () => {
        if (!requireAuth()) return;
        // Pre-fill a new event and open the form
        el.eventTitleInput.value = `Call with ${u.username}`;
        state.pendingInvite = u;   // emailed the call details once it's created (if they allow emails)
        ensureEventDefaults();
        el.newEventDetails.open = true;
        setDirectoryOpen(false);
        setMobileView('calendar');
      });
      li.appendChild(callBtn);

      el.directoryList.appendChild(li);
    }
  }

  function renderFolders() {
    el.foldersList.innerHTML = '';
    if (!state.folders.length) { el.foldersList.innerHTML = '<li>No folders.</li>'; return; }
    for (const f of state.folders) {
      const li = document.createElement('li');
      li.appendChild(actionLink(f.title, () => openFolder(f.id)));
      li.appendChild(document.createTextNode(` (${f.block_count||0})`));
      attachDrop(li, async (p) => { await dropInFolder(f.id, p); await openFolder(f.id); });
      el.foldersList.appendChild(li);
    }
  }

  // Where clicking a block goes: its external link if it has one, otherwise the block on Are.na
  function blockHref(b) {
    const src = b.source_url || '';
    const isOwnFile = src.startsWith(`${location.origin}/api/files/`) || src.startsWith('/api/files/');
    if (src && !isOwnFile && b.block_type !== 'image') return src;
    if (b.arena_block_id) return `https://www.are.na/block/${b.arena_block_id}`;
    return src || b.image_url || null;
  }

  function newTabLink(href, text) {
    const a = document.createElement('a');
    a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    if (text != null) a.textContent = text;
    return a;
  }

  function blockLI(b) {
    const li = document.createElement('li');
    const href = blockHref(b);
    if (b.image_url) {
      const a = newTabLink(href || b.image_url);
      const img = document.createElement('img');
      img.className = 'block-thumb'; img.src = b.image_url; img.alt = b.title||''; img.loading = 'lazy';
      a.appendChild(img); li.appendChild(a);
    }
    if (b.block_type === 'text') {
      if (b.title) {
        const s = document.createElement('strong');
        s.appendChild(href ? newTabLink(href, b.title) : document.createTextNode(b.title));
        li.appendChild(s);
      }
      const q = document.createElement('blockquote'); linkify(q, b.content||''); li.appendChild(q);
      if (!b.title && href) { li.appendChild(newTabLink(href, 'Open on Are.na')); li.appendChild(document.createElement('br')); }
    } else if (b.block_type === 'file') {
      const label = `${b.title||b.file_name||'File'}${b.file_size ? ` (${fmtBytes(b.file_size)})` : ''}`;
      li.appendChild(href ? newTabLink(href, label) : document.createTextNode(label));
      li.appendChild(document.createElement('br'));
    } else if (href) {
      li.appendChild(newTabLink(href, b.title || b.source_url || 'Open on Are.na'));
      li.appendChild(document.createElement('br'));
    } else if (b.title) {
      li.appendChild(document.createTextNode(b.title)); li.appendChild(document.createElement('br'));
    }
    if (b.note) {
      const n = document.createElement('p'); n.className = 'block-note'; linkify(n, b.note); li.appendChild(n);
    }
    const sm = document.createElement('small');
    if (b.creator_username) sm.appendChild(badge(b.creator_username, b.creator_color, b.creator_font));
    else if (b.arena_author) sm.appendChild(document.createTextNode(b.arena_author));
    const af = state.folders.find(f => f.id === state.activeFolderId);
    if (state.user && (b.created_by === state.user.id || (af && af.created_by === state.user.id))) {
      if (sm.childNodes.length) sm.appendChild(document.createTextNode(' · '));
      sm.appendChild(actionLink('Delete', async () => {
        if (!confirm('Delete block?')) return;
        const d = await api(`/api/blocks/${b.id}`, { method:'DELETE' });
        state.activeFolderBlocks = d.blocks||[];
        state.folders = d.folders||state.folders;
        renderFolders(); renderFolder();
      }));
    }
    li.appendChild(sm);
    return li;
  }

  function renderFolder() {
    const f = state.folders.find(f => f.id === state.activeFolderId);
    if (!f) { state.activeFolderId = null; el.foldersListView.hidden = false; el.folderDetailView.hidden = true; return; }
    el.foldersListView.hidden = true; el.folderDetailView.hidden = false;
    el.activeFolderTitle.textContent = f.title;
    el.activeFolderMeta.innerHTML = '';
    const p = document.createElement('p');
    const sm = document.createElement('small');
    if (f.creator_username) sm.appendChild(badge(f.creator_username, f.creator_color, f.creator_font));
    if (f.arena_channel_slug) {
      if (sm.childNodes.length) sm.appendChild(document.createTextNode(' · '));
      const a = document.createElement('a');
      a.href = `https://www.are.na/channel/${encodeURIComponent(f.arena_channel_slug)}`;
      a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'Are.na';
      sm.appendChild(a);
    }
    if (state.user && f.created_by === state.user.id) {
      if (sm.childNodes.length) sm.appendChild(document.createTextNode(' · '));
      sm.appendChild(actionLink('Delete folder', async () => {
        if (!confirm(`Delete "${f.title}"?`)) return;
        const d = await api(`/api/folders/${f.id}`, { method:'DELETE' });
        state.folders = d.folders||[]; state.activeFolderId = null;
        renderFolders(); renderFolder();
      }));
    }
    p.appendChild(sm); el.activeFolderMeta.appendChild(p);
    el.blocksList.innerHTML = '';
    if (!state.activeFolderBlocks.length) { el.blocksList.innerHTML = '<li>No blocks.</li>'; return; }
    for (const b of state.activeFolderBlocks) el.blocksList.appendChild(blockLI(b));
  }

  // The add-block form stays hidden until "+ Add block" is pressed
  function setAddBlockOpen(open) {
    el.blockDropzone.hidden = !open;
    el.toggleAddBlockBtn.textContent = open ? 'Close' : '+ Add block';
    el.toggleAddBlockBtn.setAttribute('aria-expanded', String(open));
    if (open) el.blockInput.focus();
  }

  async function openFolder(id, sync = false) {
    state.activeFolderId = id;
    el.blockFormError.hidden = true;
    setAddBlockOpen(false);
    renderFolder();
    try {
      const d = await api(`/api/folders/${id}${sync ? '?sync=1' : ''}`);
      if (state.activeFolderId === id) { state.activeFolderBlocks = d.blocks||[]; renderFolder(); }
    } catch (e) { el.blockFormError.textContent = e.message; el.blockFormError.hidden = false; }
  }

  function attachDrop(el, cb) {
    let depth = 0;
    el.addEventListener('dragenter', e => { e.preventDefault(); e.stopPropagation(); depth++; el.classList.add('drag-over'); });
    el.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); el.classList.add('drag-over'); });
    el.addEventListener('dragleave', e => { e.preventDefault(); e.stopPropagation(); if (--depth <= 0) { depth = 0; el.classList.remove('drag-over'); } });
    el.addEventListener('drop', async e => {
      e.preventDefault(); e.stopPropagation(); depth = 0; el.classList.remove('drag-over');
      if (!requireAuth()) return;
      const files = Array.from(e.dataTransfer?.files||[]);
      const text = (e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain') || '').trim();
      await cb({ files, text });
    });
  }

  async function dropInFolder(id, { files, text, title, note }) {
    el.blockFormError.hidden = true;
    el.blockUploadStatus.textContent = 'Saving...'; el.blockUploadStatus.hidden = false;
    el.addBlockSubmitBtn.disabled = true;
    try {
      let d;
      if (files && files.length) {
        const form = new FormData();
        for (const f of files) form.append('file', f);
        if (title) form.append('title', title);
        if (note) form.append('note', note);
        d = await api(`/api/folders/${id}/blocks`, { method:'POST', body: form });
      } else if (text) {
        d = await api(`/api/folders/${id}/blocks`, { method:'POST', body: { input: text, title: title||'', note: note||'' } });
      } else return;
      if (d.folders) state.folders = d.folders;
      if (state.activeFolderId === id && d.blocks) state.activeFolderBlocks = d.blocks;
      renderFolders();
      if (state.activeFolderId === id) renderFolder();
    } catch (e) { setAddBlockOpen(true); el.blockFormError.textContent = e.message; el.blockFormError.hidden = false; }
    finally { el.blockUploadStatus.hidden = true; el.addBlockSubmitBtn.disabled = false; }
  }

  function ensureEventDefaults() {
    if (!el.eventDateInput.value) el.eventDateInput.value = state.selectedDateKey || dateKey(new Date());
    if (!el.eventTimeInput.value) {
      const h = new Date(); h.setHours(h.getHours()+1, 0, 0, 0);
      el.eventTimeInput.value = `${String(h.getHours()).padStart(2,'0')}:00`;
    }
  }

  function renderCalendar() {
    const first = new Date(state.calYear, state.calMonth, 1);
    el.calMonthLabel.textContent = first.toLocaleDateString([], { month:'long', year:'numeric' });
    const evByDate = new Map();
    for (const ev of state.events) { const k = dateKey(new Date(ev.starts_at)); evByDate.set(k, (evByDate.get(k)||0)+1); }
    const startDow = first.getDay(), dim = new Date(state.calYear, state.calMonth+1, 0).getDate();
    const today = dateKey(new Date());
    el.calGridBody.innerHTML = '';
    let dc = 1;
    const total = Math.ceil((startDow + dim) / 7) * 7;
    for (let i = 0; i < total; i++) {
      if (i % 7 === 0) el.calGridBody.appendChild(document.createElement('tr'));
      const tr = el.calGridBody.lastElementChild, td = document.createElement('td');
      if (i < startDow || dc > dim) { const blank = document.createElement('span'); blank.textContent = '\u00a0'; td.appendChild(blank); }
      else {
        const dk = dateKey(new Date(state.calYear, state.calMonth, dc));
        const cnt = evByDate.get(dk)||0;
        const label = `${dc}${cnt ? '*' : ''}`;
        const link = actionLink(label, () => {
          state.selectedDateKey = state.selectedDateKey === dk ? null : dk;
          if (state.selectedDateKey) el.eventDateInput.value = state.selectedDateKey;
          renderCalendar();
        });
        if (dk === state.selectedDateKey) {
          const b = document.createElement('strong');
          b.appendChild(document.createTextNode('[')); b.appendChild(link); b.appendChild(document.createTextNode(']'));
          td.appendChild(b);
        } else if (dk === today) {
          const b = document.createElement('strong'); b.appendChild(link); td.appendChild(b);
        } else td.appendChild(link);
        dc++;
      }
      tr.appendChild(td);
    }
    // Events list
    el.eventsList.innerHTML = '';
    const now = Date.now();
    let filtered;
    if (state.selectedDateKey) {
      el.eventsListHeading.textContent = state.selectedDateKey;
      el.clearDateFilterLink.hidden = false;
      filtered = state.events.filter(ev => dateKey(new Date(ev.starts_at)) === state.selectedDateKey);
    } else {
      el.eventsListHeading.textContent = 'Upcoming';
      el.clearDateFilterLink.hidden = true;
      filtered = state.events.filter(ev => Date.parse(ev.starts_at) + (ev.duration_minutes||60)*60000 > now);
    }
    if (!filtered.length) {
      el.eventsList.innerHTML = `<li>${state.selectedDateKey ? 'No calls on this date.' : 'No upcoming calls.'}</li>`;
      return;
    }
    for (const ev of filtered) {
      const li = document.createElement('li');
      const ts = document.createElement('strong'); ts.textContent = ev.title; li.appendChild(ts);
      li.appendChild(document.createTextNode(` — ${fmtDT(ev.starts_at)} (${ev.duration_minutes||60}m) — `));
      linkify(li, ev.location||'FaceTime');
      if (ev.notes) { li.appendChild(document.createElement('br')); linkify(li, ev.notes); }
      li.appendChild(document.createElement('br'));
      const sm = document.createElement('small');
      const att = ev.attendees||[];
      if (ev.creator_username) sm.appendChild(badge(ev.creator_username, ev.creator_color, ev.creator_font));
      if (att.length) {
        if (sm.childNodes.length) sm.appendChild(document.createTextNode(' · '));
        sm.appendChild(document.createTextNode('Attending: '));
        att.forEach((a,i) => { if (i) sm.appendChild(document.createTextNode(', ')); sm.appendChild(badge(a.username, a.name_color, a.name_font)); });
      }
      const joining = state.user && att.some(a => a.id === state.user.id);
      if (sm.childNodes.length) sm.appendChild(document.createTextNode(' · '));
      sm.appendChild(actionLink(joining ? 'Leave' : 'Join', async () => {
        if (!requireAuth()) return;
        const d = await api(`/api/events/${ev.id}/rsvp`, { method:'POST' });
        state.events = d.events||[]; renderCalendar(); renderBanner();
      }));
      if (state.user && ev.created_by === state.user.id) {
        sm.appendChild(document.createTextNode(' · '));
        sm.appendChild(actionLink('Delete', async () => {
          if (!confirm(`Delete "${ev.title}"?`)) return;
          const d = await api(`/api/events/${ev.id}`, { method:'DELETE' });
          state.events = d.events||[]; renderCalendar(); renderBanner();
        }));
      }
      li.appendChild(sm);
      el.eventsList.appendChild(li);
    }
  }

  function renderAll(forceBottom = false) {
    renderAuthBar(); renderBanner(); renderChatTabs(); renderActiveChat(forceBottom);
    renderFolders(); renderDirectory();
    if (state.activeFolderId) renderFolder();
    renderCalendar();
  }

  function bind() {
    ensureEventDefaults();


    el.chatInput.addEventListener('focus', () => { if (!state.user) window.location.href = '/login.html'; });
    el.chatForm.addEventListener('submit', async e => {
      e.preventDefault();
      if (!requireAuth()) return;
      const text = el.chatInput.value.trim();
      if (!text) return;
      el.chatSendBtn.disabled = true;
      try {
        if (state.activeTab === 'group') {
          const d = await api('/api/messages', { method:'POST', body: { body: text } });
          el.chatInput.value = '';
          if (d.message && !state.messages.some(m => m.id === d.message.id)) {
            state.messages.push(d.message); renderChat(true);
          }
        } else {
          // DM
          const userId = state.activeTab;
          const d = await api(`/api/dm/${userId}`, { method:'POST', body: { body: text } });
          el.chatInput.value = '';
          if (d.message) {
            if (!state.dmMessages[userId]) state.dmMessages[userId] = [];
            if (!state.dmMessages[userId].some(m => m.id === d.message.id)) {
              state.dmMessages[userId].push(d.message);
            }
            renderDMChat(userId, true);
          }
        }
      } catch (e) { alert(e.message); }
      finally { el.chatSendBtn.disabled = false; el.chatInput.focus(); }
    });

    el.newFolderDetails.addEventListener('toggle', () => {
      if (el.newFolderDetails.open && !state.user) { el.newFolderDetails.open = false; window.location.href = '/login.html'; }
    });
    el.newFolderForm.addEventListener('submit', async e => {
      e.preventDefault();
      if (!requireAuth()) return;
      el.folderFormError.hidden = true;
      try {
        const d = await api('/api/folders', { method:'POST', body: { title: el.folderTitleInput.value.trim(), existing_arena_slug: el.folderSlugInput.value.trim() } });
        el.newFolderForm.reset(); el.newFolderDetails.open = false;
        const lr = await api('/api/folders');
        state.folders = lr.folders||[]; renderFolders();
        if (d.folder?.id) await openFolder(d.folder.id);
        if (d.arenaWarning) alert(d.arenaWarning);
      } catch (e) { el.folderFormError.textContent = e.message; el.folderFormError.hidden = false; }
    });

    el.backToFoldersLink.addEventListener('click', e => { e.preventDefault(); state.activeFolderId = null; renderFolder(); });
    el.syncFolderLink.addEventListener('click', async e => {
      e.preventDefault();
      if (state.activeFolderId) {
        await openFolder(state.activeFolderId, true);
        const r = await api('/api/folders');
        state.folders = r.folders||state.folders; renderFolders();
      }
    });

    el.toggleAddBlockBtn.addEventListener('click', () => {
      if (!requireAuth()) return;
      setAddBlockOpen(el.blockDropzone.hidden);
    });

    // Drops work anywhere in the open folder, even with the form closed
    attachDrop(el.folderDetailView, async p => {
      if (!state.activeFolderId) return;
      await dropInFolder(state.activeFolderId, { ...p, title: el.blockTitleInput.value.trim(), note: el.blockNoteInput.value.trim() });
      el.blockTitleInput.value = ''; el.blockNoteInput.value = '';
    });
    el.blockFileInput.addEventListener('change', async () => {
      if (!requireAuth()) { el.blockFileInput.value = ''; return; }
      const files = Array.from(el.blockFileInput.files||[]);
      if (files.length && state.activeFolderId) {
        await dropInFolder(state.activeFolderId, { files, title: el.blockTitleInput.value.trim(), note: el.blockNoteInput.value.trim() });
        el.blockFileInput.value = ''; el.blockTitleInput.value = ''; el.blockNoteInput.value = '';
      }
    });
    el.blockDropzone.addEventListener('paste', async e => {
      const files = Array.from(e.clipboardData?.files||[]);
      if (files.length && state.activeFolderId) {
        e.preventDefault();
        if (!requireAuth()) return;
        await dropInFolder(state.activeFolderId, { files, title: el.blockTitleInput.value.trim(), note: el.blockNoteInput.value.trim() });
      }
    });
    el.addBlockForm.addEventListener('submit', async e => {
      e.preventDefault();
      if (!requireAuth() || !state.activeFolderId) return;
      const text = el.blockInput.value.trim(), title = el.blockTitleInput.value.trim(), note = el.blockNoteInput.value.trim();
      if (!text) return;
      await dropInFolder(state.activeFolderId, { text, title, note });
      el.blockInput.value = ''; el.blockTitleInput.value = ''; el.blockNoteInput.value = '';
    });

    document.getElementById('directory-toggle-btn').addEventListener('click', () => {
      setDirectoryOpen(!document.getElementById('directory-drawer').classList.contains('open'));
    });
    document.getElementById('directory-close-btn').addEventListener('click', () => setDirectoryOpen(false));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') setDirectoryOpen(false); });

    // Cancel: clear everything typed into the new-call form and close it
    document.getElementById('event-cancel-btn').addEventListener('click', () => {
      el.newEventForm.reset();
      el.eventFormError.hidden = true;
      el.newEventDetails.open = false;
      state.pendingInvite = null;
    });

    document.getElementById('schedule-call-btn').addEventListener('click', () => {
      state.pendingInvite = null;
      el.newEventDetails.open = !el.newEventDetails.open;
    });
    el.newEventDetails.addEventListener('toggle', () => {
      if (el.newEventDetails.open) { if (!state.user) { el.newEventDetails.open = false; window.location.href = '/login.html'; return; } ensureEventDefaults(); }
    });
    el.calPrevLink.addEventListener('click', e => { e.preventDefault(); if (--state.calMonth < 0) { state.calMonth = 11; state.calYear--; } renderCalendar(); });
    el.calNextLink.addEventListener('click', e => { e.preventDefault(); if (++state.calMonth > 11) { state.calMonth = 0; state.calYear++; } renderCalendar(); });
    el.calTodayLink.addEventListener('click', e => { e.preventDefault(); const n = new Date(); state.calYear = n.getFullYear(); state.calMonth = n.getMonth(); state.selectedDateKey = null; renderCalendar(); });
    el.clearDateFilterLink.addEventListener('click', e => { e.preventDefault(); state.selectedDateKey = null; renderCalendar(); });
    el.newEventForm.addEventListener('submit', async e => {
      e.preventDefault();
      if (!requireAuth()) return;
      el.eventFormError.hidden = true;
      const ld = new Date(`${el.eventDateInput.value}T${el.eventTimeInput.value}`);
      if (isNaN(ld.getTime())) { el.eventFormError.textContent = 'Invalid date or time.'; el.eventFormError.hidden = false; return; }
      try {
        const payload = {
          title: el.eventTitleInput.value.trim(),
          starts_at: ld.toISOString(),
          duration_minutes: parseInt(el.eventDurationInput.value,10)||60,
          location: el.eventLocationInput.value.trim()||'FaceTime',
          notes: el.eventNotesInput.value.trim()
        };
        const d = await api('/api/events', { method:'POST', body: payload });
        state.events = d.events||[];
        const invitee = state.pendingInvite;
        state.pendingInvite = null;
        if (invitee?.email) emailInvite(invitee, payload);
        el.eventTitleInput.value = ''; el.eventNotesInput.value = ''; el.newEventDetails.open = false;
        state.calYear = ld.getFullYear(); state.calMonth = ld.getMonth();
        renderCalendar(); renderBanner();
      } catch (e) { el.eventFormError.textContent = e.message; el.eventFormError.hidden = false; }
    });
  }

  async function refreshFull(initial = false) {
    const d = await api('/api/bootstrap');
    state.user = d.user;
    state.config = { ...state.config, ...(d.config||{}) };
    state.messages = d.messages||[];
    state.folders = d.folders||[];
    state.events = d.events||[];
    state.users = d.users||[];
    state.stateToken = d.stateToken||'';
    renderAll(initial);
    if (state.activeFolderId) {
      const fd = await api(`/api/folders/${state.activeFolderId}`).catch(() => null);
      if (fd) { state.activeFolderBlocks = fd.blocks||[]; renderFolder(); }
    }
  }

  async function poll() {
    if (document.hidden) return;
    try {
      const last = state.messages.length ? state.messages[state.messages.length-1].id : 0;
      const d = await api(`/api/poll?after_msg=${last}`);
      if (d.messages?.length) {
        let added = false;
        for (const m of d.messages) if (!state.messages.some(x => x.id === m.id)) { state.messages.push(m); added = true; }
        if (added && state.activeTab === 'group') renderChat(false);
      }
      if (d.stateToken && d.stateToken !== state.stateToken) {
        state.stateToken = d.stateToken;
        const [fr, er, ur] = await Promise.all([api('/api/folders'), api('/api/events'), api('/api/users')]);
        state.folders = fr.folders||[]; state.events = er.events||[]; state.users = ur.users||[];
        renderFolders(); renderCalendar(); renderBanner(); renderDirectory();
        if (state.activeFolderId) {
          const ad = await api(`/api/folders/${state.activeFolderId}`).catch(() => null);
          if (ad) { state.activeFolderBlocks = ad.blocks||[]; renderFolder(); }
        }
      }
    } catch {}
  }

  // NTS radio: one shared audio element, only one channel plays at a time
  function bindRadio() {
    const audio = new Audio();
    const btns = document.querySelectorAll('.radio-btn');
    const label = (b, playing) => {
      const n = b.textContent.trim().charAt(0);
      b.textContent = `${n} ${playing ? '\u25A0' : '\u25B6'}`;
      b.setAttribute('aria-label', `${playing ? 'Stop' : 'Play'} NTS ${n}`);
    };
    btns.forEach(b => b.addEventListener('click', () => {
      const playingThis = !audio.paused && audio.dataset.src === b.dataset.src;
      audio.pause();
      btns.forEach(x => label(x, false));
      if (playingThis) { audio.removeAttribute('src'); audio.load(); return; }
      audio.src = b.dataset.src; audio.dataset.src = b.dataset.src;
      audio.play().then(() => label(b, true)).catch(() => {});
    }));
  }

  // --- Presence: heartbeat every 30s; "away" when the tab is hidden or idle for 5 min ---
  const PRESENCE_INTERVAL_MS = 30000;
  const IDLE_MS = 5 * 60000;
  let lastActivity = Date.now();

  function myStatus() {
    return document.hidden || Date.now() - lastActivity > IDLE_MS ? 'away' : 'online';
  }

  // Logged in: report status and get the directory back. Logged out: just refresh the directory.
  async function sendPresence() {
    try {
      const d = state.user
        ? await api('/api/presence', { method: 'POST', body: { status: myStatus() } })
        : await api('/api/users');
      if (d.users) { state.users = d.users; renderDirectory(); }
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
    ['pointerdown', 'keydown', 'pointermove', 'scroll', 'focus'].forEach(ev =>
      window.addEventListener(ev, bump, { passive: true, capture: true }));
    document.addEventListener('visibilitychange', sendPresence);
    // Leaving the page: mark offline right away
    window.addEventListener('pagehide', () => {
      if (!state.user) return;
      const blob = new Blob([JSON.stringify({ status: 'offline' })], { type: 'application/json' });
      navigator.sendBeacon('/api/presence', blob);
    });
  }

  async function init() {
    bind();
    bindRadio();
    try { await refreshFull(true); } catch (e) { el.nextCallContent.textContent = `Error: ${e.message}`; }
    setInterval(poll, 3000);
    setInterval(renderBanner, 30000);
    startPresence();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  }

  init();
})();
