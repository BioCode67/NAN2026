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
  /**
   * 앞손에 든 것. 팔과 같은 자리에 놓이므로 **팔과 함께 움직여야 한다.**
   * 무기만 제자리에 남으면 손에서 빠진 것처럼 보인다.
   */
  handProp?: Phaser.GameObjects.Container;
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

  /*
   * 손에 든 것.
   *
   * 팔보다 앞(=화면상 위)에 그린다. 팔 뒤에 두면 몸통에 가려 안 보이는
   * 각도가 생기고, 그러면 무기를 붙인 의미가 절반으로 준다.
   */
  const handProp = buildHandProp(scene, art, cfg.colors.accent, outline);
  if (handProp) back.push(handProp);

  /* --- 머리 ------------------------------------------------------- */
  const head = scene.add.circle(0, HEAD_CY, FIGHTER.HEAD_R, skin);
  head.setStrokeStyle(3, outline, 0.45);
  front.push(head);
  flashParts.push(head);

  /* --- 머리카락 --------------------------------------------------- */
  front.push(...buildHair(scene, art, outline));

  /*
   * --- 머리 위 ----------------------------------------------------
   * 머리카락보다 뒤(=화면상 위)에 그린다. 뿔·귀·안테나는 머리 밖으로
   * 삐져나와야 실루엣이 되는데, 머리카락 뒤에 두면 가려지기 때문이다.
   */
  front.push(...buildHeadgear(scene, art, cfg.colors.accent, outline));

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
    handProp: handProp ?? undefined,
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

/**
 * 앞손에 든 것.
 *
 * 컨테이너로 감싸는 이유 — 공격할 때 팔과 **같은 좌표로 함께 움직여야** 한다.
 * 조각들을 따로 두면 팔 트윈에 맞춰 각각의 오프셋을 다시 계산해야 하고,
 * 그러면 무기를 하나 늘릴 때마다 애니메이션 코드를 손대게 된다.
 * 컨테이너 하나면 뷰는 "팔과 이것을 같이 옮겨라"만 알면 된다.
 */
