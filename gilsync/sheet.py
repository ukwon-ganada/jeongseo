"""시트 읽기·쓰기 — Sheets API v4 를 requests 로 직접.

인증은 ADC 입니다. Cloud Run 에 붙여 둔 서비스 계정 자격이 컨테이너 안에서
저절로 잡히므로 **내려받을 JSON 키가 없습니다.** 유출될 파일 자체를 만들지
않고, iam.disableServiceAccountKeyCreation 조직 정책에도 걸리지 않습니다.

시트에는 그 서비스 계정 메일 주소를 편집자로 초대만 해 두면 됩니다.

색은 건드리지 않습니다. 공판 파랑·선고 빨강은 시트에 걸린 **조건부 서식**이라
(사건정리시트_기일가져오기.gs:476-484) 값만 쓰면 저절로 따라옵니다.
"""
import requests
import google.auth
import google.auth.transport.requests

import config
from hearing import text, norm, flat, make, col_letter, find_col

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
BASE = "https://sheets.googleapis.com/v4/spreadsheets"
TIMEOUT = 60

_creds = None


def _token():
    global _creds
    if _creds is None:
        _creds, _ = google.auth.default(scopes=SCOPES)
    if not _creds.valid:
        _creds.refresh(google.auth.transport.requests.Request())
    return _creds.token


def _call(method, path, **kw):
    r = requests.request(method, BASE + "/" + config.SHEET_ID + path,
                         headers={"Authorization": "Bearer " + _token()},
                         timeout=TIMEOUT, **kw)
    if r.status_code != 200:
        raise RuntimeError("Sheets HTTP %d — %s" % (r.status_code, r.text[:300]))
    return r.json()


def _a1(tab, rng=""):
    q = "'" + tab.replace("'", "''") + "'"
    return q + ("!" + rng if rng else "")


def _cell(grid, r, c):
    """줄이 들쭉날쭉해도(뒤쪽 빈 칸은 아예 안 옴) 안전하게 꺼낸다."""
    if r < 0 or r >= len(grid):
        return ""
    row = grid[r]
    return row[c] if 0 <= c < len(row) else ""


# ── 읽기 ────────────────────────────────────────────────────────────

def sheet_ids():
    """탭 이름 → gid. 메모를 쓸 때 gid 가 필요하다."""
    j = _call("GET", "", params={"fields": "sheets(properties(sheetId,title))"})
    return {s["properties"]["title"]: s["properties"]["sheetId"]
            for s in j.get("sheets", [])}


def read_grid(tab):
    """탭의 쓰인 범위를 통째로. 화면에 보이는 글자 그대로 받는다.

    UNFORMATTED_VALUE 로 받으면 날짜가 일련번호(45890)로 와서 견주기가
    어긋난다. FORMATTED_VALUE 라야 앱스 스크립트가 쓰던 값과 맞는다.
    """
    j = _call("GET", "/values/" + requests.utils.quote(_a1(tab), safe=""),
              params={"valueRenderOption": "FORMATTED_VALUE",
                      "dateTimeRenderOption": "FORMATTED_STRING"})
    return j.get("values", [])


def read_notes(tab, col, start_row, n):
    """기일 열의 메모만 읽어 온다. 없으면 빈 글자."""
    rng = _a1(tab, "%s%d:%s%d" % (col_letter(col), start_row,
                                  col_letter(col), start_row + n - 1))
    j = _call("GET", "", params={"ranges": rng, "includeGridData": "true",
                                 "fields": "sheets(data(rowData(values(note))))"})
    out = [""] * n
    try:
        rows = j["sheets"][0]["data"][0].get("rowData", [])
    except (KeyError, IndexError):
        return out
    for i, row in enumerate(rows[:n]):
        vals = row.get("values") or []
        if vals:
            out[i] = vals[0].get("note", "") or ""
    return out


def head_row(grid):
    """머리글 줄 찾기 (1부터). 못 찾으면 1.   (hrHeadRow_)"""
    for r in range(min(5, len(grid))):
        for c in range(len(grid[r])):
            h = norm(grid[r][c])
            if h.startswith("성명") or h.startswith("이름"):
                return r + 1
    return 1


def last_row(grid, head, col):
    """col 열에서 값이 있는 마지막 줄 (1부터).   (hrLastRow_)"""
    for r in range(len(grid) - 1, head - 1, -1):
        if text(_cell(grid, r, col - 1)).strip():
            return r + 1
    return head


# ── 쓰기 ────────────────────────────────────────────────────────────

def write_values(tab, col, start_row, values):
    """RAW 로 쓴다.

    USER_ENTERED 로 쓰면 '2026-08-26' 이 날짜로 바뀌고, 칸 서식에 따라
    '2026. 8. 26' 처럼 되돌아온다. 그러면 다음 실행이 또 '바뀜'으로 잡아
    영영 다시 쓰는 쳇바퀴가 된다. RAW 라야 글자 그대로 남는다.
    """
    rng = _a1(tab, "%s%d:%s%d" % (col_letter(col), start_row,
                                  col_letter(col), start_row + len(values) - 1))
    _call("PUT", "/values/" + requests.utils.quote(rng, safe=""),
          params={"valueInputOption": "RAW"},
          json={"values": [[v] for v in values]})


