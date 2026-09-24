/* 存档：资料更正前把「当前清单」整体快照留档；旧牌随旧档可查，不进入当前清单。
   快照在更正那一刻生成，之后不再变化（只读）。 */
(function (global) {
  "use strict";

  // 生成当前清单快照：只收录当时有现牌的标记，并记录其现牌编号/领用人/时刻。
  function snapshot(state, opts) {
    const active = global.TagRules.activeTag;
    const items = state.marks
      .filter(m => active(m))
      .map(m => {
        const t = active(m);
        return {
          markId: m.id,
          code: t.code,
          type: m.type,
          dive: m.dive,
          depth: m.depth,
          orientation: m.orientation,
          condition: m.condition,
          note: m.note,
          x: m.x,
          y: m.y,
          issuedTo: t.issuedTo,
          issuedAt: t.issuedAt,
          photo: t.photo || ""
        };
      })
      .sort((a, b) => a.dive === b.dive ? a.code.localeCompare(b.code) : a.dive.localeCompare(b.dive));

    const record = {
      id: global.TagRules.uid(),
      reason: (opts && opts.reason) || "资料更正",
      markId: opts && opts.markId || "",
      changedCode: opts && opts.changedCode || "",
      at: global.TagRules.nowISO(),
      items
    };
    state.archives = state.archives || [];
    state.archives.unshift(record);
    return record;
  }

  function list(state) {
    return (state.archives || []).slice();
  }

  function get(state, id) {
    return (state.archives || []).find(a => a.id === id) || null;
  }

  global.TagArchive = { snapshot, list, get };
})(window);
