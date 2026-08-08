import Phaser from 'phaser';
import { DEPTH, STAGE } from '../config/gameConfig';
import { SPRITE_SHEETS } from '../config/spriteSheets';
import type { AttackConfig } from '../types';
import type { BaseCharacter } from '../characters/BaseCharacter';

/** 탄의 표시 객체 — 스프라이트든 도형이든 이 정도만 있으면 된다 */
type ProjectileView = Phaser.GameObjects.GameObject & {
  x: number;
  y: number;
  setDepth(v: number): unknown;
  destroy(): void;
};

/** 날아가는 탄 하나 */
interface Projectile {
  view: ProjectileView;
  atk: AttackConfig;
  ownerId: string;
  vx: number;
  vy: number;
  /** 소멸 시각 */
  dieAt: number;
  /** 이미 맞춘 대상 (관통용) */
  hit: Set<string>;
  width: number;
  height: number;
  dead: boolean;
}

/**
 * 투사체 시스템.
 *
 * 근접 히트박스와 달리 발사 후 독립적으로 날아가며,
 * 판정은 CombatSystem이 근접 공격과 같은 경로로 처리한다.
 *
 * 캐릭터 스킬뿐 아니라 앞으로 추가될 원거리 아이템도 이 시스템을 쓴다.
 */
export class ProjectileSystem {
  private readonly list: Projectile[] = [];
  private readonly rect = new Phaser.Geom.Rectangle();

  constructor(private readonly scene: Phaser.Scene) {}

  /** 시전자 앞에 투사체를 만든다 */
  spawn(owner: BaseCharacter, atk: AttackConfig): void {
    const p = atk.projectile;
    if (!p) return;

    const x = owner.x + owner.facing * 44;
    const y = owner.y + p.offsetY;

    /*
     * 캐릭터 시트에 투사체 프레임이 있으면 그것을 쓰고,
     * 없으면 캐릭터 포인트 색의 원형으로 대체한다.
     * (시트가 없는 캐릭터도 스킬이 동작해야 하기 때문)
     */
    const sheet = SPRITE_SHEETS[owner.cfg.id];
    let view: Projectile['view'];
    let size: number;

    if (p.frame !== undefined && sheet && this.scene.textures.exists(sheet.key)) {
      const sprite = this.scene.add.sprite(x, y, sheet.key, p.frame);
      const frameH = sprite.frame.height || p.displayHeight;
      sprite.setScale(p.displayHeight / frameH);
      sprite.setFlipX(owner.facing < 0);
      view = sprite;
      size = p.displayHeight;
    } else {
      const circle = this.scene.add.circle(
        x,
        y,
        p.displayHeight / 2,
        owner.cfg.colors.accent,
        0.9,
      );
      circle.setStrokeStyle(3, 0xffffff, 0.8);
      view = circle;
      size = p.displayHeight;
    }

    view.setDepth?.(DEPTH.IMPACT - 1);

    this.list.push({
      view,
      atk,
      ownerId: owner.fighterId,
      vx: p.speed * owner.facing,
      vy: 0,
      dieAt: this.scene.time.now + p.lifespan,
      hit: new Set(),
      width: size * 0.8,
      height: size * 0.8,
      dead: false,
    });
  }

  /** 이동 + 수명/장외 정리 */
  update(time: number, delta: number): void {
    const dt = delta / 1000;

    for (let i = this.list.length - 1; i >= 0; i--) {
      const pr = this.list[i]!;

      if (pr.dead || time >= pr.dieAt) {
        this.kill(i);
        continue;
      }

      const g = pr.atk.projectile?.gravity ?? 0;
      pr.vy += g * dt;
      pr.view.x += pr.vx * dt;
      pr.view.y += pr.vy * dt;

      // 스테이지 밖으로 나가면 소멸
      if (
        pr.view.x < STAGE.LEFT - 200 ||
        pr.view.x > STAGE.RIGHT + 200 ||
        pr.view.y > STAGE.BLAST_BOTTOM
      ) {
        this.kill(i);
      }
    }
  }

  /** CombatSystem이 판정에 쓸 활성 투사체 목록 */
  getActive(): Array<{
    rect: Phaser.Geom.Rectangle;
    atk: AttackConfig;
    ownerId: string;
    hasHit: (id: string) => boolean;
    markHit: (id: string) => void;
    x: number;
    y: number;
  }> {
    return this.list
      .filter((p) => !p.dead)
      .map((p) => ({
        rect: new Phaser.Geom.Rectangle(
          p.view.x - p.width / 2,
          p.view.y - p.height / 2,
          p.width,
          p.height,
        ),
        atk: p.atk,
        ownerId: p.ownerId,
        hasHit: (id: string) => p.hit.has(id),
        markHit: (id: string) => {
          p.hit.add(id);
          // 관통이 아니면 맞자마자 소멸
          if (!p.atk.projectile?.pierce) p.dead = true;
        },
        x: p.view.x,
        y: p.view.y,
      }));
  }

  private kill(index: number): void {
    const pr = this.list[index];
    if (!pr) return;

    // 소멸 시 작게 터지는 연출
    const burst = this.scene.add
      .circle(pr.view.x, pr.view.y, pr.width * 0.4, 0xffffff, 0.8)
      .setDepth(DEPTH.IMPACT);
    this.scene.tweens.add({
      targets: burst,
      scale: 2,
      alpha: 0,
      duration: 180,
      onComplete: () => burst.destroy(),
    });

    pr.view.destroy();
    this.list.splice(index, 1);
  }

  /**
   * 날아가는 탄들 — 온라인에서 회선으로 보낸다. 탄마다 [x, y, 색, 크기].
   *
   * 이게 없어서 참가자 화면에는 **투사체가 아예 안 보였다.** 게이츠의
   * 블루스크린을 정통으로 맞았는데 화면에는 아무것도 날아오지 않은 것이다 —
   * 피할 수 없는 공격만큼 억울한 것이 없다.
   */
  snapshot(): number[][] {
    return this.list
      .filter((p) => !p.dead)
      .map((p) => [
        Math.round(p.view.x),
        Math.round(p.view.y),
        (p.view as unknown as { fillColor?: number }).fillColor ?? 0xffffff,
        Math.round(p.width),
      ]);
  }

  /**
   * 회선으로 받은 탄들을 그린다 (참가자 쪽).
   *
   * 아이템과 같은 규칙 — 개수가 맞으면 자리만 옮기고, 다르면 전부 다시
   * 세운다. 탄은 판정이 없다(판정은 호스트가 하고 결과는 hit 으로 온다).
   */
  applyRemote(list: number[][]): void {
    if (list.length !== this.remote.length) {
      this.remote.forEach((r) => r.destroy());
      this.remote.length = 0;
      for (const [x, y, color, size] of list) {
        const c = this.scene.add
          .circle(x!, y!, Math.max(8, (size ?? 24) / 2), color ?? 0xffffff, 0.9)
          .setStrokeStyle(3, 0xffffff, 0.8)
          .setDepth(DEPTH.IMPACT - 1);
        this.remote.push(c);
      }
      return;
    }
    list.forEach((row, i) => this.remote[i]?.setPosition(row[0]!, row[1]!));
  }

  /** 참가자 쪽 원격 탄 그림 */
  private readonly remote: Phaser.GameObjects.Arc[] = [];

  reset(): void {
    this.list.forEach((p) => p.view.destroy());
    this.list.length = 0;
    this.remote.forEach((r) => r.destroy());
    this.remote.length = 0;
    // 재사용 필드 유지 (rect는 상태가 없다)
    void this.rect;
  }
}
