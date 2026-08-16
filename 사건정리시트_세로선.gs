/* 법무법인 정서 — 사건정리 시트: 옅은 세로 구분선
   ───────────────────────────────────────────────────────────────
   [무엇을 하나]
     모든 탭에 옅은 세로선을 긋습니다. 열이 스무 개가 넘어가면 세로선이 없을 때
     어느 값이 어느 칸의 것인지 눈으로 따라가기 어렵습니다.

       지금    가로선만 있음
       뒤      가로선 + 옅은 세로선  (가로선은 그대로 둡니다)

   [선 하나만 건드립니다]
     테두리의 왼쪽·오른쪽·칸 사이 세로선만 새로 긋습니다.
     위·아래·가로선 자리에는 null 을 넘기므로 기존 가로선과 머리글 아래의
     진한 선은 손대지 않습니다.

     글꼴·글자 크기·정렬·열 너비·행 높이·배경색·값 — 아무것도 바꾸지 않습니다.

   [탭마다 알아서 범위를 잡습니다]
     머리글은 '성명'(또는 '이름')이 적힌 줄, 없으면 1행.
     세로선은 데이터가 있는 데까지만 긋습니다. 예전 스크립트가 남긴 가로선이
     데이터보다 한참 아래까지 그어져 있는데, 거기까지 격자를 치면 표가 아니라
     빈 양식지처럼 보이기 때문입니다.

   [설치]
     Apps Script 에서 [+] → 스크립트를 눌러 새 파일을 만들고
     이 내용을 붙여넣은 뒤 Ctrl+S

   [실행]
     · previewGridLines  → runGridLines    세로선 긋기
     · removeGridLines                     세로선만 걷어내기

   [주의]
     서식.gs 의 runFormat 을 돌리면 세로선이 지워집니다. 그 함수는 격자를
     통째로 지우고 가로선만 다시 긋기 때문입니다.
     그때는 runGridLines 를 한 번 더 실행하시면 됩니다.
   ─────────────────────────────────────────────────────────────── */

var VL_SHEET_ID = '1YCf77KxxotM4RnxePAhO16C7xbwEiHq4SuF5DN5vWto';

// 세로선 색. 지금 가로선과 같은 톤입니다. 더 옅게 하시려면 '#e8eaed'
var VL_COLOR = '#d9d9d9';

// 빼고 싶은 탭 이름 (예: ['수정로그'])
var VL_SKIP = [];

/* ══════════════════════════════════════════════════════════════
   실행
   ══════════════════════════════════════════════════════════════ */

function previewGridLines() { vlShow_(vlProcess_(true, true)); }

function runGridLines() { vlRun_('세로선긋기', function () { return vlProcess_(false, true); }); }

function removeGridLines() { vlRun_('세로선지우기', function () { return vlProcess_(false, false); }); }

/* 백업 → 본 작업 → 결과 보고.
   백업이 실패하면 (드라이브 용량·권한) 왜 멈췄는지 보이게 한다. */
function vlRun_(what, work) {
  var head;
  try {
    head = '백업 먼저 만들었습니다:\n' + vlBackup_(what);
  } catch (err) {
    vlShow_('백업을 만들지 못해 아무것도 바꾸지 않았습니다.\n\n'
      + '이유: ' + (err && err.message ? err.message : err) + '\n\n'
      + '드라이브 용량이 찼거나 권한이 없을 때 이렇게 됩니다.\n'
      + '오래된 [백업] 사건정리 … 파일을 지우고 다시 실행해 주세요.');
    return;
  }
  var body;
  try {
    body = work();
  } catch (err) {
    vlShow_(head + '\n\n작업 중 오류가 나서 멈췄습니다.\n\n'
      + '이유: ' + (err && err.message ? err.message : err)
      + (err && err.stack ? '\n\n' + err.stack : ''));
    return;
  }
  vlShow_(head + '\n\n' + body);
}

