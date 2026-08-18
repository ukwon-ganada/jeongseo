/* 법무법인 정서 — 사건정리 시트: 종결 이동이 왜 안 되는지 짚어보기
   ───────────────────────────────────────────────────────────────
   [무엇을 하나]
     종결을 체크해도 안 넘어갈 때, onCloseEdit 이 지나가는 길목을 하나씩
     짚어 어디서 멈추는지 알려줍니다. 시트는 한 글자도 바꾸지 않습니다.

   [쓰는 법]
     ① Apps Script 에서 [+] → 스크립트 로 파일을 만들고 이 내용을 붙여넣기
     ② Ctrl+S
     ③ 함수 고르는 칸에서  diagClose  를 고르고  ▶ 실행
     ④ 나온 내용을 그대로 알려주시면 됩니다

   [읽는 법]
     ✓ 는 통과, ✗ 는 여기서 막힌다는 뜻입니다. 첫 ✗ 가 원인입니다.

   [지우셔도 됩니다]
     원인을 찾고 나면 이 파일은 지우셔도 아무 영향이 없습니다.
   ─────────────────────────────────────────────────────────────── */

function diagClose() {
  var L = [];
  function say(s) { L.push(s); }
  function ok(s) { L.push('  ✓ ' + s); }
  function no(s) { L.push('  ✗ ' + s); }

  say('=== 종결 이동 진단 ===');
  say('');

  /* ── ① 트리거 ── */
  say('① 트리거');
  var trigs = [];
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      trigs.push(t.getHandlerFunction());
    });
  } catch (err) {
    no('트리거 목록을 못 읽었습니다 — ' + err);
  }
  var nClose = trigs.filter(function (h) { return h === 'onCloseEdit'; }).length;
  if (nClose === 1) ok('onCloseEdit 이 걸려 있습니다');
  else if (nClose === 0) no('onCloseEdit 이 없습니다 — setupCloseButtons 를 실행하세요');
  else no('onCloseEdit 이 ' + nClose + '개 겹쳐 있습니다');
  say('    (내 계정 트리거 전체: ' + (trigs.length ? trigs.join(', ') : '없음') + ')');
  say('');

  /* ── ② 탭 이름 ── */
  say('② 탭 이름');
  var ss = SpreadsheetApp.openById(CL_SHEET_ID);
  var names = ss.getSheets().map(function (s) { return s.getName(); });
  say('    시트에 있는 탭: ' + names.map(function (n) { return '「' + n + '」'; }).join(' '));
  var main = ss.getSheetByName(CL_MAIN), done = ss.getSheetByName(CL_DONE);
  if (main) ok('「' + CL_MAIN + '」 찾음'); else no('「' + CL_MAIN + '」 이름의 탭이 없습니다');
  if (done) ok('「' + CL_DONE + '」 찾음'); else no('「' + CL_DONE + '」 이름의 탭이 없습니다');
  if (!main || !done) { clShow_(L.join('\n')); return; }
  say('');

  /* ── ③ 머리글 줄과 열 ── */
  say('③ 머리글과 열');
  var mHead = clHeadRow_(main), dHead = clHeadRow_(done);
  if (mHead) ok('형사사건 머리글 ' + mHead + '행'); else no('형사사건 머리글 줄을 못 찾음 (성명/이름 열 확인)');
  if (dHead) ok('종결 머리글 ' + dHead + '행'); else no('종결 머리글 줄을 못 찾음');
  if (!mHead || !dHead) { clShow_(L.join('\n')); return; }

  var shared = clSharedCols_(main, mHead);
  var watchCol = shared + 1;
  var mainHead = main.getRange(mHead, 1, 1, shared).getValues()[0];
  say('    공유 열 ' + shared + '개 → 종결 체크 열은 ' + clL_(watchCol) + '열(' + watchCol + ')');
  var watchName = clNorm_(main.getRange(mHead, watchCol).getValue());
  if (watchName === CL_HEAD_CLOSE) ok(clL_(watchCol) + '열 머리글이 「' + CL_HEAD_CLOSE + '」 입니다');
  else no(clL_(watchCol) + '열 머리글이 「' + watchName + '」 입니다 — 「' + CL_HEAD_CLOSE + '」 여야 합니다');
  say('    종결 탭 복원 열은 ' + clL_(shared + CL_EXTRA.length + 1) + '열');
  say('');

  /* ── ④ 구조가 맞는지 ── */
  say('④ 종결 탭 구조');
  if (clAligned_(main, mHead, done, dHead, shared)) {
    ok('형사사건과 같은 구조입니다');
  } else {
    no('구조가 다릅니다 — 체크해도 되돌려집니다. runAlignClosed 를 먼저 실행하세요');
    var dRow = done.getRange(dHead, 1, 1, Math.max(done.getLastColumn(), shared)).getValues()[0];
    for (var c = 0; c < shared; c++) {
      if (clNorm_(dRow[c]) !== clNorm_(mainHead[c])) {
        say('      처음 어긋나는 곳: ' + clL_(c + 1) + '열   형사 「' + clNorm_(mainHead[c])
          + '」  ↔  종결 「' + clNorm_(dRow[c]) + '」');
        break;
      }
    }
  }
  say('');

  /* ── ⑤ 체크된 줄이 있는지, 그 값이 진짜 체크박스인지 ── */
  say('⑤ 지금 체크돼 있는 줄');
  /* clLastRow_ 는 성명이 있는 마지막 줄까지만 봅니다. 그 아래에 체크만 해두신
     줄이 있으면 못 봅니다. 진단은 시트 끝까지 훑습니다. */
  var mLast = Math.max(main.getLastRow(), clLastRow_(main, mHead));
  var n = mLast - mHead;
  if (n < 1) {
    no('형사사건에 데이터가 없습니다');
  } else {
    var vals = main.getRange(mHead + 1, watchCol, n, 1).getValues();
    var nameCol = clFind_(mainHead, '성명') || clFind_(mainHead, '이름');
    var nameVals = main.getRange(mHead + 1, nameCol, n, 1).getValues();
    var hit = [];
    for (var i = 0; i < n; i++) {
      var v = vals[i][0];
      if (v === false || v === '' || v == null) continue;
      hit.push({ row: mHead + 1 + i, v: v, t: typeof v,
                 name: String(nameVals[i][0] == null ? '' : nameVals[i][0]).replace(/\s+/g, ' ').trim() });
    }
    if (!hit.length) {
      no('체크된 줄이 하나도 없습니다 — ' + clL_(watchCol) + '열에 체크하셨는지 확인해 주세요');
    } else {
      hit.slice(0, 10).forEach(function (h) {
        var real = (h.v === true);
        L.push((real ? '  ✓ ' : '  ✗ ') + h.row + '행  ' + (h.name || '(이름 없음)')
          + '   값 ' + JSON.stringify(h.v) + ' (' + h.t + ')'
          + (real ? '' : '  ← 진짜 체크박스가 아닙니다. 글자입니다'));
        if (real && !h.name) L.push('        └ 이름이 비어 있어 체크만 풀고 끝납니다');
      });
      if (hit.length > 10) say('    ... 외 ' + (hit.length - 10) + '줄');
    }
  }
  say('');

  /* ── ⑥ 90초 잠금이 남아 있는지 ── */
  say('⑥ 90초 잠금 (같은 줄을 거푸 체크하면 걸립니다)');
  try {
    var cache = CacheService.getScriptCache();
    var locked = [];
    for (var r = mHead + 1; r <= mLast; r++) {
      if (cache.get('cl:' + CL_MAIN + ':' + r)) locked.push(r);
    }
    if (!locked.length) ok('잠긴 줄 없음');
    else {
      no('이 줄들이 잠겨 있습니다: ' + locked.join(', ') + '행');
      say('      90초 기다렸다가 다시 체크하시면 됩니다');
    }
  } catch (err) {
    say('    캐시를 못 읽었습니다 — ' + err);
  }
  say('');

  /* ── ⑦ 문서 잠금 ── */
  say('⑦ 문서 잠금');
  var lock = LockService.getDocumentLock();
  var got = false;
  try { lock.waitLock(3000); got = true; } catch (err) { }
  if (got) { ok('잠금을 얻을 수 있습니다'); lock.releaseLock(); }
  else no('다른 스크립트가 문서를 붙들고 있습니다 — 잠시 뒤 다시 해보세요');

  say('');
  say('=== 첫 ✗ 가 원인입니다. 이 내용을 그대로 알려주세요 ===');
  clShow_(L.join('\n'));
}
