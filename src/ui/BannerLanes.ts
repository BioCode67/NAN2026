/**
 * 화면 상단 중앙 배너들의 자리를 한 곳에서 나눠 준다.
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────
 * 기믹 배너 · 리듬 게이지 · 오브 알림은 서로의 존재를 모른 채 각자
 * 고정된 y에 그려져 있었다. 하나씩 뜰 때는 괜찮지만 겹쳐 뜨는 순간
 * — 리듬 배틀이 걸린 채로 오브가 달아나면 — 글자 위에 게이지가 얹혀
 * **둘 다 안 읽힌다.**
 *
 * 각자 고정 y를 조금씩 벌려 잡는 방법도 있지만, 그러면 배너를 하나
 * 더할 때마다 나머지 전부의 y를 다시 계산해야 하고, 혼자 뜰 때는
 * 엉뚱하게 아래쪽에 뜬다. 자리를 배분하는 쪽이 옳다.
 *
 * ── 규칙 ───────────────────────────────────────────────────────────
 * 각 배너는 "높이 얼마짜리 한 줄"만 요구한다. 위에서부터 비어 있는
 * 첫 자리를 받고, 다 쓰면 비운다.
 *
 * 위 칸이 비어도 아래 배너를 끌어올리지 않는다. 읽는 도중에 글자가
 * 움직이는 편이 한 줄 비는 것보다 눈에 거슬리기 때문이다.
 */

/**
 * 첫 줄이 시작되는 y — 화면 위쪽 조작 안내 바로 아래.
 *
 * 안내가 두 줄(16·34)일 때는 48 이면 충분했다. 그런데 "이 캐릭터만 되는 것"
 * 줄이 붙으면서 안내가 52·70 까지 내려왔고, 첫 배너 자리(48~74)가 그 위에
 * 그대로 포개졌다 — 기믹이 걸린 채로 판이 시작되면 둘 다 안 읽힌다.
 */
const TOP = 92;

/** 줄 사이 간격 */
const GAP = 8;

/**
 * 이 아래로는 내려가지 않는다.
 * 배너가 여기까지 내려오면 전투 화면을 가리기 시작하므로,
 * 자리가 없으면 맨 아래 줄을 겹쳐 쓰는 편이 낫다.
 */
const BOTTOM = 260;

export interface BannerLane {
  /** 잡은 자리의 위쪽 경계 */
  readonly top: number;
  /** 세로 가운데 — origin 0.5 로 놓는 오브젝트는 이 값을 쓴다 */
  readonly center: number;
  /** 자리를 비운다. 여러 번 불러도 안전하다 */
  release(): void;
}

export class BannerLanes {
  private taken: { top: number; bottom: number }[] = [];

  /**
   * 높이 `height` 짜리 배너 한 줄을 잡는다.
   *
   * 높이는 글자 크기가 아니라 **차지하는 세로 전체**를 준다.
   * 리듬 게이지처럼 라벨이 위에 붙어 있으면 그 라벨까지 포함해야
   * 위 배너와 붙지 않는다.
   */
  claim(height: number): BannerLane {
    const top = this.findTop(height);
    const slot = { top, bottom: top + height };
    this.taken.push(slot);

    let released = false;
    return {
      top,
      center: top + height / 2,
      release: () => {
        if (released) return;
        released = true;
        this.taken = this.taken.filter((s) => s !== slot);
      },
    };
  }

  /** 잡은 자리를 전부 비운다 (판을 새로 열 때) */
  reset(): void {
    this.taken = [];
  }

  /** 위에서부터 훑어 `height` 가 들어가는 첫 빈 자리를 찾는다 */
  private findTop(height: number): number {
    const sorted = [...this.taken].sort((a, b) => a.top - b.top);
    let cursor = TOP;

    for (const slot of sorted) {
      // 이 칸 앞에 빈 공간이 충분하면 거기에 넣는다
      if (slot.top - cursor >= height + GAP) return cursor;
      cursor = Math.max(cursor, slot.bottom + GAP);
    }

    // 아래로 밀려 화면을 가릴 지경이면 차라리 맨 위부터 다시 쓴다
    return cursor + height <= BOTTOM ? cursor : TOP;
  }
}
