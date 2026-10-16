import React, { useEffect, useReducer, useRef } from "react";
import { timerReducer } from "../services/practice.js";

export default function Timer({ durationSeconds, persistedTimer, onChange, onComplete }) {
  const [timer, dispatch] = useReducer(timerReducer, persistedTimer || { remaining: durationSeconds, running: false });
  const previousDuration = useRef(durationSeconds);
  const lastReported = useRef("");
  useEffect(() => {
    if (previousDuration.current !== durationSeconds) {
      previousDuration.current = durationSeconds;
      dispatch({ type: "set-duration", duration: durationSeconds });
    }
  }, [durationSeconds]);
  useEffect(() => {
    const snapshot = JSON.stringify(timer);
    if (snapshot === lastReported.current) return;
    lastReported.current = snapshot;
    onChange?.(timer);
  }, [timer, onChange]);
  useEffect(() => {
    if (!timer.running) return undefined;
    const id = window.setInterval(() => dispatch({ type: "tick", seconds: 1 }), 1000);
    return () => window.clearInterval(id);
  }, [timer.running]);
  useEffect(() => { if (timer.remaining === 0 && timer.running) { dispatch({ type: "pause" }); onComplete?.(); } }, [timer.remaining, timer.running, onComplete]);
  const minutes = String(Math.floor(timer.remaining / 60)).padStart(2, "0");
  const seconds = String(timer.remaining % 60).padStart(2, "0");
  return <div className="timer"><strong>{minutes}:{seconds}</strong><div><button onClick={() => dispatch({ type: timer.running ? "pause" : "start" })}>{timer.running ? "暂停" : "开始"}</button><button onClick={() => dispatch({ type: "reset", duration: durationSeconds })}>重置</button></div></div>;
}
