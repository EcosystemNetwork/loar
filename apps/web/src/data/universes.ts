/**
 * Static Universe Seed Data
 *
 * Hard-coded demo universes used for the landing page and local-only mode.
 * Each universe contains a narrative hierarchy following the LOAR ontology:
 *   Universe → Timeline/Reality → Dimension/Plane → Realm → Domain
 *
 * These are NOT fetched from the blockchain — see useUniverseBlockchain for on-chain data.
 */

import type { EntityKind } from '../hooks/useEntities';

/** A single node in a narrative timeline graph. */
export interface TimelineNode {
  id: string;
  title: string;
  description: string;
  videoUrl: string;
  characters: string[];
  position: { x: number; y: number };
  connections: string[];
}

/** A linear or branching sequence of narrative nodes. */
export interface Timeline {
  id: string;
  name: string;
  description: string;
  nodes: TimelineNode[];
}

/** A narrative entity within the ontology hierarchy (Timeline, Reality, Dimension, etc.). */
export interface NarrativeEntity {
  id: string;
  name: string;
  description: string;
  kind: EntityKind;
  imageUrl?: string;
  parentId: string | null;
  nodeIds: string[];
  children?: NarrativeEntity[];
}

/** A complete narrative universe containing timelines and an entity hierarchy. */
export interface Universe {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  timelines: Timeline[];
  entities: NarrativeEntity[];
}

const WALRUS_BLOB =
  'https://aggregator.walrus-testnet.walrus.space/v1/blobs/lBt_Ua5p8I56LFOYgG_z8YiLf3IBVvBNRBlO_94giMI';

