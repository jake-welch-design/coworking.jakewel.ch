// Coworking frontend — plain HTML elements

(function () {
  'use strict';

  const DEFAULT_FONTS = [
    { value: 'Georgia, serif', label: 'Georgia' },
    { value: "'Courier New', monospace", label: 'Courier New' },
    { value: "'Times New Roman', serif", label: 'Times New Roman' },
    { value: 'Verdana, sans-serif', label: 'Verdana' },
    { value: "'Trebuchet MS', sans-serif", label: 'Trebuchet MS' },
    { value: 'Impact, sans-serif', label: 'Impact' },
    { value: "'Comic Sans MS', cursive", label: 'Comic Sans MS' },
    { value: "Palatino, 'Palatino Linotype', serif", label: 'Palatino' },
    { value: 'Garamond, serif', label: 'Garamond' },
    { value: "'Arial Black', sans-serif", label: 'Arial Black' },
    { value: 'Monaco, Consolas, monospace', label: 'Monaco' },
    { value: "'Brush Script MT', cursive", label: 'Brush Script' }
  ];

  const state = {
    user: null,
    config: {
      arenaConfigured: false,
      passcodeRequired: false,
      allowedFonts: DEFAULT_FONTS.map((f) => f.value)
    },
    messages: [],
    folders: [],
    activeFolderId: null,
    activeFolderBlocks: [],
    events: [],
    calYear: new Date().getFullYear(),
    calMonth: new Date().getMonth(),
    selectedDateKey: null,
    stateToken: '',
    mobileView: 'chat'
  };

  const el = {
    workspace: document.getElementById('workspace'),
    brandLink: document.getElementById('brand-link'),
    authBar: document.getElementById('auth-bar'),
    nextCallContent: document.getElementById('next-call-content'),

    mobileSelect: document.getElementById('mobile-view-select'),
    mobileBackChatLink: document.getElementById('mobile-back-chat-link'),

    // Resources
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
    addBlockSubmitBtn: document.getElementById('add-block-submit-btn'),
    blockUploadStatus: document.getElementById('block-upload-status'),
    blockFormError: document.getElementById('block-form-error'),
    blocksList: document.getElementById('blocks-list'),

    // Chat
    chatMessages: document.getElementById('chat-messages'),
    chatForm: document.getElementById('chat-form'),
    chatInput: document.getElementById('chat-input'),
    chatSendBtn: document.getElementById('chat-send-btn'),

    // Calendar
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
    eventsList: document.getElementById('events-list'),

    // Dialog
    authDialog: document.getElementById('auth-dialog'),
    authNavLinks: document.getElementById('auth-nav-links'),
    loginForm: document.getElementById('login-form'),
    loginIdentifier: document.getElementById('login-identifier'),
    loginPassword: document.getElementById('login-password'),
    loginError: document.getElementById('login-error'),
    signupForm: document.getElementById('signup-form'),
    signupEmail: document.getElementById('signup-email'),
    signupUsername: document.getElementById('signup-username'),
    signupPassword: document.getElementById('signup-password'),
    signupPasscodeRow: document.getElementById('signup-passcode-row'),
    signupPasscode: document.getElementById('signup-passcode'),
    signupColor: document.getElementById('signup-color'),
    signupFont: document.getElementById('signup-font'),
    signupNamePreview: document.getElementById('signup-name-preview'),
    signupError: document.getElementById('signup-error'),
    styleForm: document.getElementById('style-form'),
    styleColor: document.getElementById('style-color'),
    styleFont: document.getElementById('style-font'),
    styleNamePreview: document.getElementById('style-name-preview'),
    styleError: document.getElementById('style-error')
  };

  async function api(path, options = {}) {
    const opts = {
      credentials: 'same-origin',
      ...options,
      headers: { ...(options.headers || {}) }
    };
    if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Error ${res.status}`);
    }
    return data;
  }

  function isVeryLightHex(hex) {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex || '')) return false;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b > 225;
  }

  function applyUserStyle(node, color, font) {
    const safeColor = /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : '#000000';
    node.style.color = safeColor;
    node.style.fontFamily = font || 'Georgia, serif';
    node.style.textShadow = isVeryLightHex(safeColor) ? '0 0 1px #000000' : 'none';
  }

  function createUserBadge(username, color, font) {
    const span = document.createElement('span');
    span.textContent = username || 'unknown';
    applyUserStyle(span, color, font);
    return span;
  }

  function makeActionLink(label, onClick) {
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = label;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      onClick(e);
    });
    return a;
  }

  function appendLinkifiedText(container, text) {
    const raw = String(text || '');
    const urlRegex = /(https?:\/\/[^\s<>"']+)/gi;
    let lastIndex = 0;
    let match;
    while ((match = urlRegex.exec(raw)) !== null) {
      if (match.index > lastIndex) {
        container.appendChild(document.createTextNode(raw.slice(lastIndex, match.index)));
      }
      let urlStr = match[0];
      let trailing = '';
      while (/[.,;:!?)]$/.test(urlStr)) {
        trailing = urlStr.slice(-1) + trailing;
        urlStr = urlStr.slice(0, -1);
      }
      const a = document.createElement('a');
      a.href = urlStr;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = urlStr;
      container.appendChild(a);
      if (trailing) container.appendChild(document.createTextNode(trailing));
      lastIndex = urlRegex.lastIndex;
    }
    if (lastIndex < raw.length) {
      container.appendChild(document.createTextNode(raw.slice(lastIndex)));
    }
  }

  function toLocalDateKey(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function formatBytes(bytes) {
    if (!bytes || bytes < 1024) return `${bytes || 0} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatEventDateTime(isoStr) {
    const d = new Date(isoStr);
    return d.toLocaleString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short'
    });
  }

  function computeClientNextEvent() {
    const now = Date.now();
    for (const ev of state.events) {
      const startMs = Date.parse(ev.starts_at);
      if (Number.isNaN(startMs)) continue;
      const endMs = startMs + (ev.duration_minutes || 60) * 60_000;
      if (endMs > now) return ev;
    }
    return null;
  }

  function setMobileView(view) {
    state.mobileView = view;
    el.workspace.setAttribute('data-mobile-view', view);
    el.mobileSelect.value = view;
    el.mobileBackChatLink.hidden = view === 'chat';
  }

  function requireAuthOrPrompt(tab = 'login') {
    if (state.user) return true;
    openAuthDialog(tab);
    return false;
  }

  // --- Native <dialog> for Auth & Style ---

  function populateFontSelect(selectEl) {
    selectEl.innerHTML = '';
    for (const f of DEFAULT_FONTS) {
      const opt = document.createElement('option');
      opt.value = f.value;
      opt.textContent = f.label;
      selectEl.appendChild(opt);
    }
  }

  function updateSignupPreview() {
    const name = el.signupUsername.value.trim() || 'username';
    el.signupNamePreview.textContent = name;
    applyUserStyle(el.signupNamePreview, el.signupColor.value, el.signupFont.value);
  }

  function updateStylePreview() {
    const name = state.user?.username || 'username';
    el.styleNamePreview.textContent = name;
    applyUserStyle(el.styleNamePreview, el.styleColor.value, el.styleFont.value);
  }

  function openAuthDialog(mode = 'login') {
    el.loginError.hidden = true;
    el.signupError.hidden = true;
    el.styleError.hidden = true;

    if (mode === 'style' && state.user) {
      el.authNavLinks.hidden = true;
      el.loginForm.hidden = true;
      el.signupForm.hidden = true;
      el.styleForm.hidden = false;
      el.styleColor.value = state.user.name_color || '#000000';
      el.styleFont.value = state.user.name_font || DEFAULT_FONTS[0].value;
      updateStylePreview();
    } else {
      el.authNavLinks.hidden = false;
      el.styleForm.hidden = true;
      switchAuthTab(mode === 'signup' ? 'signup' : 'login');
    }

    if (!el.authDialog.open) {
      el.authDialog.showModal();
    }
  }

  function switchAuthTab(tab) {
    const isLogin = tab === 'login';
    el.loginForm.hidden = !isLogin;
    el.signupForm.hidden = isLogin;
    el.signupPasscodeRow.hidden = !state.config.passcodeRequired;
    if (!isLogin) updateSignupPreview();
  }

  function closeAuthDialog() {
    if (el.authDialog.open) el.authDialog.close();
  }

  // --- Rendering ---

  function renderAuthBar() {
    el.authBar.innerHTML = '';
    if (!state.user) {
      el.authBar.appendChild(makeActionLink('Log in', () => openAuthDialog('login')));
      el.authBar.appendChild(document.createTextNode(' / '));
      el.authBar.appendChild(makeActionLink('Sign up', () => openAuthDialog('signup')));
      el.chatInput.placeholder = 'Log in to post';
      return;
    }

    el.authBar.appendChild(
      createUserBadge(state.user.username, state.user.name_color, state.user.name_font)
    );
    el.authBar.appendChild(document.createTextNode(' · '));
    el.authBar.appendChild(makeActionLink('Style', () => openAuthDialog('style')));
    el.authBar.appendChild(document.createTextNode(' · '));
    el.authBar.appendChild(
      makeActionLink('Log out', async () => {
        await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
        state.user = null;
        renderAll();
      })
    );
    el.chatInput.placeholder = 'Message';
  }

  function renderNextCallBanner() {
    const nextEv = computeClientNextEvent();
    el.nextCallContent.innerHTML = '';

    if (!nextEv) {
      el.nextCallContent.textContent = 'none';
      return;
    }

    const now = Date.now();
    const startMs = Date.parse(nextEv.starts_at);
    const endMs = startMs + (nextEv.duration_minutes || 60) * 60_000;
    if (now >= startMs && now < endMs) {
      el.nextCallContent.appendChild(document.createTextNode('[Now] '));
    }

    el.nextCallContent.appendChild(
      makeActionLink(nextEv.title, () => {
        setMobileView('calendar');
        const evDate = new Date(nextEv.starts_at);
        state.calYear = evDate.getFullYear();
        state.calMonth = evDate.getMonth();
        renderCalendar();
      })
    );

    el.nextCallContent.appendChild(
      document.createTextNode(` — ${formatEventDateTime(nextEv.starts_at)} — `)
    );
    appendLinkifiedText(el.nextCallContent, nextEv.location || 'FaceTime');

    if (nextEv.creator_username) {
      el.nextCallContent.appendChild(document.createTextNode(' — '));
      el.nextCallContent.appendChild(
        createUserBadge(nextEv.creator_username, nextEv.creator_color, nextEv.creator_font)
      );
    }
  }

  // --- Chat ---

  function isChatNearBottom() {
    return el.chatMessages.scrollHeight - el.chatMessages.scrollTop - el.chatMessages.clientHeight < 60;
  }

  function renderChat(forceScrollBottom = false) {
    const stickToBottom = forceScrollBottom || isChatNearBottom();
    el.chatMessages.innerHTML = '';

    if (state.messages.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'No messages.';
      el.chatMessages.appendChild(p);
      return;
    }

    let prevDay = '';
    for (const msg of state.messages) {
      const d = new Date(msg.created_at);
      const dayLabel = d.toLocaleDateString([], {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
      if (dayLabel !== prevDay) {
        prevDay = dayLabel;
        const dayP = document.createElement('p');
        const small = document.createElement('small');
        small.textContent = `— ${dayLabel} —`;
        dayP.appendChild(small);
        el.chatMessages.appendChild(dayP);
      }

      const line = document.createElement('div');
      const timeSmall = document.createElement('small');
      timeSmall.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ';
      line.appendChild(timeSmall);

      line.appendChild(createUserBadge(msg.username, msg.name_color, msg.name_font));
      line.appendChild(document.createTextNode(': '));
      appendLinkifiedText(line, msg.body);

      el.chatMessages.appendChild(line);
    }

    if (stickToBottom) {
      el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
    }
  }

  // --- Resources (Are.na Folders & Blocks) ---

  function renderFoldersList() {
    el.foldersList.innerHTML = '';
    if (state.folders.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'No folders.';
      el.foldersList.appendChild(li);
      return;
    }

    for (const folder of state.folders) {
      const li = document.createElement('li');
      li.appendChild(makeActionLink(folder.title, () => openFolder(folder.id)));
      li.appendChild(document.createTextNode(` (${folder.block_count || 0})`));

      if (folder.creator_username) {
        li.appendChild(document.createTextNode(' — '));
        li.appendChild(
          createUserBadge(folder.creator_username, folder.creator_color, folder.creator_font)
        );
      }

      attachDropHandlers(li, async (dropPayload) => {
        await handleDropIntoFolder(folder.id, dropPayload);
        await openFolder(folder.id, false);
      });

      el.foldersList.appendChild(li);
    }
  }

  function createBlockListItem(block) {
    const li = document.createElement('li');

    if (block.image_url) {
      const a = document.createElement('a');
      a.href = block.source_url || block.image_url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';

      const img = document.createElement('img');
      img.className = 'block-thumb';
      img.src = block.image_url;
      img.alt = block.title || block.file_name || 'Image';
      img.loading = 'lazy';
      a.appendChild(img);
      li.appendChild(a);
    }

    if (block.block_type === 'text') {
      if (block.title) {
        const b = document.createElement('strong');
        b.textContent = block.title;
        li.appendChild(b);
      }
      const q = document.createElement('blockquote');
      appendLinkifiedText(q, block.content || '');
      li.appendChild(q);
    } else if (block.block_type === 'file') {
      const a = document.createElement('a');
      a.href = block.source_url || '#';
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      const sizeStr = block.file_size ? ` (${formatBytes(block.file_size)})` : '';
      a.textContent = `${block.title || block.file_name || 'File'}${sizeStr}`;
      li.appendChild(a);
      li.appendChild(document.createElement('br'));
    } else if (block.source_url) {
      const a = document.createElement('a');
      a.href = block.source_url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = block.title || block.source_url;
      li.appendChild(a);
      li.appendChild(document.createElement('br'));
    } else if (block.title) {
      li.appendChild(document.createTextNode(block.title));
      li.appendChild(document.createElement('br'));
    }

    const meta = document.createElement('small');
    if (block.creator_username) {
      meta.appendChild(
        createUserBadge(block.creator_username, block.creator_color, block.creator_font)
      );
    } else if (block.arena_author) {
      meta.appendChild(document.createTextNode(block.arena_author));
    }

    const activeFolder = state.folders.find((f) => f.id === state.activeFolderId);
    const canDelete =
      state.user &&
      (block.created_by === state.user.id ||
        (activeFolder && activeFolder.created_by === state.user.id));

    if (canDelete) {
      if (meta.childNodes.length) meta.appendChild(document.createTextNode(' · '));
      meta.appendChild(
        makeActionLink('Delete', async () => {
          if (!confirm('Delete block?')) return;
          const data = await api(`/api/blocks/${block.id}`, { method: 'DELETE' });
          state.activeFolderBlocks = data.blocks || [];
          state.folders = data.folders || state.folders;
          renderFoldersList();
          renderActiveFolder();
        })
      );
    }

    li.appendChild(meta);
    return li;
  }

  function renderActiveFolder() {
    const folder = state.folders.find((f) => f.id === state.activeFolderId);
    if (!folder) {
      state.activeFolderId = null;
      el.foldersListView.hidden = false;
      el.folderDetailView.hidden = true;
      return;
    }

    el.foldersListView.hidden = true;
    el.folderDetailView.hidden = false;

    el.activeFolderMeta.innerHTML = '';
    const p = document.createElement('p');
    const titleStrong = document.createElement('strong');
    titleStrong.textContent = folder.title;
    p.appendChild(titleStrong);
    p.appendChild(document.createElement('br'));

    const small = document.createElement('small');
    if (folder.creator_username) {
      small.appendChild(
        createUserBadge(folder.creator_username, folder.creator_color, folder.creator_font)
      );
    }
    if (folder.arena_channel_slug) {
      if (small.childNodes.length) small.appendChild(document.createTextNode(' · '));
      const arenaLink = document.createElement('a');
      arenaLink.href = `https://www.are.na/channel/${encodeURIComponent(folder.arena_channel_slug)}`;
      arenaLink.target = '_blank';
      arenaLink.rel = 'noopener noreferrer';
      arenaLink.textContent = 'Are.na';
      small.appendChild(arenaLink);
    }
    if (state.user && folder.created_by === state.user.id) {
      if (small.childNodes.length) small.appendChild(document.createTextNode(' · '));
      small.appendChild(
        makeActionLink('Delete folder', async () => {
          if (!confirm(`Delete folder "${folder.title}"?`)) return;
          const data = await api(`/api/folders/${folder.id}`, { method: 'DELETE' });
          state.folders = data.folders || [];
          state.activeFolderId = null;
          renderFoldersList();
          renderActiveFolder();
        })
      );
    }
    p.appendChild(small);
    el.activeFolderMeta.appendChild(p);

    el.blocksList.innerHTML = '';
    if (state.activeFolderBlocks.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'No blocks.';
      el.blocksList.appendChild(li);
    } else {
      for (const b of state.activeFolderBlocks) {
        el.blocksList.appendChild(createBlockListItem(b));
      }
    }
  }

  async function openFolder(folderId, shouldSync = false) {
    state.activeFolderId = folderId;
    el.blockFormError.hidden = true;
    renderActiveFolder();
    const query = shouldSync ? '?sync=1' : '';
    try {
      const data = await api(`/api/folders/${folderId}${query}`);
      if (state.activeFolderId === folderId) {
        state.activeFolderBlocks = data.blocks || [];
        renderActiveFolder();
      }
    } catch (err) {
      el.blockFormError.textContent = err.message;
      el.blockFormError.hidden = false;
    }
  }

  function attachDropHandlers(element, onDropCallback) {
    let dragDepth = 0;
    element.addEventListener('dragenter', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepth++;
      element.classList.add('drag-over');
    });
    element.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      element.classList.add('drag-over');
    });
    element.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) element.classList.remove('drag-over');
    });
    element.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepth = 0;
      element.classList.remove('drag-over');
      if (!requireAuthOrPrompt('login')) return;

      const files = Array.from(e.dataTransfer?.files || []);
      const uri = e.dataTransfer?.getData('text/uri-list') || '';
      const plain = e.dataTransfer?.getData('text/plain') || '';
      await onDropCallback({ files, text: (uri || plain).trim() });
    });
  }

  async function handleDropIntoFolder(folderId, { files, text, title }) {
    el.blockFormError.hidden = true;
    el.blockUploadStatus.textContent = 'Saving...';
    el.blockUploadStatus.hidden = false;
    el.addBlockSubmitBtn.disabled = true;

    try {
      let data;
      if (files && files.length > 0) {
        const form = new FormData();
        for (const f of files) form.append('file', f);
        if (title) form.append('title', title);
        data = await api(`/api/folders/${folderId}/blocks`, {
          method: 'POST',
          body: form
        });
      } else if (text) {
        data = await api(`/api/folders/${folderId}/blocks`, {
          method: 'POST',
          body: { input: text, title: title || '' }
        });
      } else {
        return;
      }

      if (data.folders) state.folders = data.folders;
      if (state.activeFolderId === folderId && data.blocks) {
        state.activeFolderBlocks = data.blocks;
      }
      renderFoldersList();
      if (state.activeFolderId === folderId) renderActiveFolder();
    } catch (err) {
      el.blockFormError.textContent = err.message;
      el.blockFormError.hidden = false;
    } finally {
      el.blockUploadStatus.hidden = true;
      el.addBlockSubmitBtn.disabled = false;
    }
  }

  // --- Calendar ---

  function ensureDefaultEventDateTime() {
    if (!el.eventDateInput.value) {
      el.eventDateInput.value = state.selectedDateKey || toLocalDateKey(new Date());
    }
    if (!el.eventTimeInput.value) {
      const nextHour = new Date();
      nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
      el.eventTimeInput.value = `${String(nextHour.getHours()).padStart(2, '0')}:00`;
    }
  }

  function renderCalendar() {
    const firstOfMonth = new Date(state.calYear, state.calMonth, 1);
    el.calMonthLabel.textContent = firstOfMonth.toLocaleDateString([], {
      month: 'long',
      year: 'numeric'
    });

    const eventsByDateKey = new Map();
    for (const ev of state.events) {
      const key = toLocalDateKey(new Date(ev.starts_at));
      eventsByDateKey.set(key, (eventsByDateKey.get(key) || 0) + 1);
    }

    const startDayOfWeek = firstOfMonth.getDay();
    const daysInMonth = new Date(state.calYear, state.calMonth + 1, 0).getDate();
    const todayKey = toLocalDateKey(new Date());

    el.calGridBody.innerHTML = '';
    let dayCounter = 1;
    const totalCells = Math.ceil((startDayOfWeek + daysInMonth) / 7) * 7;

    for (let cellIdx = 0; cellIdx < totalCells; cellIdx++) {
      if (cellIdx % 7 === 0) {
        el.calGridBody.appendChild(document.createElement('tr'));
      }
      const tr = el.calGridBody.lastElementChild;
      const td = document.createElement('td');

      if (cellIdx < startDayOfWeek || dayCounter > daysInMonth) {
        td.textContent = '\u00a0';
      } else {
        const dObj = new Date(state.calYear, state.calMonth, dayCounter);
        const dateKey = toLocalDateKey(dObj);
        const count = eventsByDateKey.get(dateKey) || 0;
        const label = `${dayCounter}${count > 0 ? '*' : ''}`;

        const dayLink = makeActionLink(label, () => {
          state.selectedDateKey = state.selectedDateKey === dateKey ? null : dateKey;
          if (state.selectedDateKey) {
            el.eventDateInput.value = state.selectedDateKey;
          }
          renderCalendar();
        });

        if (dateKey === state.selectedDateKey) {
          const strong = document.createElement('strong');
          strong.appendChild(document.createTextNode('['));
          strong.appendChild(dayLink);
          strong.appendChild(document.createTextNode(']'));
          td.appendChild(strong);
        } else if (dateKey === todayKey) {
          const strong = document.createElement('strong');
          strong.appendChild(dayLink);
          td.appendChild(strong);
        } else {
          td.appendChild(dayLink);
        }

        dayCounter++;
      }
      tr.appendChild(td);
    }

    el.eventsList.innerHTML = '';
    const now = Date.now();
    let filteredEvents;

    if (state.selectedDateKey) {
      el.eventsListHeading.textContent = state.selectedDateKey;
      el.clearDateFilterLink.hidden = false;
      filteredEvents = state.events.filter(
        (ev) => toLocalDateKey(new Date(ev.starts_at)) === state.selectedDateKey
      );
    } else {
      el.eventsListHeading.textContent = 'Upcoming';
      el.clearDateFilterLink.hidden = true;
      filteredEvents = state.events.filter((ev) => {
        const endMs = Date.parse(ev.starts_at) + (ev.duration_minutes || 60) * 60_000;
        return endMs > now;
      });
    }

    if (filteredEvents.length === 0) {
      const li = document.createElement('li');
      li.textContent = state.selectedDateKey ? 'No calls on this date.' : 'No upcoming calls.';
      el.eventsList.appendChild(li);
      return;
    }

    for (const ev of filteredEvents) {
      const li = document.createElement('li');

      const titleStrong = document.createElement('strong');
      titleStrong.textContent = ev.title;
      li.appendChild(titleStrong);
      li.appendChild(
        document.createTextNode(
          ` — ${formatEventDateTime(ev.starts_at)} (${ev.duration_minutes || 60}m) — `
        )
      );
      appendLinkifiedText(li, ev.location || 'FaceTime');

      if (ev.notes) {
        li.appendChild(document.createElement('br'));
        appendLinkifiedText(li, ev.notes);
      }

      li.appendChild(document.createElement('br'));
      const small = document.createElement('small');

      const attendees = ev.attendees || [];
      if (ev.creator_username) {
        small.appendChild(
          createUserBadge(ev.creator_username, ev.creator_color, ev.creator_font)
        );
      }
      if (attendees.length > 0) {
        if (small.childNodes.length) small.appendChild(document.createTextNode(' · '));
        small.appendChild(document.createTextNode('Attending: '));
        attendees.forEach((a, idx) => {
          if (idx > 0) small.appendChild(document.createTextNode(', '));
          small.appendChild(createUserBadge(a.username, a.name_color, a.name_font));
        });
      }

      const isJoining = Boolean(state.user && attendees.some((a) => a.id === state.user.id));
      if (small.childNodes.length) small.appendChild(document.createTextNode(' · '));
      small.appendChild(
        makeActionLink(isJoining ? 'Leave' : 'Join', async () => {
          if (!requireAuthOrPrompt('login')) return;
          const data = await api(`/api/events/${ev.id}/rsvp`, { method: 'POST' });
          state.events = data.events || [];
          renderCalendar();
          renderNextCallBanner();
        })
      );

      if (state.user && ev.created_by === state.user.id) {
        small.appendChild(document.createTextNode(' · '));
        small.appendChild(
          makeActionLink('Delete', async () => {
            if (!confirm(`Delete "${ev.title}"?`)) return;
            const data = await api(`/api/events/${ev.id}`, { method: 'DELETE' });
            state.events = data.events || [];
            renderCalendar();
            renderNextCallBanner();
          })
        );
      }

      li.appendChild(small);
      el.eventsList.appendChild(li);
    }
  }

  function renderAll(forceChatBottom = false) {
    renderAuthBar();
    renderNextCallBanner();
    renderChat(forceChatBottom);
    renderFoldersList();
    if (state.activeFolderId) renderActiveFolder();
    renderCalendar();
  }

  // --- Event Listeners ---

  function bindEvents() {
    populateFontSelect(el.signupFont);
    populateFontSelect(el.styleFont);
    ensureDefaultEventDateTime();

    el.signupUsername.addEventListener('input', updateSignupPreview);
    el.signupColor.addEventListener('input', updateSignupPreview);
    el.signupFont.addEventListener('change', updateSignupPreview);

    el.styleColor.addEventListener('input', updateStylePreview);
    el.styleFont.addEventListener('change', updateStylePreview);

    el.brandLink.addEventListener('click', (e) => {
      e.preventDefault();
      setMobileView('chat');
    });

    el.mobileSelect.addEventListener('change', () => {
      setMobileView(el.mobileSelect.value);
    });
    el.mobileBackChatLink.addEventListener('click', (e) => {
      e.preventDefault();
      setMobileView('chat');
    });

    for (const btn of document.querySelectorAll('.close-dialog-btn')) {
      btn.addEventListener('click', closeAuthDialog);
    }
    for (const link of el.authNavLinks.querySelectorAll('a')) {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        switchAuthTab(link.dataset.authTab);
      });
    }

    el.loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      el.loginError.hidden = true;
      try {
        const data = await api('/api/auth/login', {
          method: 'POST',
          body: {
            identifier: el.loginIdentifier.value.trim(),
            password: el.loginPassword.value
          }
        });
        state.user = data.user;
        el.loginForm.reset();
        closeAuthDialog();
        renderAll();
      } catch (err) {
        el.loginError.textContent = err.message;
        el.loginError.hidden = false;
      }
    });

    el.signupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      el.signupError.hidden = true;
      try {
        const data = await api('/api/auth/signup', {
          method: 'POST',
          body: {
            email: el.signupEmail.value.trim(),
            username: el.signupUsername.value.trim(),
            password: el.signupPassword.value,
            passcode: el.signupPasscode.value,
            name_color: el.signupColor.value,
            name_font: el.signupFont.value
          }
        });
        state.user = data.user;
        el.signupForm.reset();
        closeAuthDialog();
        renderAll();
      } catch (err) {
        el.signupError.textContent = err.message;
        el.signupError.hidden = false;
      }
    });

    el.styleForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      el.styleError.hidden = true;
      try {
        const data = await api('/api/auth/profile', {
          method: 'PATCH',
          body: {
            name_color: el.styleColor.value,
            name_font: el.styleFont.value
          }
        });
        state.user = data.user;
        await refreshFullState();
        closeAuthDialog();
      } catch (err) {
        el.styleError.textContent = err.message;
        el.styleError.hidden = false;
      }
    });

    // Chat
    el.chatInput.addEventListener('focus', () => {
      if (!state.user) openAuthDialog('login');
    });
    el.chatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!requireAuthOrPrompt('login')) return;
      const text = el.chatInput.value.trim();
      if (!text) return;

      el.chatSendBtn.disabled = true;
      try {
        const data = await api('/api/messages', {
          method: 'POST',
          body: { body: text }
        });
        el.chatInput.value = '';
        if (data.message && !state.messages.some((m) => m.id === data.message.id)) {
          state.messages.push(data.message);
          renderChat(true);
        }
      } catch (err) {
        alert(err.message);
      } finally {
        el.chatSendBtn.disabled = false;
        el.chatInput.focus();
      }
    });

    // Folders
    el.newFolderDetails.addEventListener('toggle', () => {
      if (el.newFolderDetails.open && !state.user) {
        el.newFolderDetails.open = false;
        openAuthDialog('login');
      }
    });
    el.newFolderForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!requireAuthOrPrompt('login')) return;
      el.folderFormError.hidden = true;
      try {
        const data = await api('/api/folders', {
          method: 'POST',
          body: {
            title: el.folderTitleInput.value.trim(),
            existing_arena_slug: el.folderSlugInput.value.trim()
          }
        });
        el.newFolderForm.reset();
        el.newFolderDetails.open = false;
        const listRes = await api('/api/folders');
        state.folders = listRes.folders || [];
        renderFoldersList();
        if (data.folder?.id) {
          await openFolder(data.folder.id, false);
        }
        if (data.arenaWarning) {
          alert(data.arenaWarning);
        }
      } catch (err) {
        el.folderFormError.textContent = err.message;
        el.folderFormError.hidden = false;
      }
    });

    el.backToFoldersLink.addEventListener('click', (e) => {
      e.preventDefault();
      state.activeFolderId = null;
      renderActiveFolder();
    });
    el.syncFolderLink.addEventListener('click', async (e) => {
      e.preventDefault();
      if (state.activeFolderId) {
        await openFolder(state.activeFolderId, true);
        const fRes = await api('/api/folders');
        state.folders = fRes.folders || state.folders;
        renderFoldersList();
      }
    });

    attachDropHandlers(el.blockDropzone, async (dropPayload) => {
      if (!state.activeFolderId) return;
      await handleDropIntoFolder(state.activeFolderId, {
        ...dropPayload,
        title: el.blockTitleInput.value.trim()
      });
      el.blockTitleInput.value = '';
    });

    el.blockFileInput.addEventListener('change', async () => {
      if (!requireAuthOrPrompt('login')) {
        el.blockFileInput.value = '';
        return;
      }
      const files = Array.from(el.blockFileInput.files || []);
      if (files.length > 0 && state.activeFolderId) {
        await handleDropIntoFolder(state.activeFolderId, {
          files,
          title: el.blockTitleInput.value.trim()
        });
        el.blockFileInput.value = '';
        el.blockTitleInput.value = '';
      }
    });

    el.blockDropzone.addEventListener('paste', async (e) => {
      const files = Array.from(e.clipboardData?.files || []);
      if (files.length > 0 && state.activeFolderId) {
        e.preventDefault();
        if (!requireAuthOrPrompt('login')) return;
        await handleDropIntoFolder(state.activeFolderId, {
          files,
          title: el.blockTitleInput.value.trim()
        });
      }
    });

    el.addBlockForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!requireAuthOrPrompt('login')) return;
      if (!state.activeFolderId) return;
      const text = el.blockInput.value.trim();
      const title = el.blockTitleInput.value.trim();
      if (!text) return;

      await handleDropIntoFolder(state.activeFolderId, { text, title });
      el.blockInput.value = '';
      el.blockTitleInput.value = '';
    });

    // Calendar
    el.newEventDetails.addEventListener('toggle', () => {
      if (el.newEventDetails.open) {
        if (!state.user) {
          el.newEventDetails.open = false;
          openAuthDialog('login');
          return;
        }
        ensureDefaultEventDateTime();
      }
    });

    el.calPrevLink.addEventListener('click', (e) => {
      e.preventDefault();
      state.calMonth--;
      if (state.calMonth < 0) {
        state.calMonth = 11;
        state.calYear--;
      }
      renderCalendar();
    });
    el.calNextLink.addEventListener('click', (e) => {
      e.preventDefault();
      state.calMonth++;
      if (state.calMonth > 11) {
        state.calMonth = 0;
        state.calYear++;
      }
      renderCalendar();
    });
    el.calTodayLink.addEventListener('click', (e) => {
      e.preventDefault();
      const now = new Date();
      state.calYear = now.getFullYear();
      state.calMonth = now.getMonth();
      state.selectedDateKey = null;
      renderCalendar();
    });
    el.clearDateFilterLink.addEventListener('click', (e) => {
      e.preventDefault();
      state.selectedDateKey = null;
      renderCalendar();
    });

    el.newEventForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!requireAuthOrPrompt('login')) return;
      el.eventFormError.hidden = true;

      const dateVal = el.eventDateInput.value;
      const timeVal = el.eventTimeInput.value;
      const localDate = new Date(`${dateVal}T${timeVal}`);
      if (Number.isNaN(localDate.getTime())) {
        el.eventFormError.textContent = 'Invalid date or time.';
        el.eventFormError.hidden = false;
        return;
      }

      try {
        const data = await api('/api/events', {
          method: 'POST',
          body: {
            title: el.eventTitleInput.value.trim(),
            starts_at: localDate.toISOString(),
            duration_minutes: parseInt(el.eventDurationInput.value, 10) || 60,
            location: el.eventLocationInput.value.trim() || 'FaceTime',
            notes: el.eventNotesInput.value.trim()
          }
        });
        state.events = data.events || [];
        el.eventTitleInput.value = '';
        el.eventNotesInput.value = '';
        el.newEventDetails.open = false;
        state.calYear = localDate.getFullYear();
        state.calMonth = localDate.getMonth();
        renderCalendar();
        renderNextCallBanner();
      } catch (err) {
        el.eventFormError.textContent = err.message;
        el.eventFormError.hidden = false;
      }
    });
  }

  async function refreshFullState(initialLoad = false) {
    const data = await api('/api/bootstrap');
    state.user = data.user;
    state.config = { ...state.config, ...(data.config || {}) };
    state.messages = data.messages || [];
    state.folders = data.folders || [];
    state.events = data.events || [];
    state.stateToken = data.stateToken || '';
    renderAll(initialLoad);

    if (state.activeFolderId) {
      const fData = await api(`/api/folders/${state.activeFolderId}`).catch(() => null);
      if (fData) {
        state.activeFolderBlocks = fData.blocks || [];
        renderActiveFolder();
      }
    }
  }

  async function pollUpdates() {
    if (document.hidden) return;
    try {
      const lastMsgId = state.messages.length ? state.messages[state.messages.length - 1].id : 0;
      const data = await api(`/api/poll?after_msg=${lastMsgId}`);

      if (Array.isArray(data.messages) && data.messages.length > 0) {
        let added = false;
        for (const m of data.messages) {
          if (!state.messages.some((existing) => existing.id === m.id)) {
            state.messages.push(m);
            added = true;
          }
        }
        if (added) renderChat(false);
      }

      if (data.stateToken && data.stateToken !== state.stateToken) {
        state.stateToken = data.stateToken;
        const [fRes, eRes] = await Promise.all([api('/api/folders'), api('/api/events')]);
        state.folders = fRes.folders || [];
        state.events = eRes.events || [];
        renderFoldersList();
        renderCalendar();
        renderNextCallBanner();

        if (state.activeFolderId) {
          const activeData = await api(`/api/folders/${state.activeFolderId}`).catch(() => null);
          if (activeData) {
            state.activeFolderBlocks = activeData.blocks || [];
            renderActiveFolder();
          }
        }
      }
    } catch {
      // Ignore transient poll errors
    }
  }

  async function init() {
    bindEvents();
    try {
      await refreshFullState(true);
    } catch (err) {
      el.nextCallContent.textContent = `Connection error: ${err.message}`;
    }

    setInterval(pollUpdates, 3000);
    setInterval(renderNextCallBanner, 30_000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) pollUpdates();
    });
  }

  init();
})();
