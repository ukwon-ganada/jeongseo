# 정서 대법원 원문 받기 (크롬 확장)

로웨어가 연 대법원 나의사건(ssgo.scourt.go.kr) 사건 창에 이미 그려진 화면 글자만 읽어
Supabase `scourt-raw-ingest` 함수로 보냅니다. 화면을 누르거나 대법원에 요청을 보내지 않습니다.

- 설치: 크롬 `chrome://extensions` → 개발자 모드 → 압축해제된 확장 프로그램 로드 → 이 폴더
- `config.example.js`를 `config.js`로 복사하고 열쇠를 넣어야 동작합니다.
- 받은 원문: `scourt_raw_snapshots` → 트리거가 `scourt_case_info`, `scourt_progress_rows`로 정리
- 사건 화면(case-view)은 원문이 있으면 로웨어 진행내역보다 우선합니다(`scourt_overlay.ts`).
