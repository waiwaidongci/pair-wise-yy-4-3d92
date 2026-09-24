/* 页面操作：地图选点、发放/换牌/更正表单、照片读取、各视图渲染、筛选与搜索、
   潜次时间线、待重印/存档界面、localStorage 持久化与 JSON 导出。
   业务判定调 TagRules，存档调 TagArchive。 */
(function () {
  "use strict";

  const STORE_KEY = "zflTagDeskV1";
  const LEGACY_KEY = "zfl30Marks";
  const T = window.TagRules;
  const A = window.TagArchive;
  const typeNames = { ceramic: "陶片", wood: "木构件", metal: "金属件", unknown: "未知物" };

  const $ = sel => document.querySelector(sel);
  const map = $("#map"), form = $("#form"), listEl = $("#list"),
        filterEl = $("#filter"), viewEl = $("#view"), queryEl = $("#query"),
        listTitle = $("#listTitle"), msgEl = $("#msg"),
        formTitle = $("#formTitle"), saveBtn = $("#saveBtn"),
        replaceToggleBtn = $("#replaceToggleBtn"), replaceBox = $("#replaceBox"),
        deleteBtn = $("#deleteBtn"), photoFile = $("#photoFile"),
        photoPreview = $("#photoPreview"), newCodeEl = $("#newCode"), newToEl = $("#newTo");

  let state = load();
  let selectedId = "";   // 正在编辑的标记；空 = 发放新标签
  let pendingXY = null;  // 地图选点
  let photoData = "";    // 本次新读入的照片（dataURL）

  // ---------- 示例照片（SVG dataURL，仅用于种子数据） ----------
  function seedPhoto(bg, fg, text) {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160">' +
      '<rect width="240" height="160" fill="' + bg + '"/>' +
      '<circle cx="120" cy="66" r="38" fill="' + fg + '" opacity=".85"/>' +
      '<text x="120" y="132" font-size="22" text-anchor="middle" fill="#fff" font-family="sans-serif">' + text + '</text></svg>';
    return "data:image/svg+xml," + encodeURIComponent(svg);
  }

  function tagRow(id, code, issuedTo, issuedAt, status, photo, history) {
    return { id, code, issuedTo, issuedAt, status, photo: photo || "", history: history || [{ kind: "issued", at: issuedAt, issuedTo, detail: "首次发放" }] };
  }

  function seedState() {
    return {
      marks: [
        {
          id: T.uid(), code: "A-017", type: "ceramic", dive: "DIVE-01", x: 42, y: 46,
          depth: "17.8m", orientation: "东", condition: "边缘残缺", note: "靠近船肋",
          tags: [tagRow(T.uid(), "A-017", "林悦", "2026-09-16T02:10:00.000Z", T.STATUS.ACTIVE, seedPhoto("#3a6f7d", "#b56c38", "A-017"))]
        },
        {
          id: T.uid(), code: "W-003", type: "wood", dive: "DIVE-02", x: 58, y: 39,
          depth: "18.2m", orientation: "西北", condition: "稳定", note: "疑似横梁",
          tags: [
            Object.assign(tagRow(T.uid(), "W-002", "陈松", "2026-09-17T03:05:00.000Z", T.STATUS.REPLACED, seedPhoto("#3a5f4a", "#6c4b2f", "W-002")),
              { replacedAt: "2026-09-19T06:40:00.000Z", history: [
                  { kind: "issued", at: "2026-09-17T03:05:00.000Z", issuedTo: "陈松", detail: "首次发放" },
                  { kind: "replaced", at: "2026-09-19T06:40:00.000Z", newCode: "W-003", detail: "标签磨损，换发 W-003" } ] }),
            tagRow(T.uid(), "W-003", "周岚", "2026-09-19T06:40:00.000Z", T.STATUS.ACTIVE, seedPhoto("#3a5f4a", "#8a5f3a", "W-003"),
              [{ kind: "issued", at: "2026-09-19T06:40:00.000Z", issuedTo: "周岚", detail: "换牌自 W-002" }])
          ]
        },
        {
          id: T.uid(), code: "M-009", type: "metal", dive: "DIVE-01", x: 35, y: 63,
          depth: "15.6m", orientation: "南", condition: "锈蚀", note: "深度由16.1m更正为15.6m",
          tags: [
            Object.assign(tagRow(T.uid(), "M-009", "林悦", "2026-09-16T02:40:00.000Z", T.STATUS.INVALID, seedPhoto("#4a5560", "#6e7880", "M-009")),
              { invalidatedAt: "2026-09-21T08:15:00.000Z", invalidateReason: "资料更正", history: [
                  { kind: "issued", at: "2026-09-16T02:40:00.000Z", issuedTo: "林悦", detail: "首次发放" },
                  { kind: "invalidated", at: "2026-09-21T08:15:00.000Z", detail: "登记资料更正，旧牌失效转待重印" } ] })
          ]
        }
      ],
      reprints: [
        { id: T.uid(), markId: "", code: "M-009", createdAt: "2026-09-21T08:15:00.000Z", reason: "资料更正", oldTagId: "" }
      ],
      archives: []
    };
  }

  // ---------- 存储 / 旧版迁移 ----------
  function load() {
    let s;
    try { s = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) { s = null; }
    if (s && Array.isArray(s.marks)) {
      s.reprints = s.reprints || [];
      s.archives = s.archives || [];
      return s;
    }
    // 旧版单牌数据：一张标记补一张 active 标签，领用人缺失记为“未登记”。
    let legacy = null;
    try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null"); } catch (e) { legacy = null; }
    if (Array.isArray(legacy) && legacy.length) {
      s = {
        marks: legacy.map(m => Object.assign({}, m, { tags: [{
          id: T.uid(), code: m.code, issuedTo: "未登记", issuedAt: null,
          status: T.STATUS.ACTIVE, photo: "", history: [{ kind: "issued", at: null, issuedTo: "未登记", detail: "旧记录迁入" }]
        }] })),
        reprints: [], archives: []
      };
    } else {
      s = seedState();
      // 给待重印种子补上 markId / oldTagId
      const rpMark = s.marks.find(m => m.code === "M-009");
      s.reprints[0].markId = rpMark.id;
      s.reprints[0].oldTagId = rpMark.tags[0].id;
      s.archives.push({
        id: T.uid(), reason: "资料更正", markId: rpMark.id, changedCode: "M-009",
        at: "2026-09-21T08:15:00.000Z",
        items: s.marks.filter(m => T.activeTag(m)).map(m => {
          const t = T.activeTag(m);
          return { markId: m.id, code: t.code, type: m.type, dive: m.dive, depth: m.depth,
            orientation: m.orientation, condition: m.condition, note: m.note, x: m.x, y: m.y,
            issuedTo: t.issuedTo, issuedAt: t.issuedAt, photo: t.photo || "" };
        })
      });
    }
    save(s);
    return s;
  }
  function save(s) { localStorage.setItem(STORE_KEY, JSON.stringify(s || state)); }

  // ---------- 工具 ----------
  function esc(v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function fmt(iso) {
    if (!iso) return "时刻未登记";
    const d = new Date(iso);
    if (isNaN(d)) return String(iso);
    const p = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
      " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  function say(text, ok) {
    msgEl.textContent = text || "";
    msgEl.className = "msg" + (text ? (ok ? " ok" : " err") : "");
  }
  function field(name) { return form.elements[name]; }
  function latestTag(mark) { return mark.tags[mark.tags.length - 1] || null; }

  // ---------- 筛选 / 搜索 ----------
  function matchesQuery(m, q) {
    if (!q) return true;
    const active = T.activeTag(m);
    const holder = active ? active.issuedTo : (latestTag(m) || {}).issuedTo || "";
    return m.code.toLowerCase().includes(q) ||
           m.dive.toLowerCase().includes(q) ||
           holder.toLowerCase().includes(q) ||
           m.tags.some(t => t.code.toLowerCase().includes(q) || (t.issuedTo || "").toLowerCase().includes(q));
  }
  function visibleMarks() {
    const t = filterEl.value;
    const q = queryEl.value.trim().toLowerCase();
    return state.marks.filter(m => (!t || m.type === t) && matchesQuery(m, q));
  }

  // ---------- 地图 ----------
  for (let i = 0; i < 7; i++) {
    const rib = document.createElement("div");
    rib.className = "rib";
    rib.style.left = 28 + i * 7 + "%";
    map.appendChild(rib);
  }
  function renderMap(data) {
    map.querySelectorAll(".marker").forEach(el => el.remove());
    data.forEach(mark => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "marker " + mark.type + (mark.id === selectedId ? " selected" : "");
      el.style.left = mark.x + "%";
      el.style.top = mark.y + "%";
      el.textContent = mark.code.slice(0, 2);
      el.title = mark.code + (T.isPendingReprint(state, mark) ? "（待重印）" : "");
      if (T.isPendingReprint(state, mark)) el.innerHTML += '<span class="dot" title="待重印"></span>';
      el.onclick = ev => { ev.stopPropagation(); editMark(mark.id); };
      map.appendChild(el);
    });
  }

  // ---------- 视图：当前清单 ----------
  function renderList(data) {
    listTitle.textContent = "当前清单";
    listEl.className = "list";
    const rows = data.filter(m => T.activeTag(m));
    const pending = data.length - rows.length;
    if (!rows.length) {
      listEl.innerHTML = '<div class="muted">当前清单没有匹配的标记。</div>';
      return;
    }
    listEl.innerHTML = rows.map(m => {
      const t = T.activeTag(m);
      return '<div class="item ' + (m.id === selectedId ? "active" : "") + '" data-id="' + m.id + '">' +
        '<b>' + esc(t.code) + '</b> <span class="pill">' + typeNames[m.type] + '</span>' +
        '<div class="muted">' + esc(m.dive) + ' · ' + esc(m.depth) + ' · ' + esc(m.orientation || '—') + '</div>' +
        '<div class="muted">领用人 ' + esc(t.issuedTo) + ' · ' + fmt(t.issuedAt) + '</div>' +
        (t.photo ? '<img class="thumb" src="' + t.photo + '" alt="标签照片">' : "") +
        '</div>';
    }).join("") + (pending ? '<div class="muted">另有 ' + pending + ' 个标记正在待重印，不进入当前清单。</div>' : "");
    listEl.querySelectorAll("[data-id]").forEach(el => el.onclick = () => editMark(el.dataset.id));
  }

  // ---------- 视图：潜次时间线 ----------
  function renderTimeline(data) {
    listTitle.textContent = "潜次时间线";
    listEl.className = "timeline";
    const rows = data.filter(m => T.activeTag(m));
    const groups = rows.reduce((g, m) => ((g[m.dive] ||= []).push(m), g), {});
    const dives = Object.keys(groups).sort();
    if (!dives.length) { listEl.innerHTML = '<div class="muted">没有匹配的潜次记录。</div>'; return; }
    listEl.innerHTML = dives.map(dive => {
      const items = groups[dive];
      return '<div class="item"><b>' + esc(dive) + '</b>' +
        '<div class="muted">本潜次发放 ' + items.length + ' 张有效标签</div>' +
        items.map(m => { const t = T.activeTag(m);
          return '<div>' + esc(t.code) + ' · ' + typeNames[m.type] + ' · ' + esc(m.depth) +
            ' <span class="muted">(' + esc(t.issuedTo) + ')</span></div>';
        }).join("") + '</div>';
    }).join("");
  }

  // ---------- 视图：标签记录（旧牌可查） ----------
  function renderLedger(data) {
    listTitle.textContent = "标签记录（含旧牌）";
    listEl.className = "list";
    const ids = new Set(data.map(m => m.id));
    const q = queryEl.value.trim().toLowerCase();
    const flat = state.marks
      .filter(m => ids.has(m.id))
      .flatMap(m => m.tags.map(t => ({ mark: m, tag: t })))
      .filter(r => !q || r.tag.code.toLowerCase().includes(q) ||
                    (r.tag.issuedTo || "").toLowerCase().includes(q) ||
                    r.mark.dive.toLowerCase().includes(q))
      .sort((a, b) => (b.tag.issuedAt || "").localeCompare(a.tag.issuedAt || ""));
    if (!flat.length) { listEl.innerHTML = '<div class="muted">没有匹配的标签记录。</div>'; return; }
    listEl.innerHTML = flat.map(r => {
      const t = r.tag, off = t.status !== T.STATUS.ACTIVE;
      let note = "";
      if (t.status === T.STATUS.REPLACED) note = '<div class="muted">旧牌保留 · ' + fmt(t.issuedAt) + ' 由 ' + esc(t.issuedTo) + ' 领用 · ' + fmt(t.replacedAt) + ' 换发 ' + esc(nextCode(r.mark, t)) + '</div>';
      else if (t.status === T.STATUS.INVALID) note = '<div class="muted">已失效 · ' + fmt(t.invalidatedAt) + ' ' + esc(t.invalidateReason || "") + '，编号 ' + esc(t.code) + ' 转待重印</div>';
      else note = '<div class="muted">现牌 · ' + fmt(t.issuedAt) + ' 由 ' + esc(t.issuedTo) + ' 领用</div>';
      const pill = t.status === T.STATUS.ACTIVE ? "ok" : (t.status === T.STATUS.REPLACED ? "warn" : "off");
      return '<div class="ledger-row ' + (off ? "off" : "") + '" data-id="' + r.mark.id + '">' +
        '<b>' + esc(t.code) + '</b> <span class="pill ' + pill + '">' + T.STATUS_NAME[t.status] + '</span>' +
        ' <span class="pill">' + typeNames[r.mark.type] + '</span>' +
        '<div class="muted">' + esc(r.mark.dive) + ' · ' + esc(r.mark.depth) + '</div>' + note + '</div>';
    }).join("");
    listEl.querySelectorAll("[data-id]").forEach(el => el.onclick = () => editMark(el.dataset.id));
  }
  function nextCode(mark, oldTag) {
    const i = mark.tags.indexOf(oldTag);
    return mark.tags[i + 1] ? mark.tags[i + 1].code : "?";
  }

  // ---------- 视图：待重印队列 ----------
  function renderReprint() {
    listTitle.textContent = "待重印队列";
    listEl.className = "list";
    const t = filterEl.value;
    const q = queryEl.value.trim().toLowerCase();
    const rows = state.reprints.filter(rp => {
      const m = state.marks.find(x => x.id === rp.markId);
      if (!m) return false;
      if (t && m.type !== t) return false;
      if (q && !(rp.code.toLowerCase().includes(q) || m.dive.toLowerCase().includes(q))) return false;
      return true;
    });
    if (!rows.length) { listEl.innerHTML = '<div class="muted">待重印队列为空。</div>'; return; }
    listEl.innerHTML = rows.map(rp => {
      const m = state.marks.find(x => x.id === rp.markId);
      return '<div class="item"><b>' + esc(rp.code) + '</b> <span class="pill warn">待重印</span>' +
        '<div class="muted">' + esc(m.dive) + ' · ' + typeNames[m.type] + ' · ' + esc(m.depth) + '</div>' +
        '<div class="muted">' + esc(rp.reason) + ' · ' + fmt(rp.createdAt) + ' 旧牌失效</div>' +
        '<label>重印牌领用人</label>' +
        '<div class="grid2"><input class="rp-to" data-rp="' + rp.id + '" placeholder="领用人">' +
        '<button type="button" class="rp-done" data-rp="' + rp.id + '">重印领用，接回标记</button></div></div>';
    }).join("");
    listEl.querySelectorAll(".rp-done").forEach(btn => btn.onclick = () => {
      const rp = btn.dataset.rp;
      const input = listEl.querySelector('.rp-to[data-rp="' + rp + '"]');
      const res = T.completeReprint(state, rp, input.value);
      if (!res.ok) { say(res.error); return; }
      save(); say("编号 " + res.data.newTag.code + " 重印牌已由 " + res.data.newTag.issuedTo + " 领用，标记回到当前清单。", true);
      selectedId = res.data.mark.id;
      fillForm(res.data.mark.id); render();
    });
  }

  // ---------- 视图：存档清单 ----------
  function renderArchive() {
    listTitle.textContent = "存档清单（只读）";
    listEl.className = "list";
    const q = queryEl.value.trim().toLowerCase();
    const archs = A.list(state).filter(ar => !q || ar.changedCode.toLowerCase().includes(q) || ar.items.some(i => i.dive.toLowerCase().includes(q)));
    if (!archs.length) { listEl.innerHTML = '<div class="muted">还没有存档。每次资料更正前，系统会把更正前的当前清单整体留档。</div>'; return; }
    listEl.innerHTML = archs.map(ar =>
      '<details class="item archive-card" ' + (selectedId && ar.markId === selectedId ? "open" : "") + '>' +
      '<summary>' + fmt(ar.at) + ' · ' + esc(ar.reason) + ' · ' + esc(ar.changedCode) +
      ' <span class="muted">(' + ar.items.length + ' 条)</span></summary>' +
      '<div class="muted" style="margin:6px 0">更正前的当前清单快照，旧牌编号与领用人原样保留：</div>' +
      ar.items.map(i => '<div>' + esc(i.code) + ' · ' + esc(i.dive) + ' · ' + typeNames[i.type] +
        ' · ' + esc(i.depth) + ' <span class="muted">(' + esc(i.issuedTo) + ')</span></div>').join("") +
      '</details>').join("");
  }

  function render() {
    const data = visibleMarks();
    renderMap(data);
    if (viewEl.value === "timeline") renderTimeline(data);
    else if (viewEl.value === "ledger") renderLedger(data);
    else if (viewEl.value === "reprint") renderReprint();
    else if (viewEl.value === "archive") renderArchive();
    else renderList(data);
  }

  // ---------- 表单：发放 / 更正 ----------
  function setPreview(url) {
    if (url) { photoPreview.src = url; photoPreview.hidden = false; }
    else { photoPreview.removeAttribute("src"); photoPreview.hidden = true; }
  }

  function issueMode() {
    selectedId = "";
    replaceBox.hidden = true;
    replaceToggleBtn.hidden = true;
    deleteBtn.hidden = true;
    formTitle.textContent = "发放登记";
    saveBtn.textContent = "发放标签";
    field("code").readOnly = false;
    field("dive").readOnly = false;
    field("issuedTo").readOnly = false;
    field("issuedTo").placeholder = "例如 林悦";
    saveBtn.disabled = false;
  }

  function editMark(id) {
    const mark = state.marks.find(m => m.id === id);
    if (!mark) return;
    selectedId = id;
    fillForm(id);
    render();
  }

  function fillForm(id) {
    const mark = state.marks.find(m => m.id === id);
    if (!mark) return;
    const active = T.activeTag(mark);
    const rp = T.reprintFor(state, mark);
    form.reset();
    photoData = "";
    photoFile.value = "";
    replaceBox.hidden = true;
    field("id").value = mark.id;
    field("code").value = active ? active.code : (rp ? rp.code : mark.code);
    field("type").value = mark.type;
    field("dive").value = mark.dive;
    field("depth").value = mark.depth;
    field("orientation").value = mark.orientation || "";
    field("condition").value = mark.condition || "";
    field("note").value = mark.note || "";
    const srcTag = active || latestTag(mark);
    setPreview(srcTag && srcTag.photo);
    if (active) {
      formTitle.textContent = "资料更正 · " + active.code;
      saveBtn.textContent = "保存更正（旧牌失效转待重印）";
      field("issuedTo").value = active.issuedTo;
      field("issuedTo").readOnly = true;
      field("code").readOnly = true;
      field("dive").readOnly = true;
      replaceToggleBtn.hidden = false;
      deleteBtn.hidden = false;
      saveBtn.disabled = false;
    } else {
      formTitle.textContent = "待重印 · " + (rp ? rp.code : mark.code);
      saveBtn.textContent = "待重印，暂不可更正";
      field("issuedTo").value = "";
      field("issuedTo").placeholder = "旧牌已失效，请在「待重印队列」办理领用";
      field("issuedTo").readOnly = true;
      field("code").readOnly = true;
      field("dive").readOnly = true;
      replaceToggleBtn.hidden = true;
      deleteBtn.hidden = false;
      saveBtn.disabled = true;
    }
  }

  // 地图选点 → 准备发放
  map.addEventListener("click", event => {
    const rect = map.getBoundingClientRect();
    pendingXY = {
      x: Number(((event.clientX - rect.left) / rect.width * 100).toFixed(2)),
      y: Number(((event.clientY - rect.top) / rect.height * 100).toFixed(2))
    };
    form.reset();
    photoData = "";
    photoFile.value = "";
    setPreview("");
    issueMode();
    field("id").value = "";
    field("code").value = "M-" + String(state.marks.length + 1).padStart(3, "0");
    field("dive").value = "DIVE-01";
    say("已在平面图选点，填好编号、深度、领用人和照片后发放。", true);
    render();
  });

  // 照片读取
  photoFile.addEventListener("change", () => {
    const file = photoFile.files && photoFile.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { photoData = String(reader.result); setPreview(photoData); };
    reader.readAsDataURL(file);
  });

  // 提交：发放 或 资料更正
  form.onsubmit = event => {
    event.preventDefault();
    const f = Object.fromEntries(new FormData(form).entries());

    if (!selectedId) {
      const res = T.issue(state, {
        code: f.code, dive: f.dive, depth: f.depth, type: f.type,
        issuedTo: f.issuedTo, photo: photoData,
        orientation: f.orientation, condition: f.condition, note: f.note,
        x: pendingXY ? pendingXY.x : 50, y: pendingXY ? pendingXY.y : 50
      });
      if (!res.ok) { say(res.error); return; }
      state.marks.push(res.data);
      save(); pendingXY = null; photoData = ""; photoFile.value = "";
      say("标签 " + res.data.code + " 已发放给 " + T.activeTag(res.data).issuedTo + "，登记完成。", true);
      selectedId = res.data.id;
      fillForm(res.data.id);
      render();
      return;
    }

    // 资料更正：先把更正前的当前清单整体存档，再作废旧牌转待重印
    const mark = state.marks.find(m => m.id === selectedId);
    if (!mark || !T.activeTag(mark)) { say("该标记正在待重印，暂不能更正。"); return; }
    const oldCode = T.activeTag(mark).code;
    A.snapshot(state, { reason: "资料更正", markId: mark.id, changedCode: oldCode });
    const res = T.correct(state, selectedId, {
      type: f.type, depth: f.depth, orientation: f.orientation,
      condition: f.condition, note: f.note,
      photo: photoData || undefined
    });
    if (!res.ok) { say(res.error); return; }
    save(); photoData = ""; photoFile.value = "";
    say("资料已更正；旧牌 " + oldCode + " 失效并转入待重印，更正前清单已留档。", true);
    fillForm(selectedId);
    render();
  };

  // ---------- 换牌 ----------
  replaceToggleBtn.onclick = () => {
    if (replaceBox.hidden) {
      replaceBox.hidden = false;
      newCodeEl.value = "";
      newToEl.value = "";
      setTimeout(() => newCodeEl.focus(), 0);
    } else {
      replaceBox.hidden = true;
    }
  };
  $("#replaceCancelBtn").onclick = () => { replaceBox.hidden = true; };
  $("#replaceConfirmBtn").onclick = () => {
    if (!selectedId) return;
    const res = T.replace(state, selectedId, { code: newCodeEl.value, issuedTo: newToEl.value });
    if (!res.ok) { say(res.error); return; }
    save();
    replaceBox.hidden = true;
    say("已换发 " + res.data.newTag.code + "；旧牌 " + res.data.oldTag.code +
        " 的领用人（" + res.data.oldTag.issuedTo + "）和发放时刻保留，可在标签记录中查询。", true);
    fillForm(selectedId);
    render();
  };

  // ---------- 删除 ----------
  deleteBtn.onclick = () => {
    if (!selectedId) return;
    const mark = state.marks.find(m => m.id === selectedId);
    if (!mark) return;
    if (!confirm("确认删除标记 " + mark.code + " 及其全部标签记录？此操作不可恢复。")) return;
    T.removeMark(state, selectedId);
    save();
    selectedId = "";
    form.reset();
    setPreview("");
    issueMode();
    say("已删除。", true);
    render();
  };

  // ---------- JSON 导出（完整数据：标记/现牌与旧牌/待重印/存档） ----------
  $("#exportBtn").onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "dive-marks.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  filterEl.onchange = render;
  viewEl.onchange = render;
  queryEl.oninput = render;

  render();
})();
