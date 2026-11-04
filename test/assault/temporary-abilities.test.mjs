import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';

const root = new URL('../../', import.meta.url);
const patchPath = process.env.TEMPORARY_ABILITIES_PATCH;
const patchText = patchPath ? readFileSync(patchPath, 'utf8') : null;
function addedFile(path) {
  const marker = `+++ b/${path}\n`;
  const start = patchText?.indexOf(marker);
  if (start == null || start < 0) throw new Error(`candidate patch missing ${path}`);
  const hunk = patchText.slice(start + marker.length).match(/^@@[^\n]*\n/);
  if (!hunk) throw new Error(`candidate patch has no addition hunk for ${path}`);
  const bodyStart = start + marker.length + hunk[0].length, next = patchText.indexOf('\ndiff --git ', bodyStart);
  const body = patchText.slice(bodyStart, next < 0 ? undefined : next).split(/\r?\n/);
  return body.filter((line) => line.startsWith('+')).map((line) => line.slice(1)).join('\n');
}
function applyCandidateHunk(original, path) {
  const sections = patchText.split(/(?=^diff --git )/m).filter((section) => section.startsWith(`diff --git a/${path} b/${path}`));
  if (!sections.length) throw new Error(`candidate patch missing hunk ${path}`);
  for (const sectionText of sections) {
    const section = sectionText.split(/\r?\n/);
    let index = 0, found = false;
    while (index < section.length) {
      if (!section[index].startsWith('@@')) { index++; continue; }
      found = true;
      const oldLines = [], newLines = [];
      index++;
      while (index < section.length && !section[index].startsWith('@@') && !section[index].startsWith('diff --git ')) {
        const line = section[index++];
        if (line.startsWith(' ')) { oldLines.push(line.slice(1)); newLines.push(line.slice(1)); }
        else if (line.startsWith('-') && !line.startsWith('---')) oldLines.push(line.slice(1));
        else if (line.startsWith('+') && !line.startsWith('+++')) newLines.push(line.slice(1));
      }
      const before = oldLines.join('\n'), after = newLines.join('\n');
      if (!before || !original.includes(before)) throw new Error(`candidate hunk anchor drifted ${path}`);
      original = original.replace(before, after);
    }
    if (!found) throw new Error(`candidate hunk malformed ${path}`);
  }
  return original;
}
if (patchText) {
  const runtime = addedFile('server/sim/content/assault/temporary-abilities.js');
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === '../../server/sim/content/assault/temporary-abilities.js') {
        return { url: new URL(specifier, import.meta.url).href, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
    if (!url.startsWith('file:')) return nextLoad(url, context);
    const path = fileURLToPath(url).replaceAll('\\', '/');
    if (path.endsWith('/server/sim/content/assault/temporary-abilities.js')) {
      console.log(`TEMPORARY_ABILITIES_DRAFT_HOOK_MATCH runtime:${patchPath}`);
      return { format: 'module', source: runtime, shortCircuit: true };
    }
    if (path.endsWith('/server/sim/content/assault/cards/ranged-mid.js')) {
      const loaded = nextLoad(url, context);
      console.log(`TEMPORARY_ABILITIES_DRAFT_HOOK_MATCH ranged-mid:${patchPath}`);
      return { ...loaded, source: applyCandidateHunk(String(loaded.source), 'server/sim/content/assault/cards/ranged-mid.js'), shortCircuit: true };
    }
    if (path.endsWith('/server/sim/battle/status.js')) {
      const loaded = nextLoad(url, context);
      console.log(`TEMPORARY_ABILITIES_DRAFT_HOOK_MATCH status:${patchPath}`);
      return { ...loaded, source: applyCandidateHunk(String(loaded.source), 'server/sim/battle/status.js'), shortCircuit: true };
    }
    if (path.endsWith('/server/sim/damage.js')) {
      const loaded = nextLoad(url, context);
      console.log(`TEMPORARY_ABILITIES_DRAFT_HOOK_MATCH damage:${patchPath}`);
      return { ...loaded, source: applyCandidateHunk(String(loaded.source), 'server/sim/damage.js'), shortCircuit: true };
    }
    if (path.endsWith('/server/sim/content/assault/cards/assault.js')) {
      const loaded = nextLoad(url, context);
      console.log(`TEMPORARY_ABILITIES_DRAFT_HOOK_MATCH assault-card:${patchPath}`);
      return { ...loaded, source: applyCandidateHunk(String(loaded.source), 'server/sim/content/assault/cards/assault.js'), shortCircuit: true };
    }
    return nextLoad(url, context);
  } });
}

