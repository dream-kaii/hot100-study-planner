import React from "react";
import ProgressPanel from "../components/ProgressPanel.jsx";
import PracticeTimeline from "../components/PracticeTimeline.jsx";
import StageProgress from "../components/StageProgress.jsx";
import WeakPoints from "../components/WeakPoints.jsx";
import { buildQuestionTimeline, buildStageProgress, findWeakPoints } from "../services/dashboard.js";
import { getHistorySummary, getRecentHistory } from "../services/history.js";
import { derivePracticeStatus } from "../services/status.js";

// 「今日复习」这一栏原本把错题和到期复习混在一起，每条都写「复习已到期」，
// 于是统计卡上的「待复习 2 / 错题 1」和列表里的 3 条对不上，看着像 bug。
// 现在每条都带上真实原因，标题也写明这一栏是「错题 + 到期」的合集。
function reviewReason(progressItem) {
  const status = derivePracticeStatus(progressItem);
  if (status === "reviewing") return "错题 · 需要重做";
  if (status === "due") return "复习已到期";
  return "待复习";
}

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
  const progressMap = dashboardState.progress || {};
  const stages = stageProgress || (questions.length ? buildStageProgress(questions, dashboardState, now) : []);
  const focus = weakPoints || (questions.length ? findWeakPoints(questions, dashboardState, now) : []);
  const history = timelineQuestionId ? buildQuestionTimeline(dashboardState, timelineQuestionId) : (timeline.length ? timeline : getRecentHistory(dashboardState, { limit: 20 }));
  const historySummary = timelineQuestionId ? {} : getHistorySummary(dashboardState);
  const openQuestion = onOpenQuestion || onOpen;
  return <section className="pageSection">
    <div className="sectionHeader">
      <div><span className="eyebrow">STUDY OVERVIEW</span><h1>今天，继续推进。</h1><p>沿学习顺序推进新内容；错题和到期复习从下方「需要重做」单独进入。</p></div>
      <button className="primaryButton" onClick={() => onOpen?.(studyEntry?.id)} disabled={!studyEntry}>开始今日练习</button>
    </div>
    <ProgressPanel stats={stats} />
    <div className="dashboardGrid">
      <article className="contentCard">
        <h2>学习主线</h2>
        {studyEntry
          ? <><p>{studyEntry.phase} · 学习顺序 {studyEntry.studyOrder}</p><button className="planRow" onClick={() => onOpen?.(studyEntry.id)}><span>#{studyEntry.id}</span><strong>{studyEntry.title}</strong><small>学习顺序中最早的未完成题</small></button></>
          : <p>学习主线已完成，可以继续复习。</p>}
        <h3>需要重做 · {dueReviews.length} 道</h3>
        {dueReviews.length
          ? dueReviews.map((entry) => {
            // dueReviews 现在从 sortReviewQueue 出来，是 {question, item, status} 的形状；
            // 旧版这里是裸的题目对象。两种都认，免得别处传裸数组时整页崩掉。
            const question = entry.question || entry;
            const item = entry.item || progressMap[question.id];
            const status = entry.status || derivePracticeStatus(item);
            // 到期复习的主按钮照样是「重写」：点进去给空白模板，而不是上次那份满分答案。
            return <button className="planRow" key={question.id} onClick={() => onOpen?.(question.id, status === "due" ? { freshStart: true } : undefined)}>
              <span>#{question.id}</span>
              <strong>{question.title}</strong>
              <small>{reviewReason(item)}</small>
            </button>;
          })
          : <p>今天没有错题或到期复习。</p>}
      </article>
      <article className="contentCard">
        <h2>学习建议</h2>
        <p>把错题标记原因，复习日期会按 1、3、7、14 天自动推进。</p>
        <p>代码运行只比较公开示例输出，适合快速检查思路。</p>
        <p>换思路时点「+ 新解法」：当前代码会存档，不会再被清空。</p>
      </article>
    </div>
    <StageProgress stages={stages} onOpenStage={onOpenStage} />
    <WeakPoints items={focus} onOpenQuestion={openQuestion} />
    <PracticeTimeline items={history} summary={historySummary} />
  </section>;
}
