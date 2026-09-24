"use strict";
// 存档：旧牌留档、更正时旧清单快照、旧牌可查。纯查询与快照生成，不直接读写存储。
const TagArchive = (() => {
  const photoPlaceholder = m => ({
    id: m.id, type: m.type, dive: m.dive, depth: m.depth,
    orientation: m.orientation, condition: m.condition, note: m.note, x: m.x, y: m.y
  });

  // 资料更正前调用：把更正前的整张现行清单（含当时的现行牌）存档
  function snapshot(markers, tags, reason) {
    return {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      reason: reason || "资料更正",
      tags: tags.map(t => ({ ...t })),
      markers: markers.map(photoPlaceholder)
    };
  }

  // 旧牌：不是现行牌的都算（已换发、失效待重印），可查但不进当前清单
  const oldTags = tags => tags.filter(t => t.status !== "active");

  function searchOldTags(tags, keyword) {
    const kw = String(keyword || "").trim().toLowerCase();
    if (!kw) return oldTags(tags);
    return oldTags(tags).filter(t =>
      t.code.toLowerCase().includes(kw) ||
      t.dive.toLowerCase().includes(kw) ||
      (t.holder || "").toLowerCase().includes(kw)
    );
  }

  function searchArchives(archives, keyword) {
    const kw = String(keyword || "").trim().toLowerCase();
    if (!kw) return archives;
    return archives.filter(a =>
      (a.reason || "").toLowerCase().includes(kw) ||
      a.id.toLowerCase().includes(kw) ||
      a.tags.some(t =>
        t.code.toLowerCase().includes(kw) ||
        t.dive.toLowerCase().includes(kw) ||
        (t.holder || "").toLowerCase().includes(kw))
    );
  }

  function latest(archives, n) {
    return [...archives].sort((a, b) => b.at.localeCompare(a.at)).slice(0, n);
  }

  return { snapshot, oldTags, searchOldTags, searchArchives, latest };
})();