const [{ Battle }, { DataSource, getDefaultSource }, harness, dataModule, abilities, { installTemporaryAbilities }, rangedMid, upgradeModule, registry] = await Promise.all([
  import('../../server/sim/Battle.js'), import('../../server/sim/simdata.js'), import('../helpers/battleHarness.js'),
  import('../../server/modes/assault/data.js'), import('../../shared/assault/temporary-abilities.js'),
  import('../../server/sim/content/assault/temporary-abilities.js'), import('../../server/sim/content/assault/cards/ranged-mid.js'),
  import('../../server/sim/content/assault/upgrades.js'), import('../../server/sim/content/assault/cards/registry.js'),
]);
const { chessRec, enemyRec, flatRoutes, flatStage } = harness;
const catalog = dataModule.getAssaultData().runtime;
const clock = { day: 1, hour: 6 };
const record = (id, ability, amount, expiresAtHour = 20) => ({ id, ability, amount, expiresAtHour });

function fixture({ bonus = { damage: 20, heal: 5, regen: 3, shield: 11, poison: 7, burn: 12 }, secondBonus = {} } = {}) {
  const cards = [
    { uid: 'ability-host', charId: 'char_1045_svash2', star: 4, abilityBonuses: bonus },
    { uid: 'ability-peer', charId: 'char_1020_reed2', star: 4, abilityBonuses: secondBonus },
    { uid: 'ability-foreign', charId: 'char_1020_reed2', star: 4, ownerId: 'p2', abilityBonuses: {} },
  ];
  const chess = {};
  for (const card of cards) {
    const body = catalog.bodies[card.charId];
    const chessId = `chess:${card.uid}`;
    const row = chessRec({ id: chessId, charId: card.charId, profession: body.profession, stats: body.starStats[3].stats, rangeGrid: body.range });
    row.assaultPiece = card; row.assaultBody = body; chess[chessId] = row;
  }
  const targetRecord = enemyRec({ key: 'ability-target', hp: 100000, atk: 0, def: 0, res: 0, speed: 0 });
  const data = new DataSource({ chess, enemies: { [targetRecord.key]: targetRecord }, tokens: {} }, getDefaultSource());
  const prepared = { input: { pieces: cards, relicIds: [], skillRanks: {}, teamGrowth: {}, derivedBuffInputs: [] } };
  const battle = new Battle({ kind: 'normal', modeId: 'temporary-abilities-test', stage: flatStage(), routes: flatRoutes(), spawns: [], data,
    players: [{ playerId: 'p1', units: cards.slice(0, 2).map((card, index) => ({ uid: card.uid, chessId: `chess:${card.uid}`, row: 10, col: 4 + index })) },
      { playerId: 'p2', units: [{ uid: cards[2].uid, chessId: `chess:${cards[2].uid}`, row: 11, col: 4 }] }],
    flags: { dpInit: 999, dpPerSec: 0, dpMax: 999, startOpCooldown: 0 }, autoFinish: false, timeLimit: 30, quiet: true,
    logger: { warn() {}, error() {}, info() {}, log() {} } });
  battle.start();
  const units = Object.fromEntries(cards.map((card) => [card.uid, battle.allyUnits.find((unit) => unit.uid === card.uid)]));
  const target = battle.spawnEnemy(targetRecord.key, { routeIndex: 0, pos: [10, 8] });
  return { battle, prepared, cards, units, target };
}

