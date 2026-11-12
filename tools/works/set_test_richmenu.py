# -*- coding: utf-8 -*-
"""정서 시험봇에 '리치 메뉴'를 거는 시험 스크립트 (사무실 PC에서 실행).

시험하려는 것: 리치 메뉴의 postback 버튼은 displayText를 비워 두면
방에 글을 남기지 않고 봇에게만 "어느 방에서 누가 눌렀는지" 신호를 보낸다(문서 기준).
PC에서도 리치 메뉴가 보이는지, 눌렀을 때 방에 글이 정말 안 남는지 확인한다.

사용법 (명령 프롬프트, 이 파일과 richmenu_test.png 가 같은 폴더에 있어야 함):
    python set_test_richmenu.py           # 보낼 내용만 보여 줌 (아무것도 바꾸지 않음)
    python set_test_richmenu.py --run     # 시험봇에 리치 메뉴 등록 + 기본 메뉴로 지정
    python set_test_richmenu.py --delete  # 시험봇 리치 메뉴 전부 지우기

고정 메뉴와 리치 메뉴는 둘 중 하나만 보이므로, 먼저
    python set_test_menu.py --delete
로 고정 메뉴를 지운 뒤 실행하세요. 시험이 끝나면 --delete 후 set_test_menu.py --run 으로 되돌립니다.
"""
import json, os, sys, urllib.request, uuid
from set_test_menu import load_cred, token, BOT_ID, WOFF

API = "https://www.worksapis.com/v1.0/bots/%s" % BOT_ID
IMG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "richmenu_test.png")

BODY = {
    "richmenuName": "정서 시험 리치메뉴",
    "size": {"width": 2500, "height": 843},
    "areas": [
        {"bounds": {"x": 0, "y": 0, "width": 1250, "height": 843},
         "action": {"type": "uri", "label": "사건 화면 열기", "uri": WOFF + "?view=timeline"}},
        # displayText 없음 → 방에 글이 남지 않아야 함
        {"bounds": {"x": 1250, "y": 0, "width": 1250, "height": 843},
         "action": {"type": "postback", "label": "이 방 사건 보기", "data": "room-case"}},
    ],
}

def req(method, url, tok, body=None, raw=None, ctype="application/json"):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    h = {"Authorization": "Bearer " + tok}
    if data is not None:
        h["Content-Type"] = ctype
    r = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r) as res:
            txt = res.read().decode()
            return res.status, (json.loads(txt) if txt.strip().startswith("{") else txt)
    except urllib.error.HTTPError as e:
        print("실패:", method, url.replace(API, ""), e.code, e.read().decode())
        sys.exit(1)

def upload(tok):
    _, a = req("POST", API + "/attachments", tok, {"fileName": "richmenu_test.png"})
    b = uuid.uuid4().hex
    with open(IMG, "rb") as f:
        img = f.read()
    parts = (
        ("--%s\r\nContent-Disposition: form-data; name=\"resourceName\"\r\n\r\nrichmenu_test.png\r\n" % b).encode()
        + ("--%s\r\nContent-Disposition: form-data; name=\"Filedata\"; filename=\"richmenu_test.png\"\r\n"
           "Content-Type: image/png\r\n\r\n" % b).encode()
        + img + ("\r\n--%s--\r\n" % b).encode()
    )
    s, _ = req("POST", a["uploadUrl"], tok, raw=parts, ctype="multipart/form-data; boundary=" + b)
    print("그림 올리기:", s)
    return a["fileId"]

def main():
    print("대상 봇:", BOT_ID, "(정서 시험봇)")
    print(json.dumps(BODY, ensure_ascii=False, indent=2))
    if "--run" in sys.argv:
        tok = token(load_cred())
        s, m = req("POST", API + "/richmenus", tok, BODY)
        rid = m["richmenuId"]
        print("리치 메뉴 만들기:", s, "ID", rid)
        s, _ = req("POST", API + "/richmenus/%s/image" % rid, tok, {"fileId": upload(tok)})
        print("그림 연결:", s)
        s, _ = req("POST", API + "/richmenus/%s/set-default" % rid, tok)
        print("기본 메뉴로 지정:", s, "→ 시험방을 나갔다 다시 들어가 보세요.")
    elif "--delete" in sys.argv:
        tok = token(load_cred())
        _, m = req("GET", API + "/richmenus", tok)
        for x in (m.get("richmenus") or []):
            s, _ = req("DELETE", API + "/richmenus/%s" % x["richmenuId"], tok)
            print("지움:", x["richmenuId"], s)
        print("끝")
    else:
        print("\n미리보기만 했습니다. 실제 등록은: python set_test_richmenu.py --run")

if __name__ == "__main__":
    main()
