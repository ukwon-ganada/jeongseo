/* 법무법인 정서 — 사건정리 시트: 백업에서 되돌리기
   ───────────────────────────────────────────────────────────────
   [무엇을 하나]
     백업 시트의 탭을 원본 시트로 통째로 옮겨 넣습니다.
     값·서식·메모·체크박스·조건부서식·열너비·행높이가 모두 함께 복원되고,
     원본 시트의 주소와 공유설정은 그대로 유지됩니다.

   [지금 설정된 복원 지점]
     [백업] 사건정리 — 2026-08-15 13:16 (서식정비 직전)
       · 관할정리 반영됨 (재판부 122칸 분리 + 메모, 관할 137행)
       · 체크박스 반영됨 (공 소 장 / 증거기록)
       · 서식은 손대기 전 상태
     다른 시점으로 되돌리려면 아래 RS_BACKUP_ID 만 바꾸시면 됩니다.

   [수정로그 탭은 건드리지 않습니다]
     되돌리면 그동안 쌓인 수정 기록이 사라지기 때문입니다.
     기록은 지우지 않는 게 맞다고 보아 제외했습니다.

   [설치]
     Apps Script 왼쪽 [파일] 옆 + → [스크립트] → 이름을 되돌리기 로 하고
     이 파일 전체를 붙여넣기 → 저장(Ctrl+S)

   [실행 순서]  반드시 이 순서로
     1) previewRestore   무엇이 어떻게 바뀔지 미리 봅니다. 시트는 안 건드립니다.
     2) runRestore       실제로 되돌립니다.
                         되돌리기 자체도 되돌릴 수 있도록,
                         실행 직전에 지금 상태를 백업으로 한 번 더 떠 둡니다.
   ─────────────────────────────────────────────────────────────── */

// 어느 백업에서 되돌릴 것인가 (구글시트 주소의 /d/ 와 /edit 사이 문자열)
var RS_BACKUP_ID = '1eHcAu7DHEGnLmNkuk0-cxddjDH0Mu9433Tbvf8K_rpQ';

// 되돌릴 대상 — 원본 사건정리 시트
var RS_TARGET_ID = '1YCf77KxxotM4RnxePAhO16C7xbwEiHq4SuF5DN5vWto';

// 되돌리지 않고 지금 것을 그대로 둘 탭
var RS_SKIP = ['수정로그'];

/* ── 실행 ── */

function previewRestore() {
  var r = rsProcess_(true);
  Logger.log(r);
  rsAlert_(r);
}

function runRestore() {
  var safety = rsSafetyCopy_();
  var body = rsProcess_(false);
  var full = '되돌리기 직전 상태를 백업해 두었습니다:\n' + safety
    + '\n(잘못됐다 싶으면 RS_BACKUP_ID 를 이 백업으로 바꿔 다시 실행하시면 됩니다)\n\n' + body;
  Logger.log(full);
  rsAlert_(full);
}

/* ── 본체 ── */

