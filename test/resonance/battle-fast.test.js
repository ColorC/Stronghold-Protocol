import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SP_DATA_DIR = 'E:/WindowsWorkspace/webworks/apps/stronghold-protocol/data';

const [{ getData }, { getResonanceCatalog }, { getResonanceField, buildResonanceBattle, runResonanceBattle, resonanceBattleWon }, { Battle }] = await Promise.all([
  import('../../server/data.js'),
  import('../../server/modes/resonance/catalog.js'),
  import('../../server/modes/resonance/battle.js'),
  import('../../server/sim/Battle.js'),
]);

test('a zero-loss leak still loses the battle; uncounted parts and defeated boss follow their own outcome',()=>{
  const result={reason:'cleared',perPlayer:{resonance:{leaked:[{counted:true,lpr:0}]}},bossHpLeft:100};
  assert.equal(resonanceBattleWon(result,'normal'),false);
  result.perPlayer.resonance.leaked[0].counted=false;
  assert.equal(resonanceBattleWon(result,'normal'),true);
  assert.equal(resonanceBattleWon(result,'boss'),false);
  result.bossHpLeft=0;
  assert.equal(resonanceBattleWon(result,'boss'),true);
  assert.equal(resonanceBattleWon(result,'boss',{capped:true}),false);
});

test('FUNNY logistics field preview resolves the next even battle while runner construction stays forbidden', () => {
  const data = getData();
  const catalog = getResonanceCatalog(data, { environmentId: 'origin_laterano', seed: 1818 });
  const state = {
    schemaVersion: 1, seed: 1818, revision: 0, round: 1, roundLimit: 28, difficulty: 'FUNNY',
    environmentId: 'origin_laterano', phase: 'prep', level: 3, xp: 0, gold: 5, hp: 100,
    winStreak: 0, lossStreak: 0, shop: { offers: [], locked: false }, inventory: [], strategies: [],
    poolRemaining: {}, nextUid: 2, history: [], pacts: [], pieces: [],
  };
  const field = getResonanceField(state, { data, catalog });
  assert.equal(field.battleRound, 1);
  assert.equal(field.waveRound, 1);
  assert.equal(field.nodeKind, 'normal');
  assert.ok(field.deployMap.size > 0, 'the field preview supports unit deployment during logistics preparation');
  assert.throws(() => buildResonanceBattle(state, { data, catalog }), /FUNNY_LOGISTICS_NODE_HAS_NO_BATTLE/);
  assert.throws(() => runResonanceBattle(state, { data, catalog }), /FUNNY_LOGISTICS_NODE_HAS_NO_BATTLE/);
});

