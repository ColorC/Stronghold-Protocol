import { codedError } from './rng.js';
import { absoluteRunHour } from './temporary-enhancements.js';

const invalid=(message)=>{throw codedError('INVALID_TEMPORARY_MAX_LIFE',message);};
const allowed=new Set(['id','amount','expiresAtHour']);

function recordsFor(state){
  if(state?.temporaryMaxLife===undefined)return [];
  if(!Array.isArray(state.temporaryMaxLife))invalid('temporaryMaxLife must be an array');
  const ids=new Set();
  for(const record of state.temporaryMaxLife){
    if(!record||typeof record!=='object'||Array.isArray(record)||Object.keys(record).some(key=>!allowed.has(key))
      ||typeof record.id!=='string'||!record.id.trim()||ids.has(record.id)
      ||!Number.isSafeInteger(record.amount)||record.amount<=0
      ||!Number.isSafeInteger(record.expiresAtHour)||record.expiresAtHour<0)invalid('Invalid temporary max-life record');
    ids.add(record.id);
  }
  return state.temporaryMaxLife;
}

function validateMaxLifeState(state,allowExpired){
  if(!state||typeof state!=='object'||Array.isArray(state))invalid('Invalid run state');
  const hasBase=Object.hasOwn(state,'maxLifeBase'),hasRecords=Object.hasOwn(state,'temporaryMaxLife');
  if(!hasBase&&!hasRecords)return state;
  if(hasBase&&(!Number.isSafeInteger(state.maxLifeBase)||state.maxLifeBase<0))invalid('Invalid maxLifeBase');
  const records=recordsFor(state);
  if(hasRecords&&!hasBase)invalid('Temporary max-life records require maxLifeBase');
  if(!Number.isSafeInteger(state.maxLife)||state.maxLife<0)invalid('Invalid maxLife');
  const now=absoluteRunHour(state),base=hasBase?state.maxLifeBase:state.maxLife;
  let total=base;
  for(const record of records){if(!allowExpired&&record.expiresAtHour<=now)invalid('Expired temporary max-life record');total+=record.amount;if(!Number.isSafeInteger(total))invalid('Temporary max-life total exceeds safe integer range');}
  if(state.maxLife!==total)invalid('maxLife does not match its temporary records');
  if(state.life!==undefined&&(!Number.isSafeInteger(state.life)||state.life<0||state.life>state.maxLife))invalid('Invalid life for temporary max-life state');
  return state;
}

export function validateTemporaryMaxLife(state){return validateMaxLifeState(state,false);}

export function applyTemporaryMaxLife(state,record){
  validateTemporaryMaxLife(state);
  if(!record||typeof record!=='object'||Array.isArray(record)||Object.keys(record).some(key=>!allowed.has(key))
    ||typeof record.id!=='string'||!record.id.trim()||!Number.isSafeInteger(record.amount)||record.amount<=0
    ||!Number.isSafeInteger(record.expiresAtHour)||record.expiresAtHour<=absoluteRunHour(state))invalid('Invalid temporary max-life grant');
  const records=recordsFor(state),existing=records.find(entry=>entry.id===record.id);
  if(existing){if(existing.amount!==record.amount||existing.expiresAtHour!==record.expiresAtHour)invalid('Conflicting temporary max-life source id');return false;}
  const base=Object.hasOwn(state,'maxLifeBase')?state.maxLifeBase:state.maxLife;
  if(!Number.isSafeInteger(base)||base<0)invalid('Invalid permanent max-life base');
  let maxLife=base;for(const entry of [...records,record]){maxLife+=entry.amount;if(!Number.isSafeInteger(maxLife))invalid('Temporary max-life total exceeds safe integer range');}
  state.maxLifeBase=base;state.temporaryMaxLife=[...records,{id:record.id,amount:record.amount,expiresAtHour:record.expiresAtHour}];state.maxLife=maxLife;
  return true;
}

export function expireTemporaryMaxLife(state){
  validateMaxLifeState(state,true);
  if(!Object.hasOwn(state,'maxLifeBase')&&!Object.hasOwn(state,'temporaryMaxLife'))return state;
  const now=absoluteRunHour(state),records=recordsFor(state).filter(record=>record.expiresAtHour>now);
  let maxLife=state.maxLifeBase;for(const record of records){maxLife+=record.amount;if(!Number.isSafeInteger(maxLife))invalid('Temporary max-life total exceeds safe integer range');}
  state.temporaryMaxLife=records;state.maxLife=maxLife;
  if(Number.isSafeInteger(state.life))state.life=Math.min(state.life,maxLife);
  return state;
}
