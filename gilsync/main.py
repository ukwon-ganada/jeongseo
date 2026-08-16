"""구글 봇 — 기일을 사건정리 시트에 채운다.

    POST /hook    슈파베이스 웹훅. 바뀌는 즉시 그 한 줄만
    POST /sweep   그물. 전체를 훑어 놓친 것을 메운다 (Cloud Scheduler)
    GET  /health

둘 다 헤더 X-Hook-Secret 으로 막는다. /hook 은 슈파베이스가 로그인 없이
찔러야 해서 열어 두어야 하므로, 비밀문자가 유일한 문지기다.
"""
import hmac
import logging

from fastapi import FastAPI, Header, HTTPException, Request

import config
import sheet
import supa
from hearing import norm

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("gilsync")

app = FastAPI(title="gilsync")


_SECRET = config.HOOK_SECRET.encode("utf-8")


def _guard(given):
    """상수시간 비교. 한 글자씩 새는 걸 막는다.

    반드시 바이트로 견준다. 글자로 견주면 비ASCII 가 들어왔을 때
    compare_digest 가 TypeError 를 던져 401 이 아니라 500 이 나간다 —
    헤더에 한글을 넣는 것만으로 문지기를 넘어뜨릴 수 있다.
    """
    if not hmac.compare_digest((given or "").encode("utf-8"), _SECRET):
        raise HTTPException(status_code=401, detail="unauthorized")


def _run(by_code, dry_run):
    gids = sheet.sheet_ids()
    reports = []
    for tab in config.TABS:
        if tab not in gids:
            reports.append({"tab": tab, "skipped": "탭 없음"})
            continue
        try:
            reports.append(sheet.apply_tab(tab, gids[tab], by_code, dry_run))
        except Exception as err:                       # 한 탭이 넘어져도 다른 탭은 간다
            log.exception("[%s] 실패", tab)
            reports.append({"tab": tab, "skipped": "오류 — %s" % err})

    total = {k: sum(r.get(k, 0) for r in reports)
             for k in ("rows", "fill", "over", "same", "no_date", "miss", "blank")}
    return {"dry_run": dry_run, "total": total, "tabs": reports}


@app.get("/health")
def health():
    return {"ok": True, "tabs": config.TABS}


@app.post("/sweep")
def sweep(dry: int = 0, x_hook_secret: str = Header(default="")):
    """전체 훑기. dry=1 이면 무엇이 바뀔지만 세고 시트는 그대로 둔다."""
    _guard(x_hook_secret)

    rows = supa.fetch_all()
    by_code, dup = supa.index_by_code(rows)
    with_date = sum(1 for r in rows if str(r.get(config.COL["date"]) or "").strip())
    log.info("슈파베이스 %d건 · 기일 있는 것 %d건 · 사건번호 겹침 %d건",
             len(rows), with_date, dup)

    out = _run(by_code, dry_run=bool(dry))
    out["supabase"] = {"rows": len(rows), "with_date": with_date, "dup": dup}
    log.info("%s", out["total"])
    return out


@app.post("/hook")
async def hook(request: Request, x_hook_secret: str = Header(default="")):
    """슈파베이스 Database Webhook.

    바뀐 줄이 통째로 실려 오므로 슈파베이스를 되묻지 않는다.
    기일과 무관한 칸만 바뀌었으면 아무것도 하지 않는다.
    """
    _guard(x_hook_secret)

    body = await request.json()
    rec = body.get("record") or {}
    old = body.get("old_record") or {}

    code = rec.get(config.COL["code"])
    if not code:
        return {"skipped": "사건번호 없음"}

    watched = (config.COL["date"], config.COL["contents"])
    if old and all(rec.get(k) == old.get(k) for k in watched):
        return {"skipped": "기일이 그대로", "code": code}

    log.info("웹훅 %s %s — %s", body.get("type"), code, rec.get(config.COL["date"]))
    return _run({norm(code): rec}, dry_run=False)
