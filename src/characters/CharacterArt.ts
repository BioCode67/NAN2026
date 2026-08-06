import Phaser from 'phaser';
import { FIGHTER } from '../config/gameConfig';
import { SPRITE_SHEETS, resolvePose } from '../config/spriteSheets';
import type { ArtConfig, CharacterConfig } from '../types';

/** 머리 중심 Y (컨테이너 로컬 좌표) */
const HEAD_CY = -FIGHTER.BODY_H / 2 + FIGHTER.HEAD_R;
/** 몸통 중심 Y */
const TORSO_CY = FIGHTER.BODY_H / 2 - FIGHTER.TORSO_R;
/** 얼굴 요소를 오른쪽으로 치우치게 해 바라보는 방향을 드러낸다 */
const FACE_DX = 4;
/** 눈 중심 Y */
const EYE_CY = HEAD_CY - 5;
/** 좌우 눈 간격 */
const EYE_GAP = 11;

/** 팔 기본 X 오프셋 */
export const ARM_X = 23;
/** 팔 Y */
const ARM_Y = TORSO_CY - 2;

/**
 * 조립된 SD 캐릭터 아트.
 * BaseCharacter가 이 조각들을 visual 컨테이너에 넣고 애니메이션시킨다.
 */
export interface FighterArt {
  /** visual 컨테이너에 넣을 표시 객체 (뒤 → 앞 순서로 정렬됨) */
  parts: Phaser.GameObjects.GameObject[];
  torso: Phaser.GameObjects.Arc;
  head: Phaser.GameObjects.Arc;
  /** 공격 시 앞으로 뻗는 팔 */
  armFront: Phaser.GameObjects.Arc;
  armBack: Phaser.GameObjects.Arc;
  legL: Phaser.GameObjects.Ellipse;
  legR: Phaser.GameObjects.Ellipse;
  /** 히트 플래시 시 흰색으로 바뀌는 조각들 */
  flashParts: Phaser.GameObjects.Shape[];
}

/**
 * 캐릭터 설정을 바탕으로 SD(대두) 파이터 아트를 생성한다.
 *
 * 외부 스프라이트 없이 Phaser 도형만으로 그리므로
 * 에셋 라이선스 문제가 없고 캐릭터 추가가 데이터 수정만으로 끝난다.
 */
export function buildFighterArt(
  scene: Phaser.Scene,
  cfg: CharacterConfig,
): FighterArt {
  const art = cfg.art;
  const skin = cfg.colors.head;
  const outline = 0x0a0e1a;

  const back: Phaser.GameObjects.GameObject[] = [];
  const front: Phaser.GameObjects.GameObject[] = [];
  const flashParts: Phaser.GameObjects.Shape[] = [];

  /* --- 다리 ------------------------------------------------------- */
  const legL = scene.add.ellipse(-10, FIGHTER.BODY_H / 2 - 5, 14, 15, shade(cfg.colors.body, -0.25));
  const legR = scene.add.ellipse(8, FIGHTER.BODY_H / 2 - 5, 14, 15, shade(cfg.colors.body, -0.25));
  [legL, legR].forEach((l) => l.setStrokeStyle(2.5, outline, 0.4));
  back.push(legL, legR);

  /* --- 뒤쪽 팔 --------------------------------------------------- */
  const armBack = scene.add.circle(-ARM_X, ARM_Y, 8.5, shade(cfg.colors.body, -0.3));
  armBack.setStrokeStyle(2.5, outline, 0.4);
  back.push(armBack);

  /* --- 몸통 ------------------------------------------------------- */
  const torso = scene.add.circle(0, TORSO_CY, FIGHTER.TORSO_R, cfg.colors.body);
  torso.setStrokeStyle(3, outline, 0.45);
  back.push(torso);
  flashParts.push(torso);

  /* --- 앞쪽 팔 (공격 시 뻗는다) ---------------------------------- */
  const armFront = scene.add.circle(ARM_X, ARM_Y, 9, cfg.colors.body);
  armFront.setStrokeStyle(2.5, outline, 0.4);
  back.push(armFront);
  flashParts.push(armFront);

  /* --- 머리 ------------------------------------------------------- */
  const head = scene.add.circle(0, HEAD_CY, FIGHTER.HEAD_R, skin);
  head.setStrokeStyle(3, outline, 0.45);
  front.push(head);
  flashParts.push(head);

  /* --- 머리카락 --------------------------------------------------- */
  front.push(...buildHair(scene, art, outline));

  /* --- 수염 ------------------------------------------------------- */
  if (art.beard) {
    const beard = scene.add.ellipse(FACE_DX, HEAD_CY + 17, 40, 22, art.beardColor);
    beard.setAlpha(0.95);
    front.push(beard);
  }

  /* --- 눈 --------------------------------------------------------- */
  front.push(...buildEyes(scene, art, outline));

  /* --- 안경 ------------------------------------------------------- */
  front.push(...buildGlasses(scene, art));

  /* --- 입 --------------------------------------------------------- */
  front.push(buildMouth(scene, art));

  return {
    parts: [...back, ...front],
    torso,
    head,
    armFront,
    armBack,
    legL,
    legR,
    flashParts,
  };
}

