import React, { useEffect, useRef, useState } from "react";
import { isPassingVerdict, verdictLabel } from "../services/solutions.js";

// 解法切换器。
//
// 放在编辑器标题栏右侧，和 [Java][Python][函数][ACM] 同一组控件里 ——
// 复用的是现成的胶囊样式（1px 描边 / 7px 圆角 / 激活橙描边），
// 所以视觉上像是「本来就长在这里」的，不是新贴上去的一块。
//
// 两种形态，按可用宽度自动切换：
//   宽屏（> 1200px）：每个解法一个胶囊，右侧小勾表示「这份跑通过公开示例」
//   窄屏（≤ 1200px）：收成一个下拉框 + 「+」按钮
//     原因是编辑器卡片在 1024 宽度下只剩 456px，两个标签组已经占了 195px，
//     再塞 5 个胶囊会把标题栏顶成两行，把代码区压到 110px 高。
//
// 软上限 5 份；到顶后「+」变灰，标题里说明要先删一份。

const NAME_MAX = 24;
const VISIBLE_LIMIT = 4;
const COMPACT_QUERY = "(max-width: 1200px)";

function Check({ variant }) {
  if (!variant || !isPassingVerdict(variant.verdict)) return null;
  const label = verdictLabel(variant.verdict);
  return <span className={`variantCheck ${variant.verdict}`} aria-label={label} title={label}>✓</span>;
}

export default function SolutionVariants({
  variants = [],
  activeId = null,
  max = 5,
  onSwitch,
  onAdd,
  onRename,
  onRemove
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
  // 满了不再是「灰掉、无话可说」。按钮仍然可点，只是含义变成
  // 「把当前这份重置成模板」—— 因为点不动又没解释，用户只会以为功能坏了。
  const addTitle = canAdd
    ? "把当前代码存成一份，然后开一份新的空白模板"
    : `已有 ${max} 份（上限），点这里会把当前这份重置成空白模板，旧代码留可撤销快照`;
  const addLabel = canAdd ? "+ 新解法" : "重置当前这份";

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

  const manageMenu = activeVariant ? <div className="variantMenu">
    <button type="button" className="variantMore" aria-haspopup="menu" aria-expanded={menu === "manage"} onClick={() => setMenu((current) => (current === "manage" ? null : "manage"))} aria-label="管理当前解法" title="重命名 / 删除">⋯</button>
    {menu === "manage" && <ul className="variantMenuList" role="menu">
      <li><button type="button" role="menuitem" onClick={() => beginRename(activeVariant)}>重命名「{activeVariant.name}」</button></li>
      <li><button type="button" role="menuitem" className="dangerItem" onClick={() => { setMenu(null); onRemove?.(activeVariant.id); }}>删除这份解法</button></li>
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
          {variant.name}{isPassingVerdict(variant.verdict) ? " ✓" : ""}
        </option>)}
      </select>}
      <button type="button" className="variantAdd" onClick={() => onAdd?.()} title={addTitle} aria-label={addLabel}>{canAdd ? "+" : "↺"}</button>
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
        {label}<Check variant={variant} />
      </button>;
    })}

    {overflow.length > 0 && <div className="variantMenu">
      <button type="button" className="variantMore" aria-haspopup="menu" aria-expanded={menu === "overflow"} onClick={() => setMenu((current) => (current === "overflow" ? null : "overflow"))} title="更多解法">+{overflow.length}</button>
      {menu === "overflow" && <ul className="variantMenuList" role="menu">
        {overflow.map((variant) => <li key={variant.id}>
          <button type="button" role="menuitem" onClick={() => { setMenu(null); if (variant.id !== activeId) onSwitch?.(variant.id); }}>
            {variant.name}<Check variant={variant} />
          </button>
        </li>)}
      </ul>}
    </div>}

    <button type="button" className={`variantAdd${canAdd ? "" : " full"}`} onClick={() => onAdd?.()} title={addTitle}>{addLabel}</button>
    {manageMenu}
  </div>;
}
