/* 법무법인 정서 — 사건정리 시트: 체크박스 (공소장·증거기록·선임계)
   ───────────────────────────────────────────────────────────────
   [무엇을 하나]
     글자로 적던 것을 네모 체크박스로 바꿉니다.

       공소장 O / 증거기록x   →  공 소 장 ☑    증거기록 ☐
       경찰서에 제출완료       →  선임계 ☑

     선임계는 어디에 제출했는지는 버리고 제출 여부만 남깁니다.

   [머리글 행을 알아서 찾습니다]
     예전에는 '머리글은 3행'이라고 못박아 두었는데, 머리글이 1행으로 올라가자
     머리글을 데이터로 착각했습니다. 이제는 '성명'(또는 '이름')이 적힌 줄을
     찾아 그 줄을 머리글로 봅니다. 행을 올리거나 내려도 깨지지 않습니다.

   [설치]
     Apps Script 에서 이 파일 내용을 통째로 바꿔 붙여넣고 Ctrl+S

   [실행]
     · previewRetainer  → runRetainer    선임계를 체크박스로
     · previewCheckbox  → runCheckbox    공소장·증거기록을 체크박스로

     둘 다 미리보기로 먼저 확인하시고, run 은 실행 직전 백업을 자동으로 뜹니다.

   [두 번 돌려도 안전합니다]
     이미 체크박스가 된 칸은 손으로 체크해 두신 상태 그대로 둡니다.
   ─────────────────────────────────────────────────────────────── */

var CB_SHEET_ID = '1YCf77KxxotM4RnxePAhO16C7xbwEiHq4SuF5DN5vWto';

var CB_TAB = '형사사건';                                  // 공소장·증거기록은 여기만
var CB_RETAINER_TABS = ['형사사건', '항소사건', '종결'];    // 선임계가 있는 탭

var CB_HEAD_INDICT = '공 소 장';
var CB_HEAD_RECORD = '증거기록';
var CB_WIDTH = 70;

// O 표시로 쓰이는 글자 / x 표시로 쓰이는 글자
var MARK_YES = 'OoＯｏ0○◯ㅇ';
var MARK_NO = 'xX×Ｘ';

/* ══════════════════════════════════════════════════════════════
   선임계 → 체크박스
   ══════════════════════════════════════════════════════════════ */

function previewRetainer() { cbShow_(cbRetainer_(true)); }

function runRetainer() {
  var backup = cbBackup_('선임계체크');
  cbShow_('백업 먼저 만들었습니다:\n' + backup + '\n\n' + cbRetainer_(false));
}

function cbRetainer_(dryRun) {
  var ss = SpreadsheetApp.openById(CB_SHEET_ID);
  var out = [];
  out.push(dryRun ? '=== 미리보기 (시트는 바뀌지 않았습니다) ===' : '=== 선임계 체크박스 적용 완료 ===');
  out.push('제출했으면 체크, X 표시나 빈칸은 미체크로 바꿉니다.');
  out.push('어디에 제출했는지(경찰서·검찰청·법원)는 버립니다.');

  CB_RETAINER_TABS.forEach(function (tab) {
    var sh = ss.getSheetByName(tab);
    if (!sh) { out.push(''); out.push('[' + tab + '] 탭 없음 — 건너뜀'); return; }

    var head = cbHeadRow_(sh);
    if (!head) { out.push(''); out.push('[' + tab + '] 머리글 줄을 찾지 못함 — 건너뜀'); return; }

    var col = cbFindCol_(sh, head, '선임계');
    if (!col) { out.push(''); out.push('[' + tab + '] 선임계 열 없음 — 건너뜀'); return; }

    var first = head + 1;
    var last = cbLastRow_(sh, head);
    if (last < first) { out.push(''); out.push('[' + tab + '] 데이터 없음'); return; }
    var n = last - first + 1;

    var vals = sh.getRange(first, col, n, 1).getValues();
    var res = [], yes = 0, no = 0, kept = 0;
    var samples = [];

    for (var i = 0; i < n; i++) {
      var v = vals[i][0];
      if (typeof v === 'boolean') { res.push([v]); kept++; if (v) yes++; else no++; continue; }

      var flat = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
      var on = cbSubmitted_(flat);
      res.push([on]);
      if (on) yes++; else no++;
      if (flat && samples.length < 8) samples.push('   ' + (on ? '☑' : '☐') + '  ' + flat.substring(0, 34));
    }

    out.push('');
    out.push('[' + tab + '] 선임계 ' + cbLetter_(col) + '열 · 머리글 ' + head + '행 · 데이터 ' + first + '~' + last + '행 (' + n + '건)');
    out.push('   체크 ' + yes + '건 · 미체크 ' + no + '건'
      + (kept ? ' (이미 체크박스라 그대로 둔 줄 ' + kept + '건 포함)' : ''));
    samples.forEach(function (s) { out.push(s); });

    if (dryRun) return;

    var range = sh.getRange(first, col, n, 1);
    range.insertCheckboxes();
    range.setValues(res);
    sh.setColumnWidth(col, CB_WIDTH);
  });

  if (dryRun) {
    out.push('');
    out.push('실제로 바꾸려면 runRetainer 를 실행하세요.');
    return out.join('\n');
  }
  cbLog_(ss, '선임계를 체크박스로 전환');
  return out.join('\n');
}

