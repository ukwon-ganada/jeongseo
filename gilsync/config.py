"""설정 — 전부 환경변수에서.

비밀값(슈파베이스 키·웹훅 비밀문자)은 Secret Manager 에 넣고
Cloud Run 의 --set-secrets 로 환경변수처럼 꽂아 줍니다.
코드에도 이미지에도 남지 않습니다.
"""
import os


def _req(name):
    v = os.environ.get(name, "").strip()
    if not v:
        raise RuntimeError("환경변수 " + name + " 가 비어 있습니다")
    return v


SHEET_ID = _req("SHEET_ID")
SUPABASE_URL = _req("SUPABASE_URL").rstrip("/")

# secret key. RLS 를 지나치므로 이 값이 시트나 브라우저로 나가면 안 됩니다.
SUPABASE_KEY = _req("SUPABASE_KEY")

# 웹훅 비밀문자. 기본값을 두지 않습니다 — 빈 채로 뜨느니 안 뜨는 게 낫습니다.
HOOK_SECRET = _req("HOOK_SECRET")

# HTTP 헤더에는 ASCII 만 실립니다. 한글을 넣으면 슈파베이스가 보내지도 못하고,
# 보내도 글자가 깨져 영영 401 만 받습니다. 그 자리에서 알아채기 어려우니
# 뜰 때 막습니다. 영문·숫자·기호로 길게 지으세요.
if not HOOK_SECRET.isascii():
    raise RuntimeError("HOOK_SECRET 에는 ASCII(영문·숫자·기호)만 쓸 수 있습니다")

TABS = [t.strip() for t in os.environ.get("TABS", "형사사건,항소사건").split(",") if t.strip()]
TABLE = os.environ.get("TABLE", "cases")
PAGE = int(os.environ.get("PAGE", "1000"))

# 법정·시각을 메모로 남길지. 시트의 HR_NOTE 와 같은 뜻입니다.
NOTE_ON = os.environ.get("NOTE", "1") != "0"

# cases 표의 칸 이름 — 사건정리시트_기일가져오기.gs:59-65 와 같아야 합니다
COL = {
    "code": "l_code",          # 사건번호  '2026고단101290'
    "date": "next_date",       # 기일 날짜  '2026-08-26'
    "time": "next_time",       # 기일 시각  '10:30'
    "contents": "next_contents",  # 종류+법정  '공판기일(413호법정 10:30)'
    "updated": "updated_at",   # 갱신시각
}