test('temporary ability records validate, replay atomically, merge primary-first, and expire on the run clock', () => {
  const legacy = { uid: 'legacy' };
  assert.deepEqual(abilities.abilityBonuses(legacy), { damage: 0, heal: 0, regen: 0, shield: 0, poison: 0, burn: 0 });
  const piece = { uid: 'p', temporaryAbilityEnhancements: [record('old', 'damage', 2, 6)] };
  assert.equal(abilities.applyTemporaryAbilityEnhancement(piece, record('new', 'burn', 3, 10), clock), true);
  assert.equal(abilities.applyTemporaryAbilityEnhancement(piece, record('new', 'burn', 3, 10), clock), false);
  assert.throws(() => abilities.applyTemporaryAbilityEnhancement(piece, record('new', 'burn', 4, 10), clock), { code: 'INVALID_TEMPORARY_ABILITY' });
  const beforeBad = structuredClone(piece.temporaryAbilityEnhancements);
  assert.throws(() => abilities.applyTemporaryAbilityEnhancement(piece, { ...record('bad', 'damage', 1), extra: true }, clock), { code: 'INVALID_TEMPORARY_ABILITY' });
  assert.deepEqual(piece.temporaryAbilityEnhancements, beforeBad, 'invalid source application is atomic');
  assert.deepEqual(abilities.abilityBonuses(piece, clock), { damage: 2, heal: 0, regen: 0, shield: 0, poison: 0, burn: 3 });
  assert.deepEqual(abilities.mergeTemporaryAbilityEnhancements({ temporaryAbilityEnhancements: [record('a', 'heal', 1)] },
    { temporaryAbilityEnhancements: [record('b', 'shield', 2), record('a', 'heal', 1)] }).map((entry) => entry.id), ['a', 'b']);
  const state = { day: 1, hour: 6, pieces: [piece, legacy] };
  assert.equal(abilities.validateTemporaryAbilityRun(state), true);
  assert.equal(abilities.validateTemporaryAbilityRun({ pieces: [legacy] }), true, 'legacy records need no clock');
  assert.equal(abilities.expireTemporaryAbilityEnhancements({ pieces: [legacy] }), 0, 'legacy expiry is also clock-free');
  state.day = 2; state.hour = 6;
  assert.equal(abilities.expireTemporaryAbilityEnhancements(state), 2);
  assert.deepEqual(piece.temporaryAbilityEnhancements, []);
});

