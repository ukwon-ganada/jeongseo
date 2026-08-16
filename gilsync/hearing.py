"""기일 표기 규칙 — 사건정리시트_기일가져오기.gs:424-449 를 그대로 옮긴 것.

한 글자도 바꾸지 않습니다. 시트에 이미 들어 있는 값과 모양이 어긋나면
매번 「바뀜」으로 잡혀 온 시트가 헛되이 다시 써지기 때문입니다.

    칸    2026-08-26 공판기일
    메모   2026-08-26 공판기일(413호법정 10:30)
"""
import re

_DAY = re.compile(r"^(\d{4})-(\d{2})-(\d{2})")
_KIND = re.compile(r"기일|심문|변론|조정|선고|공판|심리")
_WS = re.compile(r"\s+")


def text(v):
    """hrText_ — None 을 빈 글자로."""
    return "" if v is None else str(v)


def norm(v):
    """hrNorm_ — 공백을 모두 지운다. 사건번호 견주기에 쓴다."""
    return re.sub(r"\s", "", text(v))


def flat(v):
    """공백을 하나로 줄이고 앞뒤를 턴다."""
    return _WS.sub(" ", text(v)).strip()


def kind(contents):
    """'공판기일(413호법정 10:30)' → '공판기일'   (hrKind_)

    괄호 앞까지가 종류다. 종류로 보이지 않으면 버린다.
    """
    t = flat(contents)
    if not t:
        return ""
    k = t.split("(")[0].strip()
    if not k:
        return ""
    if not _KIND.search(k):
        return ""
    return k


def make(rec, col):
    """슈파베이스 한 줄 → (칸에 넣을 글, 메모에 넣을 글)   (hrMake_)

    기일 날짜가 없으면 ('', '') 를 돌려준다 — 그 칸은 건드리지 않는다.

    예전에는 종류가 없을 때 시각으로 대신했는데, 로웨어 시각이 '00:00:00' 인
    사건이 많아 '2026-08-13 00:00:00' 같은 값이 15건 생겼다. 지금은 날짜만 넣는다.
    """
    d = text(rec.get(col["date"])).strip()
    m = _DAY.match(d)
    if not m:
        return "", ""
    day = m.group(1) + "-" + m.group(2) + "-" + m.group(3)

    full = flat(rec.get(col["contents"]))
    k = kind(full)

    out_text = (day + " " + k) if k else day
    out_note = (day + " " + full) if full else ""
    return out_text, out_note


def col_letter(c):
    """1 → A, 27 → AA   (hrL_)"""
    s = ""
    while c > 0:
        m = (c - 1) % 26
        s = chr(65 + m) + s
        c = (c - m - 1) // 26
    return s


def find_col(head_row, key):
    """머리글 이름으로 열 찾기 (1부터). 없으면 0.   (hrFind_)

    딱 맞는 이름을 먼저 본다 — '사건번호' 를 찾을 때 '1심사건번호' 가,
    '관할' 을 찾을 때 '관할경찰서' 가 걸리면 안 되기 때문이다.
    이미 한 번 사고가 났던 자리라 순서를 바꾸면 안 된다.
    """
    for c, v in enumerate(head_row):
        if norm(v) == key:
            return c + 1
    for c, v in enumerate(head_row):
        h = norm(v)
        if h and h.startswith(key):
            return c + 1
    return 0
