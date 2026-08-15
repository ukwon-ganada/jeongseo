/* 법무법인 정서 — 사건정리 시트 미니멀 서식
   ───────────────────────────────────────────────────────────────
   [지난번 실패를 되풀이하지 않기 위해]
     예전 서식 스크립트는 글자 크기·정렬·행 높이·열 너비·제목까지 한꺼번에
     바꿔서 표를 못 쓰게 만들었습니다. 이번에는 손대는 범위를 좁혔습니다.

     아래 함수들은 이 파일에 아예 등장하지 않습니다.
       setFontSize · setFontFamily · setHorizontalAlignment ·
       setVerticalAlignment · setRowHeight · autoResizeRows ·
       setColumnWidth · setWrap · setValue

     따라서 이런 것들은 지금 그대로 유지됩니다.
       글꼴 맑은 고딕 · 글자 크기 10pt · 가로세로 전부 가운데 정렬 ·
       행 높이 40.5 · 열 너비 · 제목(B1:W1 병합) · 셀 값

   [바꾸는 것은 넷뿐입니다]
     ① 격자 테두리 → 가로 구분선만 (지금 6,026칸 전부 사방 실선입니다)
     ② 연파랑 배경(#e8f0fe)만 골라서 지움 — 다른 색은 그대로
     ③ 머리글에 연회색 바탕 + 굵게
     ④ 머리글 행 고정 · 필터 · 눈금선 숨김

   [직접 표시하신 색은 지키지 않고 남깁니다]
     배경을 통째로 흰색으로 칠하지 않고, 연파랑인 칸만 골라 바꿉니다.
       #ff0000 순빨강 5행 · #f4cccc 1행 · #fce8e6 2행  →  전부 유지

   [열 고정은 하지 않습니다]
     제목이 B1:W1 로 병합돼 있어 열을 고정하려면 병합을 풀어야 하는데,
     제목을 건드리지 않기로 했으므로 포기합니다.
     (지난번 '병합된 셀의 일부만 포함된 열은 고정할 수 없습니다' 오류가 이것입니다)

   [설치]
     Apps Script 에서 서식정비.gs 를 열고 Ctrl+A → Delete → 이 파일 붙여넣기 → Ctrl+S

   [실행]
     1) previewFormat   무엇이 바뀔지 미리 봅니다. 시트는 안 건드립니다.
     2) runFormat       실제로 적용합니다. 적용 전 백업을 자동으로 뜹니다.
     · verifyValues     나중에 언제든 값이 그대로인지 다시 대조합니다.
   ─────────────────────────────────────────────────────────────── */

var FM_SHEET_ID = '1YCf77KxxotM4RnxePAhO16C7xbwEiHq4SuF5DN5vWto';

/* ── 색 ── */
var C_RULE = '#d9d9d9';        // 행 사이 가로 구분선
var C_HEAD_RULE = '#9e9e9e';   // 머리글 아래 선 (조금 진하게)
var C_HEAD_BG = '#f2f2f2';     // 머리글 바탕
var C_WHITE = '#ffffff';

// 지울 배경색. 여기 적힌 색만 흰색으로 바뀝니다.
var CLEAR_FILLS = ['#e8f0fe'];

// A열 번호가 1.0 으로 보이는 것을 1 로. 원하지 않으면 false 로 두세요.
var FIX_NUMBER_FORMAT = true;

/* 탭별 머리글 행 / 데이터 시작 행 */
var FM_TABS = [
  { name: '형사사건', headRow: 3, firstRow: 4 },
  { name: '항소사건', headRow: 2, firstRow: 3 },
  { name: '약식명령', headRow: 2, firstRow: 3 },
  { name: '종결', headRow: 1, firstRow: 2 }
];

/* ── 실행 ── */

function previewFormat() { fmShow_(fmProcess_(true)); }

