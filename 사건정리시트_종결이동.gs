/* 법무법인 정서 — 사건정리 시트: 종결 처리 / 되돌리기
   ───────────────────────────────────────────────────────────────
   [무엇을 하나]
     형사사건 맨 오른쪽 [종결] 칸을 체크하면 그 행이 종결 탭으로 넘어갑니다.
     종결 탭 맨 오른쪽 [복원] 칸을 체크하면 형사사건으로 되돌아옵니다.

       형사사건   … 항소여부 │ 종결 ☑  ──▶  종결 탭 맨 아래로
       종결       … 비고     │ 복원 ☑  ──▶  형사사건 맨 아래로

     구글시트는 셀 안에 누를 수 있는 버튼을 만들 수 없습니다.
     체크박스가 가장 가까운 방법이고, 클릭 한 번이라는 점은 같습니다.

   [정보가 사라지지 않게 합니다]
     종결 탭 열 구성을 형사사건과 똑같이 맞춥니다.
     그래야 행을 그대로 복사할 수 있고, 지위·단계·수사기록·재판부 같은
     항목이 옮기는 과정에서 없어지지 않습니다.

       형사사건   A~W                     + X 종결 ☐
       종결       A~W (형사사건과 동일)    + X 종결일 · Y 결과 · Z 비고 · AA 복원 ☐

   [설치]
     Apps Script 왼쪽 [파일] 옆 + → [스크립트] → 이름을 종결이동 으로 하고
     이 파일 전체를 붙여넣기 → 저장(Ctrl+S)

   [실행 순서]  반드시 이 순서로
     1) previewAlignClosed  → runAlignClosed    종결 탭 구조를 형사사건에 맞춤
     2) previewCloseButtons → runCloseButtons   양쪽에 체크박스 깔기
     3) setupCloseButtons                       체크하면 옮겨지도록 켜기

   [중요]
     스크립트가 지운 행은 Ctrl+Z 로 되돌릴 수 없습니다.
     그래서 종결 탭에 복원 체크박스를 두는 것입니다.
     실수로 체크하셨다면 종결 탭 맨 아래에서 그 행을 찾아 복원을 체크하세요.

   [끄기]  removeCloseButtons
   ─────────────────────────────────────────────────────────────── */

var CL_SHEET_ID = '1YCf77KxxotM4RnxePAhO16C7xbwEiHq4SuF5DN5vWto';

var CL_MAIN = '형사사건';
var CL_MAIN_HEAD = 3;
var CL_MAIN_FIRST = 4;

var CL_DONE = '종결';
var CL_DONE_HEAD = 1;
var CL_DONE_FIRST = 2;

var CL_SHARED_COLS = 23;   // A~W — 두 탭이 공유하는 열 수

// 종결 탭에만 있는 뒤쪽 열 (공유 열 다음부터)
var CL_DONE_EXTRA = ['종결일', '결과', '비고'];
var CL_HEAD_CLOSE = '종결';
var CL_HEAD_RESTORE = '복원';
var CL_BTN_WIDTH = 60;

/* 종결 탭 재편 — 지금 열 → 새 자리.
   자리가 분명한 것만 여기 적습니다. */
var CL_FIXED = [
  [2, 2],   // 구속여부 → 구속여부
  [3, 3],   // 성 명    → 성 명
  [4, 6],   // 사건명   → 사건명
  [5, 7],   // 선임계   → 선임계
  [10, 20], // 기일     → 기일
  [11, 25], // 결과     → 결과      (A~W 23열 + 종결일 24 + 결과 25 + 비고 26)
  [12, 26], // 비고     → 비고
  [16, 18], // (머리글 없는 체크박스) → 공소장
  [17, 19], // (머리글 없는 체크박스) → 증거기록
  [20, 22]  // (수임일 메모)          → 체크할것
];

/* F·G·H 세 열은 행마다 들어있는 것이 다릅니다.
   예전 배치로 붙여넣은 행들이 한 칸씩 밀려 있어, 열 위치로 옮기면
   법원이 사건번호 칸에 들어가 버립니다. 그래서 값의 내용을 보고 자리를 정합니다.
     울산경찰청 → 관할경찰서   /   2026노720 → 사건번호   /   인천지방법원 → 관할 */
