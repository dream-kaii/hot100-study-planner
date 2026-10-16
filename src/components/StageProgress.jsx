import React from "react";

export default function StageProgress({ stages = [], loading = false, onOpenStage }) {
  return <section className="contentCard stageProgress" aria-labelledby="stage-progress-title">
    <div className="sectionHeader">
      <div><span className="eyebrow">LEARNING PATH</span><h2 id="stage-progress-title">七阶段进度</h2></div>
    </div>
    {loading ? <p role="status" aria-live="polite">正在加载阶段进度…</p> : stages.length ? <div className="stageGrid">
      {stages.map((stage) => <article className="stageCard" key={stage.phase}>
        <div className="stageCardHeader"><span>阶段 {stage.phase}</span><strong>{stage.name}</strong><small>{stage.total ? `${stage.total} 道题` : "还没有题目"}</small></div>
        <dl className="stageCounts">
          <div><dt>独立完成</dt><dd>{stage.independentCompleted || 0}</dd></div>
          <div><dt>提示完成</dt><dd>{stage.neededHint || 0}</dd></div>
          <div><dt>参考题解</dt><dd>{stage.neededSolution || 0}</dd></div>
          <div><dt>已稳固</dt><dd>{stage.mastered || 0}</dd></div>
        </dl>
        <button type="button" className="textButton" onClick={() => onOpenStage?.(stage.phase)} disabled={!stage.total}>查看本阶段题目</button>
      </article>)}
    </div> : <div className="emptyState"><p>阶段进度暂时不可用。</p><p>完成一次练习后再回来查看。</p></div>}
  </section>;
}