function runFormat() {
  var backup = fmBackup_();
  var before = valueChecksum_();
  PropertiesService.getScriptProperties().setProperty('FM_CHECKSUM', before);

  var body = fmProcess_(false);

  var after = valueChecksum_();
  var verdict = (before === after)
    ? '값 체크섬 일치 — 데이터 변경 없음 (' + after.substring(0, 12) + ')'
    : '!! 값 체크섬 불일치 — 백업으로 되돌리세요 !!\n   전 ' + before + '\n   후 ' + after;

  fmShow_('백업 먼저 만들었습니다:\n' + backup + '\n\n' + body + '\n\n' + verdict);
}

function verifyValues() {
  var saved = PropertiesService.getScriptProperties().getProperty('FM_CHECKSUM');
  var now = valueChecksum_();
  fmShow_(!saved
    ? '저장된 체크섬이 없습니다. runFormat 을 실행하면 저장됩니다.\n지금 값 체크섬: ' + now
    : (saved === now
      ? '값이 그대로입니다 — 변경 없음 (' + now.substring(0, 12) + ')'
      : '값이 달라졌습니다.\n   저장 ' + saved + '\n   현재 ' + now
        + '\n(서식 적용 이후 사건을 입력·수정하셨다면 정상입니다.)'));
}

/* ── 본체 ── */

function fmProcess_(dryRun) {
  var ss = SpreadsheetApp.openById(FM_SHEET_ID);
  var out = [];
  out.push(dryRun ? '=== 미리보기 (시트는 바뀌지 않았습니다) ===' : '=== 미니멀 서식 적용 완료 ===');
  out.push('글자 크기·정렬·행 높이·열 너비·제목·셀 값은 건드리지 않습니다.');

  FM_TABS.forEach(function (t) {
    var sh = ss.getSheetByName(t.name);
    if (!sh) { out.push(''); out.push('[' + t.name + '] 탭 없음 — 건너뜀'); return; }

    var lastRow = sh.getLastRow();
    var lastCol = sh.getLastColumn();
    if (lastRow < t.firstRow || lastCol < 1) {
      out.push(''); out.push('[' + t.name + '] 데이터 없음'); return;
    }
    var n = lastRow - t.firstRow + 1;

    // 배경색 조사 — 지울 것과 남길 것을 센다
    var bg = sh.getRange(1, 1, lastRow, lastCol).getBackgrounds();
    var toClear = 0, keep = {};
    for (var r = 0; r < bg.length; r++) {
      for (var c = 0; c < bg[r].length; c++) {
        var v = String(bg[r][c]).toLowerCase();
        if (CLEAR_FILLS.indexOf(v) >= 0) toClear++;
        else if (v !== '#ffffff' && v !== '') keep[v] = (keep[v] || 0) + 1;
      }
    }

    out.push('');
    out.push('[' + t.name + '] 머리글 ' + t.headRow + '행 · 데이터 ' + t.firstRow + '~' + lastRow
      + '행 (' + n + '건) · ' + lastCol + '열');
    out.push('   지울 연파랑 칸  ' + toClear + '칸');
    var keys = Object.keys(keep).sort(function (a, b) { return keep[b] - keep[a]; });
    out.push('   그대로 두는 색  ' + (keys.length
      ? keys.map(function (k) { return k + ' ' + keep[k] + '칸'; }).join(' · ')
      : '없음'));

    if (dryRun) return;
    fmStyle_(sh, t, lastRow, lastCol, bg);
  });

  if (!dryRun) {
    try {
      if (typeof append_ === 'function') append_(ss, fmUser_(), '-', '-', '', '미니멀 서식 적용', '서식');
    } catch (err) { /* 수정로그 없으면 넘어감 */ }
  }
  return out.join('\n');
}

