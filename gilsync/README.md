# gilsync — 기일을 사건정리 시트에 채우는 구글 봇

슈파베이스 `cases` 의 기일을 사건정리 시트(형사사건·항소사건)의 **기일** 열에
채웁니다. Cloud Run 에서 돕니다.

```
로웨어 → 슈파베이스 cases
            ↓ Database Webhook            ← 바뀌는 즉시
      ┌──────────────────────────┐
      │  Cloud Run               │  ← 슈파베이스 키는 여기에만
      │  POST /hook    실시간     │
      │  POST /sweep   그물       │  ← Cloud Scheduler 가 하루 두 번
      └──────────────────────────┘
            ↓ Sheets API v4 · 서비스 계정
       사건정리 시트
```

## 왜 시트가 아니라 여기서 읽나

시트 공유가 **「링크가 있는 누구나 편집자」** 입니다. 편집자는 확장프로그램 →
Apps Script 를 열 수 있으므로, 시트 안에 둔 키는 링크를 아는 사람 모두에게
열린 것과 같습니다.

저장소의 마이그레이션만 보면 `cases` 는 `authenticated` 정책 하나뿐이고
(`supabase/migrations/20260704_rls_and_sign.sql:38-44`) 「익명(anon)에는 어떤
테이블 정책도 만들지 않는다」고 적혀 있습니다. 그런데 **실제로는 읽힙니다.**
시트 안 publishable 키로 도는 기일 가져오기가 수정로그에 이렇게 남아 있습니다:

```
2026-08-18 16:44:03  기일 가져오기 — 빈 칸 15건 채움 · 4건 덮어씀
```

파일에 없는 `anon` 정책이 대시보드로 따로 만들어져 있다는 뜻입니다.

그래서 위험이 **가정이 아니라 확인된 경로**입니다. 링크를 아는 사람은 누구나
시트를 열어 → Apps Script 에서 키를 꺼내 → 슈파베이스에서 **의뢰인 890건을
통째로 받아갈 수 있습니다.** 시트에 키를 두는 한 이 길은 닫히지 않습니다.

그래서 읽는 일을 시트 밖으로 뺐습니다. 시트에는 결과만 들어갑니다.

## 시트에서 그대로 가져온 규칙

`사건정리시트_기일가져오기.gs` 의 계산을 **한 글자도 바꾸지 않고** 옮겼습니다.
모양이 어긋나면 매번 「바뀜」으로 잡혀 온 시트가 헛되이 다시 써지기 때문입니다.

| 옮긴 것 | 원본 | 어디로 |
|---|---|---|
| `hrMake_` `hrKind_` | `:424-449` | `hearing.make` `hearing.kind` |
| `hrFind_` (정확일치 먼저) | `:552-560` | `hearing.find_col` |
| `hrHeadRow_` `hrLastRow_` | `:535-570` | `sheet.head_row` `sheet.last_row` |
| `hrProcess_` 의 판단 | `:276-317` | `sheet.apply_tab` |

**색은 건드리지 않습니다.** 공판 파랑·선고 빨강은 `hrPaint_`(`:463-485`)가 건
**조건부 서식**이라 시트에 남아 있고, 값만 쓰면 저절로 따라옵니다.

## 설치

### 1. GCP

```bash
gcloud projects create jeongseo-gilsync          # 이미 있으면 건너뜀
gcloud config set project jeongseo-gilsync
gcloud services enable run.googleapis.com cloudscheduler.googleapis.com \
    secretmanager.googleapis.com sheets.googleapis.com
```

### 2. 서비스 계정 — JSON 키를 만들지 않습니다

Cloud Run 에 **붙여** 두면 자격이 컨테이너 안에서 저절로 잡힙니다(ADC).
내려받을 파일이 없으니 유출될 것도 없고, 요즘 기본으로 켜져 있는
`iam.disableServiceAccountKeyCreation` 조직 정책에도 걸리지 않습니다.

```bash
gcloud iam service-accounts create gilsync --display-name="기일 봇"
```

만들어진 주소(`gilsync@<프로젝트>.iam.gserviceaccount.com`)를
**시트에 편집자로 초대**하세요. 시트 → 공유 → 그 주소 붙여넣기 → 편집자.

### 3. 비밀값

```bash
printf '%s' 'sb_secret_...' | gcloud secrets create supabase-key --data-file=-
openssl rand -hex 32        | gcloud secrets create hook-secret  --data-file=-

for s in supabase-key hook-secret; do
  gcloud secrets add-iam-policy-binding $s \
    --member="serviceAccount:gilsync@$(gcloud config get-value project).iam.gserviceaccount.com" \
    --role=roles/secretmanager.secretAccessor
done
```

