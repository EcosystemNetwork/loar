/** Barrel export for the entities tRPC sub-router. */
export { entitiesRouter } from './entities.routes';
export type { EntitiesRouter } from './entities.routes';
export { ENTITY_KINDS, PRIMARY_KINDS, SECONDARY_KINDS, VALID_PARENTS } from './entities.types';
export type { Entity, EntityKind, CreateEntityInput, UpdateEntityInput } from './entities.types';
