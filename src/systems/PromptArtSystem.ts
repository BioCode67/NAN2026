import Phaser from 'phaser';
import { DEPTH, GAME } from '../config/gameConfig';
import {
  buildImagePrompt,
  generateBattleImage,
  imageGenReady,
  seedOf,
} from '../config/imageGen';
import { sound } from './SoundSystem';

/**
 * 플레이어가 쓴 문장으로 **판을 다시 칠한다**.
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────
 * 프롬프트 오브를 깨고 문장을 쓰면 기믹이 걸린다. 그런데 걸리는 것이
 * 정해진 표 안에 있다는 걸 알아채는 순간, 문장을 쓰는 일은 버튼 하나를
 * 고르는 것과 같아진다 — 무엇을 써도 결과가 스무 개 중 하나다.
 *
 * 그래서 같은 문장을 그림 생성 서버에도 보낸다. 돌아온 그림은 화면을
 * 한 번 덮었다가 **그 판의 배경으로 남는다**. 표에 없는 결과가 하나
 * 생기는 것이고, 그 하나 때문에 다음에 무엇을 쓸지 실제로 궁금해진다.
 *
 * ── 회선으로 그림을 보내지 않는다 ───────────────────────────────────
 * 온라인에서도 문장은 이미 전원에게 간다. 그러니 각자 **같은 씨앗**으로
 * 부르면 같은 그림이 나온다. 수백 KB 를 데이터 채널에 밀어 넣는 것보다
 * 이쪽이 훨씬 안전하고, 늦게 오는 사람이 있어도 판이 기다리지 않는다.
 *
 * ── 없으면 아무 일도 없다 ───────────────────────────────────────────
 * 서버 주소가 없으면 부르지 않는다. 실패해도 조용히 없던 일이 된다.
 * 그림은 있으면 판이 뒤집히는 것이지, 없으면 못 노는 것이 아니다.
 */
export class PromptArtSystem {
  /** 지금 부르는 중인 요청을 끊는 손잡이 */
  private inflight: AbortController | null = null;
  /** 이번 판에 만든 텍스처 이름들 — 판이 끝나면 지운다 */
  private made: string[] = [];
  /** 배경을 되돌리는 함수 (다음 그림이 오면 앞의 것을 내린다) */
  private undo: (() => void) | null = null;
  private busyLabel?: Phaser.GameObjects.Text;
  private seq = 0;

  /** 마지막으로 무슨 일이 있었는가 — 검사와 콘솔이 읽는다 */
  state: 'idle' | 'asking' | 'shown' | 'failed' | 'off' = 'idle';

  constructor(
    private readonly scene: Phaser.Scene,
    /** 배경을 갈아 끼우고 되돌리는 함수를 돌려준다 */
    private readonly pushStageArt: (key: string) => () => void,
  ) {}

  /** 지금 이 판에서 그림을 부를 수 있는가 */
  get enabled(): boolean {
    return imageGenReady();
  }

  /**
   * 문장 하나로 그림을 부른다.
   *
   * @param text   플레이어가 쓴 말 (그대로)
   * @param scenes 해석기가 짚어 낸 기믹의 장면 설명(영어) — 무슨 일이
   *               벌어졌는지는 이쪽이 책임진다
   * @param accent 부른 사람의 색
   */
  request(text: string, scenes: string[], accent: number): void {
    if (!this.enabled) {
      this.state = 'off';
      return;
    }

    // 늦게 오는 앞 요청이 새 그림을 덮어쓰지 않게 먼저 끊는다
    this.inflight?.abort();
    const ctrl = new AbortController();
    this.inflight = ctrl;

    const mine = ++this.seq;
    this.state = 'asking';
    this.showBusy(accent);

    const prompt = buildImagePrompt(text, scenes);
    void generateBattleImage(prompt, seedOf(text), ctrl.signal).then((src) => {
      // 그 사이 판이 바뀌었거나 더 새로운 요청이 있었으면 버린다
      if (mine !== this.seq || !this.scene.scene.isActive()) return;
      this.hideBusy();
      if (!src) {
        this.state = 'failed';
        return;
      }
      this.adopt(src, text, accent, mine);
    });
  }

  /** 판이 끝나거나 다시 시작할 때 — 만든 것을 전부 치운다 */
  reset(): void {
    this.seq++;
    this.inflight?.abort();
    this.inflight = null;
    this.hideBusy();
    this.undo?.();
    this.undo = null;
    for (const key of this.made) {
      if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    }
    this.made = [];
    this.state = 'idle';
  }

  /* ================================================================ */

