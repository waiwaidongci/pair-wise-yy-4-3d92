/* 标签判定：发放、换牌、资料更正、重印领用的业务规则。
   不依赖 DOM / 存储，状态由调用方传入，返回 { ok, error, data }。 */
(function (global) {
  "use strict";

  const STATUS = {
    ACTIVE: "active",       // 当前挂在标记上的有效牌
    REPLACED: "replaced",   // 换牌换下的旧牌：领用人/时刻保留，可查但不进当前清单
    INVALID: "invalid"      // 资料更正后失效的旧牌：转待重印
  };
  const STATUS_NAME = { active: "当前有效", replaced: "已换牌", invalid: "已失效" };

  const nowISO = () => new Date().toISOString();
  const uid = () => (global.crypto && global.crypto.randomUUID ? global.crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2));

  // 同一潜次内一张标签编号只能发一次（旧牌编号也占用该潜次名额，避免误重复发放）。
  function codeTakenInDive(state, dive, code, exceptTagId) {
    const q = String(code || "").trim();
    return state.marks.some(m => m.dive === dive &&
      m.tags.some(t => t.id !== exceptTagId && t.code === q));
  }

  function activeTag(mark) {
    return (mark && mark.tags || []).find(t => t.status === STATUS.ACTIVE) || null;
  }

  // ---- 发放：登记编号、类型、深度和照片；同一潜次编号重复发不出去 ----
  function issue(state, draft) {
    const code = String(draft.code || "").trim();
    if (!code) return { ok: false, error: "请填写标签编号。" };
    if (!String(draft.dive || "").trim()) return { ok: false, error: "请填写潜次。" };
    if (!String(draft.depth || "").trim()) return { ok: false, error: "请填写深度。" };
    if (!String(draft.issuedTo || "").trim()) return { ok: false, error: "请填写领用人。" };
    if (!draft.photo) return { ok: false, error: "请登记标签照片。" };
    if (codeTakenInDive(state, draft.dive.trim(), code)) {
      return { ok: false, error: "潜次 " + draft.dive.trim() + " 中编号 " + code + " 已发放，不能重复登记。" };
    }
    const at = nowISO();
    const mark = {
      id: uid(),
      code,
      type: draft.type || "unknown",
      dive: draft.dive.trim(),
      depth: String(draft.depth).trim(),
      orientation: draft.orientation || "",
      condition: draft.condition || "",
      note: draft.note || "",
      x: Number(draft.x) || 50,
      y: Number(draft.y) || 50,
      tags: [{
        id: uid(),
        code,
        issuedTo: String(draft.issuedTo).trim(),
        issuedAt: at,
        status: STATUS.ACTIVE,
        photo: draft.photo,
        history: [{ kind: "issued", at, issuedTo: String(draft.issuedTo).trim(), detail: "首次发放" }]
      }]
    };
    return { ok: true, data: mark };
  }

  // ---- 换牌：保留旧牌领用人和时刻，新牌接到同一标记，旧牌可查但不进当前清单 ----
  function replace(state, markId, input) {
    const mark = state.marks.find(m => m.id === markId);
    if (!mark) return { ok: false, error: "找不到该标记。" };
    const old = activeTag(mark);
    if (!old) return { ok: false, error: "该标记暂无有效牌（可能正在待重印），不能换牌。" };
    const newCode = String(input.code || "").trim();
    const newTo = String(input.issuedTo || "").trim();
    if (!newCode) return { ok: false, error: "请填写新牌编号。" };
    if (!newTo) return { ok: false, error: "请填写新牌领用人。" };
    if (newCode === old.code) return { ok: false, error: "新牌编号不能与旧牌相同。" };
    if (codeTakenInDive(state, mark.dive, newCode)) {
      return { ok: false, error: "潜次 " + mark.dive + " 中编号 " + newCode + " 已发放，不能重复登记。" };
    }
    const at = nowISO();
    // 旧牌原样保留 issuedTo / issuedAt，仅改状态与换牌时刻。
    old.status = STATUS.REPLACED;
    old.replacedAt = at;
    old.history.push({ kind: "replaced", at, newCode, detail: "标签磨损，换发 " + newCode });
    const fresh = {
      id: uid(),
      code: newCode,
      issuedTo: newTo,
      issuedAt: at,
      status: STATUS.ACTIVE,
      photo: input.photo || old.photo,
      history: [{ kind: "issued", at, issuedTo: newTo, detail: "换牌自 " + old.code }]
    };
    mark.tags.push(fresh);
    mark.code = newCode; // 当前清单只显示现牌
    return { ok: true, data: { mark, newTag: fresh, oldTag: old } };
  }

  // ---- 资料更正：旧牌失效并转待重印；旧清单由 archive 模块留档 ----
  function correct(state, markId, patch) {
    const mark = state.marks.find(m => m.id === markId);
    if (!mark) return { ok: false, error: "找不到该标记。" };
    const old = activeTag(mark);
    if (!old) return { ok: false, error: "该标记的现牌已失效，请先在待重印队列完成重印。" };

    for (const key of ["type", "depth", "orientation", "condition", "note", "photo"]) {
      if (patch[key] !== undefined) {
        if (key === "photo") { if (patch.photo) old.photo = patch.photo; }
        else mark[key] = patch[key];
      }
    }
    if (patch.depth !== undefined) mark.depth = String(patch.depth).trim();

    const at = nowISO();
    old.status = STATUS.INVALID;
    old.invalidatedAt = at;
    old.invalidateReason = "资料更正";
    old.history.push({ kind: "invalidated", at, detail: "登记资料更正，旧牌失效转待重印" });
    // 标记失去现牌 → 进入待重印队列（编号沿用）
    state.reprints = state.reprints.filter(r => r.markId !== markId);
    state.reprints.push({ id: uid(), markId, code: old.code, createdAt: at, reason: "资料更正", oldTagId: old.id });
    return { ok: true, data: { mark, oldTag: old } };
  }

  // ---- 待重印 → 重印牌领用：同编号新牌接到同一标记，标记回到当前清单 ----
  function completeReprint(state, reprintId, issuedTo) {
    const rp = state.reprints.find(r => r.id === reprintId);
    if (!rp) return { ok: false, error: "该待重印记录不存在。" };
    const to = String(issuedTo || "").trim();
    if (!to) return { ok: false, error: "请填写重印牌领用人。" };
    const mark = state.marks.find(m => m.id === rp.markId);
    if (!mark) { state.reprints = state.reprints.filter(r => r.id !== reprintId); return { ok: false, error: "标记已不存在。" }; }
    const at = nowISO();
    const fresh = {
      id: uid(),
      code: rp.code,
      issuedTo: to,
      issuedAt: at,
      status: STATUS.ACTIVE,
      photo: (activeTag(mark) || {}).photo || mark.tags[mark.tags.length - 1]?.photo || "",
      history: [{ kind: "issued", at, issuedTo: to, detail: "资料更正后重印领用，沿用编号 " + rp.code }]
    };
    mark.tags.push(fresh);
    mark.code = rp.code;
    state.reprints = state.reprints.filter(r => r.id !== reprintId);
    return { ok: true, data: { mark, newTag: fresh } };
  }

  function removeMark(state, markId) {
    state.marks = state.marks.filter(m => m.id !== markId);
    state.reprints = state.reprints.filter(r => r.markId !== markId);
    return { ok: true };
  }

  global.TagRules = {
    STATUS, STATUS_NAME, uid, nowISO, activeTag, codeTakenInDive,
    isPendingReprint: (state, mark) => !activeTag(mark) && state.reprints.some(r => r.markId === mark.id),
    reprintFor: (state, mark) => state.reprints.find(r => r.markId === mark.id) || null,
    issue, replace, correct, completeReprint, removeMark
  };
})(window);
