import { html } from '../ui/components.js';
import { UnitThumb } from '../ui/gameComponents.js';
import { SUMMON_DRAG_TYPE, summonCardRows, summonDropRefusal } from './summonCards.js';

export { SUMMON_DRAG_TYPE, summonCardRows, summonDropRefusal };

/**
 * 召唤物 bar: a card per summon of each deployed summoner, kept apart from the bench so any number of summoners and summon
 * kinds fit and a full bench never hides one. Dragging a card over the field lights the tiles it may take; a drop places one
 * copy there (the placed copy is then an ordinary piece of the field: dragged to move, dropped on its own tile to turn, back to
 * the bench to take it back). Shown only while the board can be edited.
 */
export function NativeSummonBar({ rows, editable, busy, activeKey, onDragStart, onDragEnd }) {
  if (!rows.length) return null;
  return html`<aside class="rs-summon-bar" aria-label="召唤物">
    <header><b>召唤物</b><small>拖到战场上的部署格</small></header>
    <div class="rs-summon-bar__list">${rows.map((row) => {
      const ready = editable && !busy && row.remaining > 0;
      return html`<div class=${`rs-summon-card${row.remaining > 0 ? '' : ' is-empty'}${activeKey === row.key ? ' is-dragging' : ''}`} key=${row.key}
          draggable=${ready} data-owner-uid=${row.ownerUid} data-token-id=${row.tokenId} data-remaining=${row.remaining}
          title=${`${row.name} · ${row.ownerName}${row.remaining > 0 ? ' · 拖到战场上放置' : ' · 已全部放置'}`}
          onDragStart=${(event) => {
            if (!ready) { event.preventDefault(); return; }
            event.dataTransfer?.setData(SUMMON_DRAG_TYPE, JSON.stringify({ ownerUid: row.ownerUid, tokenId: row.tokenId }));
            if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
            onDragStart?.(row);
          }}
          onDragEnd=${() => onDragEnd?.()}>
        <${UnitThumb} kind="token" id=${row.tokenId} size="sm" showTier=${false} />
        <span class="rs-summon-card__text"><b>${row.name}</b><small>${row.ownerName}</small></span>
        <span class="rs-summon-card__count" aria-label=${`剩余${row.remaining}个，共${row.limit}个`}><b>${row.remaining}</b>/${row.limit}</span>
      </div>`;
    })}</div>
  </aside>`;
}
