/* 법무법인 정서 — 사건정리 시트: 지워진 「선임계」 열 되살리기
   ───────────────────────────────────────────────────────────────
   [무슨 일이 있었나]
     2026-08-18 17:42:52 에 형사사건 탭에서 F열 「선임계」 가 통째로 지워졌습니다.
     수정로그에 「형사사건 · 열 삭제」 로 남아 있고, 지운 계정은 이 계정이 아닙니다.
     그 뒤로 형사사건 22열 · 종결 27열이 되어 종결 이동이 막혔습니다.

   [왜 손으로 붙여넣지 않나]
     390여 줄을 열째로 복사하면 한 줄만 밀려도 남의 선임계가 내 줄에 붙습니다.
     그래서 줄 위치가 아니라 **성명 + 사건번호로 맞춰** 채웁니다.
     짝을 못 찾은 줄은 건드리지 않고 그대로 알려 드립니다.

   [쓰기 전에 — 옛 본 사본 만들기]
     ① 시트에서  파일 → 버전 기록 → 버전 기록 보기
     ② 왼쪽 목록에서  2026. 8. 18. 오후 5:42  보다 **이전** 것을 고르기
     ③ 그 줄의  ⋮  → 「사본 만들기」
     ④ 만들어진 사본을 열어 주소창의 /d/ 와 /edit 사이 글자를 복사
          https://docs.google.com/spreadsheets/d/【이 부분】/edit
     ⑤ 아래 RR_OLD_ID 에 붙여넣기

   [실행]
     previewRestoreRetainer   무엇이 채워질지만 봅니다. 시트는 그대로
     runRestoreRetainer       백업을 뜬 뒤 실제로 되살립니다

   [끝나면]
     이 파일은 지우셔도 됩니다. 사본도 지우셔도 됩니다.
   ─────────────────────────────────────────────────────────────── */

var RR_OLD_ID = '';                       // ← 옛 본 사본의 ID
var RR_SHEET_ID = '1YCf77KxxotM4RnxePAhO16C7xbwEiHq4SuF5DN5vWto';
var RR_TAB = '형사사건';
var RR_HEAD = '선임계';
var RR_AFTER = '사건명';                  // 이 열 바로 뒤에 되살립니다 (원래 자리)


function previewRestoreRetainer() { rrShow_(rrWork_(true)); }

function runRestoreRetainer() {
  var head;
  try {
    head = '백업 먼저 만들었습니다:\n' + rrBackup_();
  } catch (err) {
    rrShow_('백업을 만들지 못해 아무것도 바꾸지 않았습니다.\n\n이유: ' + rrMsg_(err));
    return;
  }
  var body;
  try { body = rrWork_(false); }
  catch (err) {
    rrShow_(head + '\n\n작업 중 오류가 나서 멈췄습니다.\n\n이유: ' + rrMsg_(err)
      + (err && err.stack ? '\n\n' + err.stack : ''));
    return;
  }
  rrShow_(head + '\n\n' + body);
}


