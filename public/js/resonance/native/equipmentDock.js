import { html, Icon } from '../../ui/components.js';
import { useEffect, useRef, useState } from '../../../vendor/hooks.module.js';
import { ResonanceItemIcon } from '../itemIcon.js';
import { RESONANCE_EQUIP_SLOTS, pactRefusal, recipeFor } from '../equipmentSlots.js';

/** Beside `rect` (right when it fits, else left), kept inside the viewport: where a floating preview box goes. */
function besideRect(rect, box, margin = 8) {
  const x = rect.right + 8 + box.width <= innerWidth - margin ? rect.right + 8 : Math.max(margin, rect.left - box.width - 8);
  const y = Math.max(margin, Math.min(rect.top, innerHeight - box.height - margin));
  return { x, y };
}

/** What a merge makes, in full: the product's icon, name and the same effect text as its detail card. */
export function MergePreview({ catalog, resultId, lead }) {
  const product = catalog?.equipment?.[resultId] || {};
  return html`<span class="rs-merge-preview" data-result-id=${resultId}>
    <${ResonanceItemIcon} catalog=${catalog} itemId=${resultId} size="md" showTier=${false}/>
    <span class="rs-merge-preview__text"><small>${lead}</small><b>${product.name || '装备'}</b>${product.description ? html`<span>${product.description}</span>` : null}</span>
  </span>`;
}

/** Permanent, narrow inventory rail. Equipped items stay on their operator; this rail owns only loose inventory. */
export function InventoryDock({ state, catalog, onDetail, onOpen, onCombine, fieldTargetUid = null, fieldAnchor = null, busy = false, className = '' }) {
  const [draggedUid, setDraggedUid] = useState(null);
  const [hoverUid, setHoverUid] = useState(null);
  const rootRef = useRef(null), previewRef = useRef(null), fieldPreviewRef = useRef(null);
  const [previewPoint, setPreviewPoint] = useState(null), [fieldPoint, setFieldPoint] = useState(null);
  const inventory = state.inventory || [];
  const source = inventory.find(item => String(item.uid) === String(draggedUid)) || null;
  const fieldTarget = (state.pieces || []).find(piece => String(piece.uid) === String(fieldTargetUid)) || null;
  const fieldRecipe = source && fieldTarget ? (fieldTarget.equipment || []).map(gear => ({ gear, recipe: recipeFor(catalog.recipes, source.itemId, gear.itemId) })).find(row => row.recipe) || null : null;
  const fieldUniqueConflict = !!fieldRecipe && !!catalog.equipment?.[fieldRecipe.recipe.resultId]?.unique &&
    (fieldTarget.equipment || []).some(gear => gear.itemId === fieldRecipe.recipe.resultId);
  const fieldFull = !!fieldTarget && !fieldRecipe && (fieldTarget.equipment || []).length >= RESONANCE_EQUIP_SLOTS;
  // an operator in no 盟约 (正义骑士号) takes no 徽记: the preview says so instead of promising it
  const fieldNoPact = !!source && pactRefusal(catalog, fieldTarget, fieldRecipe?.recipe.resultId ?? source.itemId);
  const hovered = inventory.find(item => String(item.uid) === String(hoverUid)) || null;
  const hoveredRecipe = source && hovered && String(source.uid) !== String(hovered.uid) ? recipeFor(catalog.recipes, source.itemId, hovered.itemId) : null;
  const hoveredResult = hoveredRecipe ? catalog.equipment?.[hoveredRecipe.resultId] : null;
  useEffect(() => {
    if (!hoveredRecipe) { setPreviewPoint(null); return; }
    const update = () => {
      // this dock's own slot: the rail and the equipment panel each hold the same items, so a document-wide lookup would
      // find the rail's slot first and put the panel's preview beside the rail
      const target = rootRef.current?.querySelector(`.rs-equipment-dock__slot[data-item-uid="${CSS.escape(String(hovered.uid))}"]`);
      const box = previewRef.current;
      if (!target || !box) return;
      setPreviewPoint(besideRect(target.getBoundingClientRect(), box.getBoundingClientRect()));
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [hoveredRecipe, hovered?.uid, hoveredResult?.name]);
  // the operator under the dragged component: the preview sits beside that operator on the field
  const anchored = !!(fieldAnchor && fieldTarget && source && !hovered);
  useEffect(() => {
    const box = fieldPreviewRef.current;
    if (!anchored || !box) { setFieldPoint(null); return; }
    setFieldPoint(besideRect(fieldAnchor, box.getBoundingClientRect()));
  }, [anchored, fieldAnchor?.left, fieldAnchor?.top, fieldAnchor?.right, fieldAnchor?.bottom, fieldRecipe?.recipe.resultId, fieldFull, fieldUniqueConflict, fieldNoPact]);
  const editable = !busy && ['prep', 'choice'].includes(state.phase);
  const combine = async (target) => {
    if (!editable || !source || String(source.uid) === String(target.uid)) return;
    const recipe = recipeFor(catalog.recipes, source.itemId, target.itemId);
    if (!recipe) return;
    await onCombine({ type: 'combine', itemUids: [source.uid, target.uid] });
  };
  return html`<aside ref=${rootRef} class=${`rs-equipment-dock ${className}`.trim()} aria-label=${`装备库存 ${inventory.length}`}>
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
      <${MergePreview} catalog=${catalog} resultId=${hoveredRecipe.resultId} lead="松开得到"/>
    </div>` : null}
    ${fieldTarget && source && !hovered ? html`<div ref=${fieldPreviewRef} class=${`rs-equipment-dock__field-preview${anchored ? ' is-anchored' : ''}`} role="status" aria-live="polite"
      style=${!anchored ? undefined : fieldPoint ? `left:${fieldPoint.x}px;top:${fieldPoint.y}px;visibility:visible` : 'left:-10000px;top:0;visibility:hidden'}>
      ${fieldRecipe && !fieldUniqueConflict && !fieldNoPact ? html`<${MergePreview} catalog=${catalog} resultId=${fieldRecipe.recipe.resultId} lead="装备合成为"/>`
        : html`<small>${fieldNoPact ? '该干员不计入盟约，无法佩戴徽记' : fieldUniqueConflict ? '该干员已携带此唯一装备' : fieldFull ? `装备栏已满（${RESONANCE_EQUIP_SLOTS}/${RESONANCE_EQUIP_SLOTS}）` : '松开即可装备'}</small>`}
    </div>` : null}
    <button type="button" class="rs-equipment-dock__open" aria-label="打开装备与配方" title="装备与配方" onClick=${onOpen}><${Icon} name="sword"/><small>${inventory.length}</small></button>
  </aside>`;
}