def write_notes(gid, col, start_row, notes):
    """메모는 values API 로 안 된다. batchUpdate + updateCells 라야 한다."""
    _call("POST", ":batchUpdate", json={"requests": [{
        "updateCells": {
            "range": {"sheetId": gid,
                      "startRowIndex": start_row - 1,
                      "endRowIndex": start_row - 1 + len(notes),
                      "startColumnIndex": col - 1,
                      "endColumnIndex": col},
            "rows": [{"values": [{"note": n}]} for n in notes],
            "fields": "note",
        }
    }]})


# ── 본체 ────────────────────────────────────────────────────────────

def apply_tab(tab, gid, by_code, dry_run):
    """한 탭에 기일을 채운다. hrProcess_ 248-343행과 같은 판단을 한다.

    by_code 에 없는 사건은 건드리지 않는다. 그래서 웹훅(한 건)과
    그물(전체)이 같은 함수를 쓴다 — 한 건짜리 by_code 를 넘기면 그만이다.
    """
    rep = {"tab": tab, "rows": 0, "fill": 0, "over": 0, "same": 0,
           "no_date": 0, "miss": 0, "blank": 0, "changes": [], "skipped": None}

    grid = read_grid(tab)
    if not grid:
        rep["skipped"] = "탭이 비었음"
        return rep

    head = head_row(grid)
    head_vals = grid[head - 1] if head - 1 < len(grid) else []
    code_col = find_col(head_vals, "사건번호")
    date_col = find_col(head_vals, "기일")
    name_col = find_col(head_vals, "성명") or find_col(head_vals, "이름")

    if not code_col or not date_col:
        rep["skipped"] = "사건번호 또는 기일 열을 찾지 못함"
        return rep

    last = last_row(grid, head, name_col or code_col)
    n = last - head
    if n < 1:
        rep["skipped"] = "데이터 없음"
        return rep
    rep["rows"] = n

    notes = read_notes(tab, date_col, head + 1, n)

    next_vals, next_notes, touched = [], [], False

    for i in range(n):
        r = head + i                       # grid 안에서의 0부터 줄번호
        cur = _cell(grid, r, date_col - 1)
        cur_note = notes[i]
        code = norm(_cell(grid, r, code_col - 1))

        if not code:
            next_vals.append(cur); next_notes.append(cur_note)
            rep["blank"] += 1
            continue

        rec = by_code.get(code)
        if rec is None:
            next_vals.append(cur); next_notes.append(cur_note)
            rep["miss"] += 1
            continue

        made_text, made_note = make(rec, config.COL)
        if not made_text:                  # 로웨어에 기일이 없으면 안 건드린다
            next_vals.append(cur); next_notes.append(cur_note)
            rep["no_date"] += 1
            continue

        # 메모는 원래 값(법정·시각). 칸과 똑같으면 굳이 달지 않는다
        want_note = made_note if (config.NOTE_ON and made_note and made_note != made_text) else ""

        cur_flat = flat(cur)
        if cur_flat == made_text and cur_note == want_note:
            next_vals.append(cur); next_notes.append(cur_note)
            rep["same"] += 1
            continue

        next_vals.append(made_text); next_notes.append(want_note)
        touched = True

        if cur_flat == made_text:          # 값은 그대로, 메모만 손봄
            rep["same"] += 1
        elif not cur_flat:
            rep["fill"] += 1
        else:
            rep["over"] += 1
            rep["changes"].append({
                "cell": col_letter(date_col) + str(head + 1 + i),
                "name": flat(_cell(grid, r, name_col - 1)) if name_col else code,
                "from": cur_flat, "to": made_text})

    if dry_run or not touched:
        return rep

    # ── 쓰기 직전 확인 ──
    # 앱스 스크립트는 getDocumentLock() 으로 막지만 여기서는 그 잠금을 쓸 수
    # 없다. 읽은 뒤에 종결이동 등이 줄을 밀었으면 엉뚱한 줄에 쓰게 된다.
    # 사건번호 열을 다시 읽어 그대로인지 본다. 어긋나면 이번엔 건너뛰고
    # 다음 그물이 메꾼다.
    again = read_grid(tab)
    for i in range(n):
        if norm(_cell(again, head + i, code_col - 1)) != norm(_cell(grid, head + i, code_col - 1)):
            rep["skipped"] = "쓰는 사이에 줄이 움직였음 — 건너뜀 (다음 실행이 메꿉니다)"
            rep["fill"] = rep["over"] = 0
            rep["changes"] = []
            return rep

    write_values(tab, date_col, head + 1, next_vals)
    if config.NOTE_ON:
        write_notes(gid, date_col, head + 1, next_notes)

    return rep