/** Pre-seeded demo universes for the landing page carousel. */
export const universes: Universe[] = [
  {
    id: 'cyberpunk-city',
    name: 'Cyberpunk City',
    description:
      'A neon-lit metropolis where technology and humanity collide in the shadows of corporate towers.',
    imageUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af2176?w=800&h=400&fit=crop',
    timelines: [
      {
        id: 'main-timeline',
        name: 'Main Timeline',
        description: 'The primary narrative path through Cyberpunk City',
        nodes: [
          {
            id: 'node-1',
            title: 'The Neon Awakening',
            description:
              'Our heroes discover the truth behind the corporate conspiracy in the heart of the city.',
            videoUrl: WALRUS_BLOB,
            characters: ['vera-ash', 'captain-somnus-blue'],
            position: { x: 100, y: 100 },
            connections: ['node-2', 'node-3'],
          },
          {
            id: 'node-2',
            title: 'Underground Alliance',
            description: "A secret meeting in the city's underground tunnels reveals new allies.",
            videoUrl: WALRUS_BLOB,
            characters: ['vera-ash'],
            position: { x: 200, y: 150 },
            connections: ['node-4'],
          },
          {
            id: 'node-3',
            title: 'Tower Infiltration',
            description: 'A daring mission to infiltrate the corporate headquarters.',
            videoUrl: WALRUS_BLOB,
            characters: ['captain-somnus-blue'],
            position: { x: 200, y: 50 },
            connections: ['node-4'],
          },
          {
            id: 'node-4',
            title: 'The Final Confrontation',
            description:
              'All paths converge for the ultimate showdown with the corporate overlords.',
            videoUrl: WALRUS_BLOB,
            characters: ['vera-ash', 'captain-somnus-blue'],
            position: { x: 300, y: 100 },
            connections: [],
          },
        ],
      },
      {
        id: 'alternate-timeline',
        name: 'Alternate Timeline',
        description: 'What if the heroes chose a different path?',
        nodes: [
          {
            id: 'alt-node-1',
            title: 'The Peaceful Resolution',
            description: 'Instead of fighting, our heroes choose negotiation.',
            videoUrl: WALRUS_BLOB,
            characters: ['vera-ash'],
            position: { x: 100, y: 100 },
            connections: ['alt-node-2'],
          },
          {
            id: 'alt-node-2',
            title: 'New World Order',
            description: 'The city transforms under a new cooperative government.',
            videoUrl: WALRUS_BLOB,
            characters: ['vera-ash', 'captain-somnus-blue'],
            position: { x: 200, y: 100 },
            connections: [],
          },
        ],
      },
    ],
    entities: [
      // Timelines
      {
        id: 'ent-main-timeline',
        name: 'Prime Timeline',
        description: 'The canonical corporate conspiracy storyline.',
        kind: 'timeline',
        parentId: null,
        nodeIds: ['node-1', 'node-2', 'node-3', 'node-4'],
      },
      {
        id: 'ent-alt-timeline',
        name: 'Peaceful Resolution',
        description: 'What if the heroes chose negotiation over violence?',
        kind: 'timeline',
        parentId: null,
        nodeIds: ['alt-node-1', 'alt-node-2'],
      },
      // Reality
      {
        id: 'ent-mirror-reality',
        name: 'Mirror City',
        description:
          'An alternate reality where the corporations won decades ago and the underground never formed.',
        kind: 'reality',
        parentId: 'ent-main-timeline',
        nodeIds: [],
      },
      // Realms under Prime Timeline
      {
        id: 'ent-neon-district',
        name: 'Neon District',
        description:
          'The glowing heart of the city — entertainment, nightlife, and black-market tech deals.',
        kind: 'realm',
        parentId: 'ent-main-timeline',
        nodeIds: ['node-1'],
      },
      {
        id: 'ent-undercity',
        name: 'The Undercity',
        description:
          'A sprawling network of tunnels and abandoned infrastructure beneath the towers.',
        kind: 'realm',
        parentId: 'ent-main-timeline',
        nodeIds: ['node-2'],
      },
      {
        id: 'ent-corporate-spire',
        name: 'Corporate Spire',
        description: 'The towering headquarters of MegaCorp, visible from every point in the city.',
        kind: 'realm',
        parentId: 'ent-main-timeline',
        nodeIds: ['node-3', 'node-4'],
      },
      // Domains
      {
        id: 'ent-house-neon',
        name: 'House Neon',
        description: 'The underground faction controlling the Neon District nightlife.',
        kind: 'domain',
        parentId: 'ent-neon-district',
        nodeIds: [],
      },
      {
        id: 'ent-megacorp',
        name: 'MegaCorp Territory',
        description: 'Corporate-controlled zones under 24/7 surveillance.',
        kind: 'domain',
        parentId: 'ent-corporate-spire',
        nodeIds: [],
      },
    ],
  },
  {
    id: 'magical-realm',
    name: 'Enchanted Realm',
    description: 'A mystical world of magic, ancient forests, and mythical creatures.',
    imageUrl: 'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=800&h=400&fit=crop',
    timelines: [
      {
        id: 'forest-timeline',
        name: 'Forest Quest',
        description: 'Journey through the enchanted forests',
        nodes: [
          {
            id: 'forest-1',
            title: 'The Ancient Grove',
            description: 'Discovery of the sacred trees and their guardians.',
            videoUrl: WALRUS_BLOB,
            characters: ['waddles-the-wise', 'sunny-halo'],
            position: { x: 100, y: 100 },
            connections: ['forest-2'],
          },
          {
            id: 'forest-2',
            title: 'The Crystal Cave',
            description:
              'Hidden deep in the forest, a cave of magical crystals holds the key to saving the realm.',
            videoUrl: WALRUS_BLOB,
            characters: ['waddles-the-wise', 'sunny-halo'],
            position: { x: 200, y: 100 },
            connections: [],
          },
        ],
      },
    ],
    entities: [
      // Timeline
      {
        id: 'ent-forest-quest',
        name: 'The Awakening',
        description: 'The primary quest through the enchanted forests.',
        kind: 'timeline',
        parentId: null,
        nodeIds: ['forest-1', 'forest-2'],
      },
      // Realms
      {
        id: 'ent-ancient-grove',
        name: 'The Ancient Grove',
        description: 'A sacred forest of sentient trees, older than recorded memory.',
        kind: 'realm',
        parentId: 'ent-forest-quest',
        nodeIds: ['forest-1'],
      },
      {
        id: 'ent-crystal-caverns',
        name: 'Crystal Caverns',
        description: 'Underground caves filled with resonating magical crystals.',
        kind: 'realm',
        parentId: 'ent-forest-quest',
        nodeIds: ['forest-2'],
      },
      // Planes
      {
        id: 'ent-dream-plane',
        name: 'The Dream Plane',
        description: 'A metaphysical layer where the forest speaks through visions and prophecy.',
        kind: 'plane',
        parentId: 'ent-forest-quest',
        nodeIds: [],
      },
      // Dimensions
      {
        id: 'ent-fae-dimension',
        name: 'The Fae Crossing',
        description:
          'A hidden dimension overlapping the forest, home to fae creatures and trickster spirits.',
        kind: 'dimension',
        parentId: 'ent-forest-quest',
        nodeIds: [],
      },
    ],
  },
  {
    id: 'space-odyssey',
    name: 'Galactic Odyssey',
    description: 'An epic journey across the stars, exploring alien worlds and cosmic mysteries.',
    imageUrl: 'https://images.unsplash.com/photo-1446776656089-4cfb1b8e5a3e?w=800&h=400&fit=crop',
    timelines: [
      {
        id: 'space-main',
        name: 'Main Mission',
        description: 'The primary space exploration mission',
        nodes: [
          {
            id: 'space-1',
            title: 'Launch Sequence',
            description: 'The crew prepares for their journey to the unknown reaches of space.',
            videoUrl: WALRUS_BLOB,
            characters: ['sunny-glare', 'sunny-halo'],
            position: { x: 100, y: 100 },
            connections: ['space-2', 'space-3'],
          },
          {
            id: 'space-2',
            title: 'First Contact',
            description: 'Encountering an alien civilization for the first time.',
            videoUrl: WALRUS_BLOB,
            characters: ['sunny-glare'],
            position: { x: 200, y: 50 },
            connections: ['space-4'],
          },
          {
            id: 'space-3',
            title: 'Asteroid Mining',
            description: 'A dangerous mission to harvest rare minerals from an asteroid field.',
            videoUrl: WALRUS_BLOB,
            characters: ['sunny-halo'],
            position: { x: 200, y: 150 },
            connections: ['space-4'],
          },
          {
            id: 'space-4',
            title: 'The Home Return',
            description: 'The crew returns to Earth with new knowledge and alien allies.',
            videoUrl: WALRUS_BLOB,
            characters: ['sunny-glare', 'sunny-halo'],
            position: { x: 300, y: 100 },
            connections: [],
          },
        ],
      },
    ],
    entities: [
      // Timelines
      {
        id: 'ent-main-mission',
        name: 'Genesis Mission',
        description: "Humanity's first deep-space exploration to the Kepler system.",
        kind: 'timeline',
        parentId: null,
        nodeIds: ['space-1', 'space-2', 'space-3', 'space-4'],
      },
      {
        id: 'ent-first-contact-timeline',
        name: 'First Contact Protocol',
        description: 'The diplomatic timeline that began when aliens answered.',
        kind: 'timeline',
        parentId: null,
        nodeIds: ['space-2'],
      },
      // Reality
      {
        id: 'ent-hostile-reality',
        name: 'Hostile Contact',
        description: 'An alternate reality where first contact went violently wrong.',
        kind: 'reality',
        parentId: 'ent-first-contact-timeline',
        nodeIds: [],
      },
      // Realms
      {
        id: 'ent-sol-system',
        name: 'Sol System',
        description: 'Earth and its orbital infrastructure — launch point for all missions.',
        kind: 'realm',
        parentId: 'ent-main-mission',
        nodeIds: ['space-1'],
      },
      {
        id: 'ent-kepler-reach',
        name: 'Kepler Reach',
        description: 'The alien star system where first contact occurs.',
        kind: 'realm',
        parentId: 'ent-main-mission',
        nodeIds: ['space-2', 'space-4'],
      },
      {
        id: 'ent-asteroid-belt',
        name: 'The Shattered Belt',
        description: 'A mineral-rich asteroid field between systems, lawless and dangerous.',
        kind: 'realm',
        parentId: 'ent-main-mission',
        nodeIds: ['space-3'],
      },
      // Dimension
      {
        id: 'ent-hyperspace',
        name: 'Hyperspace Corridor',
        description: 'The fold-space dimension used for faster-than-light travel between systems.',
        kind: 'dimension',
        parentId: 'ent-main-mission',
        nodeIds: [],
      },
      // Domains
      {
        id: 'ent-terran-authority',
        name: 'Terran Authority',
        description: "Earth's unified government controlling Sol System operations.",
        kind: 'domain',
        parentId: 'ent-sol-system',
        nodeIds: [],
      },
      {
        id: 'ent-kepler-alliance',
        name: 'Kepler Alliance',
        description: 'The alien-human diplomatic zone established after first contact.',
        kind: 'domain',
        parentId: 'ent-kepler-reach',
        nodeIds: [],
      },
    ],
  },
];
