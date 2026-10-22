import React, { useEffect, useRef, useState } from "react";
import { isPassingVerdict, verdictLabel } from "../services/solutions.js";
import { formatDateTime } from "../services/datetime.js";

// 解法切换器。
//
// 放在编辑器标题栏右侧，和 [Java][Python][函数][ACM] 同一组控件里 ——
// 复用的是现成的胶囊样式（1px 描边 / 7px 圆角 / 激活橙描边），
// 所以视觉上像是「本来就长在这里」的，不是新贴上去的一块。
//
// 两种形态，按可用宽度自动切换：
//   宽屏（> 1200px）：每个解法一个胶囊，右侧小勾表示「这份跑通过公开示例」
//   窄屏（≤ 1200px）：收成一个下拉框 + 「+」按钮
//     原因是编辑器卡片在 1024 宽度下只剩 456px，两个标签组已经占 195px，
//     再塞 5 个胶囊会把标题栏顶成两行，把代码区压到 110px 高。
//
// ── 关于「存档满 5 份」（2026-10 改） ──────────────────────────────
// 以前满档时这个按钮会静默把当前这份清成模板 —— 那是在复习重写会新占槽位的
// 年代做的补救。现在复习在同一份内重做，槽位只随「思路种类」增长，
// 满 5 份意味着用户真的存了 5 种思路，这时候悄悄清掉哪一份都是错的。
// 所以按钮仍然可点（可点才有反馈），但只会弹出「先删一份」的说明。

const NAME_MAX = 24;
const VISIBLE_LIMIT = 4;
const COMPACT_QUERY = "(max-width: 1200px)";

function Check({ variant }) {
  if (!variant || !isPassingVerdict(variant.verdict)) return null;
  const label = verdictLabel(variant.verdict);
  return <span className={`variantCheck ${variant.verdict}`} aria-label={label} title={label}>✓</span>;
}

// 版本角标：这份解法被顶替过几次（也就是存着几份旧代码）。
// 用 ↺ 而不是数字徽标，是为了和「✓ 通过」区分开 —— 一个是结论，一个是历史。
function VersionBadge({ variant }) {
  const count = Array.isArray(variant?.versions) ? variant.versions.length : 0;
  if (!count) return null;
  return <span className="variantVersionBadge" title={`存着 ${count} 份旧代码，可以在「⋯」里取回`}>↺{count}</span>;
}