test('same native operator at 1★ and 3★ keeps isolated star records and owned summon variants', () => {
  const data = getData();
  const catalog = getResonanceCatalog(data, { environmentId: 'origin_laterano', seed: 337 });
  const operator = Object.values(catalog.operators).find((entry) => entry.name === '赫默');
  assert.ok(operator, 'the frozen catalog includes Hemer');
  const state = {
    schemaVersion: 1, seed: 337, revision: 0, round: 1, roundLimit: 28, difficulty: 'NORMAL',
    environmentId: 'origin_laterano', phase: 'prep', level: 3, xp: 0, gold: 5, hp: 100,
    winStreak: 0, lossStreak: 0, shop: { offers: [], locked: false }, inventory: [], strategies: [],
    poolRemaining: {}, nextUid: 2, history: [], pacts: [],
    pieces: [
      { uid: 'hemer-owner-1', operatorId: operator.id, star: 1, equipment: [{ itemId: 'blade' }, { itemId: 'transfer_aegir' }], growth: { maxHp: 7 }, summonOrders: [], row: null, col: null, dir: 'RIGHT' },
      { uid: 'hemer-owner-3', operatorId: operator.id, star: 3, equipment: [], growth: {}, row: null, col: null, dir: 'RIGHT' },
    ],
  };
  const field = getResonanceField(state, { data, catalog });
  const legal = [...field.deployMap].slice(0, 2);
  assert.equal(legal.length, 2, 'source stage offers two legal owner tiles');
  state.pieces.forEach((piece, index) => {
    [piece.row, piece.col] = legal[index][0].split(',').map(Number);
  });
  const { battle } = buildResonanceBattle(state, { data, catalog, recording: false });
  const owners = state.pieces.map((piece) => battle.allyUnits.find((unit) => unit.uid === piece.uid));
  assert.equal(owners.length, 2);
  for (const [index, owner] of owners.entries()) {
    const piece = state.pieces[index];
    const starRecord = operator.stars[piece.star].record;
    assert.equal(owner.defId, `resonance_${operator.id}_star${piece.star}`);
    assert.equal(owner.def.raw.id, operator.id);
    assert.equal(owner.def.raw.resonanceOperatorId, operator.id);
    assert.equal(owner.def.raw.resonanceStar, piece.star);
    assert.equal(owner.base.maxHp, starRecord.stats.maxHp);
    assert.equal(owner.base.atk, starRecord.stats.atk);
    assert.equal(owner.base.def, starRecord.stats.def);
    assert.equal(owner.s.maxHp, starRecord.stats.maxHp + (index === 0 ? 7 : 0));
    assert.equal(owner.s.atk, starRecord.stats.atk + (index === 0 ? 15 : 0));
    assert.deepEqual(owner.def.skill.bb, starRecord.skill.bb);
  }
  const ownerInput = battle.players[0].input.units.find((unit) => unit.uid === 'hemer-owner-1');
  assert.deepEqual(ownerInput.items, ['blade', 'transfer_aegir']);
  assert.deepEqual(ownerInput.growth, { maxHp: 7 });
  const tokens = battle.allyUnits.filter((unit) => unit.kind === 'token' && unit.defId === 'token_10000_silent_healrb');
  assert.equal(tokens.length, 2, 'each fixed native skill has its own source token input');
  for (const token of tokens) {
    assert.equal(token.ownerUnit?.kind, 'op');
    assert.equal(token.uid, `resonance-summon-${token.ownerUnit.uid}-${token.defId}`);
    assert.ok(battle.resonanceSummonAnchors.some((anchor) => anchor.ownerUid === token.ownerUnit.uid && anchor.tokenId === token.defId));
    const starRecord = operator.stars[token.ownerUnit.def.raw.resonanceStar].record;
    const sourceStats = operator.source.normalChess.stats;
    const nativeTokenStats = data.tokens[token.defId].variants[operator.id].stats;
    assert.equal(token.base.maxHp, Math.round(nativeTokenStats.maxHp * starRecord.stats.maxHp / sourceStats.maxHp));
    assert.equal(token.base.atk, Math.round(nativeTokenStats.atk * starRecord.stats.atk / sourceStats.atk));
  }
  assert.ok(battle.resonanceSummonAnchorGaps.length === 0, 'native legal owner-range tile was found');
  battle.start();
  assert.ok(tokens.every((token) => token.alive), 'the original native tokens deploy onto the battle field');
  assert.ok(tokens.every((token) => owners.includes(token.ownerUnit)));
  assert.equal(owners[0].s.atk, operator.stars[1].record.stats.atk + 15, 'the real battle stat receives the equipped blade component');
  assert.ok(owners[0].mem.resonancePacts?.has('aegir'), 'the real battle installs the equipped pact transfer');
  assert.equal(battle.errorCount, 0);
});

