/* 법무법인 정서 — 사건정리 시트: 종결 처리 / 복원
   ───────────────────────────────────────────────────────────────
   [무엇을 하나]
     형사사건 맨 오른쪽 [종결] 을 체크하면 그 행이 종결 탭으로 넘어갑니다.
     종결 탭 맨 오른쪽 [복원] 을 체크하면 형사사건으로 되돌아옵니다.

       형사사건   … 항소여부 │ 종결 ☑  ──▶  종결 탭 맨 아래로 (종결일 자동 기록)
       종결       … 비고     │ 복원 ☑  ──▶  형사사건 맨 아래로

     구글시트는 셀 안에 누를 수 있는 버튼을 만들 수 없습니다.
     체크박스가 가장 가까운 방법이고, 클릭 한 번이라는 점은 같습니다.

   [정보가 사라지지 않게 합니다]
     종결 탭 머리글을 형사사건과 똑같이 맞춥니다. 그래야 행을 그대로 복사할 수
     있고, 지위·단계·수사기록·재판부 같은 15개 항목이 옮기다 없어지지 않습니다.

       형사사건   A~V (지금 22열)          + 종결 ☐
       종결       A~V (형사사건과 동일)    + 종결일 · 결과 · 비고 · 복원 ☐

   [머리글 줄과 열 수를 알아서 맞춥니다]
     '성명'이 적힌 줄을 머리글로 보고, 형사사건 머리글 개수를 세어 씁니다.
     행을 올리거나 열을 옮기셔도 다시 깨지지 않습니다.

   [설치]
     Apps Script 에서 종결이동.gs 내용을 통째로 바꿔 붙여넣고 Ctrl+S

   [실행 순서]  반드시 이 순서로
     1) previewAlignClosed  → runAlignClosed    종결 탭을 형사사건 구조에 맞춤
     2) previewCloseButtons → runCloseButtons   양쪽에 체크박스 깔기
     3) setupCloseButtons                       체크하면 옮겨지도록 켜기

   [중요]
     스크립트가 지운 행은 Ctrl+Z 로 되돌릴 수 없습니다.
     그래서 종결 탭에 복원 체크박스를 두는 것입니다.
     실수로 체크하셨다면 종결 탭 맨 아래에서 그 행을 찾아 [복원] 을 체크하세요.

   [끄기]  removeCloseButtons
   ─────────────────────────────────────────────────────────────── */

var CL_SHEET_ID = '1YCf77KxxotM4RnxePAhO16C7xbwEiHq4SuF5DN5vWto';
var CL_MAIN = '형사사건';
var CL_DONE = '종결';

// 종결 탭에만 있는 뒤쪽 열 (형사사건 열 다음에 붙습니다)
var CL_EXTRA = ['종결일', '결과', '비고'];
var CL_HEAD_CLOSE = '종결';
var CL_HEAD_RESTORE = '복원';
var CL_BTN_WIDTH = 60;

/* 값의 내용을 보고 자리를 정할 머리글.
   예전 배치로 붙여넣은 행들이 한 칸씩 밀려 있어, 열 위치대로 옮기면
   법원이 사건번호 칸에 들어갑니다. 그래서 이 열들은 값을 보고 보냅니다. */
var CL_ROUTE_HEADS = ['사건번호', '관할'];

