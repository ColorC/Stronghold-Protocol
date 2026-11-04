// Native Git version of the preceding authored roster. No formal data is copied.
import {execFileSync} from 'node:child_process';
import {getCatalog} from '../../../server/modes/independent/catalog.js';
export function preWarbandCatalog(data) {return getCatalog(data,JSON.parse(execFileSync('git',['show','52a56ca8285bbf04faabe018cf0dd64d0570d823:data/independent-design.json'],{encoding:'utf8',maxBuffer:4e6})));}
