import { html, Icon } from '../../ui/components.js';
import { useEffect, useRef, useState } from '../../../vendor/hooks.module.js';
import { ResonanceItemIcon } from '../itemIcon.js';

const recipeFor = (recipes, first, second) => (recipes || []).find(recipe => recipe.parts?.length === 2 &&
  ((recipe.parts[0] === first && recipe.parts[1] === second) || (recipe.parts[1] === first && recipe.parts[0] === second))) || null;

/** Permanent, narrow inventory rail. Equipped items stay on their operator; this rail owns only loose inventory. */
export function InventoryDock({ state, catalog, onDetail, onOpen, onCombine, fieldTargetUid = null, busy = false, className = '' }) {
  const [draggedUid, setDraggedUid] = useState(null);
  const [hoverUid, setHoverUid] = useState(null);
  const previewRef = useRef(null);
  const [previewPoint, setPreviewPoint] = useState(null);
  const inventory = state.inventory || [];
  const source = inventory.find(item => String(item.uid) === String(draggedUid)) || null;
  const fieldTarget = (state.pieces || []).find(piece => String(piece.uid) === String(fieldTargetUid)) || null;
  const fieldRecipe = source && fieldTarget ? (fieldTarget.equipment || []).map(gear => ({ gear, recipe: recipeFor(catalog.recipes, source.itemId, gear.itemId) })).find(row => row.recipe) || null : null;
  const fieldUniqueConflict = !!fieldRecipe && !!catalog.equipment?.[fieldRecipe.recipe.resultId]?.unique &&
    (fieldTarget.equipment || []).some(gear => gear.itemId === fieldRecipe.recipe.resultId);
  const hovered = inventory.find(item => String(item.uid) === String(hoverUid)) || null;
  const hoveredRecipe = source && hovered && String(source.uid) !== String(hovered.uid) ? recipeFor(catalog.recipes, source.itemId, hovered.itemId) : null;
  const hoveredResult = hoveredRecipe ? catalog.equipment?.[hoveredRecipe.resultId] : null;
  useEffect(() => {
    if (!hoveredRecipe) { setPreviewPoint(null); return; }
    const update = () => {
      const target = document.querySelector(`.rs-equipment-dock__slot[data-item-uid="${CSS.escape(String(hovered.uid))}"]`);
      const box = previewRef.current;
      if (!target || !box) return;
      const r = target.getBoundingClientRect(), b = box.getBoundingClientRect(), margin = 8;
      const x = r.right + 8 + b.width <= innerWidth - margin ? r.right + 8 : Math.max(margin, r.left - b.width - 8);
      const y = Math.max(margin, Math.min(r.top, innerHeight - b.height - margin));
      setPreviewPoint({ x, y });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [hoveredRecipe, hovered?.uid, hoveredResult?.name]);
  const editable = !busy && ['prep', 'choice'].includes(state.phase);
  const combine = async (target) => {
    if (!editable || !source || String(source.uid) === String(target.uid)) return;
    const recipe = recipeFor(catalog.recipes, source.itemId, target.itemId);
    if (!recipe) return;
    await onCombine({ type: 'combine', itemUids: [source.uid, target.uid] });
  };
  return html`<aside class=${`rs-equipment-dock ${className}`.trim()} aria-label=${`装备库存 ${inventory.length}`}>
    <div class="rs-equipment-dock__items">${inventory.map(item => {
      const record = catalog.equipment?.[item.itemId] || {};
      const recipe = source && item.uid !== source.uid ? recipeFor(catalog.recipes, source.itemId, item.itemId) : null;
      const uniqueConflict = false;
      const result = recipe ? catalog.equipment?.[recipe.resultId] : null;
      const preview = hoverUid === item.uid && source && String(source.uid) !== String(item.uid);
      return html`<div class=${`rs-equipment-dock__slot${preview && recipe && !uniqueConflict ? ' is-recipe' : ''}${preview && recipe && uniqueConflict ? ' is-blocked' : ''}`} data-item-uid=${item.uid} key=${item.uid}
        onDragOver=${event => { if (editable && source && String(source.uid) !== String(item.uid)) { event.preventDefault(); setHoverUid(item.uid); } }}
        onDragLeave=${()=>setHoverUid(value => value === item.uid ? null : value)}
        onDrop=${event => { event.preventDefault(); void combine(item); setDraggedUid(null); setHoverUid(null); }}>
      <button type="button" class="rs-equipment-dock__item" data-item-uid=${item.uid} data-item-id=${item.itemId} data-tier=${record.tier||0} draggable=${editable}
          aria-label=${`${record.name || '装备'}${recipe && preview ? ` · ${uniqueConflict ? '无法合成，唯一装备已存在' : `合成为${recipe.resultName}`}` : ''}`}
          title=${`${record.name || '装备'} · 拖到干员身上装备${recipe ? ` · 与${source?.itemId === item.itemId ? record.name : source ? catalog.equipment?.[source.itemId]?.name : '组件'}合成${uniqueConflict ? '受唯一装备限制' : `得到${recipe.resultName}`}` : ''}`}
          onDragStart=${event => { if (!editable) { event.preventDefault(); return; } setDraggedUid(item.uid); event.dataTransfer?.setData('application/x-stronghold-equipment', String(item.uid)); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'; }}
          onDragEnd=${()=>{setDraggedUid(null);setHoverUid(null)}}
          onClick=${()=>onDetail?.({ kind: 'item', id: item.itemId, itemUid: item.uid })}
          onContextMenu=${event=>{event.preventDefault();onDetail?.({ kind: 'item', id: item.itemId, itemUid: item.uid })}}>
          <${ResonanceItemIcon} catalog=${catalog} itemId=${item.itemId} size="md" showTier=${false}/>
        </button>
      </div>`;
    })}</div>
    ${hoveredRecipe ? html`<div ref=${previewRef} class="rs-equipment-dock__preview" role="status" style=${previewPoint ? `left:${previewPoint.x}px;top:${previewPoint.y}px;visibility:visible` : 'left:-10000px;top:0;visibility:hidden'}>
      <${ResonanceItemIcon} catalog=${catalog} itemId=${hoveredRecipe.resultId} size="md" showTier=${false}/><small>松开得到${hoveredRecipe.resultName}</small>
    </div>` : null}
    ${fieldTarget && source ? html`<div class="rs-equipment-dock__field-preview" role="status" aria-live="polite">
      ${fieldRecipe && !fieldUniqueConflict ? html`<${ResonanceItemIcon} catalog=${catalog} itemId=${fieldRecipe.recipe.resultId} size="md" showTier=${false}/>` : null}
      <small>${fieldRecipe ? fieldUniqueConflict ? '该干员已携带此唯一装备' : `装备合成为${fieldRecipe.recipe.resultName}` : '松开即可装备'}</small>
    </div>` : null}
    <button type="button" class="rs-equipment-dock__open" aria-label="打开装备与配方" title="装备与配方" onClick=${onOpen}><${Icon} name="item"/><small>${inventory.length}</small></button>
  </aside>`;
}
