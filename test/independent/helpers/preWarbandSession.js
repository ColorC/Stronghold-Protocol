// Historical rules stay explicit while transactions use the live implementation.
import * as live from '../../../server/modes/independent/session.js';
import {preWarbandCatalog} from './preWarband.js';
const catalog=preWarbandCatalog();
export const createSession=(options={})=>live.createSession({catalog,...options});
export const applyAction=(state,action,options={})=>live.applyAction(state,action,{catalog,...options});
export const viewSession=(state,options={})=>live.viewSession(state,{catalog,...options});
export const validateSession=live.validateSession;
