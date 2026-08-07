import Phaser from 'phaser';
import type { ItemId } from './items';

/**
 * 외부 아트 매니페스트 — 배경 · 타이틀 · UI.
 *
 * ── 왜 "선택적" 인가 ──────────────────────────────────────────────
 * 이 게임은 그림 한 장 없이도 끝까지 돌아간다. 배경·아이템·오브는 전부
 * 코드로 그려져 있고, 외부 그림은 그 위에 **덮어쓰는** 것뿐이다.
 * 그래서 파일이 하나도 없어도, 다섯 장 중 두 장만 있어도 게임은 똑같이 돈다.
 *
 * 이 원칙이 중요한 이유: 생성형 아트는 한 번에 다 나오지 않는다.
 * 배경 한 장 뽑고 돌려보고, 마음에 안 들면 다시 뽑는다. 그 사이에도
 * 게임이 멈추지 않아야 작업이 이어진다.
 *
 * ── 넣는 법 ────────────────────────────────────────────────────────
 * art-source/prompts/scenes/ 의 프롬프트로 그림을 만들어
 * 아래 path 그대로 public/ 아래에 저장하면 다음 새로고침부터 적용된다.
 * (tools/gen-prompts.mjs 가 만드는 README에 같은 표가 들어 있다)
 */

/** 통째로 한 장인 그림 */
export interface ArtImage {
  key: string;
  /** public/ 기준 경로 */
  path: string;
  /**
   * 투명 배경이어야 하는 그림인가.
   * 생성기가 투명을 못 만들면 마젠타(#FF00FF)로 대신 받기로 했으므로,
   * 이 표시가 붙은 그림만 마젠타 제거를 시도한다.
   */
  chroma?: boolean;
}

/** 가로로 N칸이 이어 붙은 띠 그림 */
export interface ArtStrip extends ArtImage {
  cells: number;
}

/* ------------------------------------------------------------------ */
/* 목록                                                                */
/* ------------------------------------------------------------------ */

export const ART_IMAGES: ArtImage[] = [
  { key: 'stage_exchange', path: 'bg/stage_exchange.png' },
  { key: 'stage_moon', path: 'bg/stage_moon.png' },
  { key: 'stage_lava', path: 'bg/stage_lava.png' },
  { key: 'stage_storm', path: 'bg/stage_storm.png' },
  { key: 'stage_blackout', path: 'bg/stage_blackout.png' },
  { key: 'ui_title_bg', path: 'ui/ui_title_bg.png' },
  { key: 'ui_title_logo', path: 'ui/ui_title_logo.png', chroma: true },
  { key: 'ui_select_bg', path: 'ui/ui_select_bg.png' },
  { key: 'ui_result_bg', path: 'ui/ui_result_bg.png' },
];

export const ART_STRIPS: ArtStrip[] = [
  { key: 'ui_item_icons', path: 'ui/ui_item_icons.png', cells: 6, chroma: true },
  { key: 'ui_prompt_orb', path: 'ui/ui_prompt_orb.png', cells: 4, chroma: true },
];

/** 기본 스테이지 배경 */
export const DEFAULT_STAGE_ART = 'stage_exchange';

/**
 * 맵 기믹 → 배경.
 *
 * "달로 보내줘" 라고 썼는데 화면이 그대로면 말과 그림이 따로 논다.
 * 기믹이 걸린 동안만 배경을 갈아 끼우고, 끝나면 원래대로 돌린다.
 * (발판 붕괴는 지형만 바뀌고 장소는 그대로라 전용 배경이 없다)
 */
export const GIMMICK_STAGE_ART: Record<string, string> = {
  map_moon: 'stage_moon',
  map_lava: 'stage_lava',
  map_storm: 'stage_storm',
  map_blackout: 'stage_blackout',
};

/** 아이템 아이콘 띠의 칸 순서 — 프롬프트에 적어 둔 순서와 같아야 한다 */
export const ITEM_ICON_FRAME: Record<ItemId, number> = {
  buyback: 0,
  stockOption: 1,
  algoTrading: 2,
  circuitBreaker: 3,
  leverage: 4,
  bomb: 5,
};