var CL_ROUTE_FROM = [6, 7, 8];
var CL_COL_POLICE = 8, CL_COL_PROS_OFFICE = 13, CL_COL_CASENO = 15, CL_COL_COURT = 16;

/* ══════════════════════════════════════════════════════════════
   ① 종결 탭을 형사사건과 같은 구조로
   ══════════════════════════════════════════════════════════════ */

function previewAlignClosed() { clShow_(clAlign_(true)); }

function runAlignClosed() {
  var backup = clBackup_('종결탭재편');
  clShow_('백업 먼저 만들었습니다:\n' + backup + '\n\n' + clAlign_(false));
}

function clAlign_(dryRun) {
  var ss = SpreadsheetApp.openById(CL_SHEET_ID);
  var main = ss.getSheetByName(CL_MAIN);
  var done = ss.getSheetByName(CL_DONE);
  if (!main || !done) return '형사사건 또는 종결 탭을 찾지 못했습니다.';

  var out = [];
  out.push(dryRun ? '=== 미리보기 (시트는 바뀌지 않았습니다) ===' : '=== 종결 탭 재편 완료 ===');

  // 이미 재편됐는지 — 종결 1행 D칸이 '지위' 면 끝난 것
  var d4 = String(done.getRange(CL_DONE_HEAD, 4).getValue() || '').replace(/\s/g, '');
  if (d4.indexOf('지위') === 0) {
    out.push('이미 형사사건과 같은 구조입니다. 할 일이 없습니다.');
    return out.join('\n');
  }

  var last = done.getLastRow();
  var n = last - CL_DONE_FIRST + 1;
  if (n < 1) { out.push('종결 탭에 데이터가 없습니다.'); return out.join('\n'); }

  var old = done.getRange(CL_DONE_FIRST, 1, n, Math.max(done.getLastColumn(), 12)).getValues();
  var totalCols = CL_SHARED_COLS + CL_DONE_EXTRA.length;   // A~Z (26열)

  var rows = [], roleCnt = {}, stageCnt = {}, kept = 0, lost = [], routed = [];

  for (var i = 0; i < n; i++) {
    var blank = true;
    for (var k = 0; k < old[i].length; k++) {
      if (String(old[i][k] == null ? '' : old[i][k]).trim()) { blank = false; break; }
    }
    if (blank) continue;

    var row = [];
    for (var c = 0; c < totalCols; c++) row.push('');

    CL_FIXED.forEach(function (m) {
      var v = old[i][m[0] - 1];
      if (v != null && String(v) !== '') row[m[1] - 1] = v;
    });

    // F·G·H 는 내용을 보고 자리를 정한다
    CL_ROUTE_FROM.forEach(function (src) {
      var v = old[i][src - 1];
      if (v == null || String(v).trim() === '') return;
      var dst = clRoute_(v);
      // 그 자리가 이미 차 있으면 사건번호(없으면 관할)로 보낸다
      if (String(row[dst - 1] || '').trim()) {
        dst = String(row[CL_COL_CASENO - 1] || '').trim() ? CL_COL_COURT : CL_COL_CASENO;
      }
      row[dst - 1] = v;
      routed.push((CL_DONE_FIRST + i) + '행  ' + clL_(src) + '「'
        + String(v).replace(/\n/g, ' ').substring(0, 20) + '」 → ' + clRouteName_(dst));
    });

    // 성명에서 지위 떼어내기 (형사사건과 같은 규칙)
    var flat = String(row[2] == null ? '' : row[2]).replace(/\s+/g, ' ').trim();
    var mm = flat.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
    if (mm && clKnownRole_(mm[2].trim())) {
      row[2] = mm[1].trim();
      row[3] = clAliasRole_(mm[2].trim());
      roleCnt[row[3]] = (roleCnt[row[3]] || 0) + 1;
    } else {
      row[2] = flat;
      kept++;
    }

    // 단계 계산 — 사건번호(15) · 관할(16) · 재판부(17)
    var stage = clStage_(String(row[14] || ''), String(row[15] || ''), String(row[16] || ''));
    row[4] = stage;
    if (stage) stageCnt[stage] = (stageCnt[stage] || 0) + 1;

    // 값이 하나라도 사라지지 않았는지 대조
    var beforeSet = clBag_(old[i]);
    var afterSet = clBag_(row);
    beforeSet.forEach(function (v) {
      if (afterSet.indexOf(v) < 0 && v !== flat) lost.push((CL_DONE_FIRST + i) + '행 「' + v.substring(0, 30) + '」');
    });

    rows.push(row);
  }

  out.push('[' + CL_DONE + '] ' + rows.length + '건을 형사사건과 같은 배치로 옮깁니다');
  out.push('');
  out.push('■ 옮기는 자리');
  out.push('   사건명 D→F · 선임계 E→G · 기일 J→T · 결과 K→Y · 비고 L→Z');
  out.push('   머리글 없던 체크박스 P·Q → 공소장·증거기록 · 수임일 T → 체크할것');
  out.push('   (구속여부·성명은 제자리)');
  if (routed.length) {
    out.push('');
    out.push('■ 내용을 보고 자리를 정한 값 ' + routed.length + '건');
    out.push('   (예전 배치로 붙여넣어 한 칸씩 밀려 있던 행들입니다)');
    routed.forEach(function (s) { out.push('   ' + s); });
  }
  out.push('');
  out.push('■ 성명에서 떼어낸 지위');
  Object.keys(roleCnt).sort(function (a, b) { return roleCnt[b] - roleCnt[a]; })
    .forEach(function (k) { out.push('   ' + k + '  ' + roleCnt[k] + '건'); });
  if (kept) out.push('   지위 표기가 없어 이름만 둔 행  ' + kept + '건');
  out.push('');
  out.push('■ 계산된 단계');
  ['①경찰', '②검찰', '③재판'].forEach(function (s) {
    if (stageCnt[s]) out.push('   ' + s + '  ' + stageCnt[s] + '건');
  });
  var noStage = rows.length - (stageCnt['①경찰'] || 0) - (stageCnt['②검찰'] || 0) - (stageCnt['③재판'] || 0);
  if (noStage) out.push('   미정  ' + noStage + '건');

  out.push('');
  out.push(lost.length ? '!! 사라지는 값 ' + lost.length + '건 !!' : '값 대조 — 사라지는 값 없음');
  lost.slice(0, 15).forEach(function (s) { out.push('   ' + s); });

  if (dryRun) {
    out.push('');
    out.push('실제로 옮기려면 runAlignClosed 를 실행하세요.');
    return out.join('\n');
  }
  if (lost.length) {
    out.push('');
    out.push('사라지는 값이 있어 아무것도 바꾸지 않았습니다.');
    return out.join('\n');
  }

  /* ── 실제 변경 ── */

  if (done.getMaxColumns() < totalCols + 1) {
    done.insertColumnsAfter(done.getMaxColumns(), totalCols + 1 - done.getMaxColumns());
  }

  // 머리글 — 형사사건 것을 그대로 가져오고 뒤에 종결 전용 열을 붙인다
  var head = main.getRange(CL_MAIN_HEAD, 1, 1, CL_SHARED_COLS).getValues()[0];
  var headRow = head.slice();
  CL_DONE_EXTRA.forEach(function (h) { headRow.push(h); });
  done.getRange(CL_DONE_HEAD, 1, 1, totalCols).setValues([headRow]);

  // 본문 — 옛 값을 지우고 새 배치로 다시 쓴다
  done.getRange(CL_DONE_FIRST, 1, n, done.getMaxColumns()).clearContent();
  if (rows.length) {
    done.getRange(CL_DONE_FIRST, 1, rows.length, totalCols).setValues(rows);
    // 공소장·증거기록은 형사사건과 같이 체크박스로
    done.getRange(CL_DONE_FIRST, 18, rows.length, 2).insertCheckboxes()
      .setHorizontalAlignment('center').setVerticalAlignment('middle');
  }

  out.push('');
  out.push('머리글을 형사사건과 똑같이 맞추고 ' + rows.length + '건을 다시 배치했습니다.');
  clLog_(ss, '종결 탭을 형사사건과 같은 구조로 재편 (' + rows.length + '건)');
  return out.join('\n');
}

