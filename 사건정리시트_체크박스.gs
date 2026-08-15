/* 법무법인 정서 — 사건정리 시트: 공소장·증거기록을 체크박스로
   ───────────────────────────────────────────────────────────────
   [무엇을 하나]
     지금은 한 칸에 글자로 '공소장 O / 증거기록x' 처럼 적고 있습니다.
     구글시트 체크박스는 한 칸에 하나만 들어가므로, 칸을 둘로 나눕니다.

       지금   O열  공 소 장 / 증거기록   ← 한 칸에 두 가지
       바뀜   O열  공 소 장  ☑          P열  증거기록  ☑

     기존에 적혀 있던 O·x 는 읽어서 체크 상태로 옮깁니다.
     공소장·증거기록이 아니라 로웨어 서면 제출 내역이 잘못 들어간 3건은
     [체크할것] 칸으로 옮깁니다.

   [적용 범위]  형사사건 탭 4~366행 (종결 탭은 건드리지 않습니다)

   [설치]
     Apps Script 왼쪽 [파일] 옆 + → [스크립트] → 이름을 체크박스 로 하고
     이 파일 전체를 붙여넣기 → 저장(Ctrl+S)
     ※ 수정로그·관할정리와 같은 프로젝트에 두시면 됩니다.

   [실행 순서]  반드시 이 순서로
     1) previewCheckbox   무엇이 어떻게 바뀔지 미리 봅니다. 시트는 안 건드립니다.
     2) runCheckbox       실제로 고칩니다. 고치기 전에 백업을 자동으로 하나 뜹니다.

   [두 번 돌려도 안전합니다]
     이미 전환된 뒤 다시 실행해도, 손으로 체크해 두신 상태는 그대로 둡니다.
     열도 두 번 생기지 않습니다.

   [되돌리기]
     runCheckbox 가 만든 백업 파일을 열어 되돌리시면 됩니다.
   ─────────────────────────────────────────────────────────────── */

var CB_SHEET_ID = '1YCf77KxxotM4RnxePAhO16C7xbwEiHq4SuF5DN5vWto';
var CB_TAB = '형사사건';

var CB_HEADER_ROW = 3;    // 머리글 줄
var CB_FIRST_ROW = 4;     // 데이터 시작 줄
var CB_NAME_COL = 3;      // C열 성명 — 데이터 마지막 줄을 찾는 기준
var CB_INDICT_COL = 15;   // O열 — 전환 뒤 '공 소 장'
var CB_RECORD_COL = 16;   // P열 — 전환 뒤 '증거기록' (열을 넣으면 여기가 생김)
var CB_TODO_COL = 19;     // 체크할것 — 열을 넣은 뒤 기준 (원래 R=18 → S=19)

var CB_HEAD_INDICT = '공 소 장';
var CB_HEAD_RECORD = '증거기록';
var CB_WIDTH = 70;

// O 표시로 쓰이는 글자들 / x 표시로 쓰이는 글자들
var MARK_YES = 'OoＯｏ0○◯ㅇ';
var MARK_NO = 'xX×Ｘ';

/* ── 실행 ── */

// 미리보기: 시트를 고치지 않고 결과만 보고합니다
function previewCheckbox() {
  var report = cbProcess_(true);
  Logger.log(report);
  cbAlert_(report);
}

// 실제 적용
function runCheckbox() {
  var backupUrl = cbBackup_();
  var report = cbProcess_(false);
  var full = '백업 먼저 만들었습니다:\n' + backupUrl + '\n\n' + report;
  Logger.log(full);
  cbAlert_(full);
}

/* ── 본체 ── */

