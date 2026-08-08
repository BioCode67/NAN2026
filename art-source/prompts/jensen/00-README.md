# 젠슨 황제 — 스프라이트 프롬프트

총 **54장**을 9개 묶음으로 나눠 뽑는다.

## 순서

1. `1-이동.txt` 를 붙여넣어 먼저 뽑는다. **이 결과가 기준 그림이 된다.**
   얼굴·옷·무기가 마음에 들 때까지 여기서 다시 돌린다.
2. 2번부터는 프롬프트를 붙여넣을 때 **1번에서 뽑은 이미지를 참조로 함께 첨부**한다.
   그래야 묶음 사이에 캐릭터가 달라지지 않는다.
3. 나온 이미지를 `art-source/` 에 아래 이름으로 저장한다.

```
art-source/jensenhuang_b1.png    (1번 묶음)
art-source/jensenhuang_b2.png    (2번 묶음)
...
art-source/jensenhuang_b9.png
```

4. 전처리 + 합치기는 한 줄로 끝난다.

```bash
npm run sheet:merge -- jensenhuang
```

## 묶음 목록

| # | 파일 | 프레임 |
|---|---|---|
| 1 | `1-이동.txt` | IDLE, WALK, RUN_A, RUN_B, RUN_C, DASH |
| 2 | `2-공중.txt` | JUMP, FALL, LAND, AIR_J, AIR_K, AIR_DIVE |
| 3 | `3-지상 연속기.txt` | ATTACK_J, ATTACK_J2, ATTACK_J3, ATTACK_K, ATTACK_K2, DASH_ATTACK |
| 4 | `4-방향 커맨드 · 방어.txt` | ATTACK_J_UP, ATTACK_J_DOWN, ATTACK_K_UP, ATTACK_K_DOWN, GUARD, DIZZY |
| 5 | `5-스킬 · 프롬프트.txt` | SKILL_CHARGE, SKILL_L, SKILL_L2, SKILL_FX, PROMPT_CAST, PROMPT_FX |
| 6 | `6-아이템 · 도발.txt` | ITEM_GET, ITEM_HOLD, ITEM_THROW, ITEM_SWING, TAUNT, DOWN |
| 7 | `7-피격 · 결과 · 초상.txt` | HIT, HIT_AIR, KNOCKBACK, WIN, LOSE, PORTRAIT |
| 8 | `8-앞뒤 커맨드.txt` | ATTACK_J_FWD, ATTACK_J_BACK, ATTACK_K_FWD, ATTACK_K_BACK, DASH_SLIDE, AIR_UP |
| 9 | `9-잡기 · 대기.txt` | GRAB, GRAB_HOLD, GRABBED, THROW, AIR_BACK, IDLE_B |

## 잘 안 나올 때

| 증상 | 대응 |
|---|---|
| 칸마다 얼굴이 다르다 | 1번 이미지를 참조로 첨부했는지 확인. 안 했으면 반드시 첨부 |
| 배경이 투명/체크무늬로 나온다 | 그래도 괜찮다. 전처리가 세 경우를 모두 처리한다 |
| 칸 구분선이 그려져 나온다 | "칸 구분선을 그리지 말 것"을 한 번 더 강조해 재생성 |
| 글자가 박혀 나온다 | 전처리가 대부분 지우지만, 심하면 재생성이 빠르다 |
| 왼쪽을 보고 있다 | 재생성. 방향이 섞이면 게임에서 좌우 반전이 어긋난다 |
| 칸 수가 다르다 | 재생성. 개수가 맞아야 자동 매핑이 된다 |
