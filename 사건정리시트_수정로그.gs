/* 법무법인 정서 — 사건정리 구글시트 수정 로그 + 매일 자동 백업
   ───────────────────────────────────────────────────────────────
   ① [수정로그] 탭에 누가·언제·어느 탭 어느 칸을 무엇에서 무엇으로 바꿨는지
      자동으로 쌓습니다. 행/열/탭의 추가·삭제도 함께 기록합니다.
   ② 매일 밤 9시에 시트 전체를 통째로 복사해 [사건정리 백업] 폴더에 넣습니다.
      30일이 지난 백업은 자동으로 휴지통에 보냅니다.

   설치 방법
     1) 저장 (디스크 아이콘 또는 Ctrl+S)  ← 저장해야 함수 목록이 뜹니다
     2) 위쪽 함수 선택창에서  setup  을 고르고 [실행]
     3) 권한 승인 (계정 선택 → 고급 → 이동 → 허용)
        · 시트와 드라이브 접근 권한을 함께 물어봅니다. 백업을 만들려면 필요합니다.
     4) 실행 로그에 "설치 완료"가 뜨면 끝

   확인·중지
     · 백업을 지금 당장 한 번 받아보고 싶으면  runBackupNow  실행
     · 전부 중지하려면  uninstall  실행 (이미 쌓인 기록과 백업은 그대로 남습니다)

   알아두실 것
     · 편집자 이름은 편집한 사람이 구글 계정으로 로그인해 있어야 남습니다.
       현재 이 시트는 '링크가 있는 모든 사용자 = 편집자'라서, 로그인하지 않고
       링크로만 들어와 고치면 '(로그인 정보 없음)'으로 기록됩니다.
       누가 고쳤는지를 확실히 남기려면 공유를 '지정된 사용자'로 바꾸셔야 합니다.
     · 여러 칸을 한 번에 붙여넣으면 '이전 값'은 남지 않습니다(구글 제한).
     · 구글은 시각을 정확히 21:00에 맞춰주지 않습니다. 21시 전후로 실행됩니다.
   ─────────────────────────────────────────────────────────────── */

/* ── 설정 (여기만 바꾸시면 됩니다) ── */

var SHEET_ID = '1YCf77KxxotM4RnxePAhO16C7xbwEiHq4SuF5DN5vWto';  // 사건정리 시트
var BACKUP_HOUR = 21;              // 백업 시각 (24시간제, 21 = 밤 9시)
var BACKUP_FOLDER_NAME = '사건정리 백업';
var BACKUP_KEEP_DAYS = 30;         // 이보다 오래된 백업은 휴지통으로
var TIMEZONE = 'Asia/Seoul';

var LOG_SHEET = '수정로그';        // 로그 탭 이름
var MAX_LOG_ROWS = 5000;           // 이 수를 넘으면 오래된 기록부터 지움
var MAX_LEN = 200;                 // 한 칸에 기록할 최대 글자 수
var LOG_FORMAT_CHANGES = false;    // 글꼴·색 등 서식 변경도 남기려면 true

/* ─────────────────────────────────────────────────────────────── */

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
  var ss = book_();
  ensureLogSheet_(ss);
  removeTriggers_();

  ScriptApp.newTrigger('logEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('logChange').forSpreadsheet(ss).onChange().create();
  ScriptApp.newTrigger('dailyBackup').timeBased()
    .everyDays(1).atHour(BACKUP_HOUR).nearMinute(0).create();

  append_(ss, currentUser_(), '-', '-', '',
    '수정 로그 설치 + 매일 ' + BACKUP_HOUR + '시 자동 백업 예약', '설치');

  var tz = Session.getScriptTimeZone();
  var msg = '설치 완료\n'
    + '· 대상 시트: ' + ss.getName() + '\n'
    + '· 수정 기록: [' + LOG_SHEET + '] 탭에 자동으로 쌓입니다\n'
    + '· 자동 백업: 매일 ' + BACKUP_HOUR + '시 전후, [' + BACKUP_FOLDER_NAME + '] 폴더\n'
    + '· 보관 기간: ' + BACKUP_KEEP_DAYS + '일\n'
    + '· 프로젝트 시간대: ' + tz
    + (tz === TIMEZONE ? '' : '  ← ' + TIMEZONE + ' 이 아닙니다. 왼쪽 톱니바퀴(프로젝트 설정)에서 바꿔주세요');

  Logger.log(msg);
  alert_(msg);
}

