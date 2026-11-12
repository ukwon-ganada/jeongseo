# -*- coding: utf-8 -*-
"""정서 시험봇에 고정 메뉴 4개를 등록하는 1회용 스크립트 (사무실 PC에서 실행).

사용법 (명령 프롬프트):
    python set_test_menu.py           # 보낼 내용만 보여 주고 끝냄 (아무것도 바꾸지 않음)
    python set_test_menu.py --run     # 실제로 시험봇에 메뉴 등록
    python set_test_menu.py --delete  # 시험봇 메뉴 지우기

열쇠 값은 works-sync가 쓰는 ~/.config/naverworks/credentials.json 에서 읽습니다.
비밀 값은 화면에 출력하지 않습니다.
"""
import json, os, sys, time, urllib.parse, urllib.request

BOT_ID = "13580302"  # 정서 시험봇 (운영 봇 아님)
WOFF = "https://woff.worksmobile.com/woff/Nxkob0LER_dfaSzH8s6flw"
MENU = [
    ("사건 타임라인", WOFF + "?view=timeline"),
    ("기한 보기", WOFF + "?view=deadline"),
    ("기일 보기", WOFF + "?view=hearing"),
    ("진행내용", WOFF + "?view=progress"),
]
CRED = os.path.expanduser("~/.config/naverworks/credentials.json")

def pick(d, *names):
    for n in names:
        if d.get(n):
            return d[n]
    return None

def load_cred():
    with open(CRED, encoding="utf-8") as f:
        d = json.load(f)
    c = {
        "client_id": pick(d, "client_id", "clientId", "CLIENT_ID"),
        "client_secret": pick(d, "client_secret", "clientSecret", "CLIENT_SECRET"),
        "service_account": pick(d, "service_account", "serviceAccount", "service_account_id", "SERVICE_ACCOUNT"),
        "private_key": pick(d, "private_key", "privateKey", "PRIVATE_KEY"),
    }
    if not c["private_key"]:
        p = pick(d, "private_key_path", "privateKeyPath", "private_key_file", "key_file")
        if p:
            with open(os.path.expanduser(p), encoding="utf-8") as f:
                c["private_key"] = f.read()
    missing = [k for k, v in c.items() if not v]
    if missing:
        print("credentials.json 에서 못 찾은 항목:", ", ".join(missing))
        print("있는 항목 이름:", ", ".join(sorted(d.keys())))
        sys.exit(1)
    return c

def token(c):
    import jwt  # PyJWT
    now = int(time.time())
    assertion = jwt.encode({"iss": c["client_id"], "sub": c["service_account"], "iat": now, "exp": now + 3600},
                           c["private_key"], algorithm="RS256")
    body = urllib.parse.urlencode({
        "assertion": assertion,
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "client_id": c["client_id"], "client_secret": c["client_secret"], "scope": "bot",
    }).encode()
    req = urllib.request.Request("https://auth.worksmobile.com/oauth2/v2.0/token", data=body,
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req) as r:
        return json.load(r)["access_token"]

def call(method, tok, body=None):
    url = "https://www.worksapis.com/v1.0/bots/%s/persistentmenu" % BOT_ID
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": "Bearer " + tok, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            print("결과:", r.status, r.read().decode() or "(내용 없음)")
    except urllib.error.HTTPError as e:
        print("실패:", e.code, e.read().decode())

def main():
    body = {"content": {"actions": [{"type": "uri", "label": l, "uri": u} for l, u in MENU]}}
    print("대상 봇:", BOT_ID, "(정서 시험봇)")
    print(json.dumps(body, ensure_ascii=False, indent=2))
    if "--run" in sys.argv:
        call("POST", token(load_cred()), body)
    elif "--delete" in sys.argv:
        call("DELETE", token(load_cred()))
    else:
        print("\n미리보기만 했습니다. 실제 등록은: python set_test_menu.py --run")

if __name__ == "__main__":
    main()
