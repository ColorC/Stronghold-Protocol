// Current-season pact overrides. The frozen generated catalog remains the v1 source.
export const CURRENT_PACT_VERSION = 2;

export const currentPactEvidence = Object.freeze({
  higashi: Object.freeze({
    nativeCommit: '4ed1ad32ec10da15c23f9d7939dade603950759b',
    sourcePath: 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native/chess.json',
    nativeStealth: { recordId: 'chess_char_4_04_a', jsonPointer: '/chess_char_4_04_a/skills/1', sourceEffectText: '攻击范围扩大，攻击力+60%，自身获得隐匿；技能结束或离场时结束。' },
    nativeDodge: { recordId: 'chess_char_2_13_a', jsonPointer: '/chess_char_2_13_a/skills/1', sourceEffectText: '受到攻击后触发，并闪避本次物理或法术伤害。' },
    nativeDeployAttack: { recordId: 'chess_char_4_04_a', jsonPointer: '/chess_char_4_04_a/skills/2', sourceEffectText: '重新部署后对穿过的最多4名敌人造成相当于攻击力110%的物理伤害。' },
    difference: '这些是具名本体技能候选，不证明东盟约复合机制原样继承；部署触发/限时和物理转真实伤害属于适配。',
  }),
  siracusa: Object.freeze({
    killToSp: Object.freeze({
      game: 'Teamfight Tactics', version: 'Set 18 Patch 18.4 / CommunityDragon publication 16.20.1', recordId: 'DA_FloraFatalis18',
      jsonPointer: '/supplement/publishedTraits/16', sourcePath: 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/docs/resonance/reference/tft-set18.json',
      sourceUrl: 'https://tftraits.com/api/display/traits?v=18-18.4.0.BF63CD5E.u09ac2d13s5&lang=en-us',
      sourceKind: 'TFTraits first-party publication; community game-data derivative',
      officialPatchContextUrl: 'https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-18-4/',
      sourceEffectText: 'Flora Fatalis champions harvest enemies on takedown, gaining 10 Mana; the 2-unit tier also heals the lowest-health ally.',
    }),
    nextAttack: Object.freeze({
      game: 'Teamfight Tactics', version: 'Patch 11.15', recordId: 'Victorious',
      sourceUrl: 'https://teamfighttactics.leagueoflegends.com/en-gb/news/game-updates/teamfight-tactics-patch-11-15-notes/',
      sourceEffectText: '击倒后，下一次攻击根据目标已损失生命值造成额外魔法伤害。',
    }),
  }),
  ammo: Object.freeze({
    game: '卫戍协议原生本体', version: '4ed1ad32ec10da15c23f9d7939dade603950759b',
    recordId: 'chess_char_1_01_a', jsonPointer: '/chess_char_1_01_a/skills/1',
    nativeGit: '4ed1ad32ec10da15c23f9d7939dade603950759b:data/chess.json/chess_char_1_01_a/skills/1',
    sourceEffectText: '隐现S2为真实弹药技能，黑板 attack@trigger_time=14；协议提供的 AMMO 技能具备 addAmmo(n)，激活时增加当前载弹并更新载弹条上限。',
  }),
  redeploy: Object.freeze({
    nativeCommit: '4ed1ad32ec10da15c23f9d7939dade603950759b',
    sourcePath: 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data/resonance-native/chess.json',
    silverAsh: Object.freeze({
      recordId: 'chess_char_4_22_a', jsonPointer: '/chess_char_4_22_a/talents/0',
      nativeGit: '4ed1ad32ec10da15c23f9d7939dade603950759b:data/chess.json/chess_char_4_22_a/talents/0',
      sourceEffectText: '编入队伍时所有我方单位的再部署时间-10%。',
    }),
    skadi: Object.freeze({
      recordId: 'chess_char_3_05_a', jsonPointer: '/chess_char_3_05_a/talents/1',
      nativeGit: '4ed1ad32ec10da15c23f9d7939dade603950759b:data/chess.json/chess_char_3_05_a/talents/1',
      sourceEffectText: '自身再部署时间-10秒。',
    }),
    texas: Object.freeze({
      recordId: 'chess_char_4_16_a', skillId: 'skchr_texas2_3', jsonPointer: '/chess_char_4_16_a/skill',
      nativeGit: '4ed1ad32ec10da15c23f9d7939dade603950759b:data/chess.json/chess_char_4_16_a/skill',
      sourceEffectText: '部署后立即对周围所有敌人造成两次相当于攻击力115%的法术伤害并使目标晕眩1.5秒。',
    }),
    difference: '银灰与斯卡蒂只支持缩短计时器，生效范围/条件不同；德克萨斯支持部署触发范围伤害，不支持返场治疗或仅限返场。返场治疗仍无具名来源，当前数值是适配。',
  }),
});

