import { useState } from '../../../vendor/hooks.module.js';
import { html, Icon } from '../../ui/components.js';
import { act } from '../../ui/gameActions.js';

export function ResonanceCombatControls({ facts, done = false, paused = false }) {
  const [busy, setBusy] = useState(false);
  const speed = Number(facts?.speed) || 2;
  const finishing = facts?.finishing === true;
  const available = facts?.available === true && !done;
  const request = async fields => {
    if (busy || !available || finishing) return;
    setBusy(true);
    try { await act('g.resonanceCombat', fields); }
    finally { setBusy(false); }
  };
  return html`<div class="rs-native-combat-controls" aria-label="战斗速度与结算">
    <button type="button" class="pausebtn rs-native-speed" data-testid="battle-speed" disabled=${busy || !available || finishing}
      aria-label=${`战斗速度 ${speed} 倍`} title="切换战斗速度：1倍、2倍、4倍"
      onClick=${() => request({ speed: speed === 1 ? 2 : speed === 2 ? 4 : 1 })}>
      <b>${finishing ? '快结中' : `${speed}倍速`}</b>
    </button>
    <button type="button" class="pausebtn rs-native-fast-finish" data-testid="battle-fast-finish" disabled=${busy || !available || finishing || paused}
      aria-label="快速结算" title=${paused ? '继续作战后可快速结算' : '加快当前战斗，按实际结果结算'} onClick=${() => request({ finish: true })}>
      <${Icon} name="chevronRight" /><span>快结</span>
    </button>
  </div>`;
}