/** 프롬프트 오브 띠 — 앞 3칸은 남은 체력, 마지막 칸은 깨지는 순간 */
export const ORB_FRAME = { INTACT: 0, CRACKED: 1, CRITICAL: 2, BURST: 3 } as const;

/* ------------------------------------------------------------------ */
/* 로딩                                                                */
/* ------------------------------------------------------------------ */

/** 있는지 확인된 그림만 로더에 건다 */
export function queueOptionalArt(
  load: Phaser.Loader.LoaderPlugin,
  available: ArtImage[],
): void {
  for (const a of available) load.image(a.key, a.path);
}

/**
 * 이 경로에 그림이 실제로 있는가.
 *
 * 상태 코드만 봐서는 안 된다 — 개발 서버는 없는 경로에도 index.html을
 * 200으로 돌려주기 때문에, 내용 종류가 이미지인지까지 확인해야 한다.
 */
async function imageExists(path: string): Promise<boolean> {
  try {
    const res = await fetch(new URL(path, document.baseURI), { method: 'HEAD' });
    const type = res.headers.get('content-type') ?? '';
    return res.ok && type.startsWith('image/');
  } catch {
    return false;
  }
}

/**
 * 쓸 수 있는 그림 경로를 고른다. 하나도 없으면 null.
 *
 * **가벼운 쪽을 먼저 본다.** 생성기가 뱉는 PNG는 배경 한 장에 6MB라
 * 그대로 올리면 심사자의 브라우저에서 로딩만 수십 초가 걸린다.
 * `npm run art:opt` 이 같은 이름의 webp를 만들어 두므로 그쪽을 우선 쓰고,
 * 아직 안 줄인(=방금 폴더에 떨어뜨린) 그림은 PNG 그대로 집는다.
 *
 * 덕분에 "폴더에 넣기만 하면 붙는다"는 규칙은 그대로고,
 * 배포되는 무게만 줄어든다.
 */
/**
 * 이 경로에 JSON이 실제로 있는가.
 *
 * 시트 메타(<key>.json)를 확인하는 데 쓴다. 이미지와 마찬가지로 상태 코드만
 * 봐서는 안 된다 — 개발 서버는 없는 경로에도 index.html 을 200으로 준다.
 */
export async function jsonExists(path: string): Promise<boolean> {
  try {
    const res = await fetch(new URL(path, document.baseURI), { method: 'HEAD' });
    const type = res.headers.get('content-type') ?? '';
    return res.ok && type.includes('json');
  } catch {
    return false;
  }
}

export async function resolveArtPath(path: string): Promise<string | null> {
  const light = path.replace(/\.png$/i, '.webp');
  if (light !== path && (await imageExists(light))) return light;
  return (await imageExists(path)) ? path : null;
}

/**
 * 어떤 그림이 실제로 있는지 먼저 확인한다.
 *
 * 없는 파일을 그냥 로더에 걸어도 게임은 돌아가지만, Phaser가 실패할 때마다
 * console.error를 찍는다(File.js에 박혀 있어 끌 수 없다). 아직 안 그린 그림이
 * 열 장이면 콘솔이 빨갛게 차고, 진짜 오류가 그 사이에 묻힌다.
 */
export async function probeArt(list: ArtImage[]): Promise<ArtImage[]> {
  const found = await Promise.all(
    list.map(async (a) => {
      const path = await resolveArtPath(a.path);
      return path ? { ...a, path } : null;
    }),
  );
  return found.filter((a): a is ArtImage => a !== null);
}

/**
 * 로딩이 끝난 뒤 한 번 호출한다.
 * 마젠타 배경을 지우고, 띠 그림을 칸으로 자른다.
 */
export function prepareOptionalArt(scene: Phaser.Scene): void {
  for (const a of [...ART_IMAGES, ...ART_STRIPS]) {
    if (!scene.textures.exists(a.key)) continue;
    if (a.chroma) dropChromaKey(scene, a.key);
  }

  for (const s of ART_STRIPS) {
    if (!scene.textures.exists(s.key)) continue;
    sliceStrip(scene, s.key, s.cells);
  }
}

/** 이 그림이 준비돼 있는가 */
export function hasArt(scene: Phaser.Scene, key: string): boolean {
  return scene.textures.exists(key);
}

