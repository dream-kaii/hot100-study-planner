import React, { useEffect, useReducer, useRef } from "react";
import { justReachedZero, minutesFromTimer, normalizeStoredTimer, shouldReportTimer, timerReducer } from "../services/practice.js";

export default function Timer({ durationSeconds, persistedTimer, onChange, onComplete }) {
  const [timer, dispatch] = useReducer(timerReducer, normalizeStoredTimer(persistedTimer, durationSeconds));
  const previousDuration = useRef(durationSeconds);
  const lastReported = useRef("");
  const lastReportedAt = useRef(timer.remaining);
  const previousRemaining = useRef(timer.remaining);
  useEffect(() => {
    if (previousDuration.current !== durationSeconds) {
      previousDuration.current = durationSeconds;
      dispatch({ type: "set-duration", duration: durationSeconds });
    }
  }, [durationSeconds]);
  useEffect(() => {
    if (!shouldReportTimer({ timer, lastSnapshot: lastReported.current, lastReportedAt: lastReportedAt.current })) return;
    lastReported.current = JSON.stringify(timer);
    lastReportedAt.current = timer.remaining;
    onChange?.(timer);
  }, [timer, onChange]);
  useEffect(() => {
    if (!timer.running) return undefined;
    const id = window.setInterval(() => dispatch({ type: "tick", seconds: 1 }), 1000);
    return () => window.clearInterval(id);
  }, [timer.running]);
  useEffect(() => {
    const previous = previousRemaining.current;
    previousRemaining.current = timer.remaining;
    if (justReachedZero(previous, timer.remaining)) onComplete?.();
  }, [timer.remaining, onComplete]);
  const minutes = String(Math.floor(timer.remaining / 60)).padStart(2, "0");
  const seconds = String(timer.remaining % 60).padStart(2, "0");
  // 归零后按「开始」要重新计时，否则点了跟没点一样（一直停在 00:00）。
  const toggle = () => {
    if (timer.running) return dispatch({ type: "pause" });
    if (timer.remaining <= 0) return dispatch({ type: "reset", duration: durationSeconds });
    return dispatch({ type: "start" });
  };
  return <div className="timer"><strong>{minutes}:{seconds}</strong><div><button onClick={toggle}>{timer.running ? "暂停" : "开始"}</button><button onClick={() => dispatch({ type: "reset", duration: durationSeconds })}>重置</button></div></div>;
}
