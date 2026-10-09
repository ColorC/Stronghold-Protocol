import { html } from '../ui/components.js';
import { LinkCopy } from './panels.js';
import { roleLabel,strategyConditionText,strategyTimingText } from './model.js';

export function DetailPanel({detail,catalog,onClose}) {
 if(!detail)return null;
 const {kind,id}=detail; let title='详情',body=null;
 if(kind==='operator') { const op=catalog.operators[id]; if(!op)return null; title=op.name; body=html`<p>${op.cost}费 · ${roleLabel(op.role)} · ${op.position==='MELEE'?'近战部署':'远程部署'} · ${op.pacts.map(x=>catalog.pacts[x]?.name).join(' / ')}</p>${[1,2,3].map(star=>{const s=op.stars[star];return html`<section class="rs-star"><h3>${star}星 · 生命 ${s.stats.health} · 攻击 ${s.stats.attack} · 防御 ${s.stats.defense} · 法抗 ${s.stats.resistance}</h3><b>${s.skill?.name||'战线应答'}</b><p>${s.skill?.description||''}</p><p>${s.skill?`${s.skill.recovery} · ${s.skill.initialSp}/${s.skill.spCost}技力 · ${s.skill.duration}`:''}</p>${s.skill?.values?.map(v=>html`<p>${v.label}：${v.value}</p>`)}${s.talents.map(t=>html`<p><b>${t.name}</b>：${t.description}</p>`)}<p>${s.passive}</p></section>`})}`; }
 else if(kind==='pact'){const p=catalog.pacts[id];if(!p)return null;title=p.name;body=html`<p>${p.description}</p>${p.levels.map(x=>html`<section class="rs-star"><h3>${x.threshold}人</h3><p>${x.description}</p></section>`)}`;}
 else if(kind==='item'){const item=catalog.equipment[id];if(!item)return null;title=item.name;body=html`<p>${item.description}</p>`;}
 else if(kind==='strategy'){const s=catalog.strategies[id];if(!s)return null;title=s.name;body=html`<p>${s.description}</p><p>生效时点：${strategyTimingText(s.timing)}</p><p>生效条件：${strategyConditionText(s.condition)}</p>`;}
 else if(kind==='environment'){const e=catalog.environments[id];if(!e)return null;title=e.name;body=html`<p>${e.description}</p><p>主盟约：${catalog.pacts[e.identityPactId]?.name||''}</p>`;}
 else if(kind==='recipe'){const r=catalog.recipes[Number(id)];if(!r)return null;title=r.resultName;body=html`<p>${r.names.join(' + ')} → ${r.resultName}</p>`;}
 return html`<aside class="rs-detail" role="dialog" aria-modal="true"><header><div><small>共鸣图鉴</small><h2>${title}</h2></div><${LinkCopy} kind=${kind} id=${id}/><button aria-label="关闭详情" onClick=${onClose}>关闭</button></header><div class="rs-detail__body">${body}</div></aside>`;
}