test('native hit, periodic, burn gauge, heal, raw regen, shield and owner isolation consume projected ability bonuses', () => {
  const f = fixture();
  assert.equal(installTemporaryAbilities(f.battle, f.prepared), true);
  assert.equal(installTemporaryAbilities(f.battle, f.prepared), false, 'WeakSet prevents duplicate hook registration');
  const { battle, units, target } = f, host = units['ability-host'], peer = units['ability-peer'], foreign = units['ability-foreign'];
  let before = target.hp;
  battle.dealDamage(host, target, { amount: 100, type: 'phys', canDodge: false });
  assert.equal(before - target.hp, 120, 'direct own damage gets the additive damage ability before native mitigation');
  const resistant = battle.spawnEnemy('ability-target', { pos: [11, 8], countInTotal: false });
  resistant.s.res = 50;
  const resistantHp = resistant.hp;
  battle.dealDamage(host, resistant, { amount: 100, type: 'arts', canDodge: false });
  assert.equal(resistantHp - resistant.hp, 60, 'damage bonus enters before native RES mitigation');
  const peerHp = resistant.hp;
  battle.dealDamage(peer, resistant, { amount: 100, type: 'arts', canDodge: false });
  assert.equal(peerHp - resistant.hp, 50, 'unmodified caster receives native RES only');
  const reflectedHp = target.hp;
  battle.dealDamage(host, target, { amount: 10, type: 'true', canDodge: false, isReflect: true, tags: ['reflect'] });
  assert.equal(reflectedHp - target.hp, 10, 'reflect is excluded from the direct damage ability');
  const sourcelessHp = target.hp;
  battle.dealDamage(null, target, { amount: 10, type: 'true', sourceless: true, canDodge: false, tags: ['environment'] });
  assert.equal(sourcelessHp - target.hp, 10, 'uncredited sourceless damage receives no direct bonus');
  before = target.hp;
  battle.dealDamage(host, target, { amount: 10, type: 'true', sourceless: true, canDodge: false, tags: ['dot', 'periodic', 'toxic:host'] });
  assert.equal(before - target.hp, 17, 'sourceless credited toxic tick receives poison only');
  before = target.hp;
  const gauge = target.elem.burn;
  battle.dealDamage(host, target, { amount: 10, type: 'arts', canDodge: false, tags: ['dot', 'periodic', 'fiery:host'] });
  assert.equal(before - target.hp, 22, 'fiery tick receives only the burn ability bonus in its native arts damage');
  assert.equal(target.elem.burn, gauge, 'fiery periodic arts damage does not create a burn gauge event');
  const gaugeBefore = target.elem.burn;
  battle.dealDamage(host, target, { amount: 10, type: 'element', element: 'burn', canDodge: false });
  assert.equal(target.elem.burn - gaugeBefore, 22, 'native burn elementHit amount receives the burn ability once');
  const ally = peer; ally.hp -= 100;
  host.s.healingDealtMul = 1.5; ally.s.healingTakenMul = 2;
  const hpBefore = ally.hp;
  battle.heal(host, ally, 20);
  assert.equal(ally.hp - hpBefore, 75, 'native healing and added ability heal both use source/target modifiers');
  host.s.healingDealtMul = 1; ally.s.healingTakenMul = 1;
  const regenBefore = ally.hp;
  battle.heal(host, ally, 20, { regen: true });
  assert.equal(ally.hp - regenBefore, 23, 'raw regen bonus is added before the unchanged regen multiplier bypass');
  ally.hp -= 100;
  const quarterRegenBefore = ally.hp;
  battle.heal(host, ally, 20, { regen: true, regenSeconds: 0.25 });
  assert.equal(ally.hp - quarterRegenBefore, 20.75, 'fractional producer intervals scale the regen bonus by elapsed seconds');
  const noHealTarget = units['ability-peer'];
  noHealTarget.s.flags.noHeal = true;
  const noHealBefore = noHealTarget.hp;
  battle.heal(host, noHealTarget, 20, { regen: true });
  assert.equal(noHealTarget.hp, noHealBefore, 'the pre-multiplier listener cannot bypass native noHeal eligibility');
  noHealTarget.s.flags.noHeal = false;
  const cancelledBefore = noHealTarget.hp;
  const cancel = (ctx) => { if (ctx.target === noHealTarget) ctx.amount = 0; };
  battle.on('healingAmount', cancel, { priority: 100, owner: battle });
  battle.heal(host, noHealTarget, 20, { regen: true });
  assert.equal(noHealTarget.hp, cancelledBefore, 'a later raw-heal cancellation is honored before healing');
  battle.off('healingAmount', cancel);
  noHealTarget.hp = 1;
  const lethalDuringHeal = (ctx) => {
    if (ctx.target === noHealTarget) battle.dealDamage(host, noHealTarget, { amount: 1000, type: 'true', canDodge: false });
  };
  battle.on('healingAmount', lethalDuringHeal, { priority: 100, owner: battle });
  assert.equal(battle.heal(host, noHealTarget, 20), 0, 'a target killed by a later raw-heal listener remains ineligible');
  assert.equal(noHealTarget.alive, false);
  assert.equal(noHealTarget.hp, 0, 'the post-listener validity guard prevents resurrecting a removed target');
  battle.off('healingAmount', lethalDuringHeal);
  const foreignBefore = foreign.hp; foreign.hp -= 100; const foreignHurt = foreign.hp;
  battle.heal(host, foreign, 20);
  assert.equal(foreign.hp - foreignHurt, 20, 'foreign owner receives no heal bonus');
  battle.addBuff(host, { key: 'ability-shield-fixture', shield: 10, duration: 10, source: host });
  assert.equal(host.findBuff('ability-shield-fixture').shield, 21, 'buffAdding adds numeric HP shield before native normalization');
  const hostHp = host.hp;
  battle.dealDamage(target, host, { amount: 15, type: 'true', canDodge: false });
  assert.equal(host.hp, hostHp, 'the increased shield is consumed by the native damage pipeline');
  assert.equal(host.findBuff('ability-shield-fixture').shield, 6);
  battle.addBuff(foreign, { key: 'foreign-shield-fixture', shield: 10, duration: 10, source: host });
  assert.equal(foreign.findBuff('foreign-shield-fixture').shield, 10, 'a source cannot enhance another owners shield');
  const foreignBurnBefore = target.elem.burn;
  battle.dealDamage(foreign, target, { amount: 10, type: 'element', element: 'burn', canDodge: false });
  assert.equal(target.elem.burn - foreignBurnBefore, 10, 'another owner receives only the native burn gauge amount');
  battle.addBuff(host, { key: 'ability-regen-fixture', mods: { hpRegen: 4 }, duration: 10, source: host });
  assert.equal(host.findBuff('ability-regen-fixture').mods.hpRegen, 4, 'buff normalization is not separately modified');
  assert.equal(host.s.hpRegen, 4, 'the bonus is applied at the actual native regen heal boundary');
  host.hp = host.s.maxHp - 30;
  const regenStart = host.hp, regenTime = battle.time;
  for (let ticks = 0; ticks < 100 && battle.time - regenTime < 1.2; ticks++) battle.step();
  assert.ok(host.hp - regenStart >= 7, `native timed HP regeneration applies base 4 plus raw regen bonus 3 (${host.hp - regenStart})`);
  battle.addBuff(host, { key: 'ability-ratio-regen-fixture', mods: { hpRegenRatio: 0.1 }, duration: 10, source: host });
  assert.equal(host.findBuff('ability-ratio-regen-fixture').mods.hpRegenRatio, 0.1);
  assert.equal(host.findBuff('ability-ratio-regen-fixture').mods.hpRegen, undefined, 'ratio remains native and ability bonus is applied once at healingAmount');
  battle.addBuff(host, { key: 'ability-zero-shield-fixture', shield: 0, duration: 10, source: host });
  assert.equal(host.findBuff('ability-zero-shield-fixture').shield, 0, 'zero shields are not converted into HP shields');
  before = target.hp;
  battle.dealDamage(peer, target, { amount: 100, type: 'phys', canDodge: false });
  assert.equal(before - target.hp, 100, 'another prepared operator without bonuses is isolated');
  assert.deepEqual(battle.errors, []);
});

