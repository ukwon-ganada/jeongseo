"""슈파베이스 cases 읽기.

이 파일이 쓰는 키는 secret key 입니다. RLS 를 지나치므로 시트나 브라우저로
나가면 안 됩니다 — Cloud Run 안에서만 삽니다. 시트 안에 두지 않는 이유가
이것입니다(시트가 '링크가 있는 누구나 편집자' 라서).
"""
import requests

import config
from hearing import text, norm

TIMEOUT = 30


def _headers():
    return {"apikey": config.SUPABASE_KEY,
            "Authorization": "Bearer " + config.SUPABASE_KEY}


def fetch_all():
    """cases 를 전부 받아온다 (hrFetchAll_ 과 같은 방식).

    사건번호를 URL 에 넣어 하나씩 묻는 방법도 있지만, 전체가 900건 남짓이라
    그냥 다 받는 편이 낫다. 한글이 URL 에 안 들어가니 인코딩 사고도 없고
    길이 제한에도 안 걸린다.
    """
    want = ",".join(config.COL[k] for k in ("code", "date", "time", "contents", "updated"))
    out, offset = [], 0

    for _ in range(50):                       # 무한루프 방지 (hrFetchAll_ 의 guard)
        r = requests.get(
            config.SUPABASE_URL + "/rest/v1/" + config.TABLE,
            params={"select": want, "limit": config.PAGE, "offset": offset},
            headers=_headers(), timeout=TIMEOUT)
        if r.status_code != 200:
            raise RuntimeError("슈파베이스 HTTP %d — %s" % (r.status_code, r.text[:200]))

        body = r.json()
        out.extend(body)
        if len(body) < config.PAGE:
            return out
        offset += config.PAGE

    return out


def index_by_code(rows):
    """사건번호 → 줄. 같은 사건번호가 여럿이면 갱신시각이 최근인 것.

    원본: hrProcess_ 231-239행
    """
    by, dup = {}, 0
    for r in rows:
        code = norm(r.get(config.COL["code"]))
        if not code:
            continue
        old = by.get(code)
        if old is None:
            by[code] = r
            continue
        dup += 1
        if text(r.get(config.COL["updated"])) > text(old.get(config.COL["updated"])):
            by[code] = r
    return by, dup