function buildHandProp(
  scene: Phaser.Scene,
  art: ArtConfig,
  accent: number,
  outline: number,
): Phaser.GameObjects.Container | null {
  const kind = art.prop ?? 'none';
  if (kind === 'none') return null;

  const c = art.propColor ?? accent;
  const dark = shade(c, -0.35);
  const parts: Phaser.GameObjects.GameObject[] = [];

  /** 자루 — 여러 무기가 공유한다 */
  const shaft = (len: number, thick = 5) => {
    const r = scene.add.rectangle(len / 2 - 4, 0, len, thick, dark);
    r.setStrokeStyle(1.5, outline, 0.5);
    return r;
  };

  switch (kind) {
    case 'hammer':
      parts.push(shaft(26), (() => {
        const head = scene.add.rectangle(26, -2, 20, 22, c);
        head.setStrokeStyle(2, outline, 0.55);
        return head;
      })());
      break;

    case 'stick': {
      const rod = scene.add.rectangle(14, 4, 42, 4.5, dark);
      rod.setStrokeStyle(1.5, outline, 0.5);
      rod.setRotation(-0.35);
      const tip = scene.add.circle(31, -1, 5, c);
      tip.setStrokeStyle(1.5, outline, 0.5);
      parts.push(rod, tip);
      break;
    }

    case 'board': {
      const plate = scene.add.rectangle(16, -2, 30, 20, c);
      plate.setStrokeStyle(2, outline, 0.55);
      // 판 위의 무늬 — 이것이 있어야 그냥 사각형으로 안 보인다
      parts.push(plate);
      [-6, 0, 6].forEach((dy) => {
        parts.push(scene.add.rectangle(16, dy, 22, 2, shade(c, 0.45)));
      });
      break;
    }

    case 'pickaxe': {
      parts.push(shaft(24));
      const blade = scene.add.triangle(26, -6, 0, 12, 14, -6, 22, 14, c);
      blade.setStrokeStyle(2, outline, 0.55);
      parts.push(blade);
      break;
    }

    case 'box': {
      const cube = scene.add.rectangle(18, -2, 26, 24, c);
      cube.setStrokeStyle(2.5, outline, 0.55);
      // 테이프 자국 — 상자로 읽히게 하는 최소 단서
      parts.push(cube, scene.add.rectangle(18, -2, 26, 3, shade(c, -0.3)));
      break;
    }

    case 'orb': {
      const ball = scene.add.circle(18, -4, 11, c);
      ball.setStrokeStyle(2, outline, 0.5);
      const glint = scene.add.circle(14, -8, 3.5, 0xffffff, 0.7);
      parts.push(ball, glint);
      break;
    }

    case 'blade': {
      const edge = scene.add.triangle(10, 0, 0, 6, 46, -4, 0, -6, c);
      edge.setStrokeStyle(2, outline, 0.55);
      parts.push(scene.add.rectangle(6, 0, 12, 5, dark), edge);
      break;
    }

    case 'phone': {
      const body = scene.add.rectangle(15, -3, 13, 22, dark);
      body.setStrokeStyle(2, outline, 0.55);
      parts.push(body, scene.add.rectangle(15, -3, 9, 17, c));
      break;
    }

    case 'doc': {
      // 서류는 살짝 어긋나게 겹쳐야 뭉치로 보인다
      [-2, 1, 4].forEach((dx, i) => {
        const sheet = scene.add.rectangle(15 + dx, -2 - i, 20, 24, i === 2 ? c : shade(c, 0.3));
        sheet.setStrokeStyle(1.5, outline, 0.45);
        parts.push(sheet);
      });
      break;
    }

    case 'gun': {
      const barrel = scene.add.rectangle(20, -4, 24, 7, c);
      barrel.setStrokeStyle(2, outline, 0.55);
      parts.push(barrel, scene.add.rectangle(11, 3, 7, 12, dark));
      break;
    }

    case 'claw': {
      [-8, 0, 8].forEach((dy) => {
        const nail = scene.add.triangle(14, dy, 0, 3, 18, 0, 0, -3, c);
        nail.setStrokeStyle(1.5, outline, 0.5);
        parts.push(nail);
      });
      break;
    }

    default:
      return null;
  }

  return scene.add.container(ARM_X, ARM_Y, parts);
}

/**
 * 머리 위 한 조각.
 *
 * 도형 몇 개로 끝내되, **머리 실루엣 밖으로 나가는 것**을 우선한다.
 * 선택 화면에서 카드가 92px까지 줄어들면 얼굴 안쪽 디테일은 뭉개져 안 보인다.
 * 밖으로 튀어나온 뿔·귀·안테나만이 그 크기에서도 남는다.
 */
