import { moveSet } from './gameConfig';
import type { CharacterConfig, CharacterId } from '../types';

/**
 * 캐릭터 5종 데이터.
 *
 * 캐릭터 고유 동작은 전부 이 데이터로 표현되며,
 * BaseCharacter가 이를 읽어 그대로 구동한다.
 *
 * 기술 이름과 연출은 "그 인물이라면 어떻게 싸울까"에서 나온다.
 * 이 게임의 정체성이 패러디이므로, 수치보다 먼저 정해지는 것이 그 인물다움이다.
 * (고유 모션이 필요해지면 그때 BillGates.ts 등으로 분리한다)
 */
export const CHARACTERS: Record<CharacterId, CharacterConfig> = {
  /* ---------------------------------------------------------------- */
  /* 1. 빌 게이츠맨 — 독점 흡수                                        */
  /* ---------------------------------------------------------------- */
  gates: {
    id: 'gates',
    name: '빌 게이츠맨',
    realName: 'Bill Gates',
    tagline: '독점은 죄가 아니다, 전략이다',
    colors: { body: 0x2f6fd0, head: 0xf1c9a5, accent: 0x7dd3fc },
    stats: { speed: 245, jump: -690, doubleJump: -620, weight: 1.05 },

    art: {
      hair: 'side-part',
      hairColor: 0x8b6b4a,
      glasses: 'round',
      glassesColor: 0xd4a843,
      beard: false,
      beardColor: 0x000000,
      mouth: 'smile',
      eyes: 'dot',
    },

    passive: {
      type: 'absorb_flat',
      name: '독점 흡수',
      desc: '타격에 성공할 때마다 피해량의 150%를 주가로 흡수한다. (기본 10% → 15%)',
      absorbRatio: 1.5,
    },

    /*
     * 견제형 — 리치가 길고 묵직하지만 발동이 느리다.
     * 기술은 전부 "윈도우 / 독점 / 기부"에서 따왔다.
     */
    moves: moveSet({
      light: { name: '잽', damage: 9, startup: 78, range: 64 },

      // 연속기 — 클릭하듯 두 번 치고 창을 강제로 닫아버린다
      light2: { name: '더블 클릭', damage: 10, startup: 108, range: 68 },
      light3: { name: '강제 종료', damage: 16, startup: 134, cry: '응답 없음.' },

      lightUp: {
        name: '강제 업데이트',
        // 팝업창이 위로 튀어 올라 상대를 걷어 올린다
        damage: 10,
        startup: 96,
        range: 74,
        hitHeight: 112,
        knockbackY: -560,
      },

      lightDown: {
        name: '기부금 살포',
        // 지폐를 바닥에 흩뿌린다 — 리치가 길고 상대를 낮게 붙잡아 둔다
        damage: 8,
        startup: 88,
        range: 104,
        knockbackX: 300,
      },

      heavy: {
        name: '독점 킥',
        damage: 19,
        startup: 195,
        range: 94,
      },
      // 대시 중 J/K — 달리던 기세로 밀어붙인다
      dashAttack: { name: '시장 진입', damage: 17, startup: 112, lunge: 560 },

      heavy2: {
        name: '인수 합병',
        damage: 24,
        startup: 172,
        range: 100,
        knockbackX: 860,
        cry: '이 회사, 내가 사겠소.',
      },

      heavyUp: {
        name: 'Ctrl+Alt+Del',
        // 세 손가락으로 상대를 강제 종료시키며 함께 솟구친다
        damage: 18,
        startup: 165,
        range: 82,
        hitHeight: 136,
        selfLaunch: -520,
        cry: '작업 관리자 호출!',
      },

      heavyDown: {
        name: '반독점 소송',
        // 판사봉을 내려찍는다 — 이 게임에서 가장 넓은 지상 광역기
        damage: 21,
        startup: 235,
        range: 176,
        knockbackY: -520,
        cry: '반독점 소송이다!',
      },

      airLight: { name: '팝업 광고', damage: 9, startup: 62 },

      airHeavy: {
        name: '윈도우 셔터',
        damage: 16,
        range: 122,
      },

      airDive: {
        name: '강제 재부팅',
        damage: 20,
        cry: '지금 다시 시작합니다!',
      },

      skill: {
        name: '블루스크린',
        damage: 20,
        startup: 260,
        active: 140,
        recovery: 420,
        // 투사체를 쓰므로 근접 히트박스는 없다
        range: 0,
        hitHeight: 0,
        knockbackX: 300,
        knockbackY: -200,
        hitstun: 1200,
        hitstop: 110,
        shake: 0.014,
        cooldown: 9000,
        effect: 'stun',
        effectDuration: 1200,
        projectile: {
          speed: 620,
          lifespan: 1800,
          // 시트 8번 = 캐릭터 없이 에너지볼만 있는 프레임
          frame: 8,
          displayHeight: 58,
          offsetY: -12,
        },
      },
    }),

    quotes: {
      intro: ["Let's upgrade!"],
      skill: ['Blue Screen!'],
      ko: ['Your stock is worthless!'],
      surge: ['Monopoly mode!'],
      comeback: ["I'll buy your company!"],
      hurt: ['치명적 오류 발생…'],
    },
  },

  /* ---------------------------------------------------------------- */
  /* 2. 스티브 잡스맨 — 현실 왜곡                                      */
  /* ---------------------------------------------------------------- */
  jobs: {
    id: 'jobs',
    name: '스티브 잡스맨',
    realName: 'Steve Jobs',
    tagline: '한 방이면 충분하다',
    colors: { body: 0x1f2937, head: 0xf1c9a5, accent: 0xe5e7eb },
    stats: { speed: 265, jump: -720, doubleJump: -650, weight: 0.95 },

    art: {
      hair: 'short',
      hairColor: 0x6b7280,
      glasses: 'round',
      glassesColor: 0x111827,
      beard: true,
      beardColor: 0x9ca3af,
      mouth: 'smirk',
      eyes: 'dot',
    },

    passive: {
      type: 'absorb_chance',
      name: '현실 왜곡',
      desc: '30% 확률로 피해량의 200%를 주가로 흡수한다. (기본 10% → 20%)',
      chance: 0.3,
      absorbRatio: 2.0,
    },

    /*
     * 한방형 — 발동이 빠르고 회복도 짧아 근접 압박에 강하다.
     * 기술은 전부 "키노트 / 앱스토어 / 가격 발표"에서 따왔다.
     */
    moves: moveSet({
      light: {
        name: '훅',
        damage: 11,
        startup: 62,
        recovery: 135,
        range: 60,
      },

      // 연속기 — 발표하듯 몰아치다 마지막에 한 장 더 꺼낸다
      light2: { name: '스트레이트', damage: 11, startup: 96, recovery: 140, range: 64 },
      light3: { name: '슬라이드 넘기기', damage: 17, startup: 122, cry: '다음 슬라이드.' },

      lightUp: {
        name: '원 모어 씽',
        // 검지를 치켜드는 그 동작. 짧지만 확실하게 띄운다
        damage: 10,
        startup: 78,
        recovery: 170,
        range: 66,
        hitHeight: 108,
        knockbackY: -570,
      },

      lightDown: {
        name: '씬 앤 라이트',
        // 서류봉투에 들어갈 만큼 얇게 베어낸다
        damage: 9,
        startup: 70,
        recovery: 180,
        range: 96,
      },

      heavy: {
        name: '현실 왜곡 강타',
        damage: 22,
        startup: 200,
        recovery: 300,
        range: 78,
      },
      // 대시 중 J/K — 가장 빠르게 파고든다
      dashAttack: { name: '기습 발표', damage: 15, startup: 92, lunge: 680 },

      heavy2: {
        name: '단종 선언',
        damage: 26,
        startup: 150,
        range: 86,
        knockbackX: 880,
        cry: '이 제품은 오늘부로 단종입니다.',
      },

      heavyUp: {
        name: '키노트 어퍼',
        // 무대 조명이 아래에서 위로 솟구친다
        damage: 18,
        startup: 138,
        recovery: 350,
        range: 74,
        hitHeight: 128,
        selfLaunch: -600,
        cry: 'One more thing!',
      },

      heavyDown: {
        name: '심사 반려',
        // 앱스토어 반려 도장을 내려찍는다 — 좁지만 발동이 빠르다
        damage: 19,
        startup: 195,
        range: 138,
        cry: '반려합니다.',
      },

      airLight: { name: '멀티터치', damage: 10, startup: 52, range: 70 },

      airHeavy: {
        name: '레티나 슬래시',
        damage: 17,
        startup: 125,
        range: 112,
      },

      airDive: {
        name: '가격 인하',
        // 발표하듯 급강하해 상대를 바닥에 처박는다
        damage: 20,
        startup: 100,
        cry: '이제 399달러입니다.',
      },

      skill: {
        name: '스포트라이트 펀치',
        damage: 34,
        startup: 280,
        active: 110,
        recovery: 380,
        range: 96,
        hitHeight: 86,
        knockbackX: 780,
        knockbackY: -440,
        hitstun: 520,
        hitstop: 150,
        shake: 0.02,
        cooldown: 8000,
        effect: 'none',
      },
    }),

    quotes: {
      intro: ['Think different.'],
      skill: ['One more thing!'],
      ko: ["You're fired."],
      surge: ['Reality distortion!'],
      comeback: ["Here's the iPhone."],
      hurt: ['이건… 내 디자인이 아니야.'],
    },
  },

  /* ---------------------------------------------------------------- */
  /* 3. 일론 머스크맨 — 변동성 폭발                                    */
  /* ---------------------------------------------------------------- */
  musk: {
    id: 'musk',
    name: '일론 머스크맨',
    realName: 'Elon Musk',
    tagline: '떡상하면 아무도 못 막는다',
    colors: { body: 0xdc2626, head: 0xf1c9a5, accent: 0xfbbf24 },
    stats: { speed: 285, jump: -760, doubleJump: -690, weight: 0.9 },

    art: {
      hair: 'swept',
      hairColor: 0x3f2d20,
      glasses: 'none',
      glassesColor: 0x000000,
      beard: false,
      beardColor: 0x000000,
      mouth: 'smirk',
      eyes: 'dot',
    },

    passive: {
      type: 'power_when_high',
      name: '변동성 폭발',
      desc: '주가가 200% 이상일 때 공격력이 2배가 된다.',
      threshold: 200,
      powerMul: 2.0,
    },

    /*
     * 속도형 — 약공격이 압도적으로 빨라 연타가 들어간다. 대신 한 방이 약하다.
     * 기술은 전부 "로켓 / 터널 / 트윗"에서 따왔다.
     */
    moves: moveSet({
      light: {
        name: '트윗 연사',
        damage: 7,
        startup: 48,
        active: 90,
        recovery: 95,
        range: 56,
        knockbackX: 120,
        hitstun: 140,
        hitstop: 55,
      },

      // 연속기 — 이 캐릭터가 가장 빠르게 몰아친다
      light2: { name: '리트윗', damage: 8, startup: 88, active: 100, recovery: 110, range: 60 },
      light3: { name: '커뮤니티 노트', damage: 14, startup: 118, cry: '이 트윗에는 맥락이 필요합니다.' },

      lightUp: {
        name: '스타링크 발사',
        // 위성을 위로 쏘아 올린다 — 대공 견제
        damage: 8,
        startup: 70,
        recovery: 165,
        range: 68,
        hitHeight: 116,
        knockbackY: -520,
      },

      lightDown: {
        name: '보링 컴퍼니',
        // 바닥에 터널을 뚫으며 앞으로 파고든다 — 가장 긴 하단기
        damage: 8,
        startup: 76,
        range: 112,
        lunge: 340,
      },

      heavy: {
        name: '부스터 차지',
        damage: 20,
        startup: 165,
        recovery: 300,
        range: 86,
        // 부스터를 점화해 앞으로 치고 나간다
        lunge: 520,
      },
      // 대시 중 J/K — 부스터를 그대로 실어 가장 멀리 밀고 나간다
      dashAttack: { name: '하이퍼루프', damage: 15, startup: 88, lunge: 820 },

      heavy2: {
        name: '단수 분리',
        damage: 25,
        startup: 145,
        range: 94,
        knockbackX: 900,
        knockbackY: -520,
        cry: '1단 분리!',
      },

      heavyUp: {
        name: '팰컨 이륙',
        // 이 게임에서 가장 높이 솟는 상승기
        damage: 17,
        startup: 140,
        recovery: 400,
        range: 76,
        hitHeight: 144,
        knockbackY: -820,
        selfLaunch: -820,
        cry: 'To the moon!',
      },

      heavyDown: {
        name: '착륙 실패',
        // 착륙에 실패한 로켓이 그대로 폭발한다
        damage: 21,
        startup: 205,
        range: 158,
        shake: 0.026,
        cry: '착륙은 원래 어려워.',
      },

      airLight: { name: '도지 킥', damage: 8, startup: 46, range: 68 },

      airHeavy: {
        name: '오토파일럿',
        damage: 15,
        startup: 118,
        range: 124,
      },

      airDive: {
        name: '대기권 재진입',
        damage: 21,
        startup: 95,
        divePlunge: { speed: 1500, shockRange: 240, shockDamage: 12 },
        cry: '재진입 시작!',
      },

      skill: {
        name: '로켓 드롭',
        damage: 28,
        startup: 260,
        active: 260,
        recovery: 460,
        range: 200,
        hitHeight: 160,
        knockbackX: 440,
        knockbackY: -780,
        hitstun: 520,
        hitstop: 140,
        shake: 0.022,
        cooldown: 11000,
        effect: 'none',
        // 로켓처럼 솟구쳤다가 내리꽂고, 착지 지점에 충격파가 퍼진다
        selfLaunch: -760,
        divePlunge: {
          speed: 1500,
          shockRange: 420,
          shockDamage: 22,
        },
      },
    }),

    quotes: {
      intro: ['To Mars!'],
      skill: ['Rocket launch!'],
      ko: ['Recycled.'],
      surge: ['Dogecoin to the moon!'],
      comeback: ["I'm buying Twitter."],
      hurt: ['재진입 실패…'],
    },
  },

  /* ---------------------------------------------------------------- */
  /* 4. 리누스 토발즈맨 — 오픈소스                                     */
  /* ---------------------------------------------------------------- */
  linus: {
    id: 'linus',
    name: '리누스 토발즈맨',
    realName: 'Linus Torvalds',
    tagline: '궁지에 몰릴수록 강해진다',
    colors: { body: 0x334155, head: 0xf1c9a5, accent: 0x38bdf8 },
    stats: { speed: 250, jump: -700, doubleJump: -630, weight: 1.0 },

    art: {
      hair: 'messy',
      hairColor: 0x7c6244,
      glasses: 'rect',
      glassesColor: 0x1f2937,
      beard: true,
      beardColor: 0x8a7050,
      mouth: 'flat',
      eyes: 'dot',
    },

    passive: {
      type: 'power_when_low',
      name: '오픈소스',
      desc: '주가가 50% 이하일 때 공격력이 1.5배가 된다.',
      threshold: 50,
      powerMul: 1.5,
    },

    /*
     * 리치형 — 가장 멀리 닿지만 가장 느리다. 거리 유지 싸움에 강하다.
     * 기술은 전부 "git / 커널 / 코드 리뷰 독설"에서 따왔다.
     */
    moves: moveSet({
      light: {
        name: '코드 리뷰',
        damage: 9,
        startup: 90,
        active: 120,
        recovery: 170,
        range: 84,
      },

      // 연속기 — 지적하고, 되돌리고, 결국 갈아엎는다
      light2: { name: '변경 요청', damage: 10, startup: 112, range: 86 },
      light3: { name: '전면 재작성', damage: 17, startup: 140, range: 92, cry: '이건 처음부터 다시 짜.' },

      lightUp: {
        name: '머지 리퀘스트',
        // 대검을 위로 곧게 세워 찌른다 — 가장 높이 닿는 대공 견제
        damage: 10,
        startup: 105,
        recovery: 200,
        range: 78,
        hitHeight: 126,
        knockbackY: -520,
      },

      lightDown: {
        name: 'rm -rf',
        // 바닥을 통째로 쓸어버린다 — 이 게임에서 가장 긴 하단기
        damage: 9,
        startup: 95,
        recovery: 215,
        range: 132,
      },

      heavy: {
        name: '커밋 해머',
        damage: 21,
        startup: 215,
        recovery: 350,
        range: 102,
        hitstop: 135,
      },
      // 대시 중 J/K — 느리지만 대검 리치가 그대로 실린다
      dashAttack: { name: '강제 푸시', damage: 18, startup: 130, range: 112, lunge: 480 },

      heavy2: {
        name: '메인라인 병합',
        damage: 26,
        startup: 178,
        range: 108,
        knockbackX: 880,
        cry: '메인라인에 들어간다.',
      },

      heavyUp: {
        name: 'force push',
        // 대검을 아래에서 위로 밀어 올린다
        damage: 19,
        startup: 175,
        recovery: 395,
        range: 88,
        hitHeight: 140,
        selfLaunch: -480,
        cry: 'git push --force!',
      },

      heavyDown: {
        name: '롤백 슬램',
        // 커밋을 통째로 되돌리듯 지면을 내려찍는다
        damage: 22,
        startup: 240,
        range: 168,
        hitstop: 155,
        cry: '전부 되돌린다.',
      },

      airLight: { name: '패치 투척', damage: 9, startup: 66, range: 82 },

      airHeavy: {
        name: '펭귄 태클',
        damage: 17,
        startup: 145,
        range: 128,
      },

      airDive: {
        name: '커널 강림',
        damage: 20,
        startup: 125,
        cry: 'Talk is cheap.',
      },

      skill: {
        name: '커널 패닉',
        damage: 12,
        startup: 200,
        active: 180,
        recovery: 380,
        range: 140,
        hitHeight: 118,
        knockbackX: 220,
        knockbackY: -180,
        hitstun: 300,
        hitstop: 100,
        shake: 0.012,
        cooldown: 10000,
        effect: 'dot',
        // 5초 동안 1초당 4% 지속 피해
        effectValue: 4,
        effectDuration: 5000,
      },
    }),

    quotes: {
      intro: ['Talk is cheap. Show me the code.'],
      skill: ['Kernel panic!'],
      ko: ['Segmentation fault.'],
      surge: ['Open source, baby!'],
      comeback: ['포크해서 다시 만들면 되지.'],
      hurt: ['이건 내 커널이 아니야.'],
    },
  },

  /* ---------------------------------------------------------------- */
  /* 5. 패니 와이즈맨 — 밈 파워                                        */
  /* ---------------------------------------------------------------- */
  pepe: {
    id: 'pepe',
    name: '패니 와이즈맨',
    realName: 'Pennywise',
    tagline: '전부 다 걸었다. 너도 걸어라',
    colors: { body: 0xd8d2e8, head: 0xf5f0f5, accent: 0xef4444 },
    stats: { speed: 300, jump: -780, doubleJump: -710, weight: 0.85 },

    art: {
      // 붉게 솟구친 광대 머리 + 귀까지 찢어진 입 + 부릅뜬 눈
      hair: 'messy',
      hairColor: 0xdc2626,
      glasses: 'none',
      glassesColor: 0x000000,
      beard: false,
      beardColor: 0x000000,
      mouth: 'wide',
      eyes: 'bulge',
    },

    passive: {
      type: 'absorb_random',
      name: '밈 파워',
      desc: '타격에 성공할 때마다 피해량의 100~300%를 랜덤하게 흡수한다. (10~30%)',
      minRatio: 1.0,
      maxRatio: 3.0,
    },

    /*
     * 도박형 — 가장 빠른 약공격 + 가장 센 강공격. 대신 리치가 짧아 파고들어야 한다.
     * 기술은 전부 "붉은 풍선 / 하수구 / 광대"에서 따왔다.
     */
    moves: moveSet({
      light: {
        name: '광대 펀치',
        damage: 6,
        startup: 45,
        active: 90,
        recovery: 90,
        range: 54,
        knockbackX: 110,
        hitstun: 140,
        hitstop: 50,
      },

      // 연속기 — 저글링하듯 가지고 놀다 풍선을 터뜨린다
      light2: { name: '저글링', damage: 8, startup: 86, active: 100, recovery: 105, range: 58 },
      light3: { name: '풍선 터뜨리기', damage: 15, startup: 116, cry: '펑!' },

      lightUp: {
        name: '붉은 풍선',
        // 풍선을 띄워 상대를 함께 들어 올린다 — 가장 잘 뜨는 약공격
        damage: 8,
        startup: 68,
        recovery: 175,
        range: 64,
        hitHeight: 118,
        knockbackY: -620,
      },

      lightDown: {
        name: '하수구의 손',
        // 발밑 하수구에서 손이 튀어나와 발목을 잡는다
        damage: 8,
        startup: 62,
        recovery: 190,
        range: 88,
        // 붙잡아 두는 기술이라 거의 밀어내지 않는다
        knockbackX: 150,
        hitstun: 320,
      },

      heavy: {
        name: '올인 스윙',
        damage: 25,
        startup: 210,
        recovery: 360,
        range: 80,
        hitstop: 140,
      },
      // 대시 중 J/K — 물살을 타고 미끄러져 들어간다
      dashAttack: { name: '하수구 질주', damage: 17, startup: 84, lunge: 760 },

      heavy2: {
        name: '광대의 초대',
        damage: 30,
        startup: 168,
        range: 88,
        knockbackX: 940,
        cry: '너도 떠내려갈 거야!',
      },

      heavyUp: {
        name: '점프 스케어',
        // 하수구에서 튀어 오르며 상대를 놀래킨다
        damage: 20,
        startup: 130,
        recovery: 370,
        range: 70,
        hitHeight: 130,
        selfLaunch: -700,
        cry: '까꿍!',
      },

      heavyDown: {
        name: '하수구 개봉',
        // 발밑 맨홀 뚜껑이 통째로 열린다
        damage: 23,
        startup: 200,
        range: 146,
        knockbackY: -600,
        cry: '내려와서 같이 놀자.',
      },

      airLight: { name: '풍선 후려치기', damage: 8, startup: 48, range: 66 },

      airHeavy: {
        name: '광대 회전',
        damage: 18,
        startup: 120,
        range: 116,
      },

      airDive: {
        name: '떠내려가기',
        damage: 22,
        startup: 90,
        cry: '너도 떠내려갈 거야.',
      },

      skill: {
        name: '리츠고!',
        damage: 24,
        startup: 240,
        active: 150,
        recovery: 400,
        range: 124,
        hitHeight: 104,
        knockbackX: 580,
        knockbackY: -500,
        hitstun: 480,
        hitstop: 130,
        shake: 0.018,
        cooldown: 12000,
        // 시전 시 50% 확률로 자기 주가 +50% / -30%
        effect: 'gamble',
        effectValue: 50,
      },
    }),

    quotes: {
      intro: ['우리 같이 떠내려가자.'],
      skill: ['리츠고!'],
      ko: ['너도 상장폐지될 거야.'],
      surge: ['풍선 하나 줄까?'],
      comeback: ['여기선 다들 떠내려가.'],
      hurt: ['아직 안 끝났어…'],
    },
  },
};

/** 선택 화면 등에서 쓰는 고정 순서 */
export const CHARACTER_ORDER: CharacterId[] = [
  'gates',
  'jobs',
  'musk',
  'linus',
  'pepe',
];

/** ID로 캐릭터 설정을 가져온다. */
export function getCharacter(id: CharacterId): CharacterConfig {
  return CHARACTERS[id];
}
