/* 법무법인 정서 — 사건정리 시트: 종결 탭에 머리글 붙이기
   ───────────────────────────────────────────────────────────────
   [무엇을 하나]
     종결 탭은 머리글이 없어 어느 칸이 무엇인지 알 수 없습니다.
     실제로 쓰이고 있는 열에만 이름을 붙입니다.

       A No · B 구속여부 · C 성 명 · D 사건명 · E 선임계
       G 사건번호 · H 관할 · J 기일 · K 결과 · L 비고

     F·I 는 쓰이지 않아 비워 둡니다. 무슨 칸인지 모르는데 이름을 붙이면
     그게 곧 틀린 정보가 되기 때문입니다. 나중에 직접 채우시면 됩니다.

   [1행이 비어 있어야 합니다]
     지금 종결 탭은 1행이 비어 있고 2행부터 데이터입니다.
     그래서 덮어쓸 것이 없습니다. 1행에 값이 있으면 실행을 멈춥니다.

   [설치]
     Apps Script 왼쪽 [파일] 옆 + → [스크립트] → 이름을 종결머리글 로 하고
     이 파일 전체를 붙여넣기 → 저장(Ctrl+S)

   [실행 순서]
     1) previewClosedHeader   무엇을 붙일지 미리 봅니다. 시트는 안 건드립니다.
     2) runClosedHeader       실제로 붙입니다. 붙이기 전에 백업을 뜹니다.
   ─────────────────────────────────────────────────────────────── */

var CH_SHEET_ID = '1YCf77KxxotM4RnxePAhO16C7xbwEiHq4SuF5DN5vWto';
var CH_TAB = '종결';
var CH_ROW = 1;          // 머리글을 넣을 줄
var CH_FIRST_ROW = 2;    // 데이터 시작 줄

// [열 번호, 머리글]. 여기 없는 열은 비워 둡니다.
var CH_HEADERS = [
  [1, 'No'], [2, '구속여부'], [3, '성 명'], [4, '사건명'], [5, '선임계'],
  [7, '사건번호'], [8, '관할'], [10, '기일'], [11, '결과'], [12, '비고']
];

/* ── 실행 ── */

function previewClosedHeader() { chShow_(chProcess_(true)); }

function runClosedHeader() {
  var backup = chBackup_();
  chShow_('백업 먼저 만들었습니다:\n' + backup + '\n\n' + chProcess_(false));
}

/* ── 본체 ── */

function chProcess_(dryRun) {
  var ss = SpreadsheetApp.openById(CH_SHEET_ID);
  var sh = ss.getSheetByName(CH_TAB);
  if (!sh) return '[' + CH_TAB + '] 탭을 찾지 못했습니다.';

  var lastCol = Math.max(sh.getLastColumn(), 12);
  var lastRow = sh.getLastRow();

  // 1행에 이미 값이 있으면 손대지 않는다
  var existing = sh.getRange(CH_ROW, 1, 1, lastCol).getValues()[0];
  var occupied = [];
  for (var i = 0; i < existing.length; i++) {
    var v = String(existing[i] == null ? '' : existing[i]).trim();
    if (v) occupied.push(chL_(i + 1) + '「' + v + '」');
  }

  var out = [];
  out.push(dryRun ? '=== 미리보기 (시트는 바뀌지 않았습니다) ===' : '=== 머리글 적용 완료 ===');
  out.push('[' + CH_TAB + '] ' + CH_ROW + '행에 머리글 · 데이터 ' + CH_FIRST_ROW + '~' + lastRow + '행');
  out.push('');

  if (occupied.length) {
    out.push('!! ' + CH_ROW + '행에 이미 값이 있습니다 — 덮어쓰지 않고 멈춥니다 !!');
    occupied.forEach(function (s) { out.push('   ' + s); });
    out.push('');
    out.push('그 값이 이미 머리글이라면 이 작업은 필요 없습니다.');
    return out.join('\n');
  }

  // 붙일 머리글과, 그 열에 실제 데이터가 몇 건 있는지 함께 보여준다
  var n = Math.max(0, lastRow - CH_FIRST_ROW + 1);
  out.push('붙일 머리글');
  CH_HEADERS.forEach(function (h) {
    var cnt = 0;
    if (n > 0) {
      var vals = sh.getRange(CH_FIRST_ROW, h[0], n, 1).getValues();
      for (var i = 0; i < vals.length; i++) {
        if (String(vals[i][0] == null ? '' : vals[i][0]).trim()) cnt++;
      }
    }
    out.push('   ' + chL_(h[0]) + '  ' + h[1] + '   (데이터 ' + cnt + '건)');
  });
  out.push('');
  out.push('F · I 는 쓰이지 않아 비워 둡니다.');

  if (dryRun) {
    out.push('');
    out.push('실제로 붙이려면 runClosedHeader 를 실행하세요.');
    return out.join('\n');
  }

  /* ── 실제 변경 ── */

  var row = [];
  for (var c = 1; c <= lastCol; c++) row.push('');
  CH_HEADERS.forEach(function (h) { if (h[0] <= lastCol) row[h[0] - 1] = h[1]; });
  sh.getRange(CH_ROW, 1, 1, lastCol).setValues([row]);

  out.push('');
  out.push('머리글 ' + CH_HEADERS.length + '개를 붙였습니다.');
  out.push('이제 서식 스크립트가 종결 탭도 머리글 있는 표로 다룹니다 — runFormat 을 돌려보세요.');

  try {
    if (typeof append_ === 'function') {
      var who = '(로그인 정보 없음)';
      try { who = Session.getActiveUser().getEmail() || who; } catch (e) { }
      append_(ss, who, CH_TAB, chL_(1) + CH_ROW, '', '종결 탭 머리글 ' + CH_HEADERS.length + '개 추가', '일괄정리');
    }
  } catch (err) { /* 수정로그 스크립트가 없으면 넘어감 */ }

  return out.join('\n');
}

/* ── 도구 ── */

function chL_(c) {
  var s = '';
  while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - m - 1) / 26; }
  return s;
}

function chBackup_() {
  var stamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  var name = '[백업] 사건정리 — ' + stamp + ' (종결머리글 직전)';
  var folder;
  try {
    folder = (typeof backupFolder_ === 'function') ? backupFolder_() : DriveApp.createFolder('사건정리 백업');
  } catch (err) {
    folder = DriveApp.getRootFolder();
  }
  return DriveApp.getFileById(CH_SHEET_ID).makeCopy(name, folder).getUrl();
}

function chShow_(text) {
  Logger.log(text);
  try {
    var t = text.length > 1200 ? text.substring(0, 1200) + '\n\n... 전체 내용은 아래 [실행 로그]에서 확인하세요' : text;
    SpreadsheetApp.getUi().alert(t);
  } catch (err) { /* 독립 프로젝트에서는 알림창이 없음 */ }
}
