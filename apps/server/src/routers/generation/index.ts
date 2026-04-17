/**
 * Generation domain barrel — video + image + audio generation.
 *
 * The `generationRouter` handles unified video generation with smart routing.
 * The `imageRouter` handles image generation, editing, and character creation.
 * The `audioRouter` handles music and audio generation with smart routing.
 */
export { generationRouter } from './generation.routes';
export { imageRouter } from './image.routes';
export { audioRouter } from './audio.routes';
