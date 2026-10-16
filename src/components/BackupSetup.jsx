import React, { useState } from "react";
import { requestBackupDirectory } from "../services/backup.js";

export default function BackupSetup({ onReady }) {
  const [error, setError] = useState("");
  const choose = async () => {
    try { await requestBackupDirectory(); onReady?.(); } catch (cause) { setError(cause.message); }
  };
  return <main className="backupSetup"><div className="backupSetupCard"><p className="eyebrow">HOT 100 STUDY WORKBENCH</p><h1>先设置本地备份</h1><p>选择一个文件夹，学习状态会自动保存为 hot100-backup.json。</p><button className="primaryButton" onClick={choose}>选择备份文件夹</button>{error && <p className="errorText">{error}</p>}</div></main>;
}