export function applyCurrentPacts(catalog) {
  const pacts = { ...catalog.pacts };
  const replaceLevels = (id, transform) => {
    const pact = pacts[id];
    if (!pact) throw new Error(`CURRENT_PACT_MISSING:${id}`);
    pacts[id] = {
      ...pact,
      levels: pact.levels.map((level) => transform({
        ...level,
        effects: level.effects.map((effect) => ({ ...effect, params: { ...effect.params } })),
      })),
    };
  };

  replaceLevels('higashi', (level) => {
    for (const effect of level.effects) if (effect.kind === 'higashi_redeploy') {
      effect.params.returnSp = 0;
      effect.reference = currentPactEvidence.higashi;
    }
    const redeploy = level.effects.find((effect) => effect.kind === 'higashi_redeploy').params;
    level.description = `部署后获得${redeploy.stealthSeconds}秒隐匿与${redeploy.dodge}%闪避。${level.threshold >= redeploy.deployTrueDamageAt ? `部署攻击造成${redeploy.deployTrueDamage}%攻击力真实伤害。` : ''}`;
    return level;
  });

  replaceLevels('siracusa', (level) => {
    const legacy = level.effects.find((effect) => effect.kind === 'siracusa_execute');
    if (!legacy) throw new Error(`CURRENT_PACT_EFFECT_MISSING:siracusa:siracusa_execute:${level.threshold}`);
    const nextHit = legacy.params.nextHit;
    delete legacy.params.damageCycle;
    delete legacy.params.sp;
    delete legacy.params.nextHit;
    legacy.reference = { nativeEffectKept: 'low-health damage and eight-member wolf remain on the existing siracusa_execute handler.' };
    const byThreshold = { 2: 3, 4: 4, 6: 5, 8: 8 };
    level.effects.push({ kind: 'siracusa_harvest', params: {
      sp: byThreshold[level.threshold], nextHit: nextHit ?? ({ 2: 60, 4: 100, 6: 160, 8: 300 }[level.threshold]),
      nextHitOnce: true, nextHitBasicAttackOnly: true, noStack: true, nonRecursive: true,
    }, reference: currentPactEvidence.siracusa });
    level.description = `敌人生命低于${legacy.params.executeBelow}%时伤害提高${legacy.params.executeBonus}%；成员击倒敌人时本人恢复${byThreshold[level.threshold]}技力，并强化本人下一次普通攻击一次，追加${level.effects.at(-1).params.nextHit}%攻击力物理伤害。${level.threshold >= legacy.params.wolfAt ? `每${legacy.params.wolfInterval}秒，狼影对最近敌人造成最高成员攻击力${legacy.params.wolfDamage}%的伤害。` : ''}`;
    return level;
  });

  replaceLevels('ammo', (level) => {
    const effect = level.effects.find((row) => row.kind === 'ammo_last_round');
    if (!effect) throw new Error(`CURRENT_PACT_EFFECT_MISSING:ammo:ammo_last_round:${level.threshold}`);
    effect.params.refundSp = 0;
    effect.params.refundChance = 0;
    effect.params.skillAmmo = ({ 2: 1, 4: 2, 6: 3 })[level.threshold];
    effect.reference = currentPactEvidence.ammo;
    level.description = `所有盟约成员的每次弹药技能载弹量增加${effect.params.skillAmmo}枚；技能最后一发追加${effect.params.lastDamage}%攻击力物理伤害。`;
    return level;
  });

  replaceLevels('necrosis', (level) => {
    const effect = level.effects.find((row) => row.kind === 'necrosis_burst');
    if (!effect) throw new Error(`CURRENT_PACT_EFFECT_MISSING:necrosis:necrosis_burst:${level.threshold}`);
    effect.params.firstBurstSp = 0;
    level.description = `凋亡损伤提高${effect.params.bonus}%；凋亡爆发目标每秒额外受到${effect.params.dps}%最高成员攻击力法术伤害，持续${effect.params.duration}秒。`;
    return level;
  });

  replaceLevels('redeploy', (level) => {
    const effect = level.effects.find((row) => row.kind === 'redeploy_return');
    if (!effect) throw new Error(`CURRENT_PACT_EFFECT_MISSING:redeploy:redeploy_return:${level.threshold}`);
    effect.params.returnLimit = 1;
    effect.params.heal = 0;
    effect.reference = currentPactEvidence.redeploy;
    const shorter = Math.round((1 - effect.params.timeMultiplier) * 100);
    level.description = `再部署时间缩短${shorter}%；每名成员本场首次返场对范围内敌人造成${effect.params.damage}%攻击力法术伤害。`;
    return level;
  });

  const playerText = { ...catalog.playerText, pacts: { ...catalog.playerText.pacts } };
  playerText.pacts.higashi = { levels: pacts.higashi.levels.map((level) => ({ threshold: level.threshold, description: level.description })) };
  playerText.pacts.siracusa = { levels: pacts.siracusa.levels.map((level) => ({ threshold: level.threshold, description: level.description })) };
  playerText.pacts.ammo = { levels: pacts.ammo.levels.map((level) => ({ threshold: level.threshold, description: level.description })) };
  playerText.pacts.necrosis = { levels: pacts.necrosis.levels.map((level) => ({ threshold: level.threshold, description: level.description })) };
  playerText.pacts.redeploy = { levels: pacts.redeploy.levels.map((level) => ({ threshold: level.threshold, description: level.description })) };
  return { ...catalog, pacts, playerText };
}
