import React, { useMemo } from "react";
import { derivePracticeStatus, isMistakeStatus } from "../services/status.js";
import { statusLabel } from "../services/status-labels.js";

// 错题与复习。
//
// 这一页以前有两个口径问题，已一并修掉：
//   1) 用 UI 文案（"错题"/"待复习"）做判断 —— 但 reviewing 统一显示成「待复习」，
//      于是「错题」分支永远不成立，页面和统计卡对不上；
//   2) 到期复习和真错题混在同一个列表里，分不清是「我做错了」还是「该复习了」。
//
// 现在两个分区各自用自己的派生状态：错题池 = reviewing，到期复习 = due。
export default function Mistakes({ questions, rawProgress = {}, dailyNewLimit = 1, onOpen }) {
  const mistakeItems = useMemo(
    () => questions.filter((question) => isMistakeStatus(derivePracticeStatus(rawProgress[question.id]))),
    [questions, rawProgress]
  );
  // 到期复习：只放「已通过但到期」的题。错题本来就要重做，已单独列在上面，
  // 不重复出现在这里 —— 否则同一道题在两栏里各数一次，和总览统计又对不上。
  const dueItems = useMemo(
    () => questions.filter((question) => derivePracticeStatus(rawProgress[question.id]) === "due"),
    [questions, rawProgress]
  );
  const newItems = useMemo(
    () => questions.filter((question) => derivePracticeStatus(rawProgress[question.id]) === "new").slice(0, Math.max(1, Number(dailyNewLimit) || 1)),
    [questions, rawProgress, dailyNewLimit]
  );

  const row = (question, tone) => {
    const item = rawProgress[question.id] || {};
    const status = derivePracticeStatus(item);
    const detail = isMistakeStatus(status)
      ? `错题 · 需要重做${item.reviewCount ? ` · 已练习 ${item.reviewCount} 次` : ""}`
      : item.reviewAt ? `${statusLabel(status)} · 复习于 ${String(item.reviewAt).slice(0, 10)}` : statusLabel(status);
    return <div className={`reviewRow ${tone}`} key={question.id}>
      <div>
        <strong>#{question.id} {question.title}</strong>
        <small>{detail}</small>
      </div>
      <div className="reviewActions">
        <button onClick={() => onOpen(question.id)}>继续写</button>
        <button onClick={() => onOpen(question.id, { freshStart: true })}>另起一种解法</button>
      </div>
    </div>;
  };

  return <section className="pageSection">
    <div className="sectionHeader">
      <div>
        <span className="eyebrow">REVIEW LOOP</span>
        <h1>错题与复习</h1>
        <p>错题是没做出来的题，到期复习是按 1、3、7、14 天该重做的题。两者分开列，数量与总览一致。</p>
      </div>
    </div>
    <div className="reviewColumns">
      <section className="contentCard">
        <h2>错题池 <span className="countBadge">{mistakeItems.length}</span></h2>
        {mistakeItems.length
          ? <div className="reviewList">{mistakeItems.map((question) => row(question, "mistake"))}</div>
          : <p>错题池是空的。在题目页把状态点成「错题」，题目会立刻出现在这里。</p>}
        <h2 className="reviewSubhead">到期复习 <span className="countBadge">{dueItems.length}</span></h2>
        {dueItems.length
          ? <div className="reviewList">{dueItems.map((question) => row(question, "due"))}</div>
          : <p>今天没有到期复习。</p>}
      </section>
      <section className="contentCard">
        <h2>今日新题</h2>
        {newItems.length
          ? newItems.map((question) => <button className="planRow" key={question.id} onClick={() => onOpen(question.id)}><span>#{question.id}</span><strong>{question.title}</strong><small>学习顺序 {question.studyOrder || question.order}</small></button>)
          : <p>今日新题已完成。</p>}
        <h3>状态怎么算</h3>
        <p>运行失败会自动进错题池；通过后按 1、3、7、14 天排复习。手动点「错题」或「待复习」会立刻生效，不会再被忽略。</p>
      </section>
    </div>
  </section>;
}
