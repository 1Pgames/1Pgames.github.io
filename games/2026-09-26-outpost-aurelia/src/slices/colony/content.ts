/**
 * Colony content aggregator: re-exports the frozen types (`data/types.ts`) and
 * every content table (`data/*.ts`) so model / threat / view / UI import one
 * path. Owned by ContentDev (W3); add a re-export when a new table lands.
 */
export * from './data/types';
export * from './data/goods';
export * from './data/buildings';
export * from './data/fauna';
export * from './data/swarms';
export * from './data/directives';
export * from './data/protocols';
export * from './data/kits';
export * from './data/orders';
export * from './data/sites';
export * from './data/ark';
export * from './data/relics';