function cbProcess_(dryRun) {
  var ss = SpreadsheetApp.openById(CB_SHEET_ID);
  var sh = ss.getSheetByName(CB_TAB);
  if (!sh) return '[' + CB_TAB + '] 탭을 찾지 못했습니다.';

  var split = isSplit_(sh);          // 이미 열이 나뉘어 있는가
  var lastRow = lastDataRow_(sh);
  if (lastRow < CB_FIRST_ROW) return '데이터가 없습니다.';
  var n = lastRow - CB_FIRST_ROW + 1;

  // 나뉘기 전이면 O열 하나, 나뉜 뒤면 O·P 두 열을 읽는다
  var src = sh.getRange(CB_FIRST_ROW, CB_INDICT_COL, n, split ? 2 : 1).getValues();

  var pairs = [];                    // 최종적으로 써 넣을 [공소장, 증거기록]
  var moved = [];                    // 체크할것으로 옮길 서면 내역
  var cntIndict = 0, cntRecord = 0, kept = 0, converted = 0;

  for (var i = 0; i < n; i++) {
    var v0 = src[i][0];
    var v1 = split ? src[i][1] : null;
    var a, b;

    if (typeof v0 === 'boolean' || typeof v1 === 'boolean') {
      // 이미 체크박스인 줄 — 손으로 체크해 두신 상태를 그대로 유지한다
      a = (v0 === true);
      b = (v1 === true);
      kept++;
    } else {
      var text = String(v0 == null ? '' : v0);
      var flat = text.replace(/\s/g, '');

      if (isFiling_(flat)) {
        // 공소장·증거기록이 아니라 서면 제출 내역 — 체크박스로 옮길 수 없다
        moved.push({ row: CB_FIRST_ROW + i, text: text.replace(/\n/g, ' ').trim() });
        a = false; b = false;
      } else {
        a = (mark_(flat, '공소장') === true);
        b = (mark_(flat, '증거기록') === true);
        if (flat) converted++;
      }
    }

    if (a) cntIndict++;
    if (b) cntRecord++;
    pairs.push([a, b]);
  }

  var out = [];
  out.push(dryRun ? '=== 미리보기 (시트는 바뀌지 않았습니다) ===' : '=== 적용 완료 ===');
  out.push('[' + CB_TAB + '] ' + CB_FIRST_ROW + '~' + lastRow + '행  ' + n + '건');
  out.push('');
  if (split) {
    out.push('※ 이미 열이 나뉘어 있습니다 — 열은 새로 만들지 않습니다.');
    out.push('   이미 체크박스인 줄 ' + kept + '건은 지금 상태 그대로 둡니다.');
    out.push('');
  }
  out.push('글자에서 옮긴 줄        ' + converted + '건');
  out.push('공소장 체크 상태        ' + cntIndict + '건');
  out.push('증거기록 체크 상태      ' + cntRecord + '건');
  out.push('체크할것으로 옮길 서면   ' + moved.length + '건');
  moved.forEach(function (m) { out.push('   ' + m.row + '행  ' + m.text.substring(0, 60)); });

  if (dryRun) return out.join('\n');

  /* ── 여기부터 실제 변경 ── */

  // ① 열 나누기 (처음 한 번만)
  if (!split) sh.insertColumnAfter(CB_INDICT_COL);

  // ② 머리글
  sh.getRange(CB_HEADER_ROW, CB_INDICT_COL).setValue(CB_HEAD_INDICT);
  sh.getRange(CB_HEADER_ROW, CB_RECORD_COL).setValue(CB_HEAD_RECORD);

  // ③ 서면 내역을 체크할것으로 이동 (원래 내용이 있으면 아래 줄에 붙인다)
  moved.forEach(function (m) {
    var cell = sh.getRange(m.row, CB_TODO_COL);
    var prev = String(cell.getValue() == null ? '' : cell.getValue()).trim();
    cell.setValue(prev ? prev + '\n' + m.text : m.text);
  });

  // ④ 체크박스 — 363행 × 2열을 한 번에 (셀마다 반복하면 시간 초과)
  var box = sh.getRange(CB_FIRST_ROW, CB_INDICT_COL, n, 2);
  box.insertCheckboxes();
  box.setValues(pairs);
  box.setHorizontalAlignment('center').setVerticalAlignment('middle');

  // ⑤ 모양
  sh.setColumnWidth(CB_INDICT_COL, CB_WIDTH);
  sh.setColumnWidth(CB_RECORD_COL, CB_WIDTH);

  // ⑥ 수정로그에 한 줄
  try {
    if (typeof append_ === 'function') {
      append_(ss, cbUser_(), CB_TAB, '-', '',
        '공소장·증거기록 체크박스 전환 (공소장 ' + cntIndict + ' / 증거기록 '
        + cntRecord + ' 체크, 서면 내역 ' + moved.length + '건 이동)', '일괄정리');
    }
  } catch (err) { /* 수정로그 스크립트가 없으면 넘어감 */ }

  return out.join('\n');
}

/* ── 판정 ── */

// 이미 열이 나뉘었는지: 오른쪽 칸 머리글이 '증거기록' 인지로 판단
function isSplit_(sh) {
  var head = String(sh.getRange(CB_HEADER_ROW, CB_RECORD_COL).getValue() || '').replace(/\s/g, '');
  return head.indexOf('증거기록') >= 0;
}

// 로웨어 서면 제출 내역인지 ('[서면]' 이 있거나 날짜로 시작)
function isFiling_(flat) {
  if (!flat) return false;
  return flat.indexOf('[서면]') >= 0 || /^\d{4}-\d{2}-\d{2}/.test(flat);
}

// '공소장O증거기록x' 에서 라벨 뒤 한 글자를 보고 true / false / null(언급 없음)
function mark_(flat, label) {
  var at = flat.indexOf(label);
  if (at < 0) return null;
  var c = flat.charAt(at + label.length);
  if (MARK_YES.indexOf(c) >= 0) return true;
  if (MARK_NO.indexOf(c) >= 0) return false;
  return null;
}

// 성명(C열)이 채워진 마지막 줄까지를 데이터로 본다
function lastDataRow_(sh) {
  var last = sh.getLastRow();
  if (last < CB_FIRST_ROW) return CB_FIRST_ROW - 1;
  var names = sh.getRange(CB_FIRST_ROW, CB_NAME_COL, last - CB_FIRST_ROW + 1, 1).getValues();
  for (var i = names.length - 1; i >= 0; i--) {
    if (String(names[i][0] == null ? '' : names[i][0]).trim()) return CB_FIRST_ROW + i;
  }
  return CB_FIRST_ROW - 1;
}

/* ── 도구 ── */

function cbBackup_() {
  var stamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  var name = '[백업] 사건정리 — ' + stamp + ' (체크박스 직전)';
  var folder;
  try {
    folder = (typeof backupFolder_ === 'function') ? backupFolder_() : DriveApp.createFolder('사건정리 백업');
  } catch (err) {
    folder = DriveApp.getRootFolder();
  }
  return DriveApp.getFileById(CB_SHEET_ID).makeCopy(name, folder).getUrl();
}

function cbUser_() {
  try { return Session.getActiveUser().getEmail() || '(로그인 정보 없음)'; }
  catch (err) { return '(로그인 정보 없음)'; }
}

function cbAlert_(text) {
  try {
    var t = text.length > 1200 ? text.substring(0, 1200) + '\n\n... 전체 내용은 아래 [실행 로그]에서 확인하세요' : text;
    SpreadsheetApp.getUi().alert(t);
  } catch (err) { /* 독립 프로젝트에서는 알림창이 없음 */ }
}
