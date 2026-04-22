/**
 * Obstacle modules - centralized exports for all obstacle-related code
 */

// Spikes and spike fields
export {
  pickSpikeKind,
  makeSpike,
  canPlaceSpike,
  isInObstacleZone,
  pickSpikePattern,
  drawSpikes,
  drawSpikeFields,
} from "./spikes";
export type { SpikePattern } from "./spikes";

// Wheels (black holes)
export { drawWheels } from "./wheels";

// Nebula clouds
export { drawNebulas } from "./nebulas";

// Pulsars (rotating energy beams)
export { drawPulsars } from "./pulsars";

// Comets
export { updateComets, drawComets } from "./comets";

// Blocks
export { drawBlocks } from "./blocks";
