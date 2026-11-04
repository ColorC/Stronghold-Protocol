// Native terminal route: the result owns the page and unmounts GameScreen/WebGL.
import { html, Icon, MicroLabel } from '../../ui/components.js';
import { useState } from '../../../vendor/hooks.module.js';
import { BattleReport } from '../battleReport.js';
import { DetailPanel } from '../detail.js';
import { ResultView } from './ResultView.js';

export function ResultPage({ state, catalog, onLeave, onReplay }) {
  const [reportOpen, setReportOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  return html`<div class="rs-terminal-screen">
    <${ResultView} state=${state} catalog=${catalog} onLeave=${onLeave} onReport=${()=>setReportOpen(true)} onDetail=${setDetail}/>
    ${reportOpen?html`<aside class="dpanel dpanel--right rs-side-panel rs-terminal-report" role="dialog" aria-label="战斗记录"><header class="rs-side-panel__head"><${MicroLabel} tone="mint">共鸣 · 战报</${MicroLabel}><h2>战斗记录</h2><button class="dpanel__close" aria-label="关闭面板" onClick=${()=>setReportOpen(false)}><${Icon} name="close"/></button></header><div class="dpanel__scroll"><${BattleReport} state=${state} catalog=${catalog} onReplay=${onReplay} onDetail=${setDetail}/></div></aside>`:null}
    <${DetailPanel} detail=${detail} catalog=${catalog} state=${state} onDetail=${setDetail} onClose=${()=>setDetail(null)}/>
  </div>`;
}