function rrWork_(dryRun) {
  var out = [];
  out.push(dryRun ? '=== 미리보기 (시트는 바뀌지 않았습니다) ===' : '=== 선임계 되살리기 완료 ===');

  if (!RR_OLD_ID) {
    return '옛 본 사본의 ID 가 비어 있습니다.\n\n'
      + '파일 → 버전 기록 → 5:42 이전 것 → ⋮ → 사본 만들기 를 하신 뒤,\n'
      + '그 사본 주소의 /d/ 와 /edit 사이 글자를 RR_OLD_ID 에 넣어 주세요.';
  }
  if (RR_OLD_ID === RR_SHEET_ID) {
    return '옛 본 ID 가 지금 시트와 같습니다. 사본의 ID 를 넣어 주세요.';
  }

  /* ── 옛 본에서 선임계를 읽는다 ── */
  var old;
  try { old = SpreadsheetApp.openById(RR_OLD_ID).getSheetByName(RR_TAB); }
  catch (err) { return '옛 본을 열지 못했습니다.\n\n이유: ' + rrMsg_(err); }
  if (!old) return '옛 본에 「' + RR_TAB + '」 탭이 없습니다.';

  var oHead = rrHeadRow_(old);
  if (!oHead) return '옛 본에서 머리글 줄을 찾지 못했습니다.';
  var oRow = old.getRange(oHead, 1, 1, Math.max(old.getLastColumn(), 1)).getValues()[0];
  var oName = rrFind_(oRow, '성명') || rrFind_(oRow, '이름');
  var oCase = rrFind_(oRow, '사건번호');
  var oRet = rrFind_(oRow, RR_HEAD);
  if (!oRet) return '옛 본에도 「' + RR_HEAD + '」 열이 없습니다.\n'
    + '5:42 보다 이전 본이 맞는지 확인해 주세요.';
  if (!oName) return '옛 본에서 성명 열을 찾지 못했습니다.';

  var oLast = old.getLastRow();
  var bag = {}, dup = 0, on = 0;
  if (oLast > oHead) {
    var n0 = oLast - oHead;
    var names = old.getRange(oHead + 1, oName, n0, 1).getValues();
    var cases = oCase ? old.getRange(oHead + 1, oCase, n0, 1).getValues() : null;
    var rets = old.getRange(oHead + 1, oRet, n0, 1).getValues();
    for (var i = 0; i < n0; i++) {
      var k = rrKey_(names[i][0], cases ? cases[i][0] : '');
      if (!k) continue;
      if (bag[k] !== undefined) { dup++; continue; }      // 같은 짝이 둘이면 첫 것만
      bag[k] = (rets[i][0] === true);
      if (bag[k]) on++;
    }
  }
  out.push('옛 본에서 ' + Object.keys(bag).length + '줄을 읽었습니다 (체크된 것 ' + on + '건'
    + (dup ? ' · 같은 짝이 겹친 줄 ' + dup + '건은 첫 것만' : '') + ')');

  /* ── 지금 시트 ── */
  var ss = SpreadsheetApp.openById(RR_SHEET_ID);
  var sh = ss.getSheetByName(RR_TAB);
  if (!sh) return '지금 시트에 「' + RR_TAB + '」 탭이 없습니다.';

  var head = rrHeadRow_(sh);
  if (!head) return '지금 시트에서 머리글 줄을 찾지 못했습니다.';
  var hRow = sh.getRange(head, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];

  if (rrFind_(hRow, RR_HEAD)) {
    return '지금 시트에 이미 「' + RR_HEAD + '」 열이 있습니다 ('
      + rrL_(rrFind_(hRow, RR_HEAD)) + '열). 되살릴 것이 없습니다.';
  }

  var after = rrFind_(hRow, RR_AFTER);
  if (!after) return '「' + RR_AFTER + '」 열을 찾지 못해 어디에 넣을지 알 수 없습니다.';
  var at = after + 1;
  out.push('「' + RR_AFTER + '」(' + rrL_(after) + '열) 바로 뒤 ' + rrL_(at) + '열에 되살립니다');

  var nameCol = rrFind_(hRow, '성명') || rrFind_(hRow, '이름');
  var caseCol = rrFind_(hRow, '사건번호');
  if (!nameCol) return '지금 시트에서 성명 열을 찾지 못했습니다.';

  var last = rrLastRow_(sh, head, nameCol);
  var n = last - head;
  if (n < 1) return '지금 시트에 자료가 없습니다.';

  var curNames = sh.getRange(head + 1, nameCol, n, 1).getValues();
  var curCases = caseCol ? sh.getRange(head + 1, caseCol, n, 1).getValues() : null;

  var vals = [], hit = 0, miss = [], willOn = 0;
  for (var r = 0; r < n; r++) {
    var key = rrKey_(curNames[r][0], curCases ? curCases[r][0] : '');
    if (key && bag[key] !== undefined) {
      vals.push([bag[key]]);
      hit++;
      if (bag[key]) willOn++;
    } else {
      vals.push([false]);                                  // 못 찾으면 빈 체크로 둔다
      if (miss.length < 30) {
        miss.push((head + 1 + r) + '행  '
          + String(curNames[r][0] == null ? '' : curNames[r][0]).replace(/\s+/g, ' ').trim());
      }
    }
  }

  out.push('');
  out.push('[' + RR_TAB + '] ' + n + '줄');
  out.push('   짝을 찾아 되살림   ' + hit + '줄  (그 중 체크 ' + willOn + '건)');
  out.push('   짝을 못 찾음       ' + (n - hit) + '줄  (빈 체크로 둡니다)');

  if (miss.length) {
    out.push('');
    out.push('   ■ 옛 본에서 못 찾은 줄 — 그 사이 새로 넣으신 사건일 수 있습니다');
    miss.slice(0, 15).forEach(function (s) { out.push('      ' + s); });
    if (miss.length > 15) out.push('      ... 외 ' + (miss.length - 15) + '줄');
  }

  if (dryRun) {
    out.push('');
    out.push('실제로 되살리려면 runRestoreRetainer 를 실행하세요.');
    return out.join('\n');
  }

  /* ── 실제 변경 ── */
  sh.insertColumnAfter(after);
  sh.getRange(head, at).setValue(RR_HEAD);
  var rg = sh.getRange(head + 1, at, n, 1);
  rg.insertCheckboxes();
  rg.setValues(vals);

  // 머리글·본문 서식을 옆 열에서 가져와 겉모습을 맞춘다
  try {
    sh.getRange(head, after).copyTo(sh.getRange(head, at),
      SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  } catch (err) { }
  sh.setColumnWidth(at, 60);

  out.push('');
  out.push('되살렸습니다. 이제 형사사건과 종결 탭의 열 구성이 다시 같아집니다.');
  out.push('종결 체크가 다시 도는지 확인해 주세요.');
  rrLog_(ss, '선임계 열 되살림 — ' + hit + '줄 (체크 ' + willOn + '건) · 못 찾음 ' + (n - hit) + '줄');
  return out.join('\n');
}


/* ── 도구 ── */

/* 성명 + 사건번호로 짝을 짓는다.
   성명 칸에 주민번호가 함께 든 경우가 있어 줄바꿈 뒤는 버린다. */
function rrKey_(name, caseNo) {
  var nm = String(name == null ? '' : name).split('\n')[0].replace(/\s/g, '');
  if (!nm) return '';
  var cs = String(caseNo == null ? '' : caseNo).replace(/\s/g, '');
  return nm + '|' + cs;
}

function rrHeadRow_(sh) {
  var probe = Math.min(5, sh.getLastRow());
  var lastCol = Math.max(sh.getLastColumn(), 1);
  if (probe < 1) return 0;
  var vals = sh.getRange(1, 1, probe, lastCol).getValues();
  for (var r = 0; r < probe; r++) {
    for (var c = 0; c < lastCol; c++) {
      var h = String(vals[r][c] == null ? '' : vals[r][c]).replace(/\s/g, '');
      if (h.indexOf('성명') === 0 || h.indexOf('이름') === 0) return r + 1;
    }
  }
  return 0;
}

/* 딱 맞는 이름을 먼저 — '관할' 이 '관할경찰서' 에 걸리지 않게 */
function rrFind_(headRow, key) {
  var c, h;
  for (c = 0; c < headRow.length; c++) {
    if (String(headRow[c] == null ? '' : headRow[c]).replace(/\s/g, '') === key) return c + 1;
  }
  for (c = 0; c < headRow.length; c++) {
    h = String(headRow[c] == null ? '' : headRow[c]).replace(/\s/g, '');
    if (h && h.indexOf(key) === 0) return c + 1;
  }
  return 0;
}

function rrLastRow_(sh, head, col) {
  var last = sh.getLastRow();
  if (last <= head) return head;
  var v = sh.getRange(head + 1, col, last - head, 1).getValues();
  for (var i = v.length - 1; i >= 0; i--) {
    if (String(v[i][0] == null ? '' : v[i][0]).trim()) return head + 1 + i;
  }
  return head;
}

function rrL_(c) {
  var s = '';
  while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - m - 1) / 26; }
  return s;
}

function rrMsg_(err) { return (err && err.message) ? err.message : String(err); }

function rrBackup_() {
  var stamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  var name = '[백업] 사건정리 — ' + stamp + ' (선임계복구 직전)';
  var folder;
  try {
    folder = (typeof backupFolder_ === 'function') ? backupFolder_() : DriveApp.getRootFolder();
  } catch (err) { folder = DriveApp.getRootFolder(); }
  return DriveApp.getFileById(RR_SHEET_ID).makeCopy(name, folder).getUrl();
}

function rrLog_(ss, msg) {
  try {
    if (typeof append_ === 'function') {
      var who = '(로그인 정보 없음)';
      try { who = Session.getActiveUser().getEmail() || who; } catch (e) { }
      append_(ss, who, RR_TAB, '-', '', msg, '선임계복구');
    }
  } catch (err) { }
}

function rrShow_(text) {
  Logger.log(text);
  if (typeof uiShow_ === 'function') { uiShow_(text); return; }
  try { SpreadsheetApp.getUi().alert(String(text).substring(0, 1200)); } catch (err) { }
}
