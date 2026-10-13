import test from 'node:test';
import assert from 'node:assert/strict';
import { CAMPAIGN_PLACEMENTS, runCampaign } from '../../tools/resonance/balance-campaign.mjs';

// how far a tile is from where the enemies enter: index along the route plus four per tile off it
const frontness = (row, routes) => Math.min(...routes.map((route) => Math.min(...route.points.map(([r, c], index) => index + 4 * (Math.abs(row.row - r) + Math.abs(row.col - c))))));

test('the careless-player control keeps the tempo picks but puts ranged operators at the front and turns everyone at random', () => {
  assert.deepEqual(CAMPAIGN_PLACEMENTS, ['planned', 'messy']);
  assert.throws(() => runCampaign({ rulesVersion: 3, seed: 1, difficulty: 'NORMAL', policy: 'tempo', placement: 'sloppy', maxBattles: 1 }), /unknown-campaign-placement:sloppy/);
  const planned = runCampaign({ rulesVersion: 3, seed: 1, difficulty: 'NORMAL', policy: 'tempo', maxBattles: 1 });
  const messy = runCampaign({ rulesVersion: 3, seed: 1, difficulty: 'NORMAL', policy: 'tempo', placement: 'messy', maxBattles: 1 });
  assert.equal(planned.placement, 'planned');
  assert.equal(messy.placement, 'messy');
  const [a] = planned.rows, [b] = messy.rows, routes = a.routeCoverage.routes;
  // the first fight comes before any result can change the economy: the same operators are deployed
  assert.deepEqual(b.roster.map((unit) => unit.uid).sort(), a.roster.map((unit) => unit.uid).sort());
  const ranged = (row) => row.roster.filter((unit) => unit.position !== 'MELEE');
  assert.ok(ranged(a).length >= 1);
  const front = (row) => ranged(row).reduce((sum, unit) => sum + frontness(unit, routes), 0);
  assert.ok(front(b) < front(a), `ranged operators stand nearer the entry (${front(b)} < ${front(a)})`);
  for (const unit of b.roster.filter((entry) => entry.position === 'MELEE')) {
    const before = a.roster.find((entry) => entry.uid === unit.uid);
    assert.deepEqual([unit.row, unit.col], [before.row, before.col], `${unit.name} keeps its blocking tile`);
  }
  assert.ok(b.roster.some((unit) => unit.dir !== a.roster.find((entry) => entry.uid === unit.uid).dir), 'facings are re-rolled');
  assert.equal(b.diagnostics, 0);
});
