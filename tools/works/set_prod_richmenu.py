# -*- coding: utf-8 -*-
"""운영 봇(실제 사건방에 들어가 있는 봇)에 사건 화면 리치 메뉴를 거는 스크립트 (사무실 PC에서 실행).

메뉴 두 칸 (방에 글이 남지 않음):
  [📱 사건 보기] uri      → 휴대폰: 그 방 사건 화면이 웍스 안에서 열림 (넓은 칸)
  [💻 PC로 보기] postback → 누른 사람 PC의 '정서 사건 도우미'가 브라우저에 그 방 사건 화면을 엶
  웍스는 봇마다 메뉴 한 벌이라 휴대폰·PC에 같은 메뉴가 뜸

사용법 (명령 프롬프트, 이 파일·set_test_menu.py·richmenu_prod.png 가 같은 폴더):
    python set_prod_richmenu.py           # 확인만: 운영 봇 이름, 지금 걸린 고정 메뉴·리치 메뉴를 보여 줌 (아무것도 안 바꿈)
    python set_prod_richmenu.py --run     # 운영 봇에 리치 메뉴 등록 + 기본 메뉴로 지정 → 모든 사건방에 보임
    python set_prod_richmenu.py --delete  # 이 스크립트가 만든 리치 메뉴만 지우기 (되돌리기)
    python set_prod_richmenu.py --replace # 기존 메뉴를 지우고 새 그림·이름으로 다시 등록

운영 봇 ID 는 works-sync 가 쓰는 ~/.config/naverworks/credentials.json 의 bot_id 를 씁니다.
주의: 고정 메뉴와 리치 메뉴는 둘 중 하나만 보입니다. 운영 봇에 고정 메뉴가 있으면 --run 전에 알려 주세요.
"""
import json, os, sys, urllib.request, uuid
from set_test_menu import load_cred, token, CRED, WOFF

NAME = "정서 사건 화면 메뉴"
IMG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "richmenu_prod.png")

def bot_id():
    with open(CRED, encoding="utf-8") as f:
        d = json.load(f)
    b = d.get("bot_id") or d.get("botId") or d.get("BOT_ID")
    if not b:
        print("credentials.json 에 bot_id 가 없습니다."); sys.exit(1)
    return str(b)

BID = bot_id()
API = "https://www.worksapis.com/v1.0/bots/%s" % BID
BODY = {
    "richmenuName": NAME,
    "size": {"width": 2500, "height": 843},
    "areas": [
        # PC 앱은 그림 대신 이 이름(label)을 ≡ 목록으로 보여 줌 → PC에서 쓰는 칸을 맨 위에, 이름을 분명하게
        {"bounds": {"x": 1640, "y": 0, "width": 860, "height": 843},
         "action": {"type": "postback", "label": "이 방 사건정보 보기", "data": "room-case"}},
        {"bounds": {"x": 0, "y": 0, "width": 1640, "height": 843},
         "action": {"type": "uri", "label": "휴대폰에서 보기", "uri": WOFF + "?view=timeline"}},
    ],
}

def req(method, url, tok, body=None, raw=None, ctype="application/json", ok404=False):
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
        if ok404 and e.code == 404:
            return 404, None
        print("실패:", method, url.replace(API, ""), e.code, e.read().decode())
        sys.exit(1)

def upload(tok):
    _, a = req("POST", API + "/attachments", tok, {"fileName": "richmenu_prod.png"})
    b = uuid.uuid4().hex
    with open(IMG, "rb") as f:
        img = f.read()
    parts = (
        ("--%s\r\nContent-Disposition: form-data; name=\"resourceName\"\r\n\r\nrichmenu_prod.png\r\n" % b).encode()
        + ("--%s\r\nContent-Disposition: form-data; name=\"Filedata\"; filename=\"richmenu_prod.png\"\r\n"
           "Content-Type: image/png\r\n\r\n" % b).encode()
        + img + ("\r\n--%s--\r\n" % b).encode()
    )
    s, _ = req("POST", a["uploadUrl"], tok, raw=parts, ctype="multipart/form-data; boundary=" + b)
    print("그림 올리기:", s)
    return a["fileId"]

def check(tok):
    s, b = req("GET", API, tok, ok404=True)
    print("운영 봇:", BID, "이름:", (b or {}).get("botName", "(확인 못 함)"))
    s, m = req("GET", API + "/persistentmenu", tok, ok404=True)
    print("고정 메뉴:", "없음" if s == 404 or not m else json.dumps(m, ensure_ascii=False))
    s, m = req("GET", API + "/richmenus", tok, ok404=True)
    menus = (m or {}).get("richmenus") or []
    print("리치 메뉴:", len(menus), "개", [x.get("richmenuName") for x in menus])
    s, m = req("GET", API + "/richmenus/default", tok, ok404=True)
    print("기본 리치 메뉴:", "없음" if s == 404 or not m else m.get("richmenuId"))
    return menus

def main():
    tok = token(load_cred())
    menus = check(tok)
    if "--replace" in sys.argv:
        for x in menus:
            if x.get("richmenuName") == NAME:
                s, _ = req("DELETE", API + "/richmenus/%s" % x["richmenuId"], tok)
                print("옛 메뉴 지움:", x["richmenuId"], s)
        menus = []
    if "--run" in sys.argv or "--replace" in sys.argv:
        if any(x.get("richmenuName") == NAME for x in menus):
            print("이미 같은 이름의 메뉴가 있습니다. 먼저 --delete 하세요."); sys.exit(1)
        s, m = req("POST", API + "/richmenus", tok, BODY)
        rid = m["richmenuId"]
        print("리치 메뉴 만들기:", s, "ID", rid)
        s, _ = req("POST", API + "/richmenus/%s/image" % rid, tok, {"fileId": upload(tok)})
        print("그림 연결:", s)
        s, _ = req("POST", API + "/richmenus/%s/set-default" % rid, tok)
        print("기본 메뉴로 지정:", s, "→ 웍스 앱을 껐다 켜면 사건방 아래에 메뉴가 보입니다.")
    elif "--delete" in sys.argv:
        for x in menus:
            if x.get("richmenuName") == NAME:
                s, _ = req("DELETE", API + "/richmenus/%s" % x["richmenuId"], tok)
                print("지움:", x["richmenuId"], s)
        print("끝")
    else:
        print("\n확인만 했습니다. 위 내용을 Claude에게 보여 주세요. 실제 등록은: python set_prod_richmenu.py --run")

if __name__ == "__main__":
    main()