  /** 받은 그림을 텍스처로 굽고, 연출한 뒤 배경에 앉힌다 */
  private adopt(src: string, text: string, accent: number, mine: number): void {
    const key = `prompt-art-${mine}`;

    const finish = () => {
      if (mine !== this.seq || !this.scene.scene.isActive()) return;
      this.made.push(key);
      this.state = 'shown';
      this.reveal(key, text, accent);
    };

    /*
     * base64 든 URL 이든 같은 길로 넣는다.
     *
     * addBase64 는 성공/실패를 이벤트로만 알려 준다. 콜백을 안 달면
     * 깨진 응답이 왔을 때 텍스처가 없는 채로 배경을 갈아 끼우게 되고,
     * 화면이 통째로 비어 버린다.
     */
    this.scene.textures.once(`addtexture-${key}`, finish);
    /*
     * 깨진 그림이 오면 **실패로 끝나야 한다**.
     *
     * addBase64 는 성공을 addtexture-키 로, 실패를 error 로 따로 알린다.
     * 실패 쪽을 안 들으면 상태가 '부르는 중'에 영원히 멈춰 서고, 화면에는
     * "그림 그리는 중…"이 끝까지 남는다 — 고장 중에 가장 나쁜 종류다.
     */
    const onError = (badKey: string) => {
      if (badKey !== key) return;
      this.scene.textures.off('onerror', onError);
      if (mine !== this.seq) return;
      this.hideBusy();
      this.state = 'failed';
    };
    this.scene.textures.on('onerror', onError);

    if (src.startsWith('data:')) {
      this.scene.textures.addBase64(key, src);
    } else {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (!this.scene.textures.exists(key)) this.scene.textures.addImage(key, img);
        finish();
      };
      img.onerror = () => {
        this.state = 'failed';
      };
      img.src = src;
    }
  }

  /**
   * 한 번 크게 보여주고 배경으로 내려앉힌다.
   *
   * 배경만 조용히 갈아 끼우면 아무도 못 알아챈다 — 싸우는 중에는 배경을
   * 안 본다. "내가 쓴 문장이 이걸 만들었다"가 전달되려면 화면이 한 번은
   * 그림에 통째로 먹혀야 한다.
   */
  private reveal(key: string, text: string, accent: number): void {
    const s = this.scene;

    const flash = s.add
      .rectangle(0, 0, GAME.WIDTH, GAME.HEIGHT, 0xffffff, 0.9)
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(DEPTH.OVERLAY + 3);
    s.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 320,
      onComplete: () => flash.destroy(),
    });

    /*
     * 화면을 다 덮지 않는다.
     *
     * 처음에는 화면의 78% 를 채웠는데, 그러면 아래 문장이 주가 패널 위에
     * 겹쳐 찍혔다 — 판이 어떻게 돌아가는지 보여 주는 유일한 자리를
     * 가려 놓고 "극적"이라고 할 수는 없다. 가운데를 살짝 위로 올리고
     * 크기를 줄여, 카드와 문장이 HUD 위쪽에서 끝나게 한다.
     */
    const cy = GAME.HEIGHT * 0.43;
    const card = s.add
      .image(GAME.WIDTH / 2, cy, key)
      .setScrollFactor(0)
      .setDepth(DEPTH.OVERLAY + 2);
    fitInto(card, GAME.WIDTH * 0.62, GAME.HEIGHT * 0.56);

    const line = s.add
      .text(GAME.WIDTH / 2, cy + card.displayHeight / 2 + 18, `“${text}”`, {
        fontFamily: GAME.FONT,
        fontSize: '22px',
        color: `#${accent.toString(16).padStart(6, '0')}`,
        fontStyle: 'bold',
        align: 'center',
        wordWrap: { width: GAME.WIDTH * 0.7 },
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH.OVERLAY + 2);
    line.setStroke('#080d1a', 6);

    card.setScale(card.scale * 1.35).setAlpha(0);
    line.setAlpha(0);
    sound.play('surge');
    s.cameras.main.shake(180, 0.008);

    s.tweens.add({
      targets: card,
      scale: card.scale / 1.35,
      alpha: 1,
      duration: 260,
      ease: 'Back.easeOut',
    });
    s.tweens.add({ targets: line, alpha: 1, duration: 260, delay: 120 });

    /*
     * 그림이 화면을 오래 막고 있으면 그 사이에 얻어맞는다.
     * 보여 주는 것과 판을 멈추는 것은 다른 일이라, 1.5초만 쓰고 비킨다.
     */
    s.time.delayedCall(1500, () => {
      if (!s.scene.isActive()) return;
      s.tweens.add({
        targets: [card, line],
        alpha: 0,
        duration: 420,
        ease: 'Quad.easeIn',
        onComplete: () => {
          card.destroy();
          line.destroy();
        },
      });
      // 이제부터 이 그림이 이 판의 세계다
      this.undo?.();
      this.undo = this.pushStageArt(key);
    });
  }

  /* --- 기다리는 동안 ---------------------------------------------- */

  private showBusy(accent: number): void {
    this.hideBusy();
    this.busyLabel = this.scene.add
      .text(GAME.WIDTH / 2, 96, '그림 그리는 중…', {
        fontFamily: GAME.FONT,
        fontSize: '15px',
        color: `#${accent.toString(16).padStart(6, '0')}`,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.OVERLAY);
    this.busyLabel.setStroke('#080d1a', 5);
    this.scene.tweens.add({
      targets: this.busyLabel,
      alpha: { from: 1, to: 0.35 },
      duration: 620,
      yoyo: true,
      repeat: -1,
    });
  }

  private hideBusy(): void {
    if (!this.busyLabel) return;
    this.scene.tweens.killTweensOf(this.busyLabel);
    this.busyLabel.destroy();
    this.busyLabel = undefined;
  }
}

/** 비율을 지키며 지정한 상자 **안에** 들어가도록 줄인다 */
function fitInto(img: Phaser.GameObjects.Image, w: number, h: number): void {
  const src = img.texture.getSourceImage();
  if (!src.width || !src.height) return;
  img.setScale(Math.min(w / src.width, h / src.height));
}
