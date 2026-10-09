import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPreviousMidTierAttempt } from '../../tools/resonance/mid-tier-terminal.mjs';

test('mid-tier history marks only committed 8-case/8-battle runs as committed evidence',()=>{
  const completed={helperWorkingTreeState:'committed-or-clean-at-current-codeRevision',cases:8,summary:{battles:8}};
  assert.deepEqual(classifyPreviousMidTierAttempt(completed),{
    attemptStatus:'committed-eight-case-superseded-by-this-validation',formalEightBattleRun:true,
  });
});

test('mid-tier history keeps uncommitted or incomplete prior runs preliminary',()=>{
  const cases=[
    {helperWorkingTreeState:'uncommitted:M tools/resonance/mid-tier-terminal.mjs',cases:8,summary:{battles:8}},
    {helperWorkingTreeState:'committed-or-clean-at-current-codeRevision',cases:8,summary:{battles:7}},
    {helperWorkingTreeState:'committed-or-clean-at-current-codeRevision',cases:7,summary:{battles:7}},
    {},
  ];
  for(const attempt of cases)assert.deepEqual(classifyPreviousMidTierAttempt(attempt),{
    attemptStatus:'preliminary-uncommitted-run-superseded-by-this-validation',formalEightBattleRun:false,
  });
});