/* ══════════════════════════════════════════════════════════════
   ② 체크박스 깔기
   ══════════════════════════════════════════════════════════════ */

function previewCloseButtons() { clShow_(clButtons_(true)); }

function runCloseButtons() {
  var backup = clBackup_('체크박스깔기');
  clShow_('백업 먼저 만들었습니다:\n' + backup + '\n\n' + clButtons_(false));
}

function clButtons_(dryRun) {
  var ss = SpreadsheetApp.openById(CL_SHEET_ID);
  var main = ss.getSheetByName(CL_MAIN);
  var done = ss.getSheetByName(CL_DONE);
  if (!main || !done) return '형사사건 또는 종결 탭을 찾지 못했습니다.';

  var mainCol = CL_SHARED_COLS + 1;                          // X
  var doneCol = CL_SHARED_COLS + CL_DONE_EXTRA.length + 1;   // AA
  var mainLast = clLastRow_(main, CL_MAIN_FIRST);
  var doneLast = clLastRow_(done, CL_DONE_FIRST);

  var out = [];
  out.push(dryRun ? '=== 미리보기 (시트는 바뀌지 않았습니다) ===' : '=== 체크박스 설치 완료 ===');
  out.push('[' + CL_MAIN + '] ' + clL_(mainCol) + '열에 「' + CL_HEAD_CLOSE + '」 체크박스 — '
    + CL_MAIN_FIRST + '~' + mainLast + '행 (' + Math.max(0, mainLast - CL_MAIN_FIRST + 1) + '건)');
  out.push('[' + CL_DONE + '] ' + clL_(doneCol) + '열에 「' + CL_HEAD_RESTORE + '」 체크박스 — '
    + CL_DONE_FIRST + '~' + doneLast + '행 (' + Math.max(0, doneLast - CL_DONE_FIRST + 1) + '건)');

  if (dryRun) {
    out.push('');
    out.push('실제로 깔려면 runCloseButtons 를 실행하세요.');
    return out.join('\n');
  }

  clPutBoxes_(main, CL_MAIN_HEAD, CL_MAIN_FIRST, mainLast, mainCol, CL_HEAD_CLOSE);
  clPutBoxes_(done, CL_DONE_HEAD, CL_DONE_FIRST, doneLast, doneCol, CL_HEAD_RESTORE);

  out.push('');
  out.push('이제 setupCloseButtons 를 실행하면 체크할 때 실제로 옮겨집니다.');
  clLog_(ss, '종결·복원 체크박스 설치');
  return out.join('\n');
}