var CL_ROLES = ['피고인', '피의자', '고소인', '피해자', '피고소인', '피고발인',
  '고발인', '신청인', '참고인', '증인', '행위자', '보호소년'];

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

  var mHead = clHeadRow_(main), dHead = clHeadRow_(done);
  if (!mHead || !dHead) return '머리글 줄을 찾지 못했습니다 (성명 열이 있는지 확인해 주세요).';

  var shared = clSharedCols_(main, mHead);
  if (!shared) return '형사사건 머리글이 비어 있습니다.';
  var total = shared + CL_EXTRA.length;

  var mainHead = main.getRange(mHead, 1, 1, shared).getValues()[0];
  var out = [];
  out.push(dryRun ? '=== 미리보기 (시트는 바뀌지 않았습니다) ===' : '=== 종결 탭 재편 완료 ===');
  out.push('형사사건 머리글 ' + mHead + '행 · ' + shared + '열  →  종결에 그대로 옮겨 씁니다');

  // 이미 맞춰졌는지 — 종결 머리글이 형사사건과 같으면 끝난 것
  var dHeadRow = done.getRange(dHead, 1, 1, Math.max(done.getLastColumn(), shared)).getValues()[0];
  if (clNorm_(dHeadRow[0]) === clNorm_(mainHead[0]) && clNorm_(dHeadRow[2]) === clNorm_(mainHead[2])) {
    out.push('');
    out.push('이미 형사사건과 같은 구조입니다. 할 일이 없습니다.');
    return out.join('\n');
  }

  var last = done.getLastRow();
  if (last <= dHead) { out.push('종결 탭에 데이터가 없습니다.'); return out.join('\n'); }
  var n = last - dHead;
  var srcCols = Math.max(done.getLastColumn(), 1);
  var old = done.getRange(dHead + 1, 1, n, srcCols).getValues();

  // 어느 열을 어디로 보낼지 정한다
  var plan = clPlan_(dHeadRow, mainHead, shared, srcCols);

  var rows = [], roleCnt = {}, stageCnt = {}, lost = [], routed = [], kept = 0;

  for (var i = 0; i < n; i++) {
    if (!clBag_(old[i]).length) continue;
    var row = [];
    for (var c = 0; c < total; c++) row.push('');

    for (var s = 0; s < srcCols; s++) {
      var v = old[i][s];
      if (v == null || String(v).trim() === '') continue;
      var how = plan[s];
      if (!how) continue;                                   // 갈 곳 없는 열 (No 등)

      var dst = (how.mode === 'route') ? clRoute_(v, shared, mainHead) : how.dst;
      if (!dst) continue;
      if (String(row[dst - 1]).trim()) {                    // 이미 차 있으면 다른 자리로
        var alt = clFind_(mainHead, '사건번호');
        dst = (dst === alt) ? clFind_(mainHead, '관할') : alt;
        if (!dst || String(row[dst - 1]).trim()) continue;
      }
      row[dst - 1] = v;
      if (how.mode === 'route') {
        routed.push((dHead + 1 + i) + '행  ' + clL_(s + 1) + '「'
          + String(v).replace(/\n/g, ' ').substring(0, 18) + '」 → ' + clNorm_(mainHead[dst - 1]));
      }
    }

    // 성명에서 지위 떼어내고 단계 계산
    var nameCol = clFind_(mainHead, '성명') || clFind_(mainHead, '이름');
    var roleCol = clFind_(mainHead, '지위');
    var stageCol = clFind_(mainHead, '단계');
    var flat = String(row[nameCol - 1] || '').replace(/\s+/g, ' ').trim();
    var mm = flat.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
    if (mm && CL_ROLES.indexOf(clAlias_(mm[2].trim())) >= 0) {
      row[nameCol - 1] = mm[1].trim();
      if (roleCol) {
        row[roleCol - 1] = clAlias_(mm[2].trim());
        roleCnt[row[roleCol - 1]] = (roleCnt[row[roleCol - 1]] || 0) + 1;
      }
    } else {
      row[nameCol - 1] = flat;
      kept++;
    }
    if (stageCol) {
      var st = clStage_(row[clFind_(mainHead, '사건번호') - 1],
        row[clFind_(mainHead, '관할') - 1], row[clFind_(mainHead, '재판부') - 1]);
      row[stageCol - 1] = st;
      if (st) stageCnt[st] = (stageCnt[st] || 0) + 1;
    }

    // 값이 하나라도 사라지지 않았는지 대조
    var after = clBag_(row);
    clBag_(old[i]).forEach(function (v) {
      if (after.indexOf(v) < 0 && v !== flat) lost.push((dHead + 1 + i) + '행 「' + v.substring(0, 30) + '」');
    });
    rows.push(row);
  }

  out.push('');
  out.push('[' + CL_DONE + '] ' + rows.length + '건을 새 배치로 옮깁니다');
  if (routed.length) {
    out.push('');
    out.push('■ 내용을 보고 자리를 정한 값 ' + routed.length + '건 (밀려 있던 행들)');
    routed.slice(0, 15).forEach(function (s) { out.push('   ' + s); });
    if (routed.length > 15) out.push('   ... 외 ' + (routed.length - 15) + '건');
  }
  out.push('');
  out.push('■ 성명에서 떼어낸 지위');
  Object.keys(roleCnt).sort(function (a, b) { return roleCnt[b] - roleCnt[a]; })
    .forEach(function (k) { out.push('   ' + k + '  ' + roleCnt[k] + '건'); });
  if (kept) out.push('   지위 표기가 없어 이름만 둔 행  ' + kept + '건');
  if (Object.keys(stageCnt).length) {
    out.push('');
    out.push('■ 계산된 단계');
    Object.keys(stageCnt).sort().forEach(function (k) { out.push('   ' + k + '  ' + stageCnt[k] + '건'); });
  }
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

  if (done.getMaxColumns() < total + 1) {
    done.insertColumnsAfter(done.getMaxColumns(), total + 1 - done.getMaxColumns());
  }
  // 옛 병합이 남아 있으면 새 배치와 어긋나므로 푼다
  done.getRange(1, 1, done.getMaxRows(), done.getMaxColumns()).breakApart();

  var headRow = mainHead.slice();
  CL_EXTRA.forEach(function (h) { headRow.push(h); });
  done.getRange(dHead, 1, 1, total).setValues([headRow]);

  done.getRange(dHead + 1, 1, n, done.getMaxColumns()).clearContent();
  if (rows.length) {
    done.getRange(dHead + 1, 1, rows.length, total).setValues(rows);
    var qc = clFind_(mainHead, '공소장'), rc = clFind_(mainHead, '증거기록');
    if (qc) done.getRange(dHead + 1, qc, rows.length, 1).insertCheckboxes();
    if (rc) done.getRange(dHead + 1, rc, rows.length, 1).insertCheckboxes();
  }

  out.push('');
  out.push('머리글을 형사사건과 똑같이 맞추고 ' + rows.length + '건을 다시 배치했습니다.');
  clLog_(ss, '종결 탭을 형사사건과 같은 구조로 재편 (' + rows.length + '건)');
  return out.join('\n');
}