> 웹훅 비밀문자는 **영문·숫자만** 쓰세요. HTTP 헤더에는 ASCII 만 실려서,
> 한글을 넣으면 슈파베이스가 보내지도 못하고 영문도 모른 채 401 만 받습니다.
> `config.py` 가 뜰 때 막아 주긴 합니다.

### 4. 배포

```bash
gcloud run deploy gilsync --source . --region asia-northeast3 \
  --service-account gilsync@$(gcloud config get-value project).iam.gserviceaccount.com \
  --allow-unauthenticated \
  --set-env-vars SHEET_ID=1YCf77KxxotM4RnxePAhO16C7xbwEiHq4SuF5DN5vWto,SUPABASE_URL=https://nyjyemjsperpakrrgzcc.supabase.co \
  --set-secrets SUPABASE_KEY=supabase-key:latest,HOOK_SECRET=hook-secret:latest
```

`--allow-unauthenticated` 는 슈파베이스가 로그인 없이 찔러야 해서 필요합니다.
그래서 **비밀문자 헤더가 유일한 문지기**입니다. 반드시 길게 지으세요.

### 5. 먼저 미리보기

```bash
URL=$(gcloud run services describe gilsync --region asia-northeast3 --format='value(status.url)')
SECRET=$(gcloud secrets versions access latest --secret=hook-secret)

curl -sS -X POST "$URL/sweep?dry=1" -H "X-Hook-Secret: $SECRET" | python3 -m json.tool
```

무엇이 바뀔지만 셉니다. **시트는 그대로입니다.** 숫자가 뜻이 통하면:

```bash
curl -sS -X POST "$URL/sweep" -H "X-Hook-Secret: $SECRET" | python3 -m json.tool
```

### 6. 그물 — Cloud Scheduler

```bash
for t in "0 7 * * *" "0 13 * * *"; do
  gcloud scheduler jobs create http gilsync-sweep-${t:2:2} \
    --location asia-northeast3 --schedule "$t" --time-zone Asia/Seoul \
    --uri "$URL/sweep" --http-method POST \
    --headers "X-Hook-Secret=$SECRET"
done
```

### 7. 실시간 — 슈파베이스 웹훅

슈파베이스 → Database → Webhooks → 새로 만들기

| | |
|---|---|
| 표 | `cases` |
| 이벤트 | INSERT · UPDATE |
| 종류 | HTTP Request · POST |
| 주소 | `<URL>/hook` |
| 헤더 | `X-Hook-Secret: <비밀문자>` |

### 8. 앱스 스크립트 정리

이제 시트가 슈파베이스를 읽지 않습니다.

- `기일가져오기.gs` 의 `HR_KEY` 를 **비웁니다**
- 메뉴 → 기일 가져오기 → **매일 아침 자동 끄기**
- **파일은 지우지 마세요** — 「기일 글자색 입히기」(조건부 서식)가 계속 쓰입니다

## 시험

```bash
python3 test_hearing.py     # 표기 규칙이 원본과 같은지
python3 test_sheet.py       # 채움/덮음/건너뜀 판단
```

둘 다 시트도 슈파베이스도 타지 않습니다.

## 알아 둘 것

- **형사 391건 중 304건만** 채워집니다. `next_date` 가 있는 건만입니다.
- **지난 기일은 안 들어갑니다.** 사무실 PC 의 `case_events` 에만 있는 자료라
  여기서는 닿지 못합니다. `next_date`(다음 기일 하나)만 씁니다.
- **DELETE 는 무시합니다.** 종결 처리는 지금대로 사람이 합니다.
- **줄이 밀리는 경우** — 앱스 스크립트의 `getDocumentLock()` 을 여기서는 쓸 수
  없습니다. 쓰기 직전에 사건번호 열을 다시 읽어 어긋나면 그 탭을 건너뜁니다.
  다음 그물이 메꿉니다.
- **시트 공유는 그대로입니다.** 키는 빠지지만 링크를 아는 사람은 여전히
  시트에서 의뢰인 890건을 보고 고칠 수 있습니다. 따로 손봐야 합니다.
- **`cases` 의 `anon` 정책도 남습니다.** 이 봇은 키를 시트에서 뺄 뿐,
  `anon` 이 `cases` 를 읽을 수 있다는 사실 자체를 바꾸지 않습니다. 그 정책이
  정말 필요한지 슈파베이스 대시보드에서 따로 확인해야 합니다.
