/* 법무법인 정서 — 사건정리 구글시트 수정 로그
   ───────────────────────────────────────────────────────────────
   시트에 [수정로그] 탭을 만들고, 누가·언제·어느 탭 어느 칸을·무엇에서 무엇으로
   바꿨는지 자동으로 쌓습니다. 행/열/탭의 추가·삭제도 함께 기록합니다.

   설치 방법
     1) 사건정리 시트에서 [확장 프로그램] → [Apps Script]
     2) 기존 코드를 지우고 이 파일 전체를 붙여넣기 → 저장(디스크 아이콘)
     3) 위쪽 함수 선택창에서 setup 을 고르고 [실행]
     4) 권한 승인 창이 뜨면 승인 (본인 구글 계정 선택 → 고급 → 이동 → 허용)
     5) [수정로그] 탭이 생기고 "설치 완료" 한 줄이 적히면 끝

   되돌리기(제거): 함수 선택창에서 uninstall 실행 → 기록은 남고 수집만 멈춤

   알아두실 것
     · 편집자 이름은 편집한 사람이 구글 계정으로 로그인해 있어야 남습니다.
       현재 이 시트는 '링크가 있는 모든 사용자 = 편집자'라서, 로그인하지 않고
       링크로만 들어와 고치면 '(로그인 정보 없음)'으로 기록됩니다.
       누가 고쳤는지를 확실히 남기려면 공유를 '지정된 사용자'로 바꾸셔야 합니다.
     · 여러 칸을 한 번에 붙여넣으면 '이전 값'은 남지 않습니다(구글 제한).
     · 스크립트나 되돌리기(Ctrl+Z)로 생긴 변경도 편집으로 기록됩니다.
   ─────────────────────────────────────────────────────────────── */

var LOG_SHEET = '수정로그';   // 로그 탭 이름
var MAX_LOG_ROWS = 5000;      // 이 수를 넘으면 오래된 기록부터 지움
var MAX_LEN = 200;            // 한 칸에 기록할 최대 글자 수
var LOG_FORMAT_CHANGES = false; // 글꼴·색 등 서식 변경도 남기려면 true

var HEADERS = ['시각', '편집자', '탭', '위치', '이전 값', '새 값', '종류'];

var CHANGE_LABEL = {
  INSERT_ROW: '행 추가',
  REMOVE_ROW: '행 삭제',
  INSERT_COLUMN: '열 추가',
  REMOVE_COLUMN: '열 삭제',
  INSERT_GRID: '탭 추가',
  REMOVE_GRID: '탭 삭제',
  FORMAT: '서식 변경',
  OTHER: '기타 변경'
};

/* ── 설치 / 제거 ── */

function setup() {
  var ss = SpreadsheetApp.getActive();
  ensureLogSheet_(ss);
  removeTriggers_();
  ScriptApp.newTrigger('logEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('logChange').forSpreadsheet(ss).onChange().create();
  append_(ss, currentUser_(), '-', '-', '', '수정 로그 설치 완료', '설치');
  try {
    SpreadsheetApp.getUi().alert('[수정로그] 탭 설치가 끝났습니다.\n이제부터 모든 수정이 자동으로 기록됩니다.');
  } catch (err) { /* 편집기에서 직접 실행한 경우 알림창이 없음 */ }
}

function uninstall() {
  removeTriggers_();
  append_(SpreadsheetApp.getActive(), currentUser_(), '-', '-', '', '수정 로그 수집 중지', '설치');
}

function removeTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'logEdit' || fn === 'logChange') ScriptApp.deleteTrigger(t);
  });
}

/* ── 기록 ── */

// 셀 값이 바뀔 때
function logEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (sh.getName() === LOG_SHEET) return;   // 로그 탭 자체 편집은 남기지 않음

  var ss = e.source || SpreadsheetApp.getActive();
  var where = e.range.getA1Notation();
  var count = e.range.getNumRows() * e.range.getNumColumns();

  if (count === 1) {
    var before = (e.oldValue === undefined || e.oldValue === null) ? '' : e.oldValue;
    var after = (e.value === undefined || e.value === null) ? e.range.getDisplayValue() : e.value;
    append_(ss, who_(e), sh.getName(), where, before, after, '셀 수정');
  } else {
    append_(ss, who_(e), sh.getName(), where,
      '(여러 칸 동시 수정 — 이전 값 기록 불가)',
      count + '칸: ' + preview_(e.range), '범위 수정');
  }
}

// 행·열·탭이 늘거나 줄 때
function logChange(e) {
  if (!e) return;
  if (e.changeType === 'EDIT') return;                       // logEdit 가 이미 기록
  if (e.changeType === 'FORMAT' && !LOG_FORMAT_CHANGES) return;

  var label = CHANGE_LABEL[e.changeType] || e.changeType;
  var ss = SpreadsheetApp.getActive();
  var name = '-';
  try { name = ss.getActiveSheet().getName(); } catch (err) { /* 탭 삭제 직후 등 */ }
  if (name === LOG_SHEET) return;

  append_(ss, who_(e), name, '', '', '', label);
}

/* ── 내부 도구 ── */

function ensureLogSheet_(ss) {
  var sh = ss.getSheetByName(LOG_SHEET);
  if (sh) return sh;

  sh = ss.insertSheet(LOG_SHEET, ss.getNumSheets());
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
    .setFontWeight('bold').setBackground('#f2f2f2')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 150);  // 시각
  sh.setColumnWidth(2, 190);  // 편집자
  sh.setColumnWidth(3, 100);  // 탭
  sh.setColumnWidth(4, 80);   // 위치
  sh.setColumnWidth(5, 240);  // 이전 값
  sh.setColumnWidth(6, 240);  // 새 값
  sh.setColumnWidth(7, 90);   // 종류
  return sh;
}

function append_(ss, editor, sheetName, where, before, after, kind) {
  var lock = LockService.getDocumentLock();
  try {
    lock.waitLock(10000);   // 여러 명이 동시에 고칠 때 기록이 겹치지 않게
  } catch (err) {
    return;                 // 10초 안에 못 잡으면 이번 건은 건너뜀
  }
  try {
    var sh = ensureLogSheet_(ss);
    sh.appendRow([new Date(), editor, sheetName, where, cut_(before), cut_(after), kind]);
    var last = sh.getLastRow();
    sh.getRange(last, 1).setNumberFormat('yyyy-mm-dd HH:mm:ss');
    var overflow = last - 1 - MAX_LOG_ROWS;
    if (overflow > 0) sh.deleteRows(2, overflow);
  } finally {
    lock.releaseLock();
  }
}

function who_(e) {
  var email = '';
  try { if (e && e.user) email = e.user.getEmail() || ''; } catch (err) { /* 도메인 밖 사용자 */ }
  if (!email) email = currentUser_();
  return email;
}

function currentUser_() {
  try { return Session.getActiveUser().getEmail() || '(로그인 정보 없음)'; }
  catch (err) { return '(로그인 정보 없음)'; }
}

function cut_(v) {
  if (v === null || v === undefined) return '';
  var s = (v instanceof Date)
    ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm')
    : String(v);
  s = s.replace(/\n/g, ' ');
  return s.length > MAX_LEN ? s.substring(0, MAX_LEN) + '…' : s;
}

// 여러 칸을 한꺼번에 고쳤을 때, 새 값 앞부분만 미리보기로 남김
function preview_(range) {
  var flat = [];
  range.getDisplayValues().forEach(function (row) {
    row.forEach(function (v) { if (v !== '') flat.push(v); });
  });
  return cut_(flat.slice(0, 8).join(' / '));
}
