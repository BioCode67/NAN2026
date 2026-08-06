# 스테이지 · UI 프롬프트

캐릭터가 아닌 그림들이다. 캐릭터 시트와 달리 **한 장씩 독립**이라
아무 순서로 뽑아도 되고, 마음에 안 드는 것만 다시 돌리면 된다.

## 스테이지 배경

맵 기믹과 짝지어 두었다. "달로 보내줘"를 입력하면 물리만 바뀌는 게 아니라
배경까지 달 표면으로 갈린다 — 말과 그림이 따로 놀지 않게 하기 위해서다.

| 프롬프트 | 저장 위치 | 언제 보이나 |
|---|---|---|
| `exchange-증권 거래소.txt` | `public/bg/stage_exchange.png` | 기본 스테이지 — 전투가 시작되는 곳 |
| `moon-달 표면.txt` | `public/bg/stage_moon.png` | 맵 기믹 "달 표면"(저중력)이 걸렸을 때 |
| `lava-용암 지대.txt` | `public/bg/stage_lava.png` | 맵 기믹 "용암 지대"가 걸렸을 때 |
| `storm-폭풍 경보.txt` | `public/bg/stage_storm.png` | 맵 기믹 "폭풍 경보"(강풍)가 걸렸을 때 |
| `blackout-정전.txt` | `public/bg/stage_blackout.png` | 맵 기믹 "정전"이 걸렸을 때 |

## UI

| 프롬프트 | 저장 위치 | 용도 |
|---|---|---|
| `title_logo-타이틀 로고.txt` | `public/ui/ui_title_logo.png` | 타이틀 로고 |
| `title_bg-타이틀 화면 배경.txt` | `public/ui/ui_title_bg.png` | 타이틀 화면 배경 |
| `select_bg-캐릭터 선택 화면 배경.txt` | `public/ui/ui_select_bg.png` | 캐릭터 선택 화면 배경 |
| `result_bg-결과 화면 배경.txt` | `public/ui/ui_result_bg.png` | 결과 화면 배경 |
| `item_icons-아이템 아이콘 6종.txt` | `public/ui/ui_item_icons.png` | 아이템 아이콘 6종 |
| `prompt_orb-프롬프트 오브 4단계.txt` | `public/ui/ui_prompt_orb.png` | 프롬프트 오브 4단계 |

## 공통 주의

- 배경에는 **캐릭터를 그리지 말 것.** 캐릭터는 게임이 위에 올린다
- 배경 가운데와 아래는 비워 둘 것 — 전투가 벌어지는 자리다
- 전체적으로 어둡게. 밝은 캐릭터가 위에 올라가야 대비로 살아난다
- 아이콘·오브는 **투명 배경**이 필요하다. 안 되면 순수 마젠타(#FF00FF)로

## 받은 뒤

배경은 전처리가 필요 없다. 위 표의 경로에 그대로 저장하면 게임이 읽는다.
아이콘·오브처럼 여러 칸이 든 그림만 전처리를 거친다.

```bash
npm run sheet -- art-source/ui_item_icons.png public/ui/ui_item_icons.png
```