function buildHeadgear(
  scene: Phaser.Scene,
  art: ArtConfig,
  accent: number,
  outline: number,
): Phaser.GameObjects.GameObject[] {
  const kind = art.headgear ?? 'none';
  if (kind === 'none') return [];

  const c = art.headgearColor ?? accent;
  const out: Phaser.GameObjects.GameObject[] = [];
  const top = HEAD_CY - 20;

  switch (kind) {
    // 동학 개미 — 안전모. 챙이 앞으로 나온다
    case 'helmet': {
      const dome = scene.add.ellipse(0, top - 4, 60, 34, c);
      dome.setStrokeStyle(2.5, outline, 0.45);
      const brim = scene.add.ellipse(FACE_DX + 6, top + 9, 54, 10, shade(c, -0.2));
      brim.setStrokeStyle(2, outline, 0.4);
      out.push(dome, brim);
      break;
    }

    // 월가 황소 — 좌우로 뻗은 뿔. 실루엣이 가장 크게 벌어진다
    case 'horns': {
      [-1, 1].forEach((s) => {
        const horn = scene.add.triangle(
          s * 26,
          top,
          0, 14,
          s * 26, -18,
          s * 2, 16,
          c,
        );
        horn.setStrokeStyle(2.5, outline, 0.5);
        out.push(horn);
      });
      break;
    }

    // 공매도 곰 — 머리 위 양쪽의 둥근 귀
    case 'ears': {
      [-1, 1].forEach((s) => {
        const ear = scene.add.circle(s * 20, top - 6, 11, c);
        ear.setStrokeStyle(2.5, outline, 0.45);
        const inner = scene.add.circle(s * 20, top - 6, 5, shade(c, 0.35));
        out.push(ear, inner);
      });
      break;
    }

    // 사토시 — 얼굴을 감싸는 후드. 정체를 가리는 것이 이 캐릭터다
    case 'hood': {
      const shell = scene.add.ellipse(-2, HEAD_CY - 6, 74, 66, c);
      shell.setStrokeStyle(2.5, outline, 0.5);
      // 얼굴 자리를 파낸다 — 그늘에 눈만 남는 인상
      const shadow = scene.add.ellipse(FACE_DX + 2, HEAD_CY - 2, 50, 48, 0x0a0e18);
      shadow.setAlpha(0.62);
      out.push(shell, shadow);
      break;
    }

    // 왕관 — 지금은 아무도 안 쓴다. 모양은 남겨 둔다
    case 'crown': {
      const band = scene.add.rectangle(0, top - 2, 48, 9, c);
      band.setStrokeStyle(2, outline, 0.45);
      out.push(band);
      [-16, 0, 16].forEach((x) => {
        out.push(scene.add.triangle(x, top - 12, 0, 10, 8, -8, 16, 10, c));
      });
      break;
    }

    // 끝에 구슬이 달린 안테나 — 지금은 아무도 안 쓴다. 모양은 남겨 둔다
    case 'antenna': {
      const rod = scene.add.rectangle(2, top - 12, 3.5, 22, shade(c, -0.3));
      const bulb = scene.add.circle(2, top - 24, 7, c);
      bulb.setStrokeStyle(2, outline, 0.4);
      out.push(rod, bulb);
      break;
    }

    // 차트 도사 — 상투
    case 'topknot': {
      const knot = scene.add.circle(0, top - 14, 12, c);
      knot.setStrokeStyle(2.5, outline, 0.45);
      const pin = scene.add.rectangle(0, top - 14, 32, 3.5, shade(c, 0.4));
      out.push(knot, pin);
      break;
    }

    // 큰손 고래 — 정수리에서 물을 뿜는다
    case 'blowhole': {
      const hole = scene.add.ellipse(-2, top + 2, 14, 8, shade(c, -0.4));
      out.push(hole);
      [0, 1, 2].forEach((i) => {
        const drop = scene.add.circle(-2 + (i - 1) * 9, top - 12 - i * 6, 5 - i, c);
        drop.setAlpha(0.85);
        out.push(drop);
      });
      break;
    }

    // 정주영차 — 챙 모자(작업모)
    case 'cap': {
      const dome = scene.add.ellipse(0, top - 3, 56, 28, c);
      dome.setStrokeStyle(2.5, outline, 0.45);
      const brim = scene.add.ellipse(FACE_DX + 16, top + 8, 36, 9, shade(c, -0.25));
      out.push(dome, brim);
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
    /*
     * 도형 아트는 전투 기준 크기라 카드 높이에 맞춰 키운다.
     *
     * 손에 무기를 든 캐릭터는 실루엣이 옆으로 넓어져, 세로만 맞추면
     * 무기가 카드 밖으로 삐져나와 옆 칸을 침범한다. 그만큼 줄인다 —
     * 무기가 잘린 캐릭터보다 조금 작은 캐릭터가 낫다.
     */
    const wide = (cfg.art.prop ?? 'none') !== 'none';
    const scale = (height / FIGHTER.BODY_H) * (wide ? 0.86 : 1);
    // 무기 쪽으로 치우친 무게중심을 되돌려 카드 가운데에 앉힌다
    const shift = wide ? -14 * scale : 0;
    return scene.add.container(shift, 0, art.parts).setScale(scale);
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