/* ================================================================== */
/* 부위별 생성                                                        */
/* ================================================================== */

function buildHair(
  scene: Phaser.Scene,
  art: ArtConfig,
  outline: number,
): Phaser.GameObjects.GameObject[] {
  const out: Phaser.GameObjects.GameObject[] = [];
  const c = art.hairColor;

  switch (art.hair) {
    // 빌 게이츠 — 가르마 탄 단정한 머리
    case 'side-part': {
      const cap = scene.add.ellipse(0, HEAD_CY - 19, 58, 28, c);
      cap.setStrokeStyle(2, outline, 0.3);
      const bang = scene.add.ellipse(13, HEAD_CY - 13, 26, 16, c);
      out.push(cap, bang);
      break;
    }

    // 스티브 잡스 — 짧고 성긴 머리
    case 'short': {
      const cap = scene.add.ellipse(0, HEAD_CY - 22, 50, 20, c);
      cap.setAlpha(0.9);
      out.push(cap);
      break;
    }

    // 일론 머스크 — 앞으로 넘긴 머리
    case 'swept': {
      const cap = scene.add.ellipse(-2, HEAD_CY - 20, 56, 26, c);
      cap.setStrokeStyle(2, outline, 0.3);
      const swoop = scene.add.triangle(18, HEAD_CY - 20, 0, 0, 20, -6, 6, 14, c);
      out.push(cap, swoop);
      break;
    }

    // 리누스 토발즈 — 부스스한 머리
    case 'messy': {
      const cap = scene.add.ellipse(0, HEAD_CY - 20, 58, 26, c);
      cap.setStrokeStyle(2, outline, 0.3);
      out.push(cap);
      [-18, -4, 12].forEach((x, i) => {
        out.push(scene.add.circle(x, HEAD_CY - 28 - (i % 2) * 4, 8, c));
      });
      break;
    }

    default:
      break;
  }

  return out;
}

function buildEyes(
  scene: Phaser.Scene,
  art: ArtConfig,
  outline: number,
): Phaser.GameObjects.GameObject[] {
  const lx = FACE_DX - EYE_GAP;
  const rx = FACE_DX + EYE_GAP;

  // 페페 — 툭 튀어나온 개구리 눈
  if (art.eyes === 'bulge') {
    const out: Phaser.GameObjects.GameObject[] = [];
    [lx, rx].forEach((x) => {
      const white = scene.add.circle(x, EYE_CY - 3, 10, 0xffffff);
      white.setStrokeStyle(2.5, outline, 0.55);
      const pupil = scene.add.circle(x + 2, EYE_CY - 3, 4.5, 0x101418);
      out.push(white, pupil);
    });
    return out;
  }

  return [
    scene.add.circle(lx, EYE_CY, 4.5, 0x101418),
    scene.add.circle(rx, EYE_CY, 4.5, 0x101418),
  ];
}

function buildGlasses(
  scene: Phaser.Scene,
  art: ArtConfig,
): Phaser.GameObjects.GameObject[] {
  if (art.glasses === 'none') return [];

  const out: Phaser.GameObjects.GameObject[] = [];
  const lx = FACE_DX - EYE_GAP;
  const rx = FACE_DX + EYE_GAP;
  const c = art.glassesColor;

  if (art.glasses === 'round') {
    [lx, rx].forEach((x) => {
      const lens = scene.add.circle(x, EYE_CY, 8.5);
      lens.setStrokeStyle(2.5, c, 1);
      lens.isFilled = false;
      out.push(lens);
    });
  } else {
    [lx, rx].forEach((x) => {
      const lens = scene.add.rectangle(x, EYE_CY, 17, 13);
      lens.setStrokeStyle(2.5, c, 1);
      lens.isFilled = false;
      out.push(lens);
    });
  }

  // 브리지
  out.push(scene.add.rectangle(FACE_DX, EYE_CY, EYE_GAP * 2 - 16, 2.5, c));
  return out;
}

