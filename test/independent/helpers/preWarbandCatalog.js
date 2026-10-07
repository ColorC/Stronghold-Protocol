import {getCatalog as current} from '../../../server/modes/independent/catalog.js';
import {preWarbandCatalog} from './preWarband.js';
export const getCatalog=(data,design)=>design?current(data,design):preWarbandCatalog(data);
