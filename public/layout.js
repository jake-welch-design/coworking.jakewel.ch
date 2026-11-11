// Pane layout — columns of stacked panes.
// Drag a gutter to resize; drag a pane's edge to move it into another column,
// another spot in a stack, or out into a new column. Desktop only; remembered per browser.

(function () {
  "use strict";

  const STORAGE_KEY = "coworking.layout.v5";
  const GUTTER_PX = 20;
  const MIN_W = 160; // min column width
  const MIN_H = 120; // min pane height
  const EDGE_PX = 8; // grab zone at a pane's edge
  const NEW_COL_ZONE = 0.22; // outer fraction of a column that means "make a new column here"
  const PANE_IDS = ["resources", "calendar", "timer", "lounge"];
  const DEFAULT_LAYOUT = () => ({
    columns: [
      { w: 15, panes: [{ id: "resources", h: 1 }] },
      {
        w: 25,
        panes: [
          { id: "calendar", h: 3 },
          { id: "timer", h: 1 },
        ],
      },
      { w: 60, panes: [{ id: "lounge", h: 1 }] },
    ],
  });

  const workspace = document.getElementById("workspace");
  if (!workspace) return;
  const panes = {};
  workspace.querySelectorAll(".pane[data-pane]").forEach((p) => {
    panes[p.dataset.pane] = p;
  });
  // Breakpoints: wide = saved layout; medium = at most 2 columns; mobile = one stack
  const mobileQuery = window.matchMedia("(max-width: 768px)");
  const mediumQuery = window.matchMedia("(max-width: 1200px)");
  const MEDIUM_MAX_COLS = 2;
  const MOBILE_ORDER = ["lounge", "calendar", "timer", "resources"];

  const indicator = document.createElement("div");
  indicator.className = "drop-indicator";
  indicator.hidden = true;

  let layout = load();
  let view = layout; // what's rendered: layout itself on wide screens, a derived copy otherwise
  let colEls = []; // column wrapper elements, parallel to view.columns
  build();
  mobileQuery.addEventListener("change", build);
  mediumQuery.addEventListener("change", build);

  // Layout editing only on wide screens, where view === layout
  function editable() {
    return !mediumQuery.matches;
  }

  function computeView() {
    if (mobileQuery.matches) {
      return {
        columns: [{ w: 1, panes: MOBILE_ORDER.map((id) => ({ id, h: 1 })) }],
      };
    }
    if (!mediumQuery.matches || layout.columns.length <= MEDIUM_MAX_COLS)
      return layout;
    // Merge the narrowest neighbouring pair of columns until few enough remain
    const cols = layout.columns.map((c) => ({
      w: c.w,
      panes: c.panes.map((p) => ({ ...p })),
    }));
    while (cols.length > MEDIUM_MAX_COLS) {
      let best = 0;
      for (let i = 1; i < cols.length - 1; i++) {
        if (cols[i].w + cols[i + 1].w < cols[best].w + cols[best + 1].w)
          best = i;
      }
      const [a, b] = cols.splice(best, 2);
      cols.splice(best, 0, { w: a.w + b.w, panes: a.panes.concat(b.panes) });
    }
    return { columns: cols };
  }

  // --- Persistence ---

  function isValid(l) {
    if (!l || !Array.isArray(l.columns) || !l.columns.length) return false;
    const seen = [];
    for (const c of l.columns) {
      if (!(Number(c.w) > 0) || !Array.isArray(c.panes) || !c.panes.length)
        return false;
      for (const p of c.panes) {
        if (
          !PANE_IDS.includes(p.id) ||
          seen.includes(p.id) ||
          !(Number(p.h) > 0)
        )
          return false;
        seen.push(p.id);
      }
    }
    return seen.length === PANE_IDS.length;
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (isValid(saved)) return saved;
    } catch {}
    return DEFAULT_LAYOUT();
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {}
  }

  // --- Rendering ---

  // Rebuilds the DOM structure (used after moves / reset)
  function build() {
    view = computeView();
    workspace.classList.toggle("layout-locked", !editable());
    workspace.querySelectorAll(".pane-column, .pane-gutter").forEach((n) => {
      if (!n.classList.contains("pane-column")) n.remove();
    });
    const oldCols = [...workspace.querySelectorAll(".pane-column")];
    colEls = [];
    view.columns.forEach((col, ci) => {
      if (ci > 0) {
        const g = document.createElement("div");
        g.className = "pane-gutter pane-gutter-col";
        g.dataset.col = String(ci - 1);
        g.title = "Drag to resize · double-click to reset layout";
        workspace.appendChild(g);
      }
      const colEl = document.createElement("div");
      colEl.className = "pane-column";
      col.panes.forEach((p, pi) => {
        if (pi > 0) {
          const g = document.createElement("div");
          g.className = "pane-gutter pane-gutter-row";
          g.dataset.col = String(ci);
          g.dataset.row = String(pi - 1);
          g.title = "Drag to resize · double-click to reset layout";
          colEl.appendChild(g);
        }
        colEl.appendChild(panes[p.id]);
      });
      workspace.appendChild(colEl);
      colEls.push(colEl);
    });
    oldCols.forEach((c) => c.remove());
    workspace.appendChild(indicator);
    sizes();
  }

  // Updates flex sizes only (used while resizing)
  function sizes() {
    view.columns.forEach((col, ci) => {
      colEls[ci].style.flex = `${col.w} 1 0px`;
      col.panes.forEach((p) => {
        panes[p.id].style.flex = `${p.h} 1 0px`;
      });
    });
  }

  // --- Helpers ---

  function findPane(id) {
    for (const col of layout.columns) {
      const i = col.panes.findIndex((p) => p.id === id);
      if (i !== -1) return { col, index: i };
    }
    return null;
  }

  function nearEdge(pane, x, y) {
    const r = pane.getBoundingClientRect();
    const right = r.right - (pane.offsetWidth - pane.clientWidth); // skip the scrollbar
    if (x < r.left || x > right || y < r.top || y > r.bottom) return false;
    return (
      x - r.left < EDGE_PX ||
      right - x < EDGE_PX ||
      y - r.top < EDGE_PX ||
      r.bottom - y < EDGE_PX
    );
  }

  function isInteractive(el) {
    return !!el.closest(
      "a, button, input, textarea, select, summary, label, [contenteditable]",
    );
  }

  function clearEdgeHover() {
    for (const p of Object.values(panes)) p.classList.remove("edge-hover");
  }

  // --- Resize ---

  let resize = null;

  function startResize(e, g) {
    e.preventDefault();
    if (g.classList.contains("pane-gutter-col")) {
      const i = Number(g.dataset.col);
      const a = layout.columns[i],
        b = layout.columns[i + 1];
      resize = {
        axis: "x",
        a,
        b,
        start: e.clientX,
        min: MIN_W,
        pxA: colEls[i].getBoundingClientRect().width,
        pxB: colEls[i + 1].getBoundingClientRect().width,
        sum: a.w + b.w,
        key: "w",
      };
    } else {
      const col = layout.columns[Number(g.dataset.col)];
      const r = Number(g.dataset.row);
      const a = col.panes[r],
        b = col.panes[r + 1];
      resize = {
        axis: "y",
        a,
        b,
        start: e.clientY,
        min: MIN_H,
        pxA: panes[a.id].getBoundingClientRect().height,
        pxB: panes[b.id].getBoundingClientRect().height,
        sum: a.h + b.h,
        key: "h",
      };
    }
    g.setPointerCapture(e.pointerId);
    document.body.classList.add(
      resize.axis === "x" ? "is-resizing-col" : "is-resizing-row",
    );
  }

  function updateResize(e) {
    const r = resize;
    const total = r.pxA + r.pxB;
    const delta = (r.axis === "x" ? e.clientX : e.clientY) - r.start;
    const min = Math.min(r.min, total / 2);
    const pxA = Math.min(Math.max(r.pxA + delta, min), total - min);
    r.a[r.key] = (r.sum * pxA) / total;
    r.b[r.key] = r.sum - r.a[r.key];
    sizes();
  }

  // --- Move ---

  let move = null;

  function startMove(e, pane) {
    e.preventDefault();
    move = {
      id: pane.dataset.pane,
      pane,
      startX: e.clientX,
      startY: e.clientY,
      target: null,
    };
    pane.setPointerCapture(e.pointerId);
    clearEdgeHover();
    pane.classList.add("is-dragging");
    document.body.classList.add("is-moving");
  }

  // Works out where the dragged pane would land and draws the indicator
  function updateMove(e) {
    const x = e.clientX,
      y = e.clientY;
    move.pane.style.transform = `translate(${x - move.startX}px, ${y - move.startY}px)`;

    const ws = workspace.getBoundingClientRect();
    const rects = colEls.map((c) => c.getBoundingClientRect());
    let target = null;

    let ci = rects.findIndex((r) => x >= r.left && x <= r.right);
    if (ci === -1) {
      // In a gutter or past the ends: new column at the nearest boundary
      ci = rects.findIndex((r) => x < r.left);
      target =
        ci === -1
          ? { type: "column", index: rects.length }
          : { type: "column", index: ci };
    } else {
      const r = rects[ci];
      const zone = Math.max(40, r.width * NEW_COL_ZONE);
      const col = layout.columns[ci];
      const onlyMe = col.panes.length === 1 && col.panes[0].id === move.id;
      if (!onlyMe && x - r.left < zone) target = { type: "column", index: ci };
      else if (!onlyMe && r.right - x < zone)
        target = { type: "column", index: ci + 1 };
      else {
        const others = col.panes.filter((p) => p.id !== move.id);
        let slot = 0;
        for (const p of others) {
          const pr = panes[p.id].getBoundingClientRect();
          if (y > pr.top + pr.height / 2) slot++;
        }
        target = { type: "stack", col, slot, others };
      }
    }
    move.target = target;

    // Indicator
    indicator.hidden = false;
    if (target.type === "column") {
      let lx;
      if (target.index === 0) lx = rects[0].left - GUTTER_PX / 2;
      else lx = rects[target.index - 1].right + GUTTER_PX / 2;
      indicator.className = "drop-indicator drop-indicator-col";
      indicator.style.left = `${lx - ws.left}px`;
      indicator.style.top = indicator.style.width = indicator.style.height = "";
    } else {
      const cr = rects[layout.columns.indexOf(target.col)];
      const { others, slot } = target;
      let ly;
      if (!others.length) ly = cr.top + cr.height / 2;
      else if (slot === 0)
        ly = panes[others[0].id].getBoundingClientRect().top - GUTTER_PX / 2;
      else
        ly =
          panes[others[slot - 1].id].getBoundingClientRect().bottom +
          GUTTER_PX / 2;
      indicator.className = "drop-indicator drop-indicator-row";
      indicator.style.left = `${cr.left - ws.left}px`;
      indicator.style.width = `${cr.width}px`;
      indicator.style.top = `${ly - ws.top}px`;
      indicator.style.height = "";
    }
  }

  function commitMove(id, target) {
    const src = findPane(id);
    if (!src) return;
    const [entry] = src.col.panes.splice(src.index, 1);
    const srcEmpty = !src.col.panes.length;

    if (target.type === "column") {
      let index = target.index;
      const srcIdx = layout.columns.indexOf(src.col);
      if (srcEmpty) {
        layout.columns.splice(srcIdx, 1);
        if (srcIdx < index) index--;
      }
      const avgW =
        layout.columns.reduce((s, c) => s + c.w, 0) /
        Math.max(1, layout.columns.length);
      layout.columns.splice(index, 0, {
        w: srcEmpty ? src.col.w : avgW,
        panes: [{ id, h: 1 }],
      });
    } else {
      if (srcEmpty && src.col !== target.col)
        layout.columns.splice(layout.columns.indexOf(src.col), 1);
      const avgH =
        target.col.panes.reduce((s, p) => s + p.h, 0) /
        Math.max(1, target.col.panes.length);
      entry.h = target.col.panes.length ? avgH : 1;
      target.col.panes.splice(target.slot, 0, entry);
    }
  }

  // --- Events ---

  workspace.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !editable() || resize || move) return;
    const g = e.target.closest(".pane-gutter");
    if (g) {
      startResize(e, g);
      return;
    }
    const pane = e.target.closest(".pane");
    if (
      pane &&
      !isInteractive(e.target) &&
      nearEdge(pane, e.clientX, e.clientY)
    )
      startMove(e, pane);
  });

  workspace.addEventListener("pointermove", (e) => {
    if (resize) {
      updateResize(e);
      return;
    }
    if (move) {
      updateMove(e);
      return;
    }
    if (!editable()) return;
    const overUI = isInteractive(e.target);
    for (const p of Object.values(panes)) {
      p.classList.toggle(
        "edge-hover",
        !overUI && nearEdge(p, e.clientX, e.clientY),
      );
    }
  });

  function endDrag() {
    if (resize) {
      document.body.classList.remove("is-resizing-col", "is-resizing-row");
      resize = null;
      save();
    }
    if (move) {
      const { id, pane, target } = move;
      move = null;
      pane.style.transform = "";
      pane.classList.remove("is-dragging");
      document.body.classList.remove("is-moving");
      indicator.hidden = true;
      if (target) {
        commitMove(id, target);
        build();
        save();
      }
    }
  }

  workspace.addEventListener("pointerup", endDrag);
  workspace.addEventListener("pointercancel", endDrag);
  workspace.addEventListener("pointerleave", () => {
    if (!resize && !move) clearEdgeHover();
  });

  workspace.addEventListener("dblclick", (e) => {
    if (!e.target.closest(".pane-gutter") || !editable()) return;
    layout = DEFAULT_LAYOUT();
    build();
    save();
  });
})();
