import { KITS, MODULES } from '../index.js';
import { createResonanceKits } from './kits.js';
import { installResonanceBattle } from './battle.js';
import { finishResonanceTerminalIfEscaped } from './battle.js';
import { installPrototypeBattleContent } from './prototype-installer.js';

export function resonanceSpecExtras(flags, rawData) {
  const snapshot = flags?.resonance;
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.catalog || !snapshot.state) return null;
  const kits = { ...KITS, ...createResonanceKits(snapshot.catalog, snapshot.state, rawData) };
  const install = (battle) => {
    for (const name of ['tokens', 'devices', 'enemies', 'bosses']) {
      const module = MODULES.find(([key]) => key === name)?.[1];
      if (typeof module?.install !== 'function') throw new Error(`MISSING_NATIVE_CONTENT_INSTALLER:${name}`);
      module.install(battle);
    }
    battle.resonanceOutcome = { won: false };
    battle.on('battleEnd', ({ result }) => {
      battle.resonanceOutcome.won = result?.reason === 'cleared';
    }, { owner: battle, priority: 1000 });
    battle.on('tick', () => finishResonanceTerminalIfEscaped(battle, snapshot.nodeKind), { owner: battle, priority: 1000 });
    installResonanceBattle(battle, { catalog: snapshot.catalog, state: snapshot.state });
    installPrototypeBattleContent(battle,snapshot.state,snapshot.catalog);
  };
  return { kits, install };
}