/* 제출했는가.
   'X' 가 들어 있으면 제출 안 한 것으로 본다 ('선임계 제출 X' 처럼 '제출' 과
   'X' 가 함께 있는 경우가 있어 X 를 먼저 본다). */
function cbSubmitted_(flat) {
  if (!flat) return false;
  if (/[xX×Ｘ]/.test(flat)) return false;
  return /(제출|접수|완료|[OoＯ○◯])/.test(flat);
}

/* ══════════════════════════════════════════════════════════════
   공소장 · 증거기록 → 체크박스
   ══════════════════════════════════════════════════════════════ */

function previewCheckbox() { cbShow_(cbProcess_(true)); }

function runCheckbox() {
  var backup = cbBackup_('공소장증거기록체크');
  cbShow_('백업 먼저 만들었습니다:\n' + backup + '\n\n' + cbProcess_(false));
}

function cbProcess_(dryRun) {
  var ss = SpreadsheetApp.openById(CB_SHEET_ID);
  var sh = ss.getSheetByName(CB_TAB);
  if (!sh) return '[' + CB_TAB + '] 탭을 찾지 못했습니다.';

  var head = cbHeadRow_(sh);
  if (!head) return '머리글 줄을 찾지 못했습니다. 성명 열이 있는지 확인해 주세요.';

  var cols = cbCols_(sh, head);
  if (!cols.indict || !cols.todo) {
    return '열을 찾지 못했습니다 (공소장=' + cbLetter_(cols.indict)
      + ' 체크할것=' + cbLetter_(cols.todo) + '). 머리글을 확인해 주세요.';
  }
  var split = cols.record > 0;
  var first = head + 1;
  var lastRow = cbLastRow_(sh, head);
  if (lastRow < first) return '데이터가 없습니다.';
  var n = lastRow - first + 1;

  /* 공소장·증거기록 값을 읽는다. 두 열이 반드시 붙어 있다고 가정하지 않는다. */
  var src = [];
  var colA = sh.getRange(first, cols.indict, n, 1).getValues();
  var colB = split ? sh.getRange(first, cols.record, n, 1).getValues() : null;
  for (var k = 0; k < n; k++) src.push(colB ? [colA[k][0], colB[k][0]] : [colA[k][0]]);

  var pairs = [], moved = [];
  var cntIndict = 0, cntRecord = 0, kept = 0, converted = 0;

  for (var i = 0; i < n; i++) {
    var v0 = src[i][0];
    var v1 = split ? src[i][1] : null;
    var a, b;

    if (typeof v0 === 'boolean' || typeof v1 === 'boolean') {
      a = (v0 === true); b = (v1 === true); kept++;
    } else {
      var text = String(v0 == null ? '' : v0);
      var flat = text.replace(/\s/g, '');
      if (isFiling_(flat)) {
        moved.push({ row: first + i, text: text.replace(/\n/g, ' ').trim() });
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
  out.push('[' + CB_TAB + '] 머리글 ' + head + '행 · 데이터 ' + first + '~' + lastRow + '행 (' + n + '건)');
  out.push('찾은 열 — 공소장 ' + cbLetter_(cols.indict)
    + (cols.record ? ' / 증거기록 ' + cbLetter_(cols.record) : ' / 증거기록 (아직 없음)')
    + ' / 체크할것 ' + cbLetter_(cols.todo) + ' / 성명 ' + cbLetter_(cols.name));
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

  /* 증거기록 열 자리. 이미 있으면 그 자리를 쓴다 —
     '공소장 바로 오른쪽'으로 계산하면 사이에 다른 열이 끼었을 때 엉뚱한 칸을 덮어쓴다. */
  var recordCol = cols.record;
  var todoCol = cols.todo;
  if (!split) {
    sh.insertColumnAfter(cols.indict);
    recordCol = cols.indict + 1;
    if (todoCol > cols.indict) todoCol++;
  }

  sh.getRange(head, cols.indict).setValue(CB_HEAD_INDICT);
  sh.getRange(head, recordCol).setValue(CB_HEAD_RECORD);

  moved.forEach(function (m) {
    var cell = sh.getRange(m.row, todoCol);
    var prev = String(cell.getValue() == null ? '' : cell.getValue()).trim();
    cell.setValue(prev ? prev + '\n' + m.text : m.text);
  });

  if (recordCol === cols.indict + 1) {
    var box = sh.getRange(first, cols.indict, n, 2);
    box.insertCheckboxes();
    box.setValues(pairs);
  } else {
    var ra = sh.getRange(first, cols.indict, n, 1);
    var rb = sh.getRange(first, recordCol, n, 1);
    ra.insertCheckboxes();
    rb.insertCheckboxes();
    ra.setValues(pairs.map(function (p) { return [p[0]]; }));
    rb.setValues(pairs.map(function (p) { return [p[1]]; }));
  }

  sh.setColumnWidth(cols.indict, CB_WIDTH);
  sh.setColumnWidth(recordCol, CB_WIDTH);

  cbLog_(ss, '공소장·증거기록 체크박스 전환 (공소장 ' + cntIndict + ' / 증거기록 ' + cntRecord + ')');
  return out.join('\n');
}

/* ══════════════════════════════════════════════════════════════
   도구
   ══════════════════════════════════════════════════════════════ */

/* 머리글 줄을 찾는다.
   '성명' 또는 '이름' 이 적힌 줄을 머리글로 본다. 위에서 다섯 줄만 살펴본다.
   머리글 행이 1행이든 3행이든 알아서 맞춘다. */
function cbHeadRow_(sh) {
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

// 머리글 줄에서 이름으로 열을 찾는다 (공백을 뺀 뒤 앞부분 일치)
function cbFindCol_(sh, head, key) {
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var row = sh.getRange(head, 1, 1, lastCol).getValues()[0];
  for (var c = 0; c < row.length; c++) {
    var h = String(row[c] == null ? '' : row[c]).replace(/\s/g, '');
    if (h.indexOf(key) === 0) return c + 1;
  }
  return 0;
}

/* 공소장·증거기록·체크할것·성명 열을 한 번에 찾는다.
   나뉘기 전 머리글은 '공 소 장 / 증거기록' 한 칸이라 공백을 빼면 '공소장증거기록'.
   '공소장' 으로 시작하니 indict 로 잡히고, record 는 정확히 '증거기록' 일 때만
   잡히므로 아직 안 나뉘었다는 사실이 record === 0 으로 드러난다. */
function cbCols_(sh, head) {
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var row = sh.getRange(head, 1, 1, lastCol).getValues()[0];
  var out = { indict: 0, record: 0, todo: 0, name: 0 };

  for (var c = 0; c < row.length; c++) {
    var h = String(row[c] == null ? '' : row[c]).replace(/\s/g, '');
    if (!h) continue;
    if (!out.indict && h.indexOf('공소장') === 0) out.indict = c + 1;
    else if (!out.record && h === '증거기록') out.record = c + 1;
    else if (!out.todo && h.indexOf('체크할것') === 0) out.todo = c + 1;
    else if (!out.name && (h.indexOf('성명') === 0 || h.indexOf('이름') === 0)) out.name = c + 1;
  }
  return out;
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

// 성명이 채워진 마지막 줄까지를 데이터로 본다
function cbLastRow_(sh, head) {
  var nameCol = cbFindCol_(sh, head, '성명') || cbFindCol_(sh, head, '이름');
  if (!nameCol) return head;
  var last = sh.getLastRow();
  if (last <= head) return head;
  var v = sh.getRange(head + 1, nameCol, last - head, 1).getValues();
  for (var i = v.length - 1; i >= 0; i--) {
    if (String(v[i][0] == null ? '' : v[i][0]).trim()) return head + 1 + i;
  }
  return head;
}

function cbLetter_(c) {
  if (!c) return '-';
  var s = '';
  while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - m - 1) / 26; }
  return s;
}

function cbBackup_(what) {
  var stamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  var name = '[백업] 사건정리 — ' + stamp + ' (' + what + ' 직전)';
  var folder;
  try {
    folder = (typeof backupFolder_ === 'function') ? backupFolder_() : DriveApp.createFolder('사건정리 백업');
  } catch (err) {
    folder = DriveApp.getRootFolder();
  }
  return DriveApp.getFileById(CB_SHEET_ID).makeCopy(name, folder).getUrl();
}

function cbLog_(ss, msg) {
  try {
    if (typeof append_ === 'function') {
      var who = '(로그인 정보 없음)';
      try { who = Session.getActiveUser().getEmail() || who; } catch (e) { }
      append_(ss, who, '-', '-', '', msg, '일괄정리');
    }
  } catch (err) { /* 수정로그 스크립트가 없으면 넘어감 */ }
}

function cbShow_(text) {
  Logger.log(text);
  // 시트에 붙은 프로젝트면 스크롤되는 창으로 보여준다 (alert 는 1200자에서 잘린다)
  if (typeof uiShow_ === 'function') { uiShow_(text); return; }
  try {
    var t = text.length > 1200 ? text.substring(0, 1200) + '\n\n... 전체 내용은 아래 [실행 로그]에서 확인하세요' : text;
    SpreadsheetApp.getUi().alert(t);
  } catch (err) { /* 독립 프로젝트에서는 알림창이 없음 */ }
}