function buildMouth(
  scene: Phaser.Scene,
  art: ArtConfig,
): Phaser.GameObjects.GameObject {
  const y = HEAD_CY + 13;

  switch (art.mouth) {
    // 페페 — 얼굴을 가로지르는 개구리 입
    case 'wide': {
      const m = scene.add.arc(FACE_DX, y - 8, 21, 15, 165, false);
      m.isFilled = false;
      m.setClosePath(false);
      m.setStrokeStyle(3.5, 0x1c5e2a, 1);
      return m;
    }

    case 'smile': {
      const m = scene.add.arc(FACE_DX, y - 5, 11, 25, 155, false);
      m.isFilled = false;
      m.setClosePath(false);
      m.setStrokeStyle(3, 0x7a4630, 1);
      return m;
    }

    // 한쪽만 올라간 자신만만한 입
    case 'smirk': {
      const m = scene.add.rectangle(FACE_DX + 1, y, 15, 3, 0x7a4630);
      m.setAngle(-12);
      return m;
    }

    default:
      return scene.add.rectangle(FACE_DX, y, 13, 3, 0x7a4630);
  }
}

/* ================================================================== */

/**
 * 초상 — HUD 패널·결과 화면에 쓰는 얼굴.
 *
 * V3 시트에는 마지막 칸(41)에 얼굴만 그린 그림이 들어 있다. 그게 있으면 쓰고,
 * 없으면 지금까지처럼 캐릭터 색 원을 둔다. 어느 쪽이든 자리와 크기는 같다.
 *
 * 원 위에 얼굴을 얹는 순서로 그리므로, 얼굴 그림에 배경이 남아 있어도
 * 원이 테두리 역할을 해 패널 안에서 형태가 유지된다.
 *
 * @returns 뒤에서 앞 순서로 정렬된 표시 객체들
 */
export function buildPortrait(
  scene: Phaser.Scene,
  cfg: CharacterConfig,
  radius: number,
): Phaser.GameObjects.GameObject[] {
  const bg = scene.add
    .circle(0, 0, radius, cfg.colors.body)
    .setStrokeStyle(3, cfg.colors.accent);

  const sheet = SPRITE_SHEETS[cfg.id];
  if (
    !sheet ||
    sheet.portraitFrame === undefined ||
    !scene.textures.exists(sheet.key)
  ) {
    return [bg];
  }

  const face = scene.add.image(0, 0, sheet.key, sheet.portraitFrame);
  // 원 안에 들어가도록 비율을 지켜 줄인다
  const fit = (radius * 2) / Math.max(face.width || 1, face.height || 1);
  face.setScale(fit);

  return [bg, face];
}

/**
 * 캐릭터 선택 카드에 놓을 그림.
 *
 * 시트가 있으면 **전투에서 실제로 보게 될 그림**을 그대로 쓴다.
 * 선택 화면은 이 게임을 켠 사람이 처음 보는 얼굴인데, 여기만 도형 아트면
 * 골라 놓고 전투에 들어갔을 때 다른 캐릭터가 나온 것처럼 느껴진다.
 * 그림이 있는데도 가장 약한 쪽을 첫인상으로 내보내는 셈이다.
 *
 * 시트가 없는 캐릭터는 지금까지처럼 도형 아트로 돌아간다 —
 * 새 캐릭터를 그림 없이 먼저 붙여 볼 수 있어야 한다는 원칙은 그대로다.
 *
 * @param height 카드 안에서 이 그림이 차지할 세로 크기
 */
export function buildCardArt(
  scene: Phaser.Scene,
  cfg: CharacterConfig,
  height: number,
): Phaser.GameObjects.Container {
  const sheet = SPRITE_SHEETS[cfg.id];
  const pose =
    sheet && scene.textures.exists(sheet.key)
      ? resolvePose(sheet.poses, 'idle')
      : null;

  if (!sheet || !pose) {
    const art = buildFighterArt(scene, cfg);
    // 도형 아트는 전투 기준 크기라, 카드 높이에 맞춰 키운다
    const scale = height / FIGHTER.BODY_H;
    return scene.add.container(0, 0, art.parts).setScale(scale);
  }

  const frame = Array.isArray(pose.frames) ? pose.frames[0]! : pose.frames;
  const img = scene.add.image(0, 0, sheet.key, frame);
  img.setScale(height / (img.height || 1));

  return scene.add.container(0, 0, [img]);
}

/* ================================================================== */

/** 색을 밝게(+) / 어둡게(-) 조정한다. amount: -1 ~ 1 */
function shade(color: number, amount: number): number {
  const c = Phaser.Display.Color.IntegerToColor(color);
  const f = amount < 0 ? 1 + amount : 1;
  const add = amount > 0 ? 255 * amount : 0;

  return Phaser.Display.Color.GetColor(
    Phaser.Math.Clamp(Math.round(c.red * f + add), 0, 255),
    Phaser.Math.Clamp(Math.round(c.green * f + add), 0, 255),
    Phaser.Math.Clamp(Math.round(c.blue * f + add), 0, 255),
  );
}
