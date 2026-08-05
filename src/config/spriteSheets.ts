import type { CharacterId } from '../types';

/**
 * 캐릭터가 취할 수 있는 포즈.
 * BaseCharacter가 매 프레임 자신의 상태에서 이 값을 계산해 뷰에 넘긴다.
 */
export type Pose =
  | 'idle'
  | 'walk'
  | 'run'
  | 'jump'
  | 'attackJ'
  | 'attackK'
  | 'skill'
  | 'hit'
  | 'knockback'
  | 'guard'
  | 'dash'
  | 'win'
  | 'lose';

/**
 * 포즈 → 프레임 지정.
 *  - 숫자: 정지 프레임
 *  - 배열: 연속 재생 애니메이션
 */
export type PoseFrames = number | number[];

export interface SpriteSheetDef {
  /** public/sprites/<key>.png 와 <key>.json 을 읽는다 */
  key: string;
  /** 게임 내 표시 높이(px). 원본 프레임 크기가 캐릭터마다 달라도 이 값으로 통일된다 */
  displayHeight: number;
  /** 포즈별 프레임. 없는 포즈는 idle로 대체된다 */
  poses: Partial<Record<Pose, PoseFrames>>;
  /** 애니메이션 재생 속도 (fps) */
  frameRate?: number;
  /** 발끝 미세 보정 (양수 = 아래로) */
  footOffset?: number;
  /**
   * 원본 그림이 왼쪽을 보고 있으면 true.
   * (스티브 잡스 시트는 오른쪽을 보고 있어 false)
   */
  facesLeft?: boolean;
}

/**
 * 스프라이트 시트가 준비된 캐릭터만 등록한다.
 *
 * 새 캐릭터 추가 방법:
 *   1. art-source/<이름>_sheet.png 에 원본 시안을 넣는다
 *   2. node tools/process-sheet.mjs art-source/<이름>_sheet.png public/sprites/<key>.png
 *   3. 출력 로그의 프레임 순서를 보고 아래에 항목을 추가한다
 *
 * 등록하지 않은 캐릭터는 코드로 그린 도형 아트(CharacterArt)로 자동 대체된다.
 */
export const SPRITE_SHEETS: Partial<Record<CharacterId, SpriteSheetDef>> = {
  gates: {
    key: 'billgates',
    displayHeight: 116,
    frameRate: 9,
    poses: {
      idle: 0,
      walk: 1,
      run: [2, 3],
      jump: 4,
      attackJ: 5,
      attackK: 6,
      // 7 = 에너지볼 발사 자세. 8은 캐릭터가 아니라 투사체 단독 스프라이트라
      // 포즈가 아니라 skill.projectile.frame 으로 쓴다.
      skill: 7,
      hit: 9,
      knockback: 10,
      guard: 11,
      dash: 12,
      win: 13,
      lose: 14,
    },
  },

  jobs: {
    key: 'stevejobs',
    displayHeight: 116,
    frameRate: 9,
    poses: {
      idle: 0,
      walk: 1,
      // 원본에 RUN 포즈가 2장 있어 달리기 사이클로 쓴다
      run: [2, 3],
      jump: 4,
      attackJ: 5,
      attackK: 6,
      // SKILL_L → SKILL_L_2 순으로 이어 재생
      skill: [7, 8],
      hit: 9,
      knockback: 10,
      guard: 11,
      dash: 12,
      win: 13,
      lose: 14,
    },
  },
};

/** 로드해야 할 시트 목록 */
export const SHEET_DEFS: SpriteSheetDef[] = Object.values(SPRITE_SHEETS);

/** Phaser 애니메이션 키 규칙 */
export function animKey(sheetKey: string, pose: Pose): string {
  return `${sheetKey}-${pose}`;
}

/** 시트 메타데이터(JSON) 캐시 키 */
export function metaKey(sheetKey: string): string {
  return `${sheetKey}-meta`;
}

/** process-sheet.mjs 가 내보내는 메타데이터 형식 */
export interface SheetMeta {
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  count: number;
}