/* 종결의 각 열을 어디로 보낼지 정한다.
   · 머리글이 있고 형사사건에 같은 이름이 있으면 → 그 자리
   · 머리글이 사건번호·관할이면 → 값을 보고 정함 (밀린 행 때문)
   · 결과·비고 → 종결 전용 자리
   · 머리글이 없으면 → 값의 생김새로 정함 */
function clPlan_(dHeadRow, mainHead, shared, srcCols) {
  var plan = [];
  for (var c = 0; c < srcCols; c++) {
    var h = clNorm_(dHeadRow[c]);
    if (!h) { plan.push({ mode: 'route' }); continue; }          // 머리글 없는 열
    if (CL_ROUTE_HEADS.indexOf(h) >= 0) { plan.push({ mode: 'route' }); continue; }

    var ex = CL_EXTRA.indexOf(h);
    if (ex >= 0) { plan.push({ mode: 'fixed', dst: shared + 1 + ex }); continue; }

    var dst = clFind_(mainHead, h);
    plan.push(dst ? { mode: 'fixed', dst: dst } : null);          // 못 찾으면 버림 (No 등)
  }
  return plan;
}

/* 값의 생김새로 갈 자리를 정한다 */
function clRoute_(v, shared, mainHead) {
  var s = String(v).replace(/\n/g, ' ').trim();
  if (typeof v === 'boolean') return 0;                          // 체크박스는 따로 처리
  if (/경찰/.test(s)) return clFind_(mainHead, '관할경찰서');
  if (/(검찰청|지검|지청)/.test(s)) return clFind_(mainHead, '관할검찰청');
  if (/(법원|지원|고법)/.test(s)) return clFind_(mainHead, '관할');
  if (/\d{4}\s*[가-힣]{1,3}\s*\d/.test(s) || /^\d{4}-\d+$/.test(s)) return clFind_(mainHead, '사건번호');
  return clFind_(mainHead, '체크할것');                           // 메모성 값
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

  var mHead = clHeadRow_(main), dHead = clHeadRow_(done);
  if (!mHead || !dHead) return '머리글 줄을 찾지 못했습니다.';
  var shared = clSharedCols_(main, mHead);

  var mainCol = shared + 1;
  var doneCol = shared + CL_EXTRA.length + 1;
  var mLast = clLastRow_(main, mHead);
  var dLast = clLastRow_(done, dHead);

  var out = [];
  out.push(dryRun ? '=== 미리보기 (시트는 바뀌지 않았습니다) ===' : '=== 체크박스 설치 완료 ===');
  out.push('[' + CL_MAIN + '] ' + clL_(mainCol) + '열에 「' + CL_HEAD_CLOSE + '」 — '
    + (mHead + 1) + '~' + mLast + '행 (' + Math.max(0, mLast - mHead) + '건)');
  out.push('[' + CL_DONE + '] ' + clL_(doneCol) + '열에 「' + CL_HEAD_RESTORE + '」 — '
    + (dHead + 1) + '~' + dLast + '행 (' + Math.max(0, dLast - dHead) + '건)');

  if (dryRun) {
    out.push('');
    out.push('실제로 깔려면 runCloseButtons 를 실행하세요.');
    return out.join('\n');
  }

  clPutBoxes_(main, mHead, mLast, mainCol, CL_HEAD_CLOSE);
  clPutBoxes_(done, dHead, dLast, doneCol, CL_HEAD_RESTORE);

  out.push('');
  out.push('이제 setupCloseButtons 를 실행하면 체크할 때 실제로 옮겨집니다.');
  clLog_(ss, '종결·복원 체크박스 설치');
  return out.join('\n');
}

