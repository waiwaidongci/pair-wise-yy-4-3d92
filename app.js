"use strict";
// 页面操作：表单、发放/补换、筛选、时间线、存档查询、JSON 导出。规则判定在 tags.js，留档在 archive.js。
(() => {
  const $ = sel => document.querySelector(sel);
  const map = $("#map");
  const form = $("#form");
  const list = $("#list");
  const filter = $("#filter");
  const view = $("#view");
  const listTitle = $("#listTitle");
  const archiveSearch = $("#archiveSearch");
  const tagStatusLine = $("#tagStatusLine");
  const msgLine = $("#msgLine");

  const typeNames = { ceramic: "陶片", wood: "木构件", metal: "金属件", unknown: "未知物" };
  const STORE_KEY = "zfl30TagDesk";
  const LEGACY_KEY = "zfl30Marks";
  const READY_PHOTO = "__ready__";

  let state = load();
  let mode = "issue";        // issue | edit
  let pendingPos = null;     // 新增标记时在图上点选的位置
  let photoData = "";        // 表单中当前的新照片
  let selectedId = null;

  // ---------- 存储与迁移 ----------
  function load() {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        return { markers: parsed.markers || [], tags: parsed.tags || [], archives: parsed.archives || [] };
      } catch (_) { /* 损坏则走迁移/种子 */ }
    }
    return migrate();
  }

  // 旧版数据：标记自带编号，迁移成 标记 + 一张现行牌
  function migrate() {
    let markers = [], tags = [];
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      try {
        const old = JSON.parse(legacy);
        old.forEach(m => {
          const markerId = m.id || crypto.randomUUID();
          markers.push({
            id: markerId, type: m.type, dive: m.dive, x: m.x, y: m.y,
            depth: m.depth, orientation: m.orientation, condition: m.condition, note: m.note, photo: ""
          });
          tags.push({
            id: crypto.randomUUID(), markerId, dive: m.dive, code: m.code,
            holder: "未登记", issuedAt: "1970-01-01T00:00:00.000Z", status: TagDesk.STATUS.ACTIVE
          });
        });
        localStorage.removeItem(LEGACY_KEY);
      } catch (_) { /* 忽略损坏旧档 */ }
    }
    if (!markers.length) ({ markers, tags } = seed());
    const s = { markers, tags, archives: [] };
    persist(s);
    return s;
  }

  function seed() {
    const m1 = { id: crypto.randomUUID(), type: "ceramic", dive: "DIVE-01", x: 42, y: 46, depth: "17.8m", orientation: "东", condition: "边缘残缺", note: "靠近船肋", photo: "" };
    const m2 = { id: crypto.randomUUID(), type: "wood", dive: "DIVE-02", x: 58, y: 39, depth: "18.2m", orientation: "西北", condition: "稳定", note: "疑似横梁", photo: "" };
    const t1 = TagDesk.issue({ markerId: m1.id, dive: m1.dive, code: "A-017", holder: "林潜" });
    const t2old = TagDesk.issue({ markerId: m2.id, dive: m2.dive, code: "W-003", holder: "周潜" });
    // 演示：W-003 泥沙磨掉后已换发 W-009，旧牌冻结留档
    const wTags = [t2old];
    TagDesk.replace(wTags, t2old, { code: "W-009", holder: "周潜" });
    return { markers: [m1, m2], tags: [t1, ...wTags] };
  }

  function persist(next = state) {
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
  }

  // ---------- 小工具 ----------
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = iso => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    const p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  function markerCode(m) {
    const t = TagDesk.activeTag(state.tags, m.id);
    return t ? t.code : "（无现行牌）";
  }
  function flash(text, ok = true) {
    msgLine.textContent = text;
    msgLine.className = "msg " + (ok ? "ok" : "err");
  }

  // ---------- 渲染 ----------
  function render() {
    renderMap();
    if (view.value === "timeline") renderTimeline();
    else if (view.value === "archive") renderArchive();
    else renderList();
    syncActions();
  }

  function renderMap() {
    map.querySelectorAll(".marker").forEach(el => el.remove());
    const filtered = filter.value ? state.markers.filter(m => m.type === filter.value) : state.markers;
    filtered.forEach(marker => {
      const tag = TagDesk.activeTag(state.tags, marker.id);
      const pending = TagDesk.pendingReprint(state.tags, marker.id);
      const el = document.createElement("button");
      el.className = "marker " + marker.type + (marker.id === selectedId ? " selected" : "") + (pending ? " reprint" : "");
      el.style.left = marker.x + "%";
      el.style.top = marker.y + "%";
      el.textContent = tag ? tag.code.slice(0, 2) : "?";
      el.title = tag ? `${tag.code}${pending ? "（待重印）" : ""}` : "无现行牌";
      el.onclick = ev => { ev.stopPropagation(); editMarker(marker.id); };
      map.appendChild(el);
    });
  }

  function renderList() {
    listTitle.textContent = "当前清单（仅现行牌）";
    list.className = "list";
    archiveSearch.hidden = true;
    const data = filter.value ? state.markers.filter(m => m.type === filter.value) : state.markers;
    list.innerHTML = data.map(m => {
      const tag = TagDesk.activeTag(state.tags, m.id);
      const pending = TagDesk.pendingReprint(state.tags, m.id);
      return `<div class="item ${m.id === selectedId ? "active" : ""}" data-id="${m.id}">
        <b>${tag ? esc(tag.code) : "（无现行牌）"}</b>
        <span class="pill">${typeNames[m.type]}</span>
        ${pending ? '<span class="pill reprint-pill">待重印</span>' : ""}
        <div class="muted">${esc(m.dive)} · ${esc(m.depth)} · ${esc(m.orientation || "—")} · 领用人 ${esc(tag ? tag.holder : "—")}</div>
        <div>${esc(m.condition || "")}</div>
        ${m.photo ? `<img class="thumb" src="${m.photo}" alt="标记照片">` : ""}
      </div>`;
    }).join("") || '<div class="muted">暂无标记，点击沉船平面图开始登记。</div>';
  }

  function renderTimeline() {
    listTitle.textContent = "潜次时间线";
    list.className = "timeline";
    archiveSearch.hidden = true;
    const data = filter.value ? state.markers.filter(m => m.type === filter.value) : state.markers;
    const groups = data.reduce((g, m) => ((g[m.dive] ||= []).push(m), g), {});
    list.innerHTML = Object.entries(groups)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([dive, items]) => {
        const lines = items.map(m => {
          const tag = TagDesk.activeTag(state.tags, m.id);
          const pending = TagDesk.pendingReprint(state.tags, m.id);
          return `<div>${tag ? esc(tag.code) : "（无现行牌）"} · ${typeNames[m.type]}${pending ? ' · <b class="reprint-text">待重印</b>' : ""}</div>`;
        }).join("");
        return `<div class="item"><b>${esc(dive)}</b><div class="muted">现行 ${items.length} 个标记</div>${lines}</div>`;
      }).join("") || '<div class="muted">暂无记录。</div>';
  }

  function renderArchive() {
    listTitle.textContent = "存档（旧牌 · 历史清单）";
    list.className = "list";
    archiveSearch.hidden = false;
    const kw = archiveSearch.value;
    const olds = TagArchive.searchOldTags(state.tags, kw)
      .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
    const archives = TagArchive.searchArchives(state.archives, kw);
    const tagRows = olds.map(t => {
      const m = state.markers.find(x => x.id === t.markerId);
      const name = TagDesk.STATUS_NAMES[t.status];
      const isReprint = t.status === TagDesk.STATUS.REPRINT;
      return `<div class="item old ${isReprint ? "reprint-row" : ""}" data-marker="${t.markerId}">
        <b>${esc(t.code)}</b>
        <span class="pill ${isReprint ? "reprint-pill" : "old-pill"}">${name}</span>
        <div class="muted">${esc(t.dive)} · 领用人 ${esc(t.holder)} · 领用 ${fmt(t.issuedAt)}</div>
        <div class="muted">${m ? "接到标记 " + esc(markerCode(m)) + "（" + typeNames[m.type] + "）" : "原标记已删除"}${t.replacedAt ? " · 换发于 " + fmt(t.replacedAt) : ""}${t.invalidatedAt ? " · 更正失效 " + fmt(t.invalidatedAt) : ""}</div>
      </div>`;
    }).join("");
    const arcRows = archives.map(a => {
      const oldCount = TagArchive.oldTags(a.tags).length;
      return `<div class="item archive-card">
        <b>${esc(a.reason)}</b>
        <div class="muted">${fmt(a.at)} · 存档清单 ${a.markers.length} 个标记、${a.tags.length} 张牌（其中旧牌 ${oldCount}）</div>
      </div>`;
    }).join("");
    list.innerHTML =
      `<h3>旧牌（可查，不进当前清单）</h3>` +
      (tagRows || '<div class="muted">没有旧牌。</div>') +
      `<h3>历史清单快照</h3>` +
      (arcRows || '<div class="muted">还没有更正留档。</div>');
  }

  // ---------- 表单 / 动作 ----------
  function readForm() {
    return {
      type: form.type.value,
      dive: form.dive.value.trim(),
      depth: form.depth.value.trim(),
      orientation: form.orientation.value.trim(),
      condition: form.condition.value.trim(),
      note: form.note.value.trim()
    };
  }

  function resetToIssue(pos) {
    mode = "issue";
    selectedId = null;
    pendingPos = pos || null;
    photoData = "";
    form.reset();
    form.id.value = "";
    form.code.value = suggestCode();
    form.photo.value = "";
    $("#photoPreview").hidden = true;
    tagStatusLine.textContent = pendingPos ? "位置已在平面图选定，登记后发放首张标签。" : "点击平面图选定位置后登记。";
    flash("");
    render();
  }

  function editMarker(id) {
    const marker = state.markers.find(m => m.id === id);
    if (!marker) return;
    mode = "edit";
    selectedId = id;
    pendingPos = null;
    photoData = "";
    form.id.value = id;
    form.type.value = marker.type;
    const pendingTag = TagDesk.pendingReprint(state.tags, marker.id);
    form.code.value = markerCode(marker) !== "（无现行牌）" ? markerCode(marker) : (pendingTag ? pendingTag.code : "");
    form.holder.value = "";
    form.dive.value = marker.dive;
    form.depth.value = marker.depth;
    form.orientation.value = marker.orientation || "";
    form.condition.value = marker.condition || "";
    form.note.value = marker.note || "";
    form.photo.value = "";
    const prev = $("#photoPreview");
    prev.hidden = !marker.photo;
    prev.src = marker.photo || "";
    render();
  }

  function syncActions() {
    const saveBtn = $("#saveBtn");
    const replaceBtn = $("#replaceBtn");
    const reprintBtn = $("#reprintBtn");
    const deleteBtn = $("#deleteBtn");
    if (mode === "issue") {
      saveBtn.textContent = "登记并发放标签";
      replaceBtn.hidden = true;
      reprintBtn.hidden = true;
      deleteBtn.hidden = true;
      return;
    }
    const marker = state.markers.find(m => m.id === selectedId);
    if (!marker) { resetToIssue(); return; }
    const tag = TagDesk.activeTag(state.tags, marker.id);
    const pending = TagDesk.pendingReprint(state.tags, marker.id);
    saveBtn.textContent = "资料更正（旧牌失效转重印）";
    deleteBtn.hidden = false;
    replaceBtn.hidden = !tag;
    reprintBtn.hidden = !pending;
    if (tag) {
      tagStatusLine.innerHTML = `现行牌 <b>${esc(tag.code)}</b> · 领用人 ${esc(tag.holder)} · ${fmt(tag.issuedAt)}
        <span class="muted">（换发时旧牌的领用人和领用时刻原样保留）</span>`;
    } else {
      tagStatusLine.textContent = "该标记暂无现行牌。";
    }
    if (pending) {
      tagStatusLine.innerHTML += `<div class="reprint-text">旧牌 ${esc(pending.code)} 已失效待重印，可在下方重印新发。</div>`;
    }
  }

  function suggestCode() {
    return "M-" + String(state.tags.length + 1).padStart(3, "0");
  }

  // 登记新标记 + 发放首张标签（编号、类型、深度、照片齐全；编号在同潜次内不得重复）
  function doIssue() {
    const f = readForm();
    const code = form.code.value.trim();
    const holder = form.holder.value.trim();
    if (!code) return flash("编号不能为空", false);
    if (!holder) return flash("请填写领用人", false);
    if (!f.depth) return flash("请填写深度", false);
    if (!pendingPos) return flash("请先在平面图点击选择位置", false);
    if (photoData !== READY_PHOTO) return flash("请登记照片", false);
    const check = TagDesk.checkIssue(state.tags, f.dive, code);
    if (!check.ok) return flash(check.reason, false);
    const marker = { id: crypto.randomUUID(), ...f, x: pendingPos.x, y: pendingPos.y, photo: photoData === READY_PHOTO ? $("#photoPreview").src : "" };
    state.markers.push(marker);
    state.tags.push(TagDesk.issue({ markerId: marker.id, dive: f.dive, code, holder }));
    persist();
    flash(`已登记并发放 ${code} 给 ${holder}`);
    editMarker(marker.id);
  }

  // 资料更正：先把旧整张清单存档，再改标记，现行牌失效转待重印
  function doCorrect() {
    const marker = state.markers.find(m => m.id === selectedId);
    if (!marker) return;
    const f = readForm();
    if (!f.depth) return flash("请填写深度", false);
    const active = TagDesk.activeTag(state.tags, marker.id);
    // 先留档，再动数据
    state.archives.push(TagArchive.snapshot(state.markers, state.tags, `资料更正 ${markerCode(marker)}`));
    Object.assign(marker, f);
    if (photoData === READY_PHOTO) marker.photo = $("#photoPreview").src;
    if (active) TagDesk.invalidateForReprint(active);
    persist();
    flash(`资料已更正，旧牌${active ? " " + active.code + " " : ""}失效并转待重印，旧清单已留档。`);
    editMarker(marker.id);
  }

  // 换牌：保留旧牌领用人与时刻，新牌接到同一标记
  function doReplace() {
    const marker = state.markers.find(m => m.id === selectedId);
    if (!marker) return;
    const old = TagDesk.activeTag(state.tags, marker.id);
    const code = form.code.value.trim();
    const holder = form.holder.value.trim();
    if (!old) return flash("该标记没有现行牌，无需换牌", false);
    if (!code) return flash("请填写新牌编号", false);
    if (!holder) return flash("请填写新牌领用人", false);
    if (code.toLowerCase() === old.code.toLowerCase()) return flash("新牌编号不能与旧牌相同", false);
    try {
      const fresh = TagDesk.replace(state.tags, old, { code, holder });
      persist();
      flash(`已换发：旧牌 ${old.code} 留档，新牌 ${fresh.code} 接到同一标记。`);
      editMarker(marker.id);
    } catch (err) { flash(err.message, false); }
  }

  // 重印新发：失效旧牌仍可查，新牌成为现行牌
  function doReprint() {
    const marker = state.markers.find(m => m.id === selectedId);
    if (!marker) return;
    const old = TagDesk.pendingReprint(state.tags, marker.id);
    const code = form.code.value.trim();
    const holder = form.holder.value.trim();
    if (!old) return flash("没有待重印的旧牌", false);
    if (!code) return flash("请填写重印新牌编号", false);
    if (!holder) return flash("请填写领用人", false);
    try {
      const fresh = TagDesk.reprint(state.tags, old, { code, holder });
      persist();
      flash(`已重印新发 ${fresh.code}，旧牌 ${old.code} 仍留档可查。`);
      editMarker(marker.id);
    } catch (err) { flash(err.message, false); }
  }

  function doDelete() {
    const marker = state.markers.find(m => m.id === selectedId);
    if (!marker) return;
    if (!confirm(`删除标记 ${markerCode(marker)}？其历史标签仍保留在存档中。`)) return;
    state.markers = state.markers.filter(m => m.id !== marker.id);
    persist();
    resetToIssue();
  }

  // ---------- 照片 ----------
  function readPhoto(file) {
    if (!file) return;
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        const max = 720;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        const prev = $("#photoPreview");
        prev.src = canvas.toDataURL("image/jpeg", 0.8);
        prev.hidden = false;
        photoData = READY_PHOTO;
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  // ---------- 事件 ----------
  map.addEventListener("click", event => {
    const rect = map.getBoundingClientRect();
    const pos = {
      x: Number(((event.clientX - rect.left) / rect.width * 100).toFixed(2)),
      y: Number(((event.clientY - rect.top) / rect.height * 100).toFixed(2))
    };
    resetToIssue(pos);
    form.dive.value = "DIVE-01";
  });

  form.onsubmit = event => {
    event.preventDefault();
    mode === "issue" ? doIssue() : doCorrect();
  };
  $("#replaceBtn").onclick = doReplace;
  $("#reprintBtn").onclick = doReprint;
  $("#deleteBtn").onclick = doDelete;
  form.photo.onchange = e => readPhoto(e.target.files[0]);

  list.addEventListener("click", e => {
    const oldRow = e.target.closest(".old[data-marker]");
    if (oldRow) { editMarker(oldRow.dataset.marker); view.value = "list"; render(); return; }
    const row = e.target.closest(".item[data-id]");
    if (row) editMarker(row.dataset.id);
  });

  filter.onchange = render;
  view.onchange = () => { archiveSearch.value = ""; render(); };
  archiveSearch.oninput = render;

  $("#exportBtn").onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "dive-tags.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ---------- 船体装饰 ----------
  for (let i = 0; i < 7; i++) {
    const rib = document.createElement("div");
    rib.className = "rib";
    rib.style.left = 28 + i * 7 + "%";
    map.appendChild(rib);
  }

  resetToIssue();
})();