/**
 * 배경 그림을 화면에 꽉 채워 깐다. 그림이 없으면 null을 돌려준다.
 *
 * 비율은 유지한 채 **덮는** 쪽으로 맞춘다(cover). 늘려 맞추면(stretch)
 * 생성기가 16:9 대신 4:3으로 뱉었을 때 그림이 눈에 띄게 찌그러진다.
 */
export function addBackdrop(
  scene: Phaser.Scene,
  key: string,
  width: number,
  height: number,
): Phaser.GameObjects.Image | null {
  if (!scene.textures.exists(key)) return null;

  const img = scene.add.image(width / 2, height / 2, key).setOrigin(0.5);
  fitCover(img, width, height);
  return img;
}

/** 비율을 유지한 채 지정한 크기를 덮도록 확대한다 */
export function fitCover(
  img: Phaser.GameObjects.Image,
  width: number,
  height: number,
): void {
  const src = img.texture.getSourceImage();
  if (!src.width || !src.height) return;

  const scale = Math.max(width / src.width, height / src.height);
  img.setDisplaySize(src.width * scale, src.height * scale);
}

/* ------------------------------------------------------------------ */

/** 마젠타로 볼 색인가 (생성기마다 값이 조금씩 흔들려 여유를 둔다) */
function isChroma(r: number, g: number, b: number): boolean {
  return r > 180 && b > 180 && g < 90;
}

/**
 * 마젠타 배경을 투명으로 바꾼다.
 *
 * 프롬프트에 "투명 PNG, 안 되면 마젠타"라고 적어 뒀다. 실제로 많은 생성기가
 * 투명을 못 만들어 마젠타로 돌아오는데, 그때 게임 쪽에서 받아주지 않으면
 * 아이콘마다 분홍 사각형이 붙는다. 사람 손으로 지우게 하느니 여기서 지운다.
 *
 * 네 모서리를 먼저 찍어 보고 마젠타가 아니면 그냥 둔다 —
 * 이미 투명한 그림을 괜히 캔버스로 굽지 않기 위해서다.
 */
function dropChromaKey(scene: Phaser.Scene, key: string): void {
  const source = scene.textures.get(key).getSourceImage() as
    | HTMLImageElement
    | HTMLCanvasElement;
  const w = source.width;
  const h = source.height;
  if (!w || !h) return;

  const probe = scene.textures.createCanvas(`${key}__probe`, w, h);
  if (!probe) return;

  const ctx = probe.context;
  ctx.drawImage(source as CanvasImageSource, 0, 0);

  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, w, h);
  } catch {
    // 캔버스가 오염된 경우(교차 출처 이미지) — 그림은 그대로 쓴다
    scene.textures.remove(`${key}__probe`);
    return;
  }

  const px = data.data;
  const corners = [
    0,
    (w - 1) * 4,
    (w * (h - 1)) * 4,
    (w * h - 1) * 4,
  ];
  const looksChroma = corners.some((i) => isChroma(px[i]!, px[i + 1]!, px[i + 2]!));

  if (!looksChroma) {
    scene.textures.remove(`${key}__probe`);
    return;
  }

  for (let i = 0; i < px.length; i += 4) {
    if (isChroma(px[i]!, px[i + 1]!, px[i + 2]!)) px[i + 3] = 0;
  }
  ctx.putImageData(data, 0, 0);
  probe.refresh();

  // 원본을 지우고 투명 처리된 캔버스가 같은 이름을 물려받는다
  scene.textures.remove(key);
  scene.textures.renameTexture(`${key}__probe`, key);
}

/**
 * 가로로 이어 붙은 띠를 같은 폭으로 잘라 프레임을 만든다.
 *
 * 시트를 미리 잘라 넣지 않고 여기서 나누는 이유: 생성기가 뱉는 크기를
 * 미리 알 수 없다. 1024px로 오든 2048px로 오든 칸 수만 알면 나눌 수 있다.
 */
function sliceStrip(scene: Phaser.Scene, key: string, cells: number): void {
  const tex = scene.textures.get(key);
  const img = tex.getSourceImage();
  const cw = Math.floor(img.width / cells);
  const ch = img.height;
  if (cw < 2) return;

  for (let i = 0; i < cells; i++) {
    if (tex.has(String(i))) continue;
    tex.add(i, 0, i * cw, 0, cw, ch);
  }
}