/* draw 가 true 면 긋고, false 면 지운다. */
function vlProcess_(dryRun, draw) {
  var ss = SpreadsheetApp.openById(VL_SHEET_ID);
  var sheets = ss.getSheets();

  var out = [];
  out.push(dryRun ? '=== 미리보기 (시트는 바뀌지 않았습니다) ==='
    : (draw ? '=== 세로 구분선 완료 ===' : '=== 세로 구분선 제거 완료 ==='));
  out.push(draw ? '색 ' + VL_COLOR + ' · 가로선과 머리글 아래 선은 그대로 둡니다'
    : '세로선만 지웁니다. 가로선과 머리글 아래 선은 그대로 둡니다');

  var before = dryRun ? '' : vlSum_(ss);
  var jobs = [], skipped = [], failed = [];

  sheets.forEach(function (sh) {
    var name = sh.getName();
    if (VL_SKIP.indexOf(name) >= 0) { skipped.push(name + ' (건너뛰기 목록)'); return; }

    var head = vlHeadRow_(sh);
    var last = vlLastRow_(sh, head);
    var cols = vlLastCol_(sh, head);
    if (last < head || cols < 1) { skipped.push(name + ' (데이터 없음)'); return; }

    jobs.push({ sh: sh, name: name, head: head, last: last, cols: cols });
  });

  jobs.forEach(function (j) {
    out.push('');
    out.push('[' + j.name + '] ' + j.head + '행~' + j.last + '행 · '
      + j.cols + '열 (' + vlL_(1) + '~' + vlL_(j.cols) + ')');
    if (dryRun) return;

    /* 위·아래·가로선 자리에 null → 기존 가로선을 건드리지 않는다.
       왼쪽·오른쪽·칸 사이 세로선만 새로 긋거나 지운다. */
    try {
      var range = j.sh.getRange(j.head, 1, j.last - j.head + 1, j.cols);
      if (draw) {
        range.setBorder(null, true, null, true, true, null,
          VL_COLOR, SpreadsheetApp.BorderStyle.SOLID);
      } else {
        range.setBorder(null, false, null, false, false, null);
      }
    } catch (err) {
      // 한 탭이 실패해도 나머지 탭은 계속한다
      failed.push(j.name + ' — ' + (err && err.message ? err.message : err));
      out.push('   !! 건너뜀 — ' + (err && err.message ? err.message : err));
    }
  });

  if (skipped.length) {
    out.push('');
    out.push('■ 건드리지 않은 탭');
    skipped.forEach(function (s) { out.push('   ' + s); });
  }

  if (dryRun) {
    out.push('');
    out.push('실제로 그으려면 runGridLines 를 실행하세요.');
    return out.join('\n');
  }

  var after = vlSum_(ss);
  out.push('');
  out.push(before === after
    ? '값 대조 — 한 글자도 바뀌지 않았습니다'
    : '!! 값이 바뀌었습니다 — 백업으로 되돌려 주세요 !!');
  if (failed.length) out.push('실패한 탭 ' + failed.length + '개 — ' + failed.join(' / '));

  vlLog_(ss, (draw ? '모든 탭에 세로 구분선' : '세로 구분선 제거')
    + ' (' + (jobs.length - failed.length) + '개 탭)');
  return out.join('\n');
}

/* ══════════════════════════════════════════════════════════════
   도구
   ══════════════════════════════════════════════════════════════ */

// 머리글 줄 — '성명' 또는 '이름'이 적힌 줄. 못 찾으면 1행 (수정로그처럼)
function vlHeadRow_(sh) {
  var probe = Math.min(5, sh.getLastRow());
  var lastCol = Math.max(sh.getLastColumn(), 1);
  if (probe < 1) return 1;
  var vals = sh.getRange(1, 1, probe, lastCol).getValues();
  for (var r = 0; r < probe; r++) {
    for (var c = 0; c < lastCol; c++) {
      var h = vlNorm_(vals[r][c]);
      if (h.indexOf('성명') === 0 || h.indexOf('이름') === 0) return r + 1;
    }
  }
  return 1;
}

