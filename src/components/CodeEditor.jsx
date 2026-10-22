import React, { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { getDraftKey, getRunResultDetails, getRunResultTitle } from "../services/editor.js";
import { compareComplexity, estimateComplexity } from "../services/complexity.js";
import ComplexityPanel from "./ComplexityPanel.jsx";
import { describeError } from "../services/errors.js";
import RunnerPairPanel from "./RunnerPairPanel.jsx";

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
  , complexity
}) {
  const editorRef = useRef(null);
  const latestCodeRef = useRef(code);
  const draftChangeRef = useRef(onDraftChange);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  // 在线运行：需要在用户电脑上启动 runner 时，本组件负责把配对码交到用户手上。
  const [pairCode, setPairCode] = useState("");
  // "pair"   = 需要用户输配对码（首次）
  // "offline"= 已配对过，但本机助手没在运行（不再生成新码）
  const [pairMode, setPairMode] = useState("pair");
  const [pairError, setPairError] = useState("");
  const pairCallbackRef = useRef(null);
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

  // 上报草稿。
  //
  // 默认值**不能**用 latestCodeRef.current：它是靠 useEffect 跟着 props.code 更新的，
  // 永远慢一帧。而 monaco 的 setValue 是同步派发事件的——
  // 「重置为模板」把 variant.code 换成模板后，编辑器立刻 setValue(模板)，
  // 同步触发的 cursor/scroll 回调读到的 latestCodeRef 还是**重置前的旧代码**，
  // 于是把旧代码写回存档 → 又渲染成旧代码 → 再 setValue → 再回调……
  // 编辑器和存档互相覆盖，一秒几百次，页面直接卡死。
  // 模型里的内容才是最新真相，没显式给值就问它。
  const emitDraft = (nextCode) => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    const value = typeof nextCode === "string" ? nextCode : model ? model.getValue() : latestCodeRef.current;
    latestCodeRef.current = value;
    const position = editor.getPosition();
    draftChangeRef.current?.({
      code: value,
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
    setPairError("");
    setPairMode("pair");
    try {
      const payload = { questionId, language, mode, func, cases, code, input: example?.input ?? "", expectedOutput: example?.output ?? "" };
      // onRun 的第三个参数是配对回调：只有线上首次运行、需要用户在终端输码时才会被调用。
      const outcome = await onRun(
        payload,
        undefined,
        (code) => {
          setPairCode(code);
          setPairMode("pair");
          pairCallbackRef.current = code;
        },
        // 已配对但 runner 没开：不显示新配对码，只提示去启动它
        () => setPairMode("offline")
      );
      if (outcome?.status === "unavailable" && pairCallbackRef.current) {
        // 需要配对：把错误留在面板里，不覆盖成"运行失败"。
        setPairError(outcome.error || "");
        setResult(null);
        return;
      }
      // 拿到真实结果（哪怕判题不通过）说明隧道已通，收起配对面板，
      // 否则用户会同时看到"请连接运行助手"和结果，很迷惑。
      setPairCode("");
      pairCallbackRef.current = null;
      setResult(outcome);
    } catch (error) {
      setResult({ status: "runtime_error", error: describeError(error, "运行请求失败，请重试。") });
      setPairCode("");
      setPairMode("pair");
    } finally {
      setRunning(false);
    }
  };

  const dismissPair = () => {
    setPairCode("");
    setPairError("");
    pairCallbackRef.current = null;
  };

  const retryAfterPair = () => {
    setPairCode("");
    pairCallbackRef.current = null;
    run();
  };

  const resultTitle = getRunResultTitle(result);
  const complexityResult = compareComplexity({ requirement: complexity?.requirement, reference: complexity?.referenceTime || complexity?.time, ...estimateComplexity({ language, code, func }) });

  return <div className="codeEditor">
    <div className="editorMeta">
      <span>{LANGUAGE_LABELS[language] || language}</span>
      <small id="hot100-run-hint">运行公开示例（代码在本机执行）</small>
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
    {(pairCode || pairMode === "offline") && running && <RunnerPairPanel
      code={pairCode}
      mode={pairMode}
      waiting={running}
      error={pairError}
      onRetry={retryAfterPair}
      onDismiss={dismissPair}
    />}
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
    <ComplexityPanel result={complexityResult} />
  </div>;
}
