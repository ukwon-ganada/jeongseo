# -*- coding: utf-8 -*-
"""사무실 PC 매칭 결과(channel_map_title.csv)를 법인 Supabase의 방↔사건 표로 옮기는 스크립트.

매칭 규칙을 새로 짜지 않고, match_by_title.py 가 매일 만드는 CSV 결과를 그대로 올립니다.
여러 번 돌려도 됩니다(매번 CSV 기준으로 다시 채움). CSV 파일은 읽기만 하고 고치지 않습니다.

사용법 (명령 프롬프트):
    python import_room_map.py          # CSV를 읽어 요약만 보여 줌 (아무것도 안 바꿈)
    python import_room_map.py --run    # Supabase에 올리고 방↔사건 표 다시 채우기

열쇠: works-sync가 쓰는 ~/.config/naverworks/supabase.json (비밀 값은 출력하지 않음)
"""
import csv, json, os, sys, urllib.request

CSV_PATH = r"C:\works-sync\out\channel_map_title.csv"
KEY_PATH = os.path.expanduser("~/.config/naverworks/supabase.json")
COLS = {  # CSV 열 이름 → 표 칸
    "channel_id": ["채널ID", "channel_id", "channelId"],
    "room_title": ["방제목", "room_title", "title"],
    "l_num": ["l_num", "사건고유번호"],
    "linked": ["연결사건"],
    "target": ["알림대상"],
    "basis": ["근거"],
    "confidence": ["신뢰도"],
}

def read_csv():
    for enc in ("utf-8-sig", "cp949"):
        try:
            with open(CSV_PATH, encoding=enc, newline="") as f:
                rows = list(csv.DictReader(f))
                return rows, enc
        except UnicodeDecodeError:
            continue
    sys.exit("CSV 글자 인코딩을 읽지 못했습니다.")

def convert(rows):
    head = rows[0].keys() if rows else []
    pick = {}
    for k, names in COLS.items():
        pick[k] = next((n for n in names if n in head), None)
    if not pick["channel_id"]:
        print("CSV 열 이름:", ", ".join(head))
        sys.exit("채널ID 열을 찾지 못했습니다. 위 열 이름을 Claude에게 알려 주세요.")
    out = []
    for r in rows:
        d = {k: (r.get(c) or "").strip() if c else "" for k, c in pick.items()}
        if d["channel_id"]:
            out.append(d)
    return out, pick

def load_key():
    with open(KEY_PATH, encoding="utf-8") as f:
        d = json.load(f)
    url = d.get("url") or d.get("SUPABASE_URL") or d.get("supabase_url")
    key = d.get("service_role_key") or d.get("service_key") or d.get("key") or d.get("SUPABASE_SERVICE_ROLE_KEY")
    if not (url and key):
        print("supabase.json 항목 이름:", ", ".join(sorted(d.keys())))
        sys.exit("주소나 열쇠 항목을 찾지 못했습니다. 위 이름을 Claude에게 알려 주세요(값은 보내지 마세요).")
    return url.rstrip("/"), key

def call(url, key, path, method="GET", body=None, prefer=None):
    h = {"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json"}
    if prefer:
        h["Prefer"] = prefer
    req = urllib.request.Request(url + path, method=method, headers=h,
                                 data=json.dumps(body, ensure_ascii=False).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req) as r:
            t = r.read().decode()
            return json.loads(t) if t.strip() else None
    except urllib.error.HTTPError as e:
        sys.exit("실패: %s %s %s" % (method, path.split("?")[0], e.read().decode()[:300]))

def main():
    rows, enc = read_csv()
    data, pick = convert(rows)
    print("CSV:", CSV_PATH, "(%s)" % enc)
    print("열 대응:", ", ".join("%s←%s" % (k, v or "없음") for k, v in pick.items()))
    print("방 %d개 · 사건 미상 %d개 · 연결사건 있는 방 %d개" % (
        len(data), sum(1 for d in data if not d["l_num"]), sum(1 for d in data if d["linked"])))
    if "--run" not in sys.argv:
        print("\n미리보기만 했습니다. 실제로 올리려면: python import_room_map.py --run")
        return
    url, key = load_key()
    call(url, key, "/rest/v1/works_room_map_raw?channel_id=not.is.null", "DELETE", prefer="return=minimal")
    for i in range(0, len(data), 500):
        call(url, key, "/rest/v1/works_room_map_raw", "POST", data[i:i + 500], prefer="return=minimal")
    res = call(url, key, "/rest/v1/rpc/works_room_case_import", "POST", {})
    print("결과:", json.dumps(res, ensure_ascii=False))

if __name__ == "__main__":
    main()