test('expired helper projection grants no healing or regen bonus at the native pre-multiplier hook', () => {
  const state = { day: 1, hour: 6, pieces: [{ uid: 'expired', temporaryAbilityEnhancements: [record('past-heal', 'heal', 99, 10), record('past-regen', 'regen', 99, 10)] }] };
  const expiredBonus = abilities.abilityBonuses(state.pieces[0], { day: 2, hour: 6 });
  const f = fixture({ bonus: expiredBonus });
  installTemporaryAbilities(f.battle, f.prepared);
  const host = f.units['ability-host'];
  host.hp -= 100;
  const before = host.hp;
  f.battle.heal(host, host, 20);
  assert.equal(host.hp - before, 20);
  const regenBefore = host.hp;
  f.battle.heal(host, host, 20, { self: true, regen: true });
  assert.equal(host.hp - regenBefore, 20);
  assert.deepEqual(f.battle.errors, []);
});

test('buffAdding has no production-side effect without listeners and expired projected abilities are empty', () => {
  const f = fixture({ bonus: {} });
  const unit = f.units['ability-host'];
  f.battle.addBuff(unit, { key: 'no-hook-shield', shield: 10, duration: 10, source: unit });
  assert.equal(unit.findBuff('no-hook-shield').shield, 10);
  const expired = { uid: 'expired', temporaryAbilityEnhancements: [record('past', 'damage', 99, 6)] };
  assert.deepEqual(abilities.abilityBonuses(expired, { day: 2, hour: 6 }), { damage: 0, heal: 0, regen: 0, shield: 0, poison: 0, burn: 0 });
  assert.deepEqual(f.battle.errors, []);
});