test('recording:false runs the real Battle without frame, field, or event-recording calls', () => {
  const data = getData();
  const catalog = getResonanceCatalog(data, { environmentId: 'origin_laterano', seed: 8192 });
  const operatorId = catalog.config.starterIds[0];
  const operator = catalog.operators[operatorId];
  const state = {
    schemaVersion: 1, seed: 8192, revision: 0, round: 1, roundLimit: 28, difficulty: 'NORMAL',
    environmentId: 'origin_laterano', phase: 'prep', level: 3, xp: 0, gold: 5, hp: 100,
    winStreak: 0, lossStreak: 0, shop: { offers: [], locked: false }, inventory: [], strategies: [],
    poolRemaining: {}, nextUid: 2, history: [], pacts: [],
    pieces: [{ uid: 'resonance-unit-1', operatorId, star: 2, equipment: [], growth: {}, row: null, col: null, dir: 'RIGHT' }],
  };
  const field = getResonanceField(state, { data, catalog });
  const legal = [...field.deployMap].find(([, type]) => operator.position === 'MELEE' ? type === 'melee' : type === 'melee' || type === 'ranged');
  assert.ok(legal, 'source stage has a legal tile for starter');
  const [row, col] = legal[0].split(',').map(Number);
  state.pieces[0].row = row;
  state.pieces[0].col = col;
  const inputBefore = structuredClone(state);
  const original = { snapshot: Battle.prototype.snapshot, fieldMeta: Battle.prototype.fieldMeta, drainEvents: Battle.prototype.drainEvents };
  Battle.prototype.snapshot = function forbiddenSnapshot() { throw new Error('snapshot called during unrecorded battle'); };
  Battle.prototype.fieldMeta = function forbiddenFieldMeta() { throw new Error('fieldMeta called during unrecorded battle'); };
  Battle.prototype.drainEvents = function forbiddenDrainEvents() { throw new Error('drainEvents called during unrecorded battle'); };
  let outcome;
  try {
    outcome = runResonanceBattle(state, { data, catalog, recording: false });
  } finally {
    Battle.prototype.snapshot = original.snapshot;
    Battle.prototype.fieldMeta = original.fieldMeta;
    Battle.prototype.drainEvents = original.drainEvents;
  }
  assert.deepEqual(state, inputBefore, 'the battle bridge never mutates the session input');
  assert.ok(outcome.diagnostics.ticks > 0, 'real Battle.step ticks executed');
  assert.ok(outcome.result.total > 0, 'the native source wave spawned enemies');
  assert.equal(outcome.diagnostics.errorCount, 0);
  assert.ok(outcome.metrics && Number.isFinite(outcome.metrics.damage) && outcome.metrics.damage > 0, 'authoritative unit combat metrics record real damage');
  for (const key of ['ammoSpent', 'skills', 'control', 'constructAttacks', 'eliteKills']) assert.ok(Object.hasOwn(outcome.metrics, key));
  assert.ok(Array.isArray(outcome.growth));
  assert.equal(outcome.replay, null);
  assert.equal(outcome.won, outcome.result.reason === 'cleared' && outcome.hpLoss === 0);
});

