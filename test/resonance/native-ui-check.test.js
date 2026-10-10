import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { countsAsCreate, countsAsFight, costCardHasWholeSurfaceStyle, iconIsConcrete, iconMatchesExpected, intersects, parseArgs } from '../../tools/resonance/native-ui-check.mjs';

const script = fileURLToPath(new URL('../../tools/resonance/native-ui-check.mjs', import.meta.url));

test('argument validation is side-effect free and points sessions at the ephemeral verification directory', () => {
  const result = spawnSync(process.execPath, [script, '--validate-args'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  assert.equal(config.browserStarted, false);
  assert.equal(config.deadlineMs, 300000);
  assert.match(config.sessionDirectory.replaceAll('\\', '/'), /runtime\/resonance\/ui-verification\/sessions$/);
  assert.doesNotMatch(config.sessionDirectory.replaceAll('\\', '/'), /player-sessions$/);
  assert.deepEqual(Object.keys(config.screenshots), ['51-title', '52-difficulty', '53-prep', '54-gear', '55-mobile', '56-replay']);
});

test('fresh creation and battle counters match only their exact gameplay requests', () => {
  assert.equal(countsAsCreate('POST', '/resonance/api/sessions'), true);
  assert.equal(countsAsCreate('GET', '/resonance/api/sessions'), false);
  assert.equal(countsAsCreate('POST', '/resonance/api/sessions/abc/actions'), false);
  assert.equal(countsAsFight('POST', '/resonance/api/sessions/abc/actions', '{"type":"fight"}'), true);
  assert.equal(countsAsFight('POST', '/resonance/api/sessions/abc/actions', '{"expectedRevision":4,"action":{"type":"fight"}}'), true);
  assert.equal(countsAsFight('POST', '/resonance/api/sessions/abc/actions', '{"type":"buy","offerUid":"o1"}'), false);
  assert.equal(countsAsFight('POST', '/resonance/api/sessions/abc/actions', '{"expectedRevision":4,"action":{"type":"buy","offerUid":"o1"}}'), false);
});

test('layout overlap and concrete skill-icon guards detect real box collisions and placeholder IDs', () => {
  assert.equal(intersects({ left: 0, right: 10, top: 0, bottom: 10 }, { left: 9, right: 20, top: 4, bottom: 12 }), true);
  assert.equal(intersects({ left: 0, right: 10, top: 0, bottom: 10 }, { left: 10, right: 20, top: 0, bottom: 10 }), false);
  assert.equal(iconIsConcrete('skill_silverash_s3', '/assets/skill_silverash_s3.png'), true);
  assert.equal(iconIsConcrete('bolt', '/assets/bolt.svg'), false);
  assert.equal(iconIsConcrete('S', '/assets/s.svg'), false);
  assert.equal(iconMatchesExpected('skchr_texas_2', '/assets/skill/skchr_texas_2.png', '/assets/skill/skchr_texas_2.png'), true);
  assert.equal(iconMatchesExpected('skchr_texas_2', '/assets/skill/bolt.png', '/assets/skill/skchr_texas_2.png'), false);
  assert.equal(costCardHasWholeSurfaceStyle({ className:'scard scard--t2',background:'rgb(1, 2, 3)',bgImage:'radial-gradient(...)',bgCoversCard:true,border:'rgb(4, 5, 6)',tierClass:'tier tier--2',tierText:'' }),true);
  assert.equal(costCardHasWholeSurfaceStyle({ className:'scard scard--t2',background:'rgb(1, 2, 3)',bgImage:'radial-gradient(...)',bgCoversCard:true,border:'rgb(4, 5, 6)',tierClass:'tier tier--2 tier--color',tierText:'' }),false);
  assert.equal(costCardHasWholeSurfaceStyle({ className:'scard scard--t2',background:'rgb(1, 2, 3)',bgImage:'radial-gradient(...)',bgCoversCard:true,border:'rgb(4, 5, 6)',tierClass:'tier tier--2',tierText:'II' }),false);
});

test('unsafe flags and malformed session identifiers fail before launching a browser', () => {
  assert.throws(() => parseArgs(['--resume-session', '../outside']), /existing session id; no work started/);
  assert.throws(() => parseArgs(['--unknown']), /no work started/);
  assert.throws(() => parseArgs(['--resume-session', 'aaaaaaaa-1111', '--validate-args']), /cannot resume/);
});