function fmStyle_(sh, t, lastRow, lastCol, bg) {
  var n = lastRow - t.firstRow + 1;

  // ① 연파랑만 골라서 흰색으로. 나머지 색은 손대지 않는다.
  var changed = false;
  for (var r = 0; r < bg.length; r++) {
    for (var c = 0; c < bg[r].length; c++) {
      if (CLEAR_FILLS.indexOf(String(bg[r][c]).toLowerCase()) >= 0) {
        bg[r][c] = C_WHITE;
        changed = true;
      }
    }
  }
  if (changed) sh.getRange(1, 1, lastRow, lastCol).setBackgrounds(bg);

  // ② 격자 제거 → 가로 구분선만
  var all = sh.getRange(1, 1, lastRow, lastCol);
  all.setBorder(false, false, false, false, false, false);
  sh.getRange(t.firstRow, 1, n, lastCol)
    .setBorder(null, null, null, null, null, true, C_RULE, SpreadsheetApp.BorderStyle.SOLID);

  // ③ 머리글 — 바탕과 굵기만. 글자 크기·정렬은 건드리지 않는다.
  var head = sh.getRange(t.headRow, 1, 1, lastCol);
  head.setBackground(C_HEAD_BG).setFontWeight('bold');
  head.setBorder(null, null, true, null, null, null, C_HEAD_RULE, SpreadsheetApp.BorderStyle.SOLID);

  // ④ 행 고정 · 필터 · 눈금선
  //    열 고정은 하지 않는다 (제목 병합을 풀어야 해서)
  try { sh.setFrozenRows(t.headRow); } catch (err) { Logger.log('[' + t.name + '] 행 고정 건너뜀 — ' + err); }
  try { sh.setHiddenGridlines(true); } catch (err) { /* 구버전 대비 */ }
  try {
    var f = sh.getFilter();
    if (f) f.remove();
    sh.getRange(t.headRow, 1, lastRow - t.headRow + 1, lastCol).createFilter();
  } catch (err) { Logger.log('[' + t.name + '] 필터 건너뜀 — ' + err); }

  // ⑤ A열 번호를 1.0 이 아니라 1 로 (표시 형식만, 값과 정렬은 그대로)
  if (FIX_NUMBER_FORMAT) sh.getRange(t.firstRow, 1, n, 1).setNumberFormat('0');
}

/* ── 값 무변경 확인 ── */

// 표시값이 아니라 실제 값을 본다. 표시 형식을 바꿔도 헛경보가 울리지 않는다.
function valueChecksum_() {
  var ss = SpreadsheetApp.openById(FM_SHEET_ID);
  var parts = [];
  ss.getSheets().forEach(function (sh) {
    var name = sh.getName();
    if (name === '수정로그') return;   // 실행할 때마다 늘어나므로 제외
    var lr = sh.getLastRow(), lc = sh.getLastColumn();
    if (lr < 1 || lc < 1) return;
    var vals = sh.getRange(1, 1, lr, lc).getValues();
    parts.push('#' + name);
    for (var r = 0; r < vals.length; r++) {
      for (var c = 0; c < vals[r].length; c++) {
        var v = vals[r][c];
        parts.push(v instanceof Date ? v.getTime() : String(v));
      }
    }
  });
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, parts.join(''), Utilities.Charset.UTF_8);
  return raw.map(function (b) { return ((b & 0xff) + 0x100).toString(16).slice(1); }).join('');
}

/* ── 도구 ── */

function fmBackup_() {
  var stamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  var name = '[백업] 사건정리 — ' + stamp + ' (미니멀서식 직전)';
  var folder;
  try {
    folder = (typeof backupFolder_ === 'function') ? backupFolder_() : DriveApp.createFolder('사건정리 백업');
  } catch (err) {
    folder = DriveApp.getRootFolder();
  }
  return DriveApp.getFileById(FM_SHEET_ID).makeCopy(name, folder).getUrl();
}

function fmUser_() {
  try { return Session.getActiveUser().getEmail() || '(로그인 정보 없음)'; }
  catch (err) { return '(로그인 정보 없음)'; }
}

function fmShow_(text) {
  Logger.log(text);
  try {
    var t = text.length > 1200 ? text.substring(0, 1200) + '\n\n... 전체 내용은 아래 [실행 로그]에서 확인하세요' : text;
    SpreadsheetApp.getUi().alert(t);
  } catch (err) { /* 독립 프로젝트에서는 알림창이 없음 */ }
}