export default function SolutionVariants({
  variants = [],
  activeId = null,
  max = 5,
  onSwitch,
  onAdd,
  onRename,
  onRemove,
  onRestoreVersion,
  onDropVersion
}) {
  // menu 可以是 null / "overflow" / "manage"
  const [menu, setMenu] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [draftName, setDraftName] = useState("");
  const [compact, setCompact] = useState(() => typeof window !== "undefined" && window.matchMedia(COMPACT_QUERY).matches);
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const media = window.matchMedia(COMPACT_QUERY);
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!menu && !editingId) return undefined;
    const close = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setMenu(null);
        setEditingId(null);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu, editingId]);

  useEffect(() => { if (editingId && inputRef.current) inputRef.current.select(); }, [editingId]);
  useEffect(() => { setMenu(null); setEditingId(null); }, [activeId]);

  const visible = variants.slice(0, VISIBLE_LIMIT);
  const overflow = variants.slice(VISIBLE_LIMIT);
  const canAdd = variants.length < max;
  const activeVariant = variants.find((item) => item.id === activeId) || null;
  const versions = Array.isArray(activeVariant?.versions) ? activeVariant.versions : [];
  // 删除是不可撤销的（历史版本跟着一起走），菜单项上要写清楚，
  // 否则「删一份空壳腾位置」很容易顺手删掉唯一一份存着旧代码的解法。
  const hasVersions = versions.length > 0;
  const addTitle = canAdd
    ? "把当前代码存成一份，然后开一份新的空白模板"
    : `已有 ${max} 份（上限）。这里已经装了 ${max} 种思路，想再存一种得先在「⋯」里删掉一份不用的 —— 删之前先把要留的那份看一眼，删除是连历史版本一起走的`;
  const addLabel = canAdd ? "+ 新解法" : `已满 ${max} 份`;

  const beginRename = (variant) => {
    if (!variant) return;
    setMenu(null);
    setEditingId(variant.id);
    setDraftName(variant.name || "");
  };

  const commitRename = () => {
    if (editingId) onRename?.(editingId, draftName);
    setEditingId(null);
  };

  const renameInput = <input
    ref={inputRef}
    className="variantNameInput"
    value={draftName}
    maxLength={NAME_MAX}
    aria-label="解法名称"
    onChange={(event) => setDraftName(event.target.value)}
    onBlur={commitRename}
    onKeyDown={(event) => {
      if (event.key === "Enter") { event.preventDefault(); commitRename(); }
      if (event.key === "Escape") setEditingId(null);
    }}
  />;

  // 历史版本列表。它替代了原来「复习重写就多一份解法」的做法：
  // 同一个思路的历次代码折叠在这份解法里面，不再各占一个槽位。
  const versionList = versions.length > 0 ? <li className="variantMenuSection" aria-hidden="true">
    <span>历史版本（{versions.length}）</span>
  </li> : null;
  const versionItems = [...versions].reverse().map((version) => <li key={version.id} className="variantVersionItem">
    <div className="variantVersionMeta">
      <strong>{version.reason || "旧代码"}</strong>
      <small>
        {formatDateTime(version.savedAt)}
        {isPassingVerdict(version.verdict) ? ` · ${verdictLabel(version.verdict)}` : ""}
        {` · ${String(version.code || "").split("\n").length} 行`}
      </small>
    </div>
    <div className="variantVersionActions">
      <button type="button" role="menuitem" onClick={() => { setMenu(null); onRestoreVersion?.(activeVariant.id, version.id); }}>取回</button>
      <button type="button" role="menuitem" className="dangerItem" aria-label="删除这一版" onClick={() => onDropVersion?.(activeVariant.id, version.id)}>×</button>
    </div>
  </li>);

  const manageMenu = activeVariant ? <div className="variantMenu">
    <button type="button" className="variantMore" aria-haspopup="menu" aria-expanded={menu === "manage"} onClick={() => setMenu((current) => (current === "manage" ? null : "manage"))} aria-label="管理当前解法" title="重命名 / 历史版本 / 删除">⋯</button>
    {menu === "manage" && <ul className="variantMenuList" role="menu">
      <li><button type="button" role="menuitem" onClick={() => beginRename(activeVariant)}>重命名「{activeVariant.name}」</button></li>
      {versionList}
      {versionItems}
      <li><button type="button" role="menuitem" className="dangerItem" title={hasVersions ? "历史版本会一起删除" : undefined} onClick={() => { setMenu(null); onRemove?.(activeVariant.id); }}>删除这份解法{hasVersions ? `（含 ${versions.length} 个历史版本）` : ""}</button></li>
    </ul>}
  </div> : null;

  // 窄屏紧凑形态：一个下拉 + 「+」，占位宽度约 190px。
  if (compact) {
    return <div className="solutionVariants compact" role="group" aria-label="解法切换" ref={rootRef}>
      {editingId ? renameInput : <select
        className="variantSelect"
        value={activeId || ""}
        aria-label="选择解法"
        title="切换解法：每份代码各自独立保存"
        onChange={(event) => { if (event.target.value && event.target.value !== activeId) onSwitch?.(event.target.value); }}
      >
        {!variants.length && <option value="">当前草稿（未存档）</option>}
        {variants.map((variant) => <option key={variant.id} value={variant.id}>
          {variant.name}{isPassingVerdict(variant.verdict) ? " ✓" : ""}{Array.isArray(variant.versions) && variant.versions.length ? ` ↺${variant.versions.length}` : ""}
        </option>)}
      </select>}
      {/* 满档时不能再用「↺」—— 那个符号是「重置」的意思，会让人以为点一下就把当前这份清空了。
          现在这里是「不行，得先删一份」，图标换成感叹号。 */}
      <button type="button" className={`variantAdd${canAdd ? "" : " full"}`} onClick={() => onAdd?.()} title={addTitle} aria-label={addLabel}>{canAdd ? "+" : "!"}</button>
      {manageMenu}
    </div>;
  }

  return <div className="solutionVariants" role="group" aria-label="解法切换" ref={rootRef}>
    {!variants.length && <span className="variantHint" title="点「+ 新解法」把当前代码存成一份，然后就能开始写另一种思路">当前草稿（未存档）</span>}

    {visible.map((variant, index) => {
      if (editingId === variant.id) return <React.Fragment key={variant.id}>{renameInput}</React.Fragment>;
      const label = variant.name || `解法 ${index + 1}`;
      const passing = isPassingVerdict(variant.verdict);
      return <button
        key={variant.id}
        type="button"
        className={`variantPill${variant.id === activeId ? " active" : ""}${passing ? " passed" : ""}`}
        onClick={() => { if (variant.id !== activeId) onSwitch?.(variant.id); }}
        onDoubleClick={() => beginRename(variant)}
        aria-pressed={variant.id === activeId}
        title={`${label} · ${passing ? verdictLabel(variant.verdict) : "尚未通过公开示例"}${variant.id === activeId ? "（正在编辑）" : " · 点击切换"}｜双击重命名`}
      >
        {label}<Check variant={variant} /><VersionBadge variant={variant} />
      </button>;
    })}

    {overflow.length > 0 && <div className="variantMenu">
      <button type="button" className="variantMore" aria-haspopup="menu" aria-expanded={menu === "overflow"} onClick={() => setMenu((current) => (current === "overflow" ? null : "overflow"))} title="更多解法">+{overflow.length}</button>
      {menu === "overflow" && <ul className="variantMenuList" role="menu">
        {overflow.map((variant) => <li key={variant.id}>
          <button type="button" role="menuitem" onClick={() => { setMenu(null); if (variant.id !== activeId) onSwitch?.(variant.id); }}>
            {variant.name}<Check variant={variant} /><VersionBadge variant={variant} />
          </button>
        </li>)}
      </ul>}
    </div>}

    <button type="button" className={`variantAdd${canAdd ? "" : " full"}`} onClick={() => onAdd?.()} title={addTitle}>{addLabel}</button>
    {manageMenu}
  </div>;
}