test('real Cathy shield-device initial grant and native refill both receive only the owner projected shield bonus', () => {
  const build = ({ bonus, moduleId = null }) => {
    const charId = 'char_4162_cathy', uid = `cathy-${moduleId ?? 'base'}-${bonus ?? 0}`;
    const body = catalog.bodies[charId];
    const piece = { uid, charId, star: 4, moduleChoices: moduleId ? { [charId]: moduleId } : {}, ...(bonus ? { abilityBonuses: { shield: bonus } } : {}) };
    const chess = chessRec({ id: `chess:${uid}`, charId, profession: body.profession, stats: body.starStats[3].stats, rangeGrid: body.range });
    chess.assaultPiece = piece; chess.assaultBody = body;
    const enemyRecData = enemyRec({ key: `${uid}:enemy`, hp: 100000, atk: 0, def: 0, res: 0, speed: 0 });
    const data = new DataSource({ chess: { [chess.chessId]: chess }, enemies: { [enemyRecData.key]: enemyRecData }, tokens: catalog.summons }, getDefaultSource());
    const battle = new Battle({ kind: 'normal', modeId: uid, stage: flatStage(), routes: flatRoutes(), spawns: [], data,
      players: [{ playerId: 'p1', units: [{ uid, chessId: chess.chessId, row: 10, col: 5 }] }],
      content: 'assault', assault: { kits: { ...rangedMid.rangedMidCards, ...rangedMid.rangedMidTokenKits }, strict: true },
      flags: { dpInit: 99, dpPerSec: 0, dpMax: 99, startOpCooldown: 0 }, autoFinish: false, timeLimit: 30, quiet: true,
      logger: { warn() {}, error() {}, info() {}, log() {} } });
    battle.start(); battle.step();
    const unit = battle.allyUnits.find((entry) => entry.uid === uid);
    const prepared = { input: { pieces: [piece] } };
    installTemporaryAbilities(battle, prepared);
    unit.skill.sp = unit.skill.spCost;
    assert.equal(unit.kit.skill.assaultCast({ battle, unit, piece, body, rank: 4, cause: null }), true);
    battle.assaultRuntime.flush();
    const token = battle.allyUnits.find((entry) => entry.kind === 'token' && entry.ownerUnit === unit
      && (entry.tokenId ?? entry.def?.tokenId ?? entry.defId) === 'token_10041_cathy_catsld');
    const shield = unit.buffs.find((entry) => entry.key === `token_10041_cathy_catsld:shield:${unit.uid}`);
    assert.ok(token && shield, 'native Cathy cast created her actual shield device/buff');
    return { battle, unit, token, shield };
  };
  for (const moduleId of [null, 'uniequip_002_cathy']) {
    const host = build({ bonus: 500, moduleId });
    const base = build({ bonus: 0, moduleId });
    const maxHp = host.unit.s.maxHp, moduleRate = moduleId ? 0.01 : 0;
    assert.equal(host.shield.shield - base.shield.shield, 500, 'initial addBuff applies the projected amount once');
    host.shield.shield = 0; base.shield.shield = 0;
    host.unit.lastHitAt = -Infinity; base.unit.lastHitAt = -Infinity;
    const limit = 150;
    for (let i = 0; i < limit && host.shield.shield === 0; i++) host.battle.step();
    for (let i = 0; i < limit && base.shield.shield === 0; i++) base.battle.step();
    assert.ok(host.shield.shield > 0 && base.shield.shield > 0, 'real token-owned timer performed a refill before bounded native ticks');
    assert.ok(Math.abs(host.shield.shield - (maxHp * (0.06 + moduleRate) + 500)) < 1e-6, 'refill increment receives the same bonus and module rate');
    assert.ok(Math.abs(base.shield.shield - base.unit.s.maxHp * (0.06 + moduleRate)) < 1e-6, 'without projected data, native refill stays at its original amount');
    assert.deepEqual(host.battle.errors, []); assert.deepEqual(base.battle.errors, []);
  }
});

