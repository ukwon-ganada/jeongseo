# 정서 사건 도우미 (PC)

사건방에서 ≡ 메뉴 **"이 방 사건 보기"**를 한 번 누르면, 이 PC 브라우저에 그 방 사건 화면이 바로 열립니다.
방에는 글이 남지 않습니다(리치 메뉴 postback).

```
사건방 ≡ "이 방 사건 보기"
  → 웍스가 봇 콜백으로 "누가·어느 방" 전달 (works-bot-callback)
  → pc_open_request 에 기록 (방 → 사건은 works_room_case 표)
  → 그 사람 PC 도우미가 pc-helper-wait 로 기다리다 받아서 브라우저로 엶
```

## 준비 (관리자, 한 번)
1. SQL Editor에서 `supabase/migrations/20261112_pc_helper.sql` 실행
2. 함수 배포: `works-bot-callback`, `pc-helper-wait` (둘 다 `--no-verify-jwt`), 시크릿 `WORKS_BOT_SECRET`
3. 개발자 콘솔 Bot → Callback URL = `https://<프로젝트>.supabase.co/functions/v1/works-bot-callback`
4. `server.json` 에 법인 프로젝트 주소·공개키가 들어 있음(공개 가능한 값)
5. 직원마다 토큰 발급: `select public.pc_helper_issue('<웍스 userId>', '<이름> PC');`

## 설치 (직원 PC, 한 번) — 직원 혼자 할 수 있음
PC 브라우저로 `https://woff.worksmobile.com/woff/Nxkob0LER_dfaSzH8s6flw?setup=pc` 를 열면
1) 명령 프롬프트에 붙일 한 줄 명령 2) 그 직원 전용 연결 코드(토큰)가 나옵니다. 명령을 붙여 넣고, 토큰을 물으면 코드를 붙이면 끝.
(코드는 웍스 로그인으로 직원 확인 뒤에만 발급, 서버엔 해시만 저장)
윈도우가 켜질 때 자동으로 뒤에서 돕니다.
지우기: `uninstall.cmd`. 기록: `%APPDATA%\JeongseoHelper\helper.log`

## 안전
- 토큰은 해시만 서버에 저장, 관리자가 `revoked_at` 을 채우면 그 PC는 바로 멈춤
- 도우미는 `https://woff.worksmobile.com/woff/` 주소만 엶
- 1분 넘게 지난 클릭은 열지 않음

## 모의 시험
`deno test --allow-net tools/pc-helper/flow_test.ts`
