import React from "react";
import ProgressPanel from "../components/ProgressPanel.jsx";
import PracticeTimeline from "../components/PracticeTimeline.jsx";
import StageProgress from "../components/StageProgress.jsx";
import WeakPoints from "../components/WeakPoints.jsx";
import { buildQuestionTimeline, buildStageProgress, findWeakPoints } from "../services/dashboard.js";

export default function Dashboard({
  stats,
  studyEntry,
  dueReviews = [],
  onOpen,
  questions = [],
  state,
  now = new Date(),
  stageProgress,
  weakPoints,
  timeline = [],
  timelineQuestionId,
  onOpenStage,
  onOpenQuestion
}) {
  const dashboardState = state || { progress: {}, history: [] };
  const stages = stageProgress || (questions.length ? buildStageProgress(questions, dashboardState, now) : []);
  const focus = weakPoints || (questions.length ? findWeakPoints(questions, dashboardState, now) : []);
  const history = timelineQuestionId ? buildQuestionTimeline(dashboardState, timelineQuestionId) : (timeline.length ? timeline : dashboardState.history || []);
  const openQuestion = onOpenQuestion || onOpen;
  return <section className="pageSection"><div className="sectionHeader"><div><span className="eyebrow">STUDY OVERVIEW</span><h1>今天，继续推进。</h1><p>沿学习顺序推进新内容；到期题目从今日复习单独进入。</p></div><button className="primaryButton" onClick={() => onOpen?.(studyEntry?.id)} disabled={!studyEntry}>开始今日练习</button></div><ProgressPanel stats={stats} /><div className="dashboardGrid"><article className="contentCard"><h2>学习主线</h2>{studyEntry ? <><p>{studyEntry.phase} · 学习顺序 {studyEntry.studyOrder}</p><button className="planRow" onClick={() => onOpen?.(studyEntry.id)}><span>#{studyEntry.id}</span><strong>{studyEntry.title}</strong><small>学习顺序中最早的未完成题</small></button></> : <p>学习主线已完成，可以继续复习。</p>}<h3>今日复习</h3>{dueReviews.length ? dueReviews.map(q => <button className="planRow" key={q.id} onClick={() => onOpen?.(q.id)}><span>#{q.id}</span><strong>{q.title}</strong><small>复习已到期</small></button>) : <p>今天没有到期复习。</p>}</article><article className="contentCard"><h2>学习建议</h2><p>把错题标记原因，复习日期会按 1、3、7、14 天自动推进。</p><p>代码运行只比较公开示例输出，适合快速检查思路。</p></article></div><StageProgress stages={stages} onOpenStage={onOpenStage} /><WeakPoints items={focus} onOpenQuestion={openQuestion} /><PracticeTimeline items={history} /></section>;
}
