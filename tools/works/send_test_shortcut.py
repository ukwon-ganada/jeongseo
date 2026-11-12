# -*- coding: utf-8 -*-
"""정서 시험봇이 '테스트방'에 버튼 모양 바로가기 메시지를 1회 보내는 시험 스크립트 (사무실 PC).

    python send_test_shortcut.py          # 보낼 내용만 보여 줌
    python send_test_shortcut.py --run    # 테스트방에 1회 보냄

열쇠는 set_test_menu.py 와 같이 ~/.config/naverworks/credentials.json 에서 읽습니다.
"""
import json, sys, urllib.parse, urllib.request
from set_test_menu import load_cred, token, BOT_ID, WOFF

CHANNEL_ID = "074adf53-c531-3fc4-5c71-75fab19f22da"  # 테스트방 (실제 사건방 아님)
CASE = "2026고단1234"

def link(view):
    return WOFF + "?" + urllib.parse.urlencode({"case": CASE, "view": view})

BODY = {"content": {
    "type": "button_template",
    "contentText": "📌 %s 사건 화면 열기\n(이 메시지를 공지로 등록해 두세요)" % CASE,
    "actions": [
        {"type": "uri", "label": "사건 타임라인", "uri": link("timeline")},
        {"type": "uri", "label": "기한 보기", "uri": link("deadline")},
        {"type": "uri", "label": "기일 보기", "uri": link("hearing")},
        {"type": "uri", "label": "진행내용", "uri": link("progress")},
        {"type": "uri", "label": "사건 정보", "uri": link("info")},
    ],
}}

def main():
    print("대상 봇:", BOT_ID, "/ 대상 방:", CHANNEL_ID, "(테스트방)")
    print(json.dumps(BODY, ensure_ascii=False, indent=2))
    if "--run" not in sys.argv:
        print("\n미리보기만 했습니다. 실제 보내기는: python send_test_shortcut.py --run")
        return
    url = "https://www.worksapis.com/v1.0/bots/%s/channels/%s/messages" % (BOT_ID, CHANNEL_ID)
    req = urllib.request.Request(url, data=json.dumps(BODY).encode(), method="POST", headers={
        "Authorization": "Bearer " + token(load_cred()), "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            print("결과:", r.status, r.read().decode() or "(내용 없음)")
    except urllib.error.HTTPError as e:
        print("실패:", e.code, e.read().decode())

if __name__ == "__main__":
    main()