/* 마지막 데이터 행 — 성명 열에 값이 있는 마지막 줄.
   성명 열이 없으면 getLastRow (수정로그처럼).
   체크박스가 데이터보다 한참 아래까지 깔려 있어도 성명 열로 재면 정확하다. */
function vlLastRow_(sh, head) {
  var last = sh.getLastRow();
  if (last <= head) return head;

  var lastCol = Math.max(sh.getLastColumn(), 1);
  var headRow = sh.getRange(head, 1, 1, lastCol).getValues()[0];
  var nameCol = 0;
  for (var c = 0; c < headRow.length; c++) {
    var h = vlNorm_(headRow[c]);
    if (h.indexOf('성명') === 0 || h.indexOf('이름') === 0) { nameCol = c + 1; break; }
  }
  if (!nameCol) return last;

  var v = sh.getRange(head + 1, nameCol, last - head, 1).getValues();
  for (var i = v.length - 1; i >= 0; i--) {
    if (String(v[i][0] == null ? '' : v[i][0]).trim()) return head + 1 + i;
  }
  return head;
}

// 마지막 열 — 머리글이 붙어 있는 마지막 열. 없으면 getLastColumn
function vlLastCol_(sh, head) {
  var lastCol = Math.max(sh.getLastColumn(), 1);
  if (head > sh.getLastRow()) return lastCol;
  var row = sh.getRange(head, 1, 1, lastCol).getValues()[0];
  var n = 0;
  for (var c = 0; c < row.length; c++) if (vlNorm_(row[c])) n = c + 1;
  return n || lastCol;
}

function vlNorm_(v) {
  return String(v == null ? '' : v).replace(/\s/g, '');
}

function vlL_(c) {
  var s = '';
  while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - m - 1) / 26; }
  return s;
}

/* 값이 그대로인지 대조하는 지문. 표시값이 아니라 실제 값을 본다. */
function vlSum_(ss) {
  var parts = [];
  ss.getSheets().forEach(function (sh) {
    var rows = sh.getLastRow(), cols = sh.getLastColumn();
    if (rows < 1 || cols < 1) { parts.push(sh.getName() + ':'); return; }
    var v = sh.getRange(1, 1, rows, cols).getValues();
    parts.push(sh.getName() + ':' + v.map(function (row) {
      return row.map(function (x) { return x == null ? '' : String(x); }).join('');
    }).join(''));
  });
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, parts.join(''))
    .map(function (b) { return (b < 0 ? b + 256 : b).toString(16); }).join('');
}

function vlBackup_(what) {
  var stamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  var name = '[백업] 사건정리 — ' + stamp + ' (' + what + ' 직전)';
  var folder;
  try {
    folder = (typeof backupFolder_ === 'function') ? backupFolder_() : DriveApp.createFolder('사건정리 백업');
  } catch (err) {
    folder = DriveApp.getRootFolder();
  }
  return DriveApp.getFileById(VL_SHEET_ID).makeCopy(name, folder).getUrl();
}

function vlLog_(ss, msg) {
  try {
    if (typeof append_ === 'function') {
      var who = '(로그인 정보 없음)';
      try { who = Session.getActiveUser().getEmail() || who; } catch (e) { }
      append_(ss, who, '-', '-', '', msg, '세로선');
    }
  } catch (err) { /* 수정로그 스크립트가 없으면 넘어감 */ }
}

function vlShow_(text) {
  Logger.log(text);
  try {
    var t = text.length > 1200 ? text.substring(0, 1200) + '\n\n... 전체 내용은 아래 [실행 로그]에서' : text;
    SpreadsheetApp.getUi().alert(t);
  } catch (err) { /* 독립 프로젝트에서는 알림창이 없음 */ }
}