function rsProcess_(dryRun) {
  var src, dst;
  try {
    src = SpreadsheetApp.openById(RS_BACKUP_ID);
  } catch (err) {
    return '백업 시트를 열지 못했습니다. RS_BACKUP_ID 를 확인해 주세요.\n' + err;
  }
  try {
    dst = SpreadsheetApp.openById(RS_TARGET_ID);
  } catch (err) {
    return '원본 시트를 열지 못했습니다. RS_TARGET_ID 를 확인해 주세요.\n' + err;
  }

  var out = [];
  out.push(dryRun ? '=== 미리보기 (시트는 바뀌지 않았습니다) ===' : '=== 되돌리기 완료 ===');
  out.push('백업 : ' + src.getName());
  out.push('원본 : ' + dst.getName());
  out.push('');

  var srcSheets = src.getSheets();
  var dstNames = dst.getSheets().map(function (s) { return s.getName(); });
  var restored = [], skipped = [], added = [];

  srcSheets.forEach(function (sheet) {
    var name = sheet.getName();
    if (RS_SKIP.indexOf(name) >= 0) { skipped.push(name); return; }
    var exists = dstNames.indexOf(name) >= 0;
    (exists ? restored : added).push(
      name + ' (' + sheet.getLastRow() + '행 × ' + sheet.getLastColumn() + '열)'
      + (exists ? '' : '  ← 원본에 없던 탭이라 새로 만듭니다'));
  });

  // 백업에는 없고 원본에만 있는 탭
  var srcNames = srcSheets.map(function (s) { return s.getName(); });
  var onlyInTarget = dstNames.filter(function (n) {
    return srcNames.indexOf(n) < 0 && RS_SKIP.indexOf(n) < 0;
  });

  out.push('덮어쓸 탭 ' + restored.length + '개');
  restored.forEach(function (s) { out.push('   ' + s); });
  if (added.length) {
    out.push('');
    out.push('새로 만들 탭 ' + added.length + '개');
    added.forEach(function (s) { out.push('   ' + s); });
  }
  if (skipped.length) {
    out.push('');
    out.push('건드리지 않는 탭 : ' + skipped.join(', ') + '  (기록을 지우지 않기 위해)');
  }
  if (onlyInTarget.length) {
    out.push('');
    out.push('백업에 없는 탭 : ' + onlyInTarget.join(', '));
    out.push('   → 지우지 않고 그대로 둡니다. 필요 없으면 직접 삭제하세요.');
  }

  if (dryRun) {
    out.push('');
    out.push('실제로 되돌리려면 runRestore 를 실행하세요.');
    return out.join('\n');
  }

  /* ── 여기부터 실제 교체 ── */

  var pos = 1, done = 0, fail = [];

  srcSheets.forEach(function (sheet) {
    var name = sheet.getName();
    if (RS_SKIP.indexOf(name) >= 0) return;
    try {
      // ① 백업 탭을 원본으로 복사 (값·서식·메모·체크박스가 함께 넘어온다)
      var copied = sheet.copyTo(dst);

      // ② 같은 이름의 기존 탭을 지운다 (이름을 비워야 바꿔 달 수 있다)
      var old = dst.getSheetByName(name);
      if (old && old.getSheetId() !== copied.getSheetId()) dst.deleteSheet(old);

      // ③ 이름을 원래대로 바꾸고 순서를 백업과 맞춘다
      copied.setName(name);
      dst.setActiveSheet(copied);
      dst.moveActiveSheet(pos++);
      done++;
    } catch (err) {
      fail.push(name + ' — ' + err);
    }
  });

  SpreadsheetApp.flush();

  out.push('');
  out.push('복원한 탭 ' + done + '개');
  if (fail.length) {
    out.push('');
    out.push('!! 실패 ' + fail.length + '개 — 되돌리기 직전 백업으로 복구하세요 !!');
    fail.forEach(function (s) { out.push('   ' + s); });
  }

  // ④ 대조 — 백업과 원본의 행·열 수가 같은지 확인
  out.push('');
  out.push('대조 결과');
  var allMatch = true;
  srcSheets.forEach(function (sheet) {
    var name = sheet.getName();
    if (RS_SKIP.indexOf(name) >= 0) return;
    var t = dst.getSheetByName(name);
    if (!t) { out.push('   ' + name + ' : 원본에 없음 !!'); allMatch = false; return; }
    var a = sheet.getLastRow() + '×' + sheet.getLastColumn();
    var b = t.getLastRow() + '×' + t.getLastColumn();
    var ok = (a === b);
    if (!ok) allMatch = false;
    out.push('   ' + name + ' : 백업 ' + a + ' / 원본 ' + b + '  ' + (ok ? '일치' : '불일치 !!'));
  });
  out.push('');
  out.push(allMatch && !fail.length
    ? '모든 탭이 백업과 일치합니다 — 되돌리기 성공'
    : '!! 일치하지 않는 탭이 있습니다. 되돌리기 직전 백업을 확인하세요 !!');

  try {
    if (typeof append_ === 'function') {
      append_(dst, rsUser_(), '-', '-', '', src.getName() + ' 에서 되돌림 (탭 ' + done + '개)', '되돌리기');
    }
  } catch (err) { /* 수정로그 스크립트가 없으면 넘어감 */ }

  return out.join('\n');
}

/* ── 도구 ── */

// 되돌리기 자체를 되돌릴 수 있도록, 지금 상태를 백업해 둔다
function rsSafetyCopy_() {
  var stamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  var name = '[백업] 사건정리 — ' + stamp + ' (되돌리기 직전)';
  var folder;
  try {
    folder = (typeof backupFolder_ === 'function') ? backupFolder_() : DriveApp.createFolder('사건정리 백업');
  } catch (err) {
    folder = DriveApp.getRootFolder();
  }
  return DriveApp.getFileById(RS_TARGET_ID).makeCopy(name, folder).getUrl();
}

function rsUser_() {
  try { return Session.getActiveUser().getEmail() || '(로그인 정보 없음)'; }
  catch (err) { return '(로그인 정보 없음)'; }
}

function rsAlert_(text) {
  // 시트에 붙은 프로젝트면 스크롤되는 창으로 보여준다 (alert 는 1200자에서 잘린다)
  if (typeof uiShow_ === 'function') { uiShow_(text); return; }
  try {
    var t = text.length > 1200 ? text.substring(0, 1200) + '\n\n... 전체 내용은 아래 [실행 로그]에서 확인하세요' : text;
    SpreadsheetApp.getUi().alert(t);
  } catch (err) { /* 독립 프로젝트에서는 알림창이 없음 */ }
}
