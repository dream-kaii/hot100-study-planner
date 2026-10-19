import React, { useRef, useState } from "react";
import { exportBackup, mergeOrReplaceState, readBackupFile, requestBackupDirectory, writeBackup } from "../services/backup.js";
import { saveDeviceBackup } from "../services/device.js";

export default function BackupPanel({ state, onImport, lastBackupAt, backupAvailable = false, deviceBackupName = "", onConfigured }) {
  const inputRef = useRef(null);
  const [message, setMessage] = useState("");
  // 目录句柄是浏览器本地凭据，换浏览器必须重新授权一次；
  // 但"有没有设过"是设备级事实，记在服务端，所以这里只在别的浏览器里提示"已设置，需重新授权"。
  const configure = async () => {
    try {
      const handle = await requestBackupDirectory();
      if (handle?.name) saveDeviceBackup(handle.name);
      onConfigured?.();
      setMessage("备份位置已设置，之后会自动保存");
    } catch (error) { setMessage(error.message); }
  };
  const backup = async () => { if (!backupAvailable) { setMessage("备份是可选功能；请先选择位置，或使用导出下载文件。"); return; } try { const at = await writeBackup(state); setMessage(`已备份：${at}`); } catch (error) { setMessage(error.message); } };
  const importFile = async (event) => {
    const file = event.target.files?.[0]; if (!file) return;
    try { const incoming = await readBackupFile(file); const mode = window.confirm("确定覆盖当前数据吗？点击取消将合并导入。") ? "replace" : "merge"; onImport?.(mergeOrReplaceState(state, incoming, mode)); setMessage("导入完成"); } catch (error) { setMessage(error.message); }
    event.target.value = "";
  };
  const download = () => { const url = URL.createObjectURL(exportBackup(state)); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "hot100-backup.json"; anchor.click(); URL.revokeObjectURL(url); setMessage("已导出当前学习数据"); };
  return <section className="backupPanel" aria-label="本地备份"><div><strong>本地备份（可选）</strong><span>{lastBackupAt
    ? `最近：${lastBackupAt}`
    : backupAvailable
      ? "已设置自动备份"
      : deviceBackupName
        ? `已设置：${deviceBackupName} · 本浏览器需重新授权`
        : "使用 localStorage 自动保存"}</span></div><div className="backupActions"><button onClick={configure}>选择位置</button><button onClick={backup}>立即备份</button><button onClick={() => inputRef.current?.click()}>导入</button><button onClick={download}>导出</button><input ref={inputRef} type="file" accept="application/json" hidden onChange={importFile} /></div>{message && <small role="status">{message}</small>}</section>;
}