test('all twenty five-cost star-three signatures trigger through canonical bridge battles and native AI', (t) => {
  const data = getData();
  const catalog = getResonanceCatalog(data, { environmentId: 'origin_laterano', seed: 2701 });
  const signatures = [
    ['新约能天使', 'holyGun'], ['圣聆初雪', 'signature_yela_single_target'], ['凛御银灰', 'signature_silverash_aura'],
    ['蕾缪安', 'signature_lemuen_splash'], ['乌尔比安', 'signature_ulpius_hit_growth'], ['隐德来希', 'signature_ines_fatal_save'],
    ['史尔特尔', 'signature_surtr_true_hit'], ['余', 'signature_yu_line'], ['维娜·维多利亚', 'signature_vina_sword'],
    ['缪尔赛思', 'signature_muelseye_clone_attack'], ['耀骑士临光', 'signature_nearl_sun'], ['荒芜拉普兰德', 'signature_lappland_repeat'],
    ['令', 'signature_ling_pulse'], ['黍', 'signature_shu_seed'], ['重岳', 'signature_chongyue_combo'],
    ['圣约送葬人', 'signature_executor_refund'], ['烛煌', 'signature_zhuhuang_wall'], ['塑心', 'signature_lingering_burst'],
    ['魔王', 'signature_crown_combo'], ['迷迭香', 'signature_rosmontis_aftershock'],
  ];
  const missing = [];
  const deepPlacement = new Set(['蕾缪安', '缪尔赛思', '令']);
  for (const [index, [name, trigger]] of signatures.entries()) {
    const operator = Object.values(catalog.operators).find((row) => row.name === name);
    assert.ok(operator, `catalog identity exists for ${name}`);
    assert.equal(operator.cost, 5, `${name} is the canonical five-cost operator`);
    const state = {
      schemaVersion: 1, seed: 400 + index, revision: 0, round: 26, roundLimit: 28, difficulty: 'NORMAL',
      environmentId: 'origin_laterano', phase: 'prep', level: 3, xp: 0, gold: 5, hp: 100,
      winStreak: 0, lossStreak: 0, shop: { offers: [], locked: false }, inventory: [], strategies: [],
      poolRemaining: {}, nextUid: 2, history: [], pacts: [],
      pieces: [{ uid: `signature-${index}`, operatorId: operator.id, star: 3, equipment: [], growth: {}, row: null, col: null, dir: 'RIGHT' }],
    };
    const field = getResonanceField(state, { data, catalog });
    const start = field.wave.routes.find((route) => route?.start)?.start ?? [9, 10];
    const legal = [...field.deployMap].filter(([, type]) => operator.position === 'MELEE' ? type === 'melee' : type === 'ranged' || type === 'melee')
      .sort(([a], [b]) => {
        const [ar, ac] = a.split(',').map(Number); const [br, bc] = b.split(',').map(Number);
        const da = Math.hypot(ar - start[0], ac - start[1]); const db = Math.hypot(br - start[0], bc - start[1]);
        return (deepPlacement.has(name) ? db - da : da - db) || a.localeCompare(b);
      });
    assert.ok(legal.length, `native stage has a legal tile for ${name}`);
    [state.pieces[0].row, state.pieces[0].col] = legal[0][0].split(',').map(Number);
    if (name === '黍') {
      const support = Object.values(catalog.operators).find((row) => row.name === '赫默');
      const [r, c] = [state.pieces[0].row, state.pieces[0].col];
      const supportTile = [...field.deployMap].filter(([, type]) => support.position === 'MELEE' ? type === 'melee' : type === 'ranged' || type === 'melee')
        .map(([key]) => [key, key.split(',').map(Number)])
        .filter(([key, [sr, sc]]) => key !== `${r},${c}` && Math.hypot(sr - r, sc - c) <= 2)
        .sort((a, b) => Math.hypot(a[1][0] - r, a[1][1] - c) - Math.hypot(b[1][0] - r, b[1][1] - c))[0];
      assert.ok(supportTile, 'Shu seed battle has a legal native support ally within S3 range');
      state.pieces.push({ uid: 'signature-shu-support', operatorId: support.id, star: 1, equipment: [], growth: {}, row: supportTile[1][0], col: supportTile[1][1], dir: 'RIGHT' });
    }
    const { battle, prepared } = buildResonanceBattle(state, { data, catalog, recording: false });
    const owner = battle.allyUnits.find((unit) => unit.uid === state.pieces[0].uid);
    assert.equal(owner?.skill?.id, operator.fixedSkillId, `${name} uses its configured source fixed skill`);
    const ownerElementHits=[],huangWallHits=[];let huangEdge=null,huangEndTime=Infinity;if(name==='塑心')battle.on('elementHit',event=>{if(event.source===owner&&event.dmg?.element==='apoptosis')ownerElementHits.push({amount:event.dmg.amount,cur:event.target.elem.apoptosis,hp:event.target.hp});});if(name==='烛煌'){battle.on('damaged',event=>{if(event.source===owner&&(event.dmg?.tags??[]).includes('zhuhuangWall'))huangWallHits.push(battle.time);});battle.on('skillEnd',event=>{if(event.unit===owner)huangEndTime=battle.time;});}
    for (const spawn of prepared.wave.spawns) spawn.mods = { ...(spawn.mods ?? {}), hpMul: (spawn.mods?.hpMul ?? 1) * (name==='塑心'?2000:20), atkMul: (spawn.mods?.atkMul ?? 1) * 0.1 };
    const enemyKey = prepared.wave.spawns.find((spawn) => spawn.count > 0)?.enemyKey;
    const spawnStillTargetable = ([r, c], atkMul = 0.1, hpMul = 100) => {
      if (!enemyKey || !battle.grid.walkable(r, c)) return null;
      return battle.spawnEnemy(enemyKey, { pos: [r, c], route: { motion: 'WALK', start: [r, c], end: [r, c], steps: [{ t: 'wait', s: 99999 }], checkpoints: [] }, mods: { hpMul, atkMul }, countInTotal: false });
    };
    if (name === '蕾缪安') {
      for (const [dr, dc] of [[0, 1], [-1, 1]]) spawnStillTargetable([owner.tileR + dr, owner.tileC + dc]);
    }
    if (name === '隐德来希') {
      spawnStillTargetable([owner.tileR, owner.tileC + 1], 100);
    }
    if (name === '烛煌') {
      const dr = owner.dir === 'UP' ? -1 : owner.dir === 'DOWN' ? 1 : 0;
      const dc = owner.dir === 'LEFT' ? -1 : owner.dir === 'RIGHT' ? 1 : 0;
      spawnStillTargetable([owner.tileR + dr * 2, owner.tileC + dc * 2]);
      const rect=battle.rect,edge=[];for(let c=rect.c0;c<=rect.c1;c++)if((dc===1?c>owner.tileC:dc===-1?c<owner.tileC:false)&&battle.grid.walkable(owner.tileR,c))edge.push([owner.tileR,c]);
      const edgeTile=edge.sort((a,z)=>dc===1?z[1]-a[1]:a[1]-z[1])[0];assert.ok(edgeTile,'native battle row has a legal tile along Zhuhuang’s full forward wall');
      huangEdge=spawnStillTargetable(edgeTile,.1,1000);assert.ok(huangEdge,'full-path boundary enemy deploys as a canonical native enemy');
    }
    if(name==='塑心')assert.ok(spawnStillTargetable([owner.tileR,owner.tileC+1],.1,1000),'a canonical high-HP source enemy stays in S1 range so real apoptosis damage can cross its gauge threshold');
    battle.start();
    if (name === '隐德来希') owner.hp = 1;
    const shuSupport = name === '黍' ? battle.allyUnits.find((unit) => unit.uid === 'signature-shu-support') : null;
    if (shuSupport) shuSupport.hp = shuSupport.s.maxHp * 0.5;
    for (let tick = 0; tick < 2400 && !battle.finished; tick++) battle.step();
    assert.ok(battle.resonanceMetrics.skills > 0, `${name} naturally activated its source skill in SkillRuntime`);
    assert.ok(battle.resonanceMetrics.damage > 0, `${name} fought canonical source-wave enemies through native AI`);
    assert.equal(battle.errorCount, 0, `${name} real Battle has no diagnostics`);
    const count = Number(battle.resonanceMetrics.triggers[trigger] ?? 0);
    t.diagnostic(`${name}: ${trigger}=${count}, attacks=${battle.resonanceMetrics.attacks ?? 0}, damage=${Math.round(battle.resonanceMetrics.damage)}`);
    if (count < 1) missing.push(`${name}:${trigger}`);
    if(name==='塑心')assert.ok(ownerElementHits.length>0,'the native S1 generated real apoptosis element-hit events before its natural burst');
    if(name==='令'){
      const advanced=battle.allyUnits.find(unit=>unit.kind==='token'&&unit.ownerUnit===owner&&unit.mem.resonanceLingAdvanced);
      assert.ok(battle.resonanceMetrics.triggers.signature_ling_merge>0,'the real bridge and native S3 cast deploy/fuse its canonical soul3 token');
      assert.ok(advanced&&advanced.defId==='token_10020_ling_soul3'&&advanced.profile.dmgType==='arts','Ling fusion preserves the native token id and enters its real advanced arts form');
      assert.equal(advanced.mem.resonanceLingDragon,true,'the star-three double growth is applied only to the advanced dragon');
      t.diagnostic(`令 fusion=${battle.resonanceMetrics.triggers.signature_ling_merge}, stock=${owner.mem.resonanceLingStock}, advanced=${advanced.form}`);
    }
    if(name==='烛煌'){assert.ok(huangEdge.hp<huangEdge.s.maxHp,'the skill-period wall damages an enemy at the forward battle boundary');assert.ok(huangWallHits.length>0,'wall damage comes from its explicit live effect hook');assert.ok(Number.isFinite(huangEndTime)&&!owner.skill.active,'the native ammo skill ends');assert.ok(huangWallHits.every(time=>time<=huangEndTime),'wall ticks stop by the native ammo skill end');}
  }
  assert.deepEqual(missing, [], `natural signature trigger evidence missing: ${missing.join(', ')}`);
});