function clPutBoxes_(sh, head, last, col, title) {
  if (sh.getMaxColumns() < col) sh.insertColumnsAfter(sh.getMaxColumns(), col - sh.getMaxColumns());
  sh.getRange(head, col).setValue(title);
  if (last > head) {
    var r = sh.getRange(head + 1, col, last - head, 1);
    r.insertCheckboxes();
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
  clShow_('켰습니다.\n\n형사사건 맨 오른쪽 [' + CL_HEAD_CLOSE + '] 을 체크하면 종결 탭으로 넘어가고,\n'
    + '종결 탭 맨 오른쪽 [' + CL_HEAD_RESTORE + '] 을 체크하면 형사사건으로 돌아옵니다.\n\n'
    + '스크립트가 지운 행은 Ctrl+Z 로 못 되돌립니다.\n'
    + '실수로 체크하셨다면 종결 탭 맨 아래에서 그 행을 찾아 [' + CL_HEAD_RESTORE + '] 을 체크하세요.');
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
  var toClose = (name === CL_MAIN), toRestore = (name === CL_DONE);
  if (!toClose && !toRestore) return;

  var ss = SpreadsheetApp.openById(CL_SHEET_ID);
  var main = ss.getSheetByName(CL_MAIN), done = ss.getSheetByName(CL_DONE);
  if (!main || !done) return;
  var mHead = clHeadRow_(main), dHead = clHeadRow_(done);
  if (!mHead || !dHead) return;
  var shared = clSharedCols_(main, mHead);

  var head = toClose ? mHead : dHead;
  var watchCol = toClose ? shared + 1 : shared + CL_EXTRA.length + 1;
  if (e.range.getColumn() > watchCol || e.range.getLastColumn() < watchCol) return;

  var top = Math.max(e.range.getRow(), head + 1);
  var bottom = e.range.getRow() + e.range.getNumRows() - 1;
  if (bottom <= head) return;

  var lock = LockService.getDocumentLock();
  try { lock.waitLock(20000); } catch (err) { return; }
  try {
    var checked = [];
    var vals = sh.getRange(top, watchCol, bottom - top + 1, 1).getValues();
    for (var i = 0; i < vals.length; i++) if (vals[i][0] === true) checked.push(top + i);
    if (!checked.length) return;

    // 아래 행부터 지운다 (위부터 지우면 행 번호가 밀린다)
    for (var j = checked.length - 1; j >= 0; j--) {
      if (toClose) clToDone_(ss, main, done, mHead, dHead, shared, checked[j]);
      else clToMain_(ss, main, done, mHead, dHead, shared, checked[j]);
    }
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

// 형사사건 → 종결
function clToDone_(ss, main, done, mHead, dHead, shared, row) {
  var data = main.getRange(row, 1, 1, shared).getValues()[0];
  var mainHead = main.getRange(mHead, 1, 1, shared).getValues()[0];
  var nameCol = clFind_(mainHead, '성명') || clFind_(mainHead, '이름');

  if (!String(data[nameCol - 1] == null ? '' : data[nameCol - 1]).trim()) {
    main.getRange(row, shared + 1).setValue(false);      // 빈 행이면 체크만 해제
    return;
  }

  var at = clLastRow_(done, dHead) + 1;
  if (at <= dHead) at = dHead + 1;
  clCopyFormat_(done, dHead, at, shared + CL_EXTRA.length + 1);
  done.getRange(at, 1, 1, shared).setValues([data]);
  done.getRange(at, shared + 1).setValue(new Date()).setNumberFormat('yyyy-mm-dd');
  done.getRange(at, shared + CL_EXTRA.length + 1).insertCheckboxes().setValue(false);

  main.deleteRow(row);
  clLog_(ss, '종결 처리 — ' + String(data[nameCol - 1]).replace(/\n/g, ' ').trim());
}

// 종결 → 형사사건 (복원)
function clToMain_(ss, main, done, mHead, dHead, shared, row) {
  var width = shared + CL_EXTRA.length;
  var full = done.getRange(row, 1, 1, width).getValues()[0];
  var data = full.slice(0, shared);
  var mainHead = main.getRange(mHead, 1, 1, shared).getValues()[0];
  var nameCol = clFind_(mainHead, '성명') || clFind_(mainHead, '이름');

  if (!String(data[nameCol - 1] == null ? '' : data[nameCol - 1]).trim()) {
    done.getRange(row, width + 1).setValue(false);
    return;
  }

  // 결과·비고는 형사사건에 자리가 없으므로 체크할것 아래에 이어 붙인다
  var todoCol = clFind_(mainHead, '체크할것');
  if (todoCol) {
    var extra = [];
    for (var k = 1; k < CL_EXTRA.length; k++) {              // 종결일은 뺀다
      var v = String(full[shared + k] == null ? '' : full[shared + k]).trim();
      if (v) extra.push(CL_EXTRA[k] + ': ' + v);
    }
    if (extra.length) {
      var prev = String(data[todoCol - 1] == null ? '' : data[todoCol - 1]).trim();
      data[todoCol - 1] = prev ? prev + '\n' + extra.join('\n') : extra.join('\n');
    }
  }

  var at = clLastRow_(main, mHead) + 1;
  if (at <= mHead) at = mHead + 1;
  clCopyFormat_(main, mHead, at, shared + 1);
  main.getRange(at, 1, 1, shared).setValues([data]);
  main.getRange(at, shared + 1).insertCheckboxes().setValue(false);

  done.deleteRow(row);
  clLog_(ss, '종결 복원 — ' + String(data[nameCol - 1]).replace(/\n/g, ' ').trim());
}

/* ══════════════════════════════════════════════════════════════
   도구
   ══════════════════════════════════════════════════════════════ */

/* 새로 추가되는 행이 위 행들과 같은 모양이 되도록 서식만 복사한다.
   setValues 는 값만 쓰기 때문에, 그냥 두면 새 행 혼자 민짜로 보인다.
   값은 건드리지 않는다 (PASTE_FORMAT). */
function clCopyFormat_(sh, head, at, cols) {
  var src = head + 1;                 // 첫 데이터 행을 본으로 삼는다
  if (src >= at || src > sh.getLastRow()) src = at - 1;
  if (src <= head || src >= at) return;
  try {
    sh.getRange(src, 1, 1, cols).copyTo(
      sh.getRange(at, 1, 1, cols), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  } catch (err) { /* 서식 복사는 실패해도 값 이동은 계속한다 */ }
}

// 머리글 줄을 찾는다 ('성명' 또는 '이름'이 적힌 줄)
function clHeadRow_(sh) {
  var probe = Math.min(5, sh.getLastRow());
  var lastCol = Math.max(sh.getLastColumn(), 1);
  if (probe < 1) return 0;
  var vals = sh.getRange(1, 1, probe, lastCol).getValues();
  for (var r = 0; r < probe; r++) {
    for (var c = 0; c < lastCol; c++) {
      var h = clNorm_(vals[r][c]);
      if (h.indexOf('성명') === 0 || h.indexOf('이름') === 0) return r + 1;
    }
  }
  return 0;
}

// 형사사건에서 머리글이 붙어 있는 마지막 열 = 두 탭이 공유할 열 수
function clSharedCols_(main, head) {
  var lastCol = Math.max(main.getLastColumn(), 1);
  var row = main.getRange(head, 1, 1, lastCol).getValues()[0];
  var n = 0;
  for (var c = 0; c < row.length; c++) {
    var h = clNorm_(row[c]);
    if (!h) continue;
    if (h === CL_HEAD_CLOSE || h === CL_HEAD_RESTORE) break;   // 체크박스 열은 뺀다
    n = c + 1;
  }
  return n;
}

// 머리글 목록에서 이름으로 열 번호를 찾는다 (공백 제거 후 앞부분 일치)
function clFind_(headRow, key) {
  for (var c = 0; c < headRow.length; c++) {
    var h = clNorm_(headRow[c]);
    if (h && (h.indexOf(key) === 0 || key.indexOf(h) === 0)) return c + 1;
  }
  return 0;
}

function clNorm_(v) {
  return String(v == null ? '' : v).replace(/\s/g, '');
}

function clAlias_(v) { return (v === '피고인2') ? '피고인' : v; }

// 형사사건과 같은 단계 판정 규칙
function clStage_(caseNo, court, bench) {
  caseNo = String(caseNo == null ? '' : caseNo).replace(/\n/g, ' ');
  court = String(court == null ? '' : court).replace(/\n/g, ' ');
  bench = String(bench == null ? '' : bench).replace(/\n/g, ' ');

  if (/\d{4}\s*(고합|고단|고정|고약|노|도|초재|재고단|전고단|동버|푸|서|모)\s*\d/.test(caseNo)
    || (court && /(법원|지원|고법)/.test(court) && !/(검찰청|지검|지청)/.test(court))
    || (bench && /(단독|형사부|합의부|재판부|제\s*\d)/.test(bench))) return '③재판';

  if (/\d{4}\s*(형제|불제)\s*\d/.test(caseNo) || (court && /(검찰청|지검|지청)/.test(court))) return '②검찰';
  return '';
}

// 값 대조용 — 비어있지 않은 값만 문자열로 모은다
function clBag_(arr) {
  var bag = [];
  for (var i = 0; i < arr.length; i++) {
    var v = String(arr[i] == null ? '' : arr[i]).replace(/\s+/g, ' ').trim();
    if (v) bag.push(v);
  }
  return bag;
}

// 성명이 채워진 마지막 줄
function clLastRow_(sh, head) {
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var headRow = sh.getRange(head, 1, 1, lastCol).getValues()[0];
  var nameCol = clFind_(headRow, '성명') || clFind_(headRow, '이름');
  if (!nameCol) return head;
  var last = sh.getLastRow();
  if (last <= head) return head;
  var v = sh.getRange(head + 1, nameCol, last - head, 1).getValues();
  for (var i = v.length - 1; i >= 0; i--) {
    if (String(v[i][0] == null ? '' : v[i][0]).trim()) return head + 1 + i;
  }
  return head;
}

function clL_(c) {
  if (!c) return '-';
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
