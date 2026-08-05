import Phaser from 'phaser';
import { FIGHTER } from '../config/gameConfig';
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
