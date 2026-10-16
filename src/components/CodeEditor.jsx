import React, { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { getDraftKey, getRunResultDetails, getRunResultTitle } from "../services/editor.js";

const LANGUAGE_LABELS = { python: "Python 3", java: "Java 17" };

function configureTheme(monaco) {
  monaco.editor.defineTheme("hot100-light", {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#FFFEFB",
      "editor.foreground": "#292824",
      "editorLineNumber.foreground": "#817b70",
      "editorLineNumber.activeForeground": "#B65332",
      "editorCursor.foreground": "#B65332",
      "editor.selectionBackground": "#F1C9B8"
    }
  });
}

export default function CodeEditor({
  language,
  code = "",
  mode = "function",
  questionId,
  func,
  cases,
  draftRecord,
  draftStatus,
  cursor = 0,
  scrollTop = 0,
  onCodeChange,
  onDraftChange,
  example,
  onRun,
  readOnly = false
}) {
  const editorRef = useRef(null);
  const latestCodeRef = useRef(code);
  const draftChangeRef = useRef(onDraftChange);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [consumeEditorWheel, setConsumeEditorWheel] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 801px)").matches);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 801px)");
    const update = () => setConsumeEditorWheel(desktop.matches);
    desktop.addEventListener("change", update);
    return () => desktop.removeEventListener("change", update);
  }, []);
  const restoredCursor = Number.isFinite(draftRecord?.cursor) ? draftRecord.cursor : cursor;
  const restoredScrollTop = Number.isFinite(draftRecord?.scrollTop) ? draftRecord.scrollTop : scrollTop;

  useEffect(() => { latestCodeRef.current = code; }, [code]);
  useEffect(() => { draftChangeRef.current = onDraftChange; }, [onDraftChange]);

  const emitDraft = (nextCode = latestCodeRef.current) => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    const position = editor.getPosition();
    draftChangeRef.current?.({
      code: nextCode,
      cursor: model && position ? model.getOffsetAt(position) : 0,
      scrollTop: editor.getScrollTop(),
      updatedAt: new Date().toISOString()
    });
  };

  const handleMount = (editor) => {
    editorRef.current = editor;
    const model = editor.getModel();
    if (model && Number.isFinite(restoredCursor)) editor.setPosition(model.getPositionAt(Math.max(0, Math.min(restoredCursor, model.getValueLength()))));
    if (Number.isFinite(restoredScrollTop)) editor.setScrollTop(Math.max(0, restoredScrollTop));
    editor.onDidScrollChange(() => emitDraft());
    editor.onDidChangeCursorPosition(() => emitDraft());
  };

  const handleChange = (value = "") => {
    latestCodeRef.current = value;
    onCodeChange?.(value);
    emitDraft(value);
  };

  const run = async () => {
    if (!onRun || running) return;
    setRunning(true);
    try {
      setResult(await onRun({ questionId, language, mode, func, cases, code, input: example?.input ?? "", expectedOutput: example?.output ?? "" }));
    } catch (error) {
      setResult({ status: "runtime_error", error: error.message || "运行请求失败，请重试。" });
    } finally {
      setRunning(false);
    }
  };

  const resultTitle = getRunResultTitle(result);

  return <div className="codeEditor">
    <div className="editorMeta">
      <span>{LANGUAGE_LABELS[language] || language}</span>
      <small>本地只运行公开示例</small>
    </div>
    <div className="monacoHost">
      <Editor
        height="100%"
        path={`${getDraftKey(questionId, language, mode)}.${language === "python" ? "py" : "java"}`}
        language={language === "python" ? "python" : "java"}
        value={code}
        theme="hot100-light"
        beforeMount={configureTheme}
        onMount={handleMount}
        onChange={handleChange}
        options={{
          readOnly,
          automaticLayout: true,
          minimap: { enabled: false },
          lineNumbers: "on",
          bracketPairColorization: { enabled: true },
          autoIndent: "full",
          formatOnPaste: true,
          scrollBeyondLastLine: false,
          scrollbar: { alwaysConsumeMouseWheel: consumeEditorWheel },
          glyphMargin: false,
          fontSize: 14
        }}
      />
    </div>
    <div className="editorActions">
      <button className="primaryButton" onClick={run} disabled={running || !onRun}>{running ? "运行中…" : "运行公开示例"}</button>
      <span className="draftStatus">{draftStatus || "输入来自左侧示例"}</span>
    </div>
    {result && <details className={`runPanel ${result.status}`} open>
      <summary><strong>{resultTitle}</strong><span>展开/收起结果</span></summary>
      <div className="runPanelBody">
        {getRunResultDetails(result).map(item => <div className="runCase" key={item.caseId}>
          {Array.isArray(result.cases) && <p>{item.caseId} · {item.title}</p>}
          {Object.hasOwn(item, "actual") && <pre>实际：{JSON.stringify(item.actual)}</pre>}
          {Object.hasOwn(item, "expected") && <pre>期望：{JSON.stringify(item.expected)}</pre>}
          {item.output && <pre>{item.output}</pre>}
          {item.error && <pre className="errorText">{item.error}</pre>}
          {item.stderr && item.stderr !== item.error && <pre>{item.stderr}</pre>}
        </div>)}
      </div>
    </details>}
  </div>;
}