function uninstall() {
  removeTriggers_();
  append_(book_(), currentUser_(), '-', '-', '', '수정 로그·자동 백업 중지', '설치');
  Logger.log('중지했습니다. 이미 쌓인 기록과 백업 파일은 그대로 남아 있습니다.');
}

function removeTriggers_() {
  var mine = { logEdit: 1, logChange: 1, dailyBackup: 1 };
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (mine[t.getHandlerFunction()]) ScriptApp.deleteTrigger(t);
  });
}

/* ── 매일 자동 백업 ── */

function dailyBackup() {
  var stamp = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm');
  var name = '[백업] 사건정리 — ' + stamp;

  var folder = backupFolder_();
  var copy = DriveApp.getFileById(SHEET_ID).makeCopy(name, folder);

  var removed = pruneOldBackups_(folder);

  var note = name + ' 저장'
    + (removed ? ' / ' + BACKUP_KEEP_DAYS + '일 지난 백업 ' + removed + '건 정리' : '');
  Logger.log(note + '\n' + copy.getUrl());

  try {
    append_(book_(), '자동', '-', '-', '', note, '백업');
  } catch (err) {
    Logger.log('백업은 됐으나 로그 기록에 실패: ' + err);
  }
  return copy.getUrl();
}

// 지금 한 번 받아보기 (손으로 실행하는 용도)
function runBackupNow() {
  var url = dailyBackup();
  alert_('백업을 만들었습니다.\n\n' + url);
}

function backupFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('BACKUP_FOLDER_ID');

  if (id) {
    try {
      var f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (err) { /* 지워졌으면 아래에서 새로 만듦 */ }
  }

  var found = DriveApp.getFoldersByName(BACKUP_FOLDER_NAME);
  var folder = found.hasNext() ? found.next() : DriveApp.createFolder(BACKUP_FOLDER_NAME);
  props.setProperty('BACKUP_FOLDER_ID', folder.getId());
  return folder;
}

function pruneOldBackups_(folder) {
  var cutoff = new Date().getTime() - BACKUP_KEEP_DAYS * 24 * 60 * 60 * 1000;
  var files = folder.getFiles();
  var n = 0;
  while (files.hasNext()) {
    var f = files.next();
    if (f.getDateCreated().getTime() < cutoff) { f.setTrashed(true); n++; }
  }
  return n;
}

/* ── 수정 기록 ── */

// 셀 값이 바뀔 때
function logEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (sh.getName() === LOG_SHEET) return;   // 로그 탭 자체 편집은 남기지 않음

  var ss = e.source || book_();
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
  var ss = book_();
  var name = '-';
  try { name = ss.getActiveSheet().getName(); } catch (err) { /* 탭 삭제 직후 등 */ }
  if (name === LOG_SHEET) return;

  append_(ss, who_(e), name, '', '', '', label);
}

/* ── 내부 도구 ── */

// 대상 시트. ID 를 직접 지정하므로 독립 프로젝트에서도, 시간 기반 실행에서도 동작함
function book_() {
  if (SHEET_ID) return SpreadsheetApp.openById(SHEET_ID);
  return SpreadsheetApp.getActive();
}

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
    ? Utilities.formatDate(v, TIMEZONE, 'yyyy-MM-dd HH:mm')
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

// 시트에 붙은 스크립트일 때만 알림창이 뜸. 독립 프로젝트에서는 실행 로그로 확인
function alert_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (err) { /* 무시 */ }
}
