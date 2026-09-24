"use strict";
// 标签判定：发放、换牌、更正失效、重印的业务规则。纯数据操作，不碰 DOM 与存储。
const TagDesk = (() => {
  const STATUS = { ACTIVE: "active", REPLACED: "replaced", REPRINT: "reprint" };
  const STATUS_NAMES = {
    active: "现行",
    replaced: "已换发",
    reprint: "失效·待重印"
  };

  // 一个标记当前只有一张现行牌
  function activeTag(tags, markerId) {
    return tags.find(t => t.markerId === markerId && t.status === STATUS.ACTIVE) || null;
  }

  function latestTag(tags, markerId) {
    return tags
      .filter(t => t.markerId === markerId)
      .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))[0] || null;
  }

  function findByCode(tags, dive, code) {
    const d = String(dive || "").trim();
    const c = String(code || "").trim().toLowerCase();
    return tags.find(t => t.dive === d && t.code.toLowerCase() === c) || null;
  }

  // 发放判定：同一潜次内，一个编号只能发给一个标记；allowTagId 仅供重印沿用旧牌自身编号
  function checkIssue(tags, dive, code, allowTagId = null) {
    if (!String(code || "").trim()) return { ok: false, reason: "编号不能为空" };
    if (!String(dive || "").trim()) return { ok: false, reason: "潜次不能为空" };
    const hit = findByCode(tags, dive, code);
    if (hit && hit.id !== allowTagId) {
      return { ok: false, reason: `潜次 ${dive} 中编号 ${hit.code} 已发出，编号重复不能发放` };
    }
    return { ok: true };
  }

  function issue({ markerId, dive, code, holder }) {
    return {
      id: crypto.randomUUID(),
      markerId,
      dive: String(dive).trim(),
      code: String(code).trim(),
      holder: String(holder || "").trim() || "未登记",
      issuedAt: new Date().toISOString(),
      status: STATUS.ACTIVE
    };
  }

  // 换牌：旧牌冻结（领用人、领用时刻原样保留），新牌接到同一标记
  function replace(tags, oldTag, input) {
    const check = checkIssue(tags, oldTag.dive, input.code);
    if (!check.ok) throw new Error(check.reason);
    oldTag.status = STATUS.REPLACED;
    oldTag.replacedAt = new Date().toISOString();
    const fresh = issue({ markerId: oldTag.markerId, dive: oldTag.dive, code: input.code, holder: input.holder });
    fresh.previousTagId = oldTag.id;
    tags.push(fresh);
    return fresh;
  }

  // 资料更正：现行牌失效，转待重印（记录保留）
  function invalidateForReprint(tag) {
    tag.status = STATUS.REPRINT;
    tag.invalidatedAt = new Date().toISOString();
    return tag;
  }

  // 重印新发：旧牌仍为失效留档，新牌成为现行牌；允许沿用被重印旧牌自身的编号
  function reprint(tags, oldTag, input) {
    const check = checkIssue(tags, oldTag.dive, input.code, oldTag.id);
    if (!check.ok) throw new Error(check.reason);
    const fresh = issue({ markerId: oldTag.markerId, dive: oldTag.dive, code: input.code, holder: input.holder });
    fresh.reprintedFrom = oldTag.id;
    tags.push(fresh);
    return fresh;
  }

  function pendingReprint(tags, markerId) {
    return tags
      .filter(t => t.markerId === markerId && t.status === STATUS.REPRINT)
      .sort((a, b) => (b.invalidatedAt || "").localeCompare(a.invalidatedAt || ""))[0] || null;
  }

  const isOld = t => t.status !== STATUS.ACTIVE;

  return {
    STATUS, STATUS_NAMES,
    activeTag, latestTag, findByCode, checkIssue,
    issue, replace, invalidateForReprint, reprint, pendingReprint, isOld
  };
})();
