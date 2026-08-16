"""apply_tab 의 판단을 시험한다 — 시트도 슈파베이스도 없이.

hrProcess_ 248-343행이 하던 판단과 같아야 한다:
빈 칸 채우기 / 덮어쓰기 / 이미 같음 / 기일 없음 / 못 찾음 / 빈 줄.

    python3 test_sheet.py
"""
import os

os.environ.setdefault("SHEET_ID", "x")
os.environ.setdefault("SUPABASE_URL", "https://x")
os.environ.setdefault("SUPABASE_KEY", "x")
os.environ.setdefault("HOOK_SECRET", "x")

import sheet

fails = []


def eq(got, want, label):
    ok = got == want
    print(("  ok  " if ok else "  X   ") + label + ("" if ok else "  -> %r (바랄 것 %r)" % (got, want)))
    if not ok:
        fails.append(label)


#            A          B                 C(기일)                  D
GRID = [
    ["사건정리"],                                                        # 1  잡음
    ["성명", "사건번호", "기일", "재판부"],                                # 2  머리글
    ["홍길동", "2026고단101290", "", ""],                                # 3  빈 칸 → 채움
    ["김철수", "2026고단101291", "2026-01-01 공판기일", ""],              # 4  → 덮음
    ["이영희", "2026고단101292", "2026-08-26 공판기일", ""],              # 5  → 이미 같음
    ["박민수", "2026고단101293", "", ""],                                # 6  로웨어에 기일 없음
    ["최지우", "2026고단999999", "", ""],                                # 7  슈파베이스에 없음
    ["정수민", "", "", ""],                                             # 8  사건번호 빈 줄
]

BY_CODE = {
    "2026고단101290": {"next_date": "2026-08-26", "next_contents": "공판기일(413호법정 10:30)"},
    "2026고단101291": {"next_date": "2026-09-01", "next_contents": "선고기일(301호법정 14:00)"},
    "2026고단101292": {"next_date": "2026-08-26", "next_contents": "공판기일"},
    "2026고단101293": {"next_date": None, "next_contents": "접수"},
}

written = {}


def fake(grid, notes=None):
    """read_grid / read_notes / write_* 를 가짜로 바꾼다."""
    written.clear()
    seq = list(grid) if isinstance(grid, tuple) else [grid, grid]
    sheet.read_grid = lambda tab, _s=iter(seq): next(_s)
    sheet.read_notes = lambda tab, col, start, n: list(notes) if notes else [""] * n
    sheet.write_values = lambda tab, col, start, vals: written.update(values=vals, col=col, start=start)
    sheet.write_notes = lambda gid, col, start, ns: written.update(notes=ns)


# ── 머리글·열 찾기 ────────────────────────────────────────────────────
eq(sheet.head_row(GRID), 2, "머리글 줄은 '성명' 이 있는 2번째 줄")
eq(sheet.last_row(GRID, 2, 1), 8, "값이 있는 마지막 줄은 8 (사건번호가 비어도 성명이 있으면 셈)")

# ── 본 판단 ──────────────────────────────────────────────────────────
fake(GRID)
rep = sheet.apply_tab("형사사건", 0, BY_CODE, dry_run=False)

eq(rep["rows"], 6, "머리글 아래 6줄")
eq(rep["fill"], 1, "빈 칸 채우기 1건")
eq(rep["over"], 1, "덮어쓰기 1건")
eq(rep["same"], 1, "이미 같음 1건")
eq(rep["no_date"], 1, "로웨어에 기일 없음 1건 — 안 건드림")
eq(rep["miss"], 1, "슈파베이스에서 못 찾음 1건")
eq(rep["blank"], 1, "사건번호 빈 줄 1건")
eq(rep["skipped"], None, "건너뛰지 않았음")

eq(written["col"], 3, "기일은 C열")
eq(written["start"], 3, "머리글 다음 줄부터")
eq(written["values"], [
    "2026-08-26 공판기일",        # 채움
    "2026-09-01 선고기일",        # 덮음
    "2026-08-26 공판기일",        # 그대로
    "",                          # 기일 없음 — 원래 값 그대로
    "",                          # 못 찾음 — 원래 값 그대로
    "",                          # 빈 줄
], "쓰는 값")
eq(written["notes"], [
    "2026-08-26 공판기일(413호법정 10:30)",
    "2026-09-01 선고기일(301호법정 14:00)",
    "",                          # 메모가 칸과 같으면 달지 않는다
    "", "", "",
], "쓰는 메모")

eq(rep["changes"][0]["from"], "2026-01-01 공판기일", "덮은 값의 원래 것을 남긴다")
eq(rep["changes"][0]["to"], "2026-09-01 선고기일", "바꾼 값")
eq(rep["changes"][0]["cell"], "C4", "어느 칸인지")
eq(rep["changes"][0]["name"], "김철수", "누구인지")

# ── 쳇바퀴 검사 — 쓴 뒤 다시 돌리면 아무것도 안 바뀌어야 한다 ─────────────
after = [list(r) for r in GRID]
for i, v in enumerate(written["values"]):
    after[2 + i][2] = v
fake(after, notes=written["notes"])
rep2 = sheet.apply_tab("형사사건", 0, BY_CODE, dry_run=False)
eq(rep2["fill"] + rep2["over"], 0, "두 번째 실행은 채울 것도 덮을 것도 없다")
eq("values" in written, False, "시트를 아예 건드리지 않는다")

# ── 미리보기는 시트를 안 건드린다 ──────────────────────────────────────
fake(GRID)
rep3 = sheet.apply_tab("형사사건", 0, BY_CODE, dry_run=True)
eq(rep3["fill"], 1, "미리보기도 셈은 똑같이")
eq("values" in written, False, "미리보기는 쓰지 않는다")

# ── 쓰는 사이에 줄이 밀리면 건너뛴다 ───────────────────────────────────
moved = [list(r) for r in GRID]
moved.insert(3, ["새사건", "2026고단777777", "", ""])      # 줄 하나가 끼어듦
fake((GRID, moved))
rep4 = sheet.apply_tab("형사사건", 0, BY_CODE, dry_run=False)
eq("values" in written, False, "엉뚱한 줄에 쓰지 않는다")
eq(rep4["skipped"] is not None, True, "건너뛴 까닭을 남긴다")
eq(rep4["fill"] + rep4["over"], 0, "건너뛰었으면 셈도 0 으로 되돌린다")

# ── 머리글이나 열을 못 찾으면 ─────────────────────────────────────────
fake([["성명", "이름만있음"]])
eq(sheet.apply_tab("형사사건", 0, BY_CODE, False)["skipped"],
   "사건번호 또는 기일 열을 찾지 못함", "열을 못 찾으면 건너뛴다")

fake([])
eq(sheet.apply_tab("형사사건", 0, BY_CODE, False)["skipped"], "탭이 비었음", "빈 탭")

print("\n실패 %d건" % len(fails))
raise SystemExit(1 if fails else 0)
