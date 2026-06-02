import {
  getJibbleAnimationId,
  JIBBLE_ANIMATION,
  JIBBLE_DIRECTIONS,
  type JibbleDirectionCode,
} from "./jibble.ts";
import type {
  PlayerCharacter,
  TextureAtlas,
  TextureAtlasAnimation,
  TextureAtlasFrame,
} from "./types.ts";

const FRAME_SIZE = 32;
const COLUMNS = 8;

const WALK_FRAME_COUNT = 2;
const BACKFLIP_FRAME_COUNT = 4;

const DIRECTION_LABELS: Record<JibbleDirectionCode, string> = {
  n: "N",
  ne: "NE",
  e: "E",
  se: "SE",
  s: "S",
  sw: "SW",
  w: "W",
  nw: "NW",
};

const COLORS = [
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#ea580c",
  "#16a34a",
  "#0891b2",
  "#4f46e5",
  "#be123c",
];

const IDLE_FRAME_NAMES = JIBBLE_DIRECTIONS.map((direction) => `idle_${direction}`);
const WALK_FRAME_NAMES = JIBBLE_DIRECTIONS.flatMap((direction) =>
  Array.from({ length: WALK_FRAME_COUNT }, (_, index) => `walk_${direction}_${index}`),
);
const BACKFLIP_FRAME_NAMES = Array.from(
  { length: BACKFLIP_FRAME_COUNT },
  (_, index) => `backflip_${index}`,
);
const SAMPLE_FRAME_NAMES = [
  ...IDLE_FRAME_NAMES,
  ...WALK_FRAME_NAMES,
  ...BACKFLIP_FRAME_NAMES,
];

const IMAGE_WIDTH = COLUMNS * FRAME_SIZE;
const IMAGE_HEIGHT = Math.ceil(SAMPLE_FRAME_NAMES.length / COLUMNS) * FRAME_SIZE;

function getFrameRect(index: number): Omit<TextureAtlasFrame, "name"> {
  return {
    x: (index % COLUMNS) * FRAME_SIZE,
    y: Math.floor(index / COLUMNS) * FRAME_SIZE,
    width: FRAME_SIZE,
    height: FRAME_SIZE,
  };
}

function createFrame(name: string, index: number): TextureAtlasFrame {
  return {
    name,
    ...getFrameRect(index),
  };
}

function getFrameLabel(name: string): string {
  return name
    .replace(/^idle_/, "i ")
    .replace(/^walk_/, "w ")
    .replace(/^backflip_/, "flip ");
}

function createSvgDataUrl(): string {
  const cells = SAMPLE_FRAME_NAMES.map((name, index) => {
    const { x, y } = getFrameRect(index);
    const color = COLORS[index % COLORS.length];
    const label = getFrameLabel(name);
    return [
      `<rect x="${x}" y="${y}" width="${FRAME_SIZE}" height="${FRAME_SIZE}" fill="${color}"/>`,
      `<rect x="${x + 1}" y="${y + 1}" width="${FRAME_SIZE - 2}" height="${FRAME_SIZE - 2}" fill="none" stroke="#ffffff" stroke-opacity="0.35"/>`,
      `<circle cx="${x + 16}" cy="${y + 11}" r="5" fill="#ffffff" fill-opacity="0.92"/>`,
      `<rect x="${x + 12}" y="${y + 17}" width="8" height="7" rx="2" fill="#ffffff" fill-opacity="0.86"/>`,
      `<text x="${x + 16}" y="${y + 30}" text-anchor="middle" font-family="monospace" font-size="5" fill="#ffffff">${label}</text>`,
    ].join("");
  }).join("");

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" viewBox="0 0 ${IMAGE_WIDTH} ${IMAGE_HEIGHT}">`,
    `<rect width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" fill="#111827"/>`,
    cells,
    "</svg>",
  ].join("");

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function createDirectionalAnimation(
  animationId: string,
  role: string,
  direction: JibbleDirectionCode,
  frames: string[],
  frameRate: number,
): TextureAtlasAnimation {
  return {
    animationId,
    role,
    group: "jibble",
    direction,
    frameRate,
    frames,
    facingFrameMap: null,
  };
}

const SAMPLE_TEXTURE_ATLAS: TextureAtlas = {
  imageUrl: createSvgDataUrl(),
  imageWidth: IMAGE_WIDTH,
  imageHeight: IMAGE_HEIGHT,
  frames: SAMPLE_FRAME_NAMES.map(createFrame),
  animations: [
    ...JIBBLE_DIRECTIONS.map((direction) =>
      createDirectionalAnimation(
        getJibbleAnimationId("idle", direction),
        "idle",
        direction,
        [`idle_${direction}`],
        1,
      ),
    ),
    ...JIBBLE_DIRECTIONS.map((direction) =>
      createDirectionalAnimation(
        getJibbleAnimationId("walk", direction),
        "walk",
        direction,
        Array.from({ length: WALK_FRAME_COUNT }, (_, index) => `walk_${direction}_${index}`),
        8,
      ),
    ),
    {
      animationId: JIBBLE_ANIMATION.Backflip,
      role: "action",
      group: "jibble",
      direction: null,
      frameRate: 10,
      frames: BACKFLIP_FRAME_NAMES,
      facingFrameMap: null,
    },
  ],
};

function cloneTextureAtlas(atlas: TextureAtlas): TextureAtlas {
  return {
    ...atlas,
    frames: atlas.frames.map((frame) => ({ ...frame })),
    animations: atlas.animations.map((animation) => ({
      ...animation,
      frames: [...animation.frames],
      facingFrameMap: animation.facingFrameMap
        ? { ...animation.facingFrameMap }
        : null,
    })),
  };
}

export function getSampleTextureAtlas(): TextureAtlas {
  return cloneTextureAtlas(SAMPLE_TEXTURE_ATLAS);
}

export function getSamplePlayerCharacter(): PlayerCharacter {
  return {
    characterName: "SDK Sample Jibble",
    baseCharacterId: "sdk-sample-jibble",
    compositionCode: "sdk-sample-jibble-atlas-v1",
    textureAtlas: getSampleTextureAtlas(),
    editorTextureAtlas: getSampleTextureAtlas(),
  };
}