test('native toxic and fiery upgrade producers consume their matching sourced ability bonuses', () => {
  const design = dataModule.loadAssaultDesign();
  const toxicId = design.system.enchantments.find((entry) => entry.battle?.kind === 'toxic').id;
  const fieryId = design.system.enchantments.find((entry) => entry.battle?.kind === 'fiery').id;
  const cards = [
    { uid: 'real-toxic-host', charId: 'char_1045_svash2', star: 4, enchantmentId: toxicId, abilityBonuses: { poison: 7 } },
    { uid: 'real-fiery-host', charId: 'char_1020_reed2', star: 4, enchantmentId: fieryId, abilityBonuses: { burn: 12 } },
  ];
  const chess = {};
  for (const piece of cards) {
    const body = catalog.bodies[piece.charId], chessId = `chess:${piece.uid}`;
    const row = chessRec({ id: chessId, charId: piece.charId, profession: body.profession, stats: body.starStats[3].stats, rangeGrid: body.range });
    row.assaultPiece = piece; row.assaultBody = body; chess[chessId] = row;
  }
  const targetRecord = enemyRec({ key: 'real-upgrade-dot', hp: 1000000, atk: 0, def: 0, res: 0, speed: 0 });
  const data = new DataSource({ chess, enemies: { [targetRecord.key]: targetRecord }, tokens: {} }, getDefaultSource());
  const prepared = { input: { pieces: cards, relicIds: [], skillRanks: {}, teamGrowth: {}, derivedBuffInputs: [] } };
  const battle = new Battle({ kind: 'normal', modeId: 'real-temporary-abilities-upgrade-test', stage: flatStage(), routes: flatRoutes(), spawns: [], data,
    players: [{ playerId: 'p1', units: cards.map((piece, index) => ({ uid: piece.uid, chessId: `chess:${piece.uid}`, row: 10, col: 4 + index })) }],
    content: 'assault', assault: { kits: registry.assaultKits, strict: true,
      install: (current) => { upgradeModule.installUpgrades(current, prepared, { design }); installTemporaryAbilities(current, prepared); } },
    flags: { dpInit: 999, dpPerSec: 0, dpMax: 999, startOpCooldown: 0 }, autoFinish: false, timeLimit: 30, quiet: true,
    logger: { warn() {}, error() {}, info() {}, log() {} } });
  battle.start();
  const toxic = battle.allyUnits.find((unit) => unit.uid === 'real-toxic-host');
  const fiery = battle.allyUnits.find((unit) => unit.uid === 'real-fiery-host');
  const target = battle.spawnEnemy(targetRecord.key, { routeIndex: 0, pos: [10, 8], countInTotal: false });
  const toxicTicks = [], fieryTicks = [];
  battle.on('hit', (event) => {
    const tags = event.dmg?.tags ?? [];
    if (event.source === fiery && tags.includes('dot') && tags.includes('periodic') && tags.includes(`fiery:${fiery.uid}:${target.uid}`)) fieryTicks.push(event.dmg.amount);
  });
  battle.on('damaged', (event) => {
    if (event.target !== target) return;
    const tags = event.dmg?.tags ?? [];
    if (tags.includes('dot') && tags.includes('periodic') && tags.includes(`toxic:${toxic.uid}:${target.uid}`)) toxicTicks.push(event.amount);
  });
  for (const unit of [toxic, fiery]) {
    unit.skill.setSpTotal(unit.skill.spCost);
    assert.equal(battle.assaultRuntime.cast(unit, { force: true }), true, `real ${pieceForUid(unit.uid).enchantmentId} fixed-skill producer casts`);
  }
  battle.assaultRuntime.flush();
  function pieceForUid(uid) { return cards.find((piece) => piece.uid === uid); }
  assert.ok(target.buffs.some((buff) => buff.data?.assaultUpgradeHost === toxic.uid));
  assert.ok(target.buffs.some((buff) => buff.data?.assaultUpgradeHost === fiery.uid));
  const burnBefore = target.elem.burn;
  for (let ticks = 0; ticks < 160 && battle.time < 4.8; ticks++) battle.step();
  const toxicBase = design.system.enchantments.find((entry) => entry.id === toxicId).battle.valuesByStar[3];
  const fieryBase = design.system.enchantments.find((entry) => entry.id === fieryId).battle.valuesByStar[3];
  assert.ok(toxicTicks.length > 0 && toxicTicks.every((amount) => amount === toxicBase + 7), 'real toxic DoT retains native true damage and adds poison only');
  assert.ok(fieryTicks.length > 0 && fieryTicks.every((amount) => amount === fieryBase + 12),
    `real fiery DoT receives its burn ability bonus once in the same native arts hit: expected=${fieryBase + 12} actual=${JSON.stringify(fieryTicks)}`);
  assert.equal(target.elem.burn, burnBefore, 'fiery periodic arts damage does not create a burn gauge event');
  assert.deepEqual(battle.errors, []);
});
