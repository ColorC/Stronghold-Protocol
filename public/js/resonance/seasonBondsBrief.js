// 共鸣「确认本局信息」的右栏：本季全部盟约（阵营 / 职业与机制）的图标、名称和生效人数。
// 共鸣没有原生的核心/附加盟约抽取，也不使用原生的禁用干员，所以不显示 ui/matchInfo.js 的那两块。

import { html, MicroLabel } from '../ui/components.js';
import { PactIcon } from './pactIcon.js';

/**
 * @param {{ catalog: { pacts?: Record<string, { name: string, group?: string, thresholds?: number[], summaryDescription?: string }> } | null }} props
 */
export function SeasonBondsBrief({ catalog }) {
  const pacts = Object.entries(catalog?.pacts ?? {});
  if (!pacts.length) return null;
  const faction = pacts.filter(([, pact]) => pact.group === 'faction');
  const combat = pacts.filter(([, pact]) => pact.group !== 'faction');
  const row = (title, micro, list) => html`<div class="brief-bonds rs-brief-season">
    <h3 class="brief-h"><span>${title}</span><${MicroLabel}>${micro}</${MicroLabel}></h3>
    <div class="rs-brief-season__grid">
      ${list.map(([id, pact]) => html`<div key=${id} class="rs-brief-season__bond" data-pact=${id} title=${pact.summaryDescription || pact.name}>
        <${PactIcon} catalog=${catalog} id=${id} />
        <b>${pact.name}</b>
        <span class="num">${(pact.thresholds ?? []).join('/')}</span>
      </div>`)}
    </div>
  </div>`;
  return html`${row('阵营盟约', 'FACTION BONDS', faction)}
    ${row('职业与机制盟约', 'CLASS BONDS', combat)}
    <p class="brief-legend">数字为生效人数，按上阵的不同干员计算；备战区的干员不计入。</p>`;
}