function clPutBoxes_(sh, headRow, first, last, col, title) {
  if (sh.getMaxColumns() < col) sh.insertColumnsAfter(sh.getMaxColumns(), col - sh.getMaxColumns());
  sh.getRange(headRow, col).setValue(title);
  if (last >= first) {
    var r = sh.getRange(first, col, last - first + 1, 1);
    r.insertCheckboxes();
    r.setHorizontalAlignment('center').setVerticalAlignment('middle');
  }
  sh.setColumnWidth(col, CL_BTN_WIDTH);
}

/* ══════════════════════════════════════════════════════════════
   ③ 체크하면 옮기기
   ══════════════════════════════════════════════════════════════ */

function setupCloseButtons() {
  var ss = SpreadsheetApp.openById(CL_SHEET_ID);
  removeCloseButtons();
  ScriptApp.newTrigger('onCloseEdit').forSpreadsheet(ss).onEdit().create();
  clShow_('켰습니다.\n\n형사사건 맨 오른쪽 [종결] 을 체크하면 종결 탭으로 넘어가고,\n'
    + '종결 탭 맨 오른쪽 [복원] 을 체크하면 형사사건으로 돌아옵니다.\n\n'
    + '스크립트가 지운 행은 Ctrl+Z 로 못 되돌립니다.\n'
    + '실수로 체크하셨다면 종결 탭 맨 아래에서 그 행을 찾아 [복원] 을 체크하세요.');
}

function removeCloseButtons() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onCloseEdit') ScriptApp.deleteTrigger(t);
  });
}

function onCloseEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  var name = sh.getName();

  var toClose = (name === CL_MAIN);
  var toRestore = (name === CL_DONE);
  if (!toClose && !toRestore) return;

  var watchCol = toClose ? CL_SHARED_COLS + 1 : CL_SHARED_COLS + CL_DONE_EXTRA.length + 1;
  if (e.range.getColumn() > watchCol || e.range.getLastColumn() < watchCol) return;

  var first = toClose ? CL_MAIN_FIRST : CL_DONE_FIRST;
  var top = Math.max(e.range.getRow(), first);
  var bottom = e.range.getRow() + e.range.getNumRows() - 1;
  if (bottom < first) return;

  var lock = LockService.getDocumentLock();
  try { lock.waitLock(20000); } catch (err) { return; }
  try {
    // 체크된 행을 모은 뒤, 아래에서부터 지운다 (위부터 지우면 행 번호가 밀린다)
    var checked = [];
    var vals = sh.getRange(top, watchCol, bottom - top + 1, 1).getValues();
    for (var i = 0; i < vals.length; i++) if (vals[i][0] === true) checked.push(top + i);
    if (!checked.length) return;

    var ss = SpreadsheetApp.openById(CL_SHEET_ID);
    for (var j = checked.length - 1; j >= 0; j--) {
      if (toClose) clMoveToDone_(ss, checked[j]);
      else clMoveToMain_(ss, checked[j]);
    }
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

// 형사사건 → 종결
function clMoveToDone_(ss, row) {
  var main = ss.getSheetByName(CL_MAIN);
  var done = ss.getSheetByName(CL_DONE);
  var data = main.getRange(row, 1, 1, CL_SHARED_COLS).getValues()[0];

  if (!String(data[2] == null ? '' : data[2]).trim()) {   // 성명이 비면 빈 행
    main.getRange(row, CL_SHARED_COLS + 1).setValue(false);
    return;
  }

  var at = clLastRow_(done, CL_DONE_FIRST) + 1;
  if (at < CL_DONE_FIRST) at = CL_DONE_FIRST;
  done.getRange(at, 1, 1, CL_SHARED_COLS).setValues([data]);
  done.getRange(at, CL_SHARED_COLS + 1)
    .setValue(new Date()).setNumberFormat('yyyy-mm-dd');           // 종결일

  var restoreCol = CL_SHARED_COLS + CL_DONE_EXTRA.length + 1;
  done.getRange(at, restoreCol).insertCheckboxes().setValue(false)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');

  main.deleteRow(row);
  clLog_(ss, '종결 처리 — ' + String(data[2]).replace(/\n/g, ' ').trim()
    + ' (' + String(data[14] || '사건번호 없음').replace(/\n/g, ' ').trim() + ')');
}

// 종결 → 형사사건 (복원)
function clMoveToMain_(ss, row) {
  var main = ss.getSheetByName(CL_MAIN);
  var done = ss.getSheetByName(CL_DONE);
  var width = CL_SHARED_COLS + CL_DONE_EXTRA.length;
  var full = done.getRange(row, 1, 1, width).getValues()[0];
  var data = full.slice(0, CL_SHARED_COLS);

  if (!String(data[2] == null ? '' : data[2]).trim()) {
    done.getRange(row, width + 1).setValue(false);
    return;
  }

  // 결과·비고는 형사사건에 자리가 없으므로 체크할것 아래에 이어 붙인다
  var extra = [];
  for (var k = 1; k < CL_DONE_EXTRA.length; k++) {          // 종결일은 뺀다
    var v = String(full[CL_SHARED_COLS + k] == null ? '' : full[CL_SHARED_COLS + k]).trim();
    if (v) extra.push(CL_DONE_EXTRA[k] + ': ' + v);
  }
  if (extra.length) {
    var prev = String(data[21] == null ? '' : data[21]).trim();   // V 체크할것
    data[21] = prev ? prev + '\n' + extra.join('\n') : extra.join('\n');
  }

  var at = clLastRow_(main, CL_MAIN_FIRST) + 1;
  if (at < CL_MAIN_FIRST) at = CL_MAIN_FIRST;
  main.getRange(at, 1, 1, CL_SHARED_COLS).setValues([data]);
  main.getRange(at, CL_SHARED_COLS + 1).insertCheckboxes().setValue(false)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');

  done.deleteRow(row);
  clLog_(ss, '종결 복원 — ' + String(data[2]).replace(/\n/g, ' ').trim()
    + ' (' + String(data[14] || '사건번호 없음').replace(/\n/g, ' ').trim() + ')');
}

/* ══════════════════════════════════════════════════════════════
   도구
   ══════════════════════════════════════════════════════════════ */

var CL_ROLES = ['피고인', '피의자', '고소인', '피해자', '피고소인', '피고발인',
  '고발인', '신청인', '참고인', '증인', '행위자', '보호소년'];

function clKnownRole_(v) {
  return CL_ROLES.indexOf(clAliasRole_(v)) >= 0;
}

// 값의 내용을 보고 갈 자리를 정한다
function clRoute_(v) {
  var s = String(v).replace(/\n/g, ' ').trim();
  if (/경찰/.test(s)) return CL_COL_POLICE;
  if (/(검찰청|지검|지청)/.test(s)) return CL_COL_PROS_OFFICE;
  if (/(법원|지원|고법)/.test(s)) return CL_COL_COURT;
  return CL_COL_CASENO;   // 임시번호(2025-3976)도 사건번호로 본다
}

function clRouteName_(col) {
  if (col === CL_COL_POLICE) return '관할경찰서';
  if (col === CL_COL_PROS_OFFICE) return '관할검찰청';
  if (col === CL_COL_COURT) return '관할';
  return '사건번호';
}
function clAliasRole_(v) {
  return (v === '피고인2') ? '피고인' : v;
}

// 형사사건과 같은 단계 판정 규칙
function clStage_(caseNo, court, bench) {
  caseNo = String(caseNo).replace(/\n/g, ' ');
  court = String(court).replace(/\n/g, ' ');
  bench = String(bench).replace(/\n/g, ' ');

  if (/\d{4}\s*(고합|고단|고정|고약|노|도|초재|재고단|전고단|동버|푸|서|모)\s*\d/.test(caseNo)
    || (court && /(법원|지원|고법)/.test(court) && !/(검찰청|지검|지청)/.test(court))
    || (bench && /(단독|형사부|합의부|재판부|제\s*\d)/.test(bench))) return '③재판';

  if (/\d{4}\s*(형제|불제)\s*\d/.test(caseNo) || (court && /(검찰청|지검|지청)/.test(court))) return '②검찰';
  return '';
}

// 값 대조용 — 비어있지 않은 값들만 문자열로 모은다
function clBag_(arr) {
  var bag = [];
  for (var i = 0; i < arr.length; i++) {
    var v = String(arr[i] == null ? '' : arr[i]).replace(/\s+/g, ' ').trim();
    if (v) bag.push(v);
  }
  return bag;
}

function clLastRow_(sh, first) {
  var last = sh.getLastRow();
  if (last < first) return first - 1;
  var v = sh.getRange(first, 3, last - first + 1, 1).getValues();   // C 성명 기준
  for (var i = v.length - 1; i >= 0; i--) {
    if (String(v[i][0] == null ? '' : v[i][0]).trim()) return first + i;
  }
  return first - 1;
}

function clL_(c) {
  var s = '';
  while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - m - 1) / 26; }
  return s;
}

function clBackup_(what) {
  var stamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  var name = '[백업] 사건정리 — ' + stamp + ' (' + what + ' 직전)';
  var folder;
  try {
    folder = (typeof backupFolder_ === 'function') ? backupFolder_() : DriveApp.createFolder('사건정리 백업');
  } catch (err) {
    folder = DriveApp.getRootFolder();
  }
  return DriveApp.getFileById(CL_SHEET_ID).makeCopy(name, folder).getUrl();
}

function clLog_(ss, msg) {
  try {
    if (typeof append_ === 'function') {
      var who = '(로그인 정보 없음)';
      try { who = Session.getActiveUser().getEmail() || who; } catch (e) { }
      append_(ss, who, '-', '-', '', msg, '종결이동');
    }
  } catch (err) { /* 수정로그 스크립트가 없으면 넘어감 */ }
}

function clShow_(text) {
  Logger.log(text);
  try {
    var t = text.length > 1200 ? text.substring(0, 1200) + '\n\n... 전체 내용은 아래 [실행 로그]에서 확인하세요' : text;
    SpreadsheetApp.getUi().alert(t);
  } catch (err) { /* 독립 프로젝트에서는 알림창이 없음 */ }
}
