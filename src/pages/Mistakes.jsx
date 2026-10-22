import React, { useMemo } from "react";
import { derivePracticeStatus, isMistakeStatus } from "../services/status.js";
import { statusLabel } from "../services/status-labels.js";
import { describeNextReview, describeOverdue, pickDailyNew, sortDueQueue } from "../services/review-session.js";

// 错题与复习。
//
// 这一页以前有几个口径问题，已一并修掉：
//   1) 用 UI 文案（"错题"/"待复习"）做判断 —— 但 reviewing 统一显示成「待复习」，
//      于是「错题」分支永远不成立，页面和统计卡对不上；
//   2) 到期复习和真错题混在同一个列表里，分不清是「我做错了」还是「该复习了」。
//
// 现在两个分区各自用自己的派生状态：错题池 = reviewing，到期复习 = due。
//
// 复习这条路的定位也改了：它原本主按钮是「继续写」—— 点进去编辑器里躺着上次那份
// 满分答案，于是「复习」变成了「把自己上周写的代码读一遍」，间隔照样推进，
// 等于白复习一次。现在主按钮是「重写」：开一份空白模板，旧代码自动存档
// （走和「+ 新解法」完全相同的路径，永远不会被删），次按钮才是「看上次的写法」。
export default function Mistakes({ questions, rawProgress = {}, dailyNewLimit = 1, onOpen }) {
  const mistakeItems = useMemo(
    () => questions.filter((question) => isMistakeStatus(derivePracticeStatus(rawProgress[question.id]))),
    [questions, rawProgress]
  );
  // 到期复习：只放「已通过但到期」的题。错题本来就要重做，已单独列在上面，
  // 不重复出现在这里 —— 否则同一道题在两栏里各数一次，和总览统计又对不上。
  // 排序按 reviewAt 升序（逾期最久的排最前），不是按题目数组原序：
  // 逾期 20 天的和昨天刚到期的，不该按题号先后混在一起。
  const dueItems = useMemo(
    () => sortDueQueue(rawProgress, questions),
    [questions, rawProgress]
  );
  // 今日新题统一走 pickDailyNew（内部按学习顺序而非数组原序），
  // 和题库页的「今日新题」用同一个口径。
  const newItems = useMemo(
    () => pickDailyNew(questions, rawProgress, dailyNewLimit),
    [questions, rawProgress, dailyNewLimit]
  );

  const row = (question, tone) => {
    const item = rawProgress[question.id] || {};
    const status = derivePracticeStatus(item);
    let detail;
    if (isMistakeStatus(status)) {
      detail = `错题 · 需要重做${item.reviewCount ? ` · 已练习 ${item.reviewCount} 次` : ""}`;
    } else if (status === "due") {
      // 逾期天数用日历日算，并且不再走 String.slice ——
      // 那是切 ISO 的 UTC 串，东八区晚上 8 点以后会把复习日显示成前一天。
      detail = `已通过 · ${describeOverdue(item.reviewAt).text}`;
    } else {
      const next = describeNextReview(item);
      detail = next ? next.text : statusLabel(status);
    }
    return <div className={`reviewRow ${tone}`} key={question.id}>
      <div>
        <strong>#{question.id} {question.title}</strong>
        <small>{detail}</small>
      </div>
      <div className="reviewActions">
        {/* 主按钮：复习就要真的重写。开空白模板，旧代码进存档、不删。 */}
        <button className="primaryButton" onClick={() => onOpen(question.id, { freshStart: true })} title="开一份空白模板重写，之前那份会存档保留">重写</button>
        <button onClick={() => onOpen(question.id, { reviewVariant: true })} title="打开最近一次通过的那份代码，对着它回忆思路">看上次的写法</button>
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
          : <p>今天没有到期复习。做完的题会按 1、3、7、14 天自动排回这里。</p>}
      </section>
      <section className="contentCard">
        <h2>今日新题</h2>
        {newItems.length
          ? newItems.map((question) => <button className="planRow" key={question.id} onClick={() => onOpen(question.id)}><span>#{question.id}</span><strong>{question.title}</strong><small>学习顺序 {question.studyOrder || question.order}</small></button>)
          : <p>今日新题已完成。</p>}
        <h3>状态怎么算</h3>
        <p>运行失败会自动进错题池；通过后按 1、3、7、14 天排复习。手动点「错题」或「待复习」会立刻生效，不会再被忽略。</p>
        <h3>复习怎么算</h3>
        <p>「重写」用空白模板重来一次，旧代码会存档保留，随时能切回去看。「看上次的写法」只是翻阅，不推进复习间隔 —— 想推进间隔就重写一遍跑通。</p>
      </section>
    </div>
  </section>;
}
