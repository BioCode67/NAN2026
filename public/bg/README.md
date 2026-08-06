# 스테이지 배경

생성한 배경 그림을 여기에 넣는다. 넣으면 다음 새로고침부터 바로 보인다.

| 파일 | 언제 보이나 |
|---|---|
| `stage_exchange.png` | 기본 스테이지 |
| `stage_moon.png` | 맵 기믹 "달 표면"(저중력) |
| `stage_lava.png` | 맵 기믹 "용암 지대" |
| `stage_storm.png` | 맵 기믹 "폭풍 경보"(강풍) |
| `stage_blackout.png` | 맵 기믹 "정전" |

프롬프트는 `art-source/prompts/scenes/` 에 있다 (`npm run prompts` 로 다시 만든다).

크기는 아무래도 좋다 — 비율을 지킨 채 월드(1920x720)를 덮도록 맞춰진다.
한 장도 없어도 게임은 코드로 그린 배경으로 그대로 돌아간다.
