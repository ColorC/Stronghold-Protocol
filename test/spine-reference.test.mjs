import test from 'node:test';
import assert from 'node:assert/strict';
import {observe,motionBetween} from '../public/dev/spine-reference/semantic.js';
import {profiles,landmarks} from '../public/dev/spine-reference/profiles.js';
const fixture={bones:[{id:'a',matrix:[1,0,0,1,-5,20]},{id:'b',matrix:[1,0,0,1,7,21]}],slots:[],coordinateSystem:{cameraExcluded:true}};
const profile={id:'test',normalizer:10,bindings:{'leg.L.hip':{kind:'bone-local',bone:'a',local:[0,0]},'leg.R.hip':{kind:'bone-local',bone:'b',local:[0,0]},'head.center':{kind:'bone-local',bone:'a',local:[3,5]},pelvis:{kind:'blend',ids:['leg.L.hip','leg.R.hip'],weights:[.5,.5]}}};
test('all rigs expose the same semantic vocabulary, with explicit unknowns',()=>{
  const pose=observe(fixture,profile);
  assert.deepEqual(Object.keys(pose.landmarks).sort(),Object.keys(landmarks).sort());
  assert.equal(pose.landmarks['arm.L.palm'].position,null);
  assert.equal(pose.landmarks['arm.L.palm'].status,'unknown');
  assert.equal(pose.contacts['leg.L.sole'].state,'unknown');
});
test('a semantic landmark can be a point inside a block rather than its bone origin',()=>{
  const pose=observe(fixture,profile);
  assert.deepEqual(pose.landmarks['head.center'].position,[-2,25]);
  assert.deepEqual(pose.landmarks.pelvis.position,[1,20.5]);
  assert.deepEqual(pose.landmarks['head.center'].normalized,[-.3,.45]);
});
test('source names have no anatomical meaning when explicit bindings are transferred',()=>{
  const raw=structuredClone(fixture);raw.bones[0].id='unrelated_driver_984';
  const translated=structuredClone(profile);for(const b of Object.values(translated.bindings))if(b.bone==='a')b.bone='unrelated_driver_984';
  assert.deepEqual(observe(raw,translated).landmarks['head.center'].position,observe(fixture,profile).landmarks['head.center'].position);
});
test('crossing screen X preserves limb identity and motion queries',()=>{
  const after=structuredClone(fixture);after.bones[0].matrix[4]=50;after.bones[1].matrix[4]=-30;
  const a=observe(fixture,profile,{time:0}),b=observe(after,profile,{time:1});
  assert.equal(b.landmarks['leg.L.hip'].position[0],50);
  assert.equal(b.landmarks['leg.L.hip'].anatomicalSide,null);
  assert.deepEqual(motionBetween(a,b,'leg.L.hip').displacement,[55,0]);
});
test('unsupported forms and absent bones cannot produce plausible fake joints',()=>{
  const pose=observe({...fixture,slots:[{id:'F_Rb_Head',alpha:1,attachment:{points:[[1,1]]}}]},profiles['surtr-front']);
  assert.equal(pose.form,'unsupported-transformed');
  assert.ok(Object.values(pose.landmarks).every(p=>p.position===null));
  assert.equal(observe({bones:[],slots:[]},profile).landmarks['head.center'].position,null);
});
test('multiple active hand variants preserve ambiguity',()=>{
  const p={...profile,bindings:{...profile.bindings,'arm.L.wrist':{kind:'active-slot',candidates:[{slot:'hand1',bone:'a'},{slot:'hand2',bone:'b'}]}}};
  const raw={...fixture,slots:['hand1','hand2'].map(id=>({id,alpha:1,attachment:{points:[[1,2]]}}))};
  assert.equal(observe(raw,p).landmarks['arm.L.wrist'].position,null);
});
