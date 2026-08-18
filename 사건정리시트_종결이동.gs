/* 법무법인 정서 — 사건정리 시트: 종결 처리 / 복원
   ───────────────────────────────────────────────────────────────
   [무엇을 하나]
     형사사건 맨 오른쪽 [종결] 을 체크하면 그 행이 종결 탭으로 넘어갑니다.
     종결 탭 맨 오른쪽 [복원] 을 체크하면 형사사건으로 되돌아옵니다.

       형사사건   … 항소여부 │ 종결 ☑  ──▶  종결 탭 맨 아래로 (종결일 자동 기록)
       종결       … 원래자리 │ 복원 ☑  ──▶  형사사건의 있던 자리로

     복원은 맨 아래가 아니라 원래 있던 자리로 돌아갑니다. 종결로 보낼 때
     바로 윗줄 사람 이름을 '원래자리' 칸에 적어 두었다가, 복원할 때 그 사람을
     찾아 바로 아래에 끼워 넣습니다. 행 번호를 적어 두면 그 사이에 다른 행이
     드나들 때 자리가 밀리기 때문입니다. 그 사람마저 종결됐다면 맨 아래로 갑니다.

     구글시트는 셀 안에 누를 수 있는 버튼을 만들 수 없습니다.
     체크박스가 가장 가까운 방법이고, 클릭 한 번이라는 점은 같습니다.

   [정보가 사라지지 않게 합니다]
     종결 탭 머리글을 형사사건과 똑같이 맞춥니다. 그래야 행을 그대로 복사할 수
     있고, 지위·단계·수사기록·재판부 같은 15개 항목이 옮기다 없어지지 않습니다.

       형사사건   A~V (지금 22열)          + 종결 ☐
       종결       A~V (형사사건과 동일)    + 종결일 · 결과 · 비고 · 원래자리 · 복원 ☐

   [머리글 줄과 열 수를 알아서 맞춥니다]
     '성명'이 적힌 줄을 머리글로 보고, 형사사건 머리글 개수를 세어 씁니다.
     행을 올리거나 열을 옮기셔도 다시 깨지지 않습니다.

   [설치]
     Apps Script 에서 종결이동.gs 내용을 통째로 바꿔 붙여넣고 Ctrl+S

   [양식도 형사사건과 똑같이 맞춥니다]
     글꼴·글자크기·정렬·격자·열 너비·행 높이·틀 고정·단계 칸 색까지 옮겨 옵니다.
     형사사건 탭은 원본으로 읽기만 하고 쓰기 호출이 하나도 없습니다.
     종결 탭도 값은 한 글자도 바뀌지 않습니다 (서식·너비·높이만 바뀝니다).

     열 구성이 아직 다르면 열 너비가 엉뚱한 칸에 붙으므로,
     구조를 맞추기 전에는 양식 맞추기가 스스로 멈춰 섭니다.
     runAlignClosed 가 끝나면 양식 맞추기까지 저절로 이어집니다.

   [실행 순서]  반드시 이 순서로
     1) previewAlignClosed  → runAlignClosed    구조 재편 + 양식 맞추기
     2) verifyDoneFormat                        남은 차이가 없는지 확인
     3) previewCloseButtons → runCloseButtons   양쪽에 체크박스 깔기
     4) setupCloseButtons                       체크하면 옮겨지도록 켜기

     나중에 양식만 다시 맞추고 싶으면  previewDoneFormat → runDoneFormat

   [중요]
     스크립트가 지운 행은 Ctrl+Z 로 되돌릴 수 없습니다.
     그래서 종결 탭에 복원 체크박스를 두는 것입니다.
     실수로 체크하셨다면 종결 탭 맨 아래에서 그 행을 찾아 [복원] 을 체크하세요.

   [끄기]  removeCloseButtons
   ─────────────────────────────────────────────────────────────── */

var CL_SHEET_ID = '1YCf77KxxotM4RnxePAhO16C7xbwEiHq4SuF5DN5vWto';
var CL_MAIN = '형사사건';
var CL_DONE = '종결';

/* 종결 탭에만 있는 뒤쪽 열 (형사사건 열 다음에 붙습니다)
   원래자리 — 복원할 때 맨 아래가 아니라 있던 자리로 되돌리기 위한 표시입니다.
   행 번호는 다른 행이 드나들면 밀리므로, 바로 윗줄 사람 이름을 적어 둡니다. */
var CL_EXTRA = ['종결일', '결과', '비고', '원래자리'];
var CL_HEAD_WHERE = '원래자리';
var CL_TOP_MARK = '맨 위';
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

function runAlignClosed() { clRun_('종결탭재편', clAlign_); }

/* 백업 → 본 작업 → 결과 보고를 한 자리에서 한다.

   예전에는 clBackup_ 가 실패하면 (드라이브 용량, 권한 등) 함수가 그대로 죽어서
   실행 로그에 아무 말도 남지 않았다. 무엇 때문에 멈췄는지 보이게 한다.
   본 작업에서 난 오류도 삼키지 않고 그대로 적는다. */
function clRun_(what, work) {
  var head;
  try {
    head = '백업 먼저 만들었습니다:\n' + clBackup_(what);
  } catch (err) {
    clShow_('백업을 만들지 못해 아무것도 바꾸지 않았습니다.\n\n'
      + '이유: ' + (err && err.message ? err.message : err) + '\n\n'
      + '드라이브 용량이 찼거나 권한이 없을 때 이렇게 됩니다.\n'
      + '오래된 [백업] 사건정리 … 파일을 지우고 다시 실행해 주세요.');
    return;
  }
  var body;
  try {
    body = work(false);
  } catch (err) {
    clShow_(head + '\n\n작업 중 오류가 나서 멈췄습니다.\n\n'
      + '이유: ' + (err && err.message ? err.message : err) + '\n'
      + (err && err.stack ? '\n' + err.stack : ''));
    return;
  }
  clShow_(head + '\n\n' + body);
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

  var rows = [], roleCnt = {}, stageCnt = {}, lost = [], routed = [], kept = 0, already = 0;

  for (var i = 0; i < n; i++) {
    if (!clBag_(old[i]).length) continue;
    var row = [];
    for (var c = 0; c < total; c++) row.push('');

    /* 체크박스로 이미 넘어온 행은 벌써 형사사건 배치다.
       종결일 칸에 날짜가 찍혀 있는 것이 그 표시다.
       이런 행을 옛 배치로 다시 풀어 헤치면 이름이 사라진다. 그대로 둔다. */
    if (srcCols > shared && old[i][shared] instanceof Date) {
      for (var k = 0; k < total && k < srcCols; k++) row[k] = old[i][k];
      already++;
      rows.push(row);
      continue;
    }

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
  if (already) {
    out.push('   그 중 ' + already + '건은 체크박스로 이미 넘어온 행이라 그대로 둡니다');
  }

  // 같은 사람이 두 번 들어와 있지 않은지 (체크를 두 번 누르면 이렇게 됩니다)
  var dup = clDupes_(rows, mainHead);
  if (dup.length) {
    out.push('');
    out.push('■ 같은 사건이 두 줄 이상 있습니다 — 손으로 지워 주셔야 합니다');
    dup.forEach(function (s) { out.push('   ' + s); });
  }

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

  // 구조를 맞췄으면 양식도 이어서 맞춘다 (둘이 따로 놀지 않게)
  out.push('');
  out.push(clFormat_(false));
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
    // 옛 자리에 남은 종결·복원 체크박스 열은 옮길 값이 아니다
    if (h === CL_HEAD_CLOSE || h === CL_HEAD_RESTORE) { plan.push(null); continue; }
    if (CL_ROUTE_HEADS.indexOf(h) >= 0) { plan.push({ mode: 'route' }); continue; }

    var ex = CL_EXTRA.indexOf(h);
    if (ex >= 0) { plan.push({ mode: 'fixed', dst: shared + 1 + ex }); continue; }

    var dst = clFind_(mainHead, h);
    plan.push(dst ? { mode: 'fixed', dst: dst } : null);          // 못 찾으면 버림 (No 등)
  }
  return plan;
}

/* 같은 사람·같은 사건번호가 두 줄 이상인지 찾는다 */
function clDupes_(rows, mainHead) {
  var nameCol = clFind_(mainHead, '성명') || clFind_(mainHead, '이름');
  var caseCol = clFind_(mainHead, '사건번호');
  if (!nameCol) return [];
  var seen = {}, dup = [];
  rows.forEach(function (r, i) {
    var nm = clNorm_(r[nameCol - 1]);
    if (!nm) return;
    var key = nm + '|' + (caseCol ? clNorm_(r[caseCol - 1]) : '');
    if (seen[key] === undefined) { seen[key] = i + 1; return; }
    dup.push(nm + (caseCol && clNorm_(r[caseCol - 1]) ? ' (' + clNorm_(r[caseCol - 1]) + ')' : '')
      + ' — ' + seen[key] + '번째 · ' + (i + 1) + '번째 줄');
  });
  return dup;
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
   ①-2 종결 탭 양식을 형사사건과 똑같이

   형사사건 탭은 원본으로 읽기만 합니다. 쓰기 호출이 하나도 없습니다.
   종결 탭도 값은 한 글자도 바뀌지 않습니다 (서식·너비·높이만).
   ══════════════════════════════════════════════════════════════ */

// 체크박스가 들어갈 머리글 (형사사건과 공유하는 열)
var CL_BOXES = ['선임계', '공소장', '증거기록', '항소여부'];

// 단계 칸 색 — 지위단계.gs 와 같은 규칙을 종결에도 건다
var CL_STAGES = [
  { label: '①경찰', bg: '#eceff1', fg: '#37474f' },
  { label: '②검찰', bg: '#e1f0fa', fg: '#0b4f6c' },
  { label: '③재판', bg: '#fce8e6', fg: '#b3261e' }
];

// 손으로 칠한 칸으로 보지 않을 배경색 (기본 바탕과 머리글 회색)
var CL_PLAIN_BG = ['#ffffff', '#f2f2f2', ''];

function previewDoneFormat() { clShow_(clFormat_(true)); }

function runDoneFormat() { clRun_('종결탭양식', clFormat_); }

function clFormat_(dryRun) {
  var ss = SpreadsheetApp.openById(CL_SHEET_ID);
  var main = ss.getSheetByName(CL_MAIN);
  var done = ss.getSheetByName(CL_DONE);
  if (!main || !done) return '형사사건 또는 종결 탭을 찾지 못했습니다.';

  var mHead = clHeadRow_(main), dHead = clHeadRow_(done);
  if (!mHead || !dHead) return '머리글 줄을 찾지 못했습니다.';

  var shared = clSharedCols_(main, mHead);
  if (!shared) return '형사사건 머리글이 비어 있습니다.';
  var total = shared + CL_EXTRA.length;      // … 종결일 · 결과 · 비고 · 원래자리
  var restore = total + 1;                   // 복원 체크박스 자리
  var mainHead = main.getRange(mHead, 1, 1, shared).getValues()[0];

  /* 안전 자물쇠 — 열 구성이 다른 채로 너비를 옮기면 엉뚱한 칸에 붙는다.
     (형사 E 사건명 너비가 종결 E 사건명이 아니라 단계 칸에 붙는 식) */
  if (!clAligned_(main, mHead, done, dHead, shared)) {
    var dRow = done.getRange(dHead, 1, 1, Math.max(done.getLastColumn(), shared)).getValues()[0];
    var where = '';
    for (var c = 0; c < shared; c++) {
      if (clNorm_(dRow[c]) !== clNorm_(mainHead[c])) {
        where = '   ' + clL_(c + 1) + '열   형사사건 「' + clNorm_(mainHead[c]) + '」'
          + '  ↔  종결 「' + clNorm_(dRow[c]) + '」\n';
        break;
      }
    }
    return '종결 탭 열 구성이 아직 형사사건과 다릅니다.\n' + where + '\n'
      + '이 상태에서 양식만 맞추면 열 너비가 엉뚱한 칸에 붙습니다.\n'
      + '먼저 previewAlignClosed → runAlignClosed 를 실행해 주세요.\n'
      + '(runAlignClosed 가 끝나면 양식 맞추기까지 저절로 이어집니다.)';
  }

  var dLast = clLastRow_(done, dHead);
  var n = Math.max(0, dLast - dHead);
  var maxRow = done.getMaxRows(), maxCol = done.getMaxColumns();

  var headH = main.getRowHeight(mHead);
  var bodyH = main.getRowHeight(mHead + 1);

  var out = [];
  out.push(dryRun ? '=== 미리보기 (시트는 바뀌지 않았습니다) ===' : '=== 종결 탭 양식 맞추기 완료 ===');
  out.push('[' + CL_DONE + '] 머리글 ' + dHead + '행 · 본문 ' + n + '건 · ' + restore + '열');
  out.push('');
  out.push('■ 형사사건에서 그대로 가져오는 것');
  out.push('   글꼴·글자크기·정렬·격자   머리글 ' + mHead + '행 / 본문 ' + (mHead + 1) + '행 서식 복사');
  out.push('   열 너비   1~' + shared + '열은 형사사건 그대로, 뒤쪽 4열은 짝이 되는 열에서');
  out.push('   행 높이   머리글 ' + headH + ' · 본문 ' + bodyH);
  out.push('   틀 고정   ' + main.getFrozenRows() + '행');
  out.push('   단계 칸 색   ①경찰 · ②검찰 · ③재판 조건부 서식');

  var diff = clDiff_(main, mHead, done, dHead, shared, n, headH, bodyH);
  out.push('');
  out.push('■ 지금 다른 점');
  if (!diff.length) out.push('   없음 — 이미 형사사건과 같습니다');
  diff.forEach(function (s) { out.push('   ' + s); });

  var merges = done.getRange(1, 1, maxRow, maxCol).getMergedRanges().length;
  if (merges) out.push('   옛 병합 ' + merges + '개 → 풉니다');

  // 미리보기 중에는 시트를 넓히지 않으므로 있는 열까지만 훑는다
  var marks = clMarks_(done, dHead, n, Math.min(restore, maxCol));
  if (marks.length) {
    out.push('');
    out.push('■ 손으로 칠하신 칸 ' + marks.length + '개 — 지우지 않고 그대로 되돌려 놓습니다');
    marks.slice(0, 12).forEach(function (m) { out.push('   ' + m.a1 + '   ' + m.bg); });
    if (marks.length > 12) out.push('   ... 외 ' + (marks.length - 12) + '개');
    out.push('   ※ 재편으로 값이 옮겨 간 자리라면 표시 뜻이 어긋날 수 있습니다. 확인해 주세요.');
  }

  if (dryRun) {
    out.push('');
    out.push('실제로 맞추려면 runDoneFormat 을 실행하세요.');
    return out.join('\n');
  }

  /* ── 실제 변경 ── */

  var before = clSum_(done, restore);

  // ⓪ 복원 칸까지 자리가 있어야 아래 서식 복사가 범위를 벗어나지 않는다
  if (done.getMaxColumns() < restore) {
    done.insertColumnsAfter(done.getMaxColumns(), restore - done.getMaxColumns());
    maxCol = done.getMaxColumns();
  }

  // ① 옛 병합 — 새 배치와 어긋나므로 푼다
  if (merges) done.getRange(1, 1, maxRow, maxCol).breakApart();

  /* 종결 전용 뒤쪽 열은 성격이 맞는 형사사건 열에서 서식을 가져온다.
     항소여부(체크박스) 칸은 Arial 이라, 글로 적는 종결일·결과·비고에는
     같은 글로 적는 칸인 체크할것 을 본으로 삼아야 글꼴이 어긋나지 않는다. */
  var cText = clFind_(mainHead, '체크할것') || shared;     // 글로 적는 칸
  var cBox = clFind_(mainHead, '항소여부') || shared;      // 체크박스 칸
  var extras = [];                                         // 종결일 … 원래자리 + 복원
  for (var t = 0; t < CL_EXTRA.length; t++) extras.push(cText);
  extras.push(cBox);

  // ② 머리글 서식
  main.getRange(mHead, 1, 1, shared).copyTo(
    done.getRange(dHead, 1, 1, shared), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  for (var x = 0; x < extras.length; x++) {
    main.getRange(mHead, extras[x]).copyTo(
      done.getRange(dHead, shared + 1 + x), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  }

  // ③ 본문 서식 — 형사사건 첫 데이터 행 하나를 본문 전체에 되풀이해 붙인다
  if (n) {
    main.getRange(mHead + 1, 1, 1, shared).copyTo(
      done.getRange(dHead + 1, 1, n, shared), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    for (var y = 0; y < extras.length; y++) {
      main.getRange(mHead + 1, extras[y]).copyTo(
        done.getRange(dHead + 1, shared + 1 + y, n, 1),
        SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    }
  }

  /* ③-2 종결일은 날짜로 보이게 되돌린다.
     바로 위에서 체크할것 칸의 서식을 복사해 오는데, 거기에는 표시 형식도
     딸려 온다. 그러면 날짜가 46250.47 같은 숫자로 보인다. */
  var dateCol = shared + 1 + CL_EXTRA.indexOf('종결일');
  if (n && CL_EXTRA.indexOf('종결일') >= 0) {
    done.getRange(dHead + 1, dateCol, n, 1).setNumberFormat('yyyy-mm-dd');
  }

  // ④ 열 너비 — 공유 열은 형사사건 그대로, 종결 전용 열은 짝이 되는 열에서
  for (var w = 1; w <= shared; w++) done.setColumnWidth(w, main.getColumnWidth(w));
  var wDate = clFind_(mainHead, '기일');
  var extraW = [];
  CL_EXTRA.forEach(function (h) {
    if (h === '종결일') extraW.push(wDate ? main.getColumnWidth(wDate) : 120);
    else if (h === CL_HEAD_WHERE) extraW.push(90);          // 원래자리 — 표시용이라 좁게
    else extraW.push(main.getColumnWidth(cText));           // 결과 · 비고
  });
  extraW.push(CL_BTN_WIDTH);                                // 복원
  for (var e = 0; e < extraW.length; e++) done.setColumnWidth(shared + 1 + e, extraW[e]);

  // ⑤ 행 높이
  done.setRowHeight(dHead, headH);
  if (maxRow > dHead) done.setRowHeights(dHead + 1, maxRow - dHead, bodyH);

  // ⑥ 틀 고정
  done.setFrozenRows(main.getFrozenRows());

  // ⑦ 데이터 확인 — 옛 자리에 남은 체크박스를 걷어내고 머리글 이름대로 다시 깐다
  if (n) {
    done.getRange(dHead + 1, 1, n, done.getMaxColumns()).clearDataValidations();
    CL_BOXES.forEach(function (h) {
      var col = clFind_(mainHead, h);
      if (col) done.getRange(dHead + 1, col, n, 1).insertCheckboxes();
    });
    if (done.getMaxColumns() >= restore
      && clNorm_(done.getRange(dHead, restore).getValue()) === CL_HEAD_RESTORE) {
      done.getRange(dHead + 1, restore, n, 1).insertCheckboxes();
    }
    ['지위', '단계'].forEach(function (h) {
      var col = clFind_(mainHead, h);
      if (!col) return;
      var dv = main.getRange(mHead + 1, col).getDataValidation();
      if (dv) done.getRange(dHead + 1, col, n, 1).setDataValidation(dv);
    });
  }

  // ⑧ 단계 칸 색 — 채우기가 아니라 조건부 서식이라 서식 복사에 딸려오지 않는다
  var stageCol = clFind_(mainHead, '단계');
  if (stageCol && n) {
    done.getRange(dHead + 1, stageCol, n, 1).setBackground(null);
    clStageColors_(done, stageCol, dHead + 1, n);
  }

  // ⑨ 손으로 칠하신 칸 되돌려 놓기
  marks.forEach(function (m) { done.getRange(m.a1).setBackground(m.bg); });

  // ⑩ 값 대조
  var after = clSum_(done, restore);
  out.push('');
  out.push(before === after
    ? '값 대조 — 한 글자도 바뀌지 않았습니다'
    : '!! 값이 바뀌었습니다 — 백업으로 되돌려 주세요 !!');

  out.push('양식을 형사사건과 똑같이 맞췄습니다.');
  clLog_(ss, '종결 탭 양식을 형사사건과 동일하게 맞춤 (' + n + '건)');
  return out.join('\n');
}

/* 두 탭의 양식을 재어 다른 점만 추린다 */
function clDiff_(main, mHead, done, dHead, shared, n, headH, bodyH) {
  var d = [];
  var probe = Math.min(n, 20);

  function uniq(arr) {
    var seen = [];
    arr.forEach(function (v) { if (seen.indexOf(v) < 0) seen.push(v); });
    return seen;
  }

  var mBody = probe ? main.getRange(mHead + 1, 1, 1, shared) : null;
  var dBody = probe ? done.getRange(dHead + 1, 1, probe, shared) : null;

  if (mBody && dBody) {
    var mSize = uniq(mBody.getFontSizes()[0]);
    var dSize = uniq([].concat.apply([], dBody.getFontSizes()));
    if (dSize.join(',') !== mSize.join(',')) {
      d.push('글자 크기   형사사건 ' + mSize.join('·') + 'pt  ↔  종결 ' + dSize.join('·') + 'pt');
    }
    var mFam = uniq(mBody.getFontFamilies()[0]);
    var dFam = uniq([].concat.apply([], dBody.getFontFamilies()));
    if (dFam.join(',') !== mFam.join(',')) {
      d.push('글꼴   형사사건 ' + mFam.join('·') + '  ↔  종결 ' + dFam.join('·'));
    }
    var mV = uniq(mBody.getVerticalAlignments()[0]);
    var dV = uniq([].concat.apply([], dBody.getVerticalAlignments()));
    if (dV.join(',') !== mV.join(',')) {
      d.push('세로 정렬   형사사건 ' + mV.join('·') + '  ↔  종결 ' + dV.join('·'));
    }
    var mH = uniq(mBody.getHorizontalAlignments()[0]);
    var dH = uniq([].concat.apply([], dBody.getHorizontalAlignments()));
    if (dH.join(',') !== mH.join(',')) {
      d.push('가로 정렬   형사사건 ' + mH.join('·') + '  ↔  종결 ' + dH.join('·'));
    }
  }

  var heights = [];
  for (var r = dHead + 1; r <= dHead + probe; r++) {
    var h = done.getRowHeight(r);
    if (heights.indexOf(h) < 0) heights.push(h);
  }
  if (heights.length && (heights.length > 1 || heights[0] !== bodyH)) {
    d.push('행 높이   형사사건 ' + bodyH + ' 로 일정  ↔  종결 ' + heights.join('·'));
  }
  if (done.getRowHeight(dHead) !== headH) {
    d.push('머리글 행 높이   형사사건 ' + headH + '  ↔  종결 ' + done.getRowHeight(dHead));
  }

  var wrong = [];
  for (var w = 1; w <= shared; w++) {
    if (done.getColumnWidth(w) !== main.getColumnWidth(w)) wrong.push(clL_(w));
  }
  if (wrong.length) {
    d.push('열 너비   ' + wrong.length + '개 열이 다름 (' + wrong.slice(0, 10).join(' ')
      + (wrong.length > 10 ? ' …' : '') + ')');
  }
  if (done.getFrozenRows() !== main.getFrozenRows()) {
    d.push('틀 고정   형사사건 ' + main.getFrozenRows() + '행  ↔  종결 ' + done.getFrozenRows() + '행');
  }
  return d;
}

/* 손으로 칠하신 칸을 찾아 둔다 (기본 바탕·머리글 회색은 뺀다) */
function clMarks_(sh, head, n, cols) {
  var found = [];
  if (!n) return found;
  var rg = sh.getRange(head + 1, 1, n, cols);
  var bg = rg.getBackgrounds();
  for (var r = 0; r < bg.length; r++) {
    for (var c = 0; c < bg[r].length; c++) {
      var v = String(bg[r][c] || '').toLowerCase();
      if (CL_PLAIN_BG.indexOf(v) >= 0) continue;
      found.push({ a1: clL_(c + 1) + (head + 1 + r), bg: bg[r][c] });
    }
  }
  return found;
}

/* 단계 칸 색 — 이 열을 겨냥한 기존 규칙만 걷어내고 새로 건다 */
function clStageColors_(sh, col, first, n) {
  var range = sh.getRange(first, col, n, 1);
  var keep = sh.getConditionalFormatRules().filter(function (rule) {
    var rs = rule.getRanges();
    for (var i = 0; i < rs.length; i++) {
      if (rs[i].getColumn() === col && rs[i].getNumColumns() === 1) return false;
    }
    return true;
  });
  CL_STAGES.forEach(function (s) {
    keep.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(s.label)
      .setBackground(s.bg).setFontColor(s.fg).setBold(true)
      .setRanges([range]).build());
  });
  sh.setConditionalFormatRules(keep);
}

/* 값이 그대로인지 대조하는 지문 */
function clSum_(sh, cols) {
  var last = sh.getLastRow();
  if (last < 1) return '';
  var v = sh.getRange(1, 1, last, Math.min(cols, sh.getMaxColumns())).getValues();
  var flat = v.map(function (row) {
    return row.map(function (x) { return x == null ? '' : String(x); }).join('');
  }).join('');
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, flat)
    .map(function (b) { return (b < 0 ? b + 256 : b).toString(16); }).join('');
}

/* 양식이 정말 같아졌는지 다시 재어 본다 */
function verifyDoneFormat() {
  var ss = SpreadsheetApp.openById(CL_SHEET_ID);
  var main = ss.getSheetByName(CL_MAIN), done = ss.getSheetByName(CL_DONE);
  if (!main || !done) return clShow_('형사사건 또는 종결 탭을 찾지 못했습니다.');

  var mHead = clHeadRow_(main), dHead = clHeadRow_(done);
  var shared = clSharedCols_(main, mHead);
  var n = Math.max(0, clLastRow_(done, dHead) - dHead);
  var diff = clDiff_(main, mHead, done, dHead, shared, n,
    main.getRowHeight(mHead), main.getRowHeight(mHead + 1));

  var out = ['=== 종결 ↔ 형사사건 양식 대조 ==='];
  out.push('공유 열 ' + shared + '개 · 종결 본문 ' + n + '건');
  out.push('');
  if (!diff.length) out.push('남은 차이 없음 — 두 탭 양식이 같습니다.');
  else diff.forEach(function (s) { out.push('   ' + s); });
  clShow_(out.join('\n'));
}

/* ══════════════════════════════════════════════════════════════
   ② 체크박스 깔기
   ══════════════════════════════════════════════════════════════ */

function previewCloseButtons() { clShow_(clButtons_(true)); }

function runCloseButtons() { clRun_('체크박스깔기', clButtons_); }

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

/* 어디까지 갔는지 찍는다. Apps Script 「실행」 목록에서 그 줄을 펼치면 보인다.

   왜 필요한가: onCloseEdit 은 조건에 안 맞으면 아무 말 없이 되돌아간다.
   그래서 '돌긴 돌았는데 아무 일도 안 났다' 가 되면 어디서 멈췄는지 알 길이 없다.
   계정 이름도 함께 찍는다 — 트리거가 여러 계정에 걸려 있을 수 있기 때문이다. */
function clTrace_(msg) {
  var who = '(로그인 정보 없음)';
  try { who = Session.getActiveUser().getEmail() || who; } catch (e) { }
  try { console.log('[종결] ' + who + '  ' + msg); } catch (e) { Logger.log(msg); }
}

function onCloseEdit(e) {
  if (!e || !e.range) { clTrace_('멈춤 — 편집 정보가 없음'); return; }
  var sh = e.range.getSheet();
  var name = sh.getName();
  var toClose = (name === CL_MAIN), toRestore = (name === CL_DONE);

  clTrace_('시작 — 탭「' + name + '」 ' + e.range.getA1Notation()
    + '  값 ' + JSON.stringify(e.value) + ' (이전 ' + JSON.stringify(e.oldValue) + ')');

  if (!toClose && !toRestore) { clTrace_('멈춤 — 형사사건도 종결도 아닌 탭'); return; }

  var ss = SpreadsheetApp.openById(CL_SHEET_ID);
  var main = ss.getSheetByName(CL_MAIN), done = ss.getSheetByName(CL_DONE);
  if (!main || !done) { clTrace_('멈춤 — 탭을 못 찾음'); return; }
  var mHead = clHeadRow_(main), dHead = clHeadRow_(done);
  if (!mHead || !dHead) { clTrace_('멈춤 — 머리글 줄을 못 찾음'); return; }
  var shared = clSharedCols_(main, mHead);

  var head = toClose ? mHead : dHead;
  var watchCol = toClose ? shared + 1 : shared + CL_EXTRA.length + 1;
  if (e.range.getColumn() > watchCol || e.range.getLastColumn() < watchCol) {
    clTrace_('멈춤 — 고친 칸이 체크 열이 아님 (고친 열 ' + e.range.getColumn()
      + '~' + e.range.getLastColumn() + ' · 체크 열 ' + watchCol + ')');
    return;
  }

  /* 종결 탭이 아직 형사사건과 같은 구조가 아니면 옮기지 않는다.
     구조가 다른 채로 옮기면 이름이 'No' 칸에, 사건명이 '선임계' 칸에 들어가
     종결 탭이 엉망이 된다. 체크만 해제하고 무엇을 해야 하는지 남긴다. */
  if (!clAligned_(main, mHead, done, dHead, shared)) {
    clTrace_('멈춤 — 종결 탭 구조가 다름');
    e.range.setValue(false);
    clLog_(ss, '종결 이동 안 함 — 종결 탭 구조가 형사사건과 다릅니다. runAlignClosed 를 먼저 실행하세요.');
    try {
      SpreadsheetApp.openById(CL_SHEET_ID).toast(
        '종결 탭 구조가 형사사건과 아직 다릅니다.\nrunAlignClosed 를 먼저 실행해 주세요.',
        '옮기지 않았습니다', 12);
    } catch (err) { }
    return;
  }

  var top = Math.max(e.range.getRow(), head + 1);
  var bottom = e.range.getRow() + e.range.getNumRows() - 1;
  if (bottom <= head) { clTrace_('멈춤 — 머리글 줄 위쪽'); return; }

  var lock = LockService.getDocumentLock();
  try { lock.waitLock(20000); } catch (err) {
    clTrace_('멈춤 — 20초 기다려도 문서 잠금을 못 얻음');
    return;
  }
  try {
    var checked = [];
    var vals = sh.getRange(top, watchCol, bottom - top + 1, 1).getValues();
    for (var i = 0; i < vals.length; i++) if (vals[i][0] === true) checked.push(top + i);
    if (!checked.length) {
      clTrace_('멈춤 — ' + top + '~' + bottom + '행에 체크된 것이 없음 (읽은 값 '
        + JSON.stringify(vals.map(function (v) { return v[0]; }).slice(0, 5)) + ')');
      return;
    }
    clTrace_('체크된 줄 ' + checked.join(', ') + '행');

    // 아래 행부터 지운다 (위부터 지우면 행 번호가 밀린다)
    for (var j = checked.length - 1; j >= 0; j--) {
      if (!clClaim_(name, checked[j])) {
        clTrace_('건너뜀 — ' + checked[j] + '행은 다른 실행이 이미 가져갔음 (90초 잠금)');
        continue;
      }
      clTrace_('옮기는 중 — ' + checked[j] + '행');
      if (toClose) clToDone_(ss, main, done, mHead, dHead, shared, checked[j]);
      else clToMain_(ss, main, done, mHead, dHead, shared, checked[j]);
      clTrace_('옮김 끝 — ' + checked[j] + '행');
    }
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

/* 같은 체크를 한 번만 처리하도록 표를 끊는다.

   수정로그를 보면 체크 한 번에 트리거가 두 번 돌고 있다 (한쪽은 계정 이름이,
   다른 쪽은 '(로그인 정보 없음)' 이 찍힌다). 계정이 다른 트리거가 두 개
   걸려 있으면 removeCloseButtons 로도 남의 것은 지울 수 없다.
   그래서 스크립트 쪽에서 막는다 — 먼저 표를 끊은 실행만 옮긴다.

   CacheService 는 스크립트 전체가 함께 쓰므로 계정이 달라도 통한다. */
function clClaim_(sheetName, row) {
  try {
    var cache = CacheService.getScriptCache();
    var key = 'cl:' + sheetName + ':' + row;
    if (cache.get(key)) return false;               // 이미 다른 실행이 가져갔다
    cache.put(key, '1', 90);                        // 90초 동안 잠근다
    return true;
  } catch (err) {
    return true;                                    // 캐시를 못 써도 일은 계속한다
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

  /* 있던 자리를 적어 둔다 — 복원할 때 맨 아래가 아니라 여기로 돌아온다.
     행 번호는 다른 행이 드나들면 밀리므로 바로 윗줄 사람 이름을 쓴다. */
  var where = CL_TOP_MARK;
  if (row > mHead + 1) {
    var above = String(main.getRange(row - 1, nameCol).getValue() || '').replace(/\s+/g, ' ').trim();
    if (above) where = above;
  }

  var at = clLastRow_(done, dHead) + 1;
  if (at <= dHead) at = dHead + 1;
  clEnsureSize_(done, at, shared + CL_EXTRA.length + 1);
  clCopyFormat_(done, dHead, at, shared + CL_EXTRA.length + 1);
  done.getRange(at, 1, 1, shared).setValues([data]);
  done.getRange(at, shared + 1).setValue(new Date()).setNumberFormat('yyyy-mm-dd');
  var whereCol = shared + 1 + CL_EXTRA.indexOf(CL_HEAD_WHERE);
  done.getRange(at, whereCol).setValue(where);
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
  // (원래자리는 자리를 찾는 데만 쓰는 표시라 옮기지 않는다)
  var todoCol = clFind_(mainHead, '체크할것');
  if (todoCol) {
    var extra = [];
    for (var k = 1; k < CL_EXTRA.length; k++) {              // 종결일은 뺀다
      if (CL_EXTRA[k] === CL_HEAD_WHERE) continue;
      var v = String(full[shared + k] == null ? '' : full[shared + k]).trim();
      if (v) extra.push(CL_EXTRA[k] + ': ' + v);
    }
    if (extra.length) {
      var prev = String(data[todoCol - 1] == null ? '' : data[todoCol - 1]).trim();
      data[todoCol - 1] = prev ? prev + '\n' + extra.join('\n') : extra.join('\n');
    }
  }

  /* 있던 자리로 되돌린다. 적어 둔 윗줄 사람을 찾아 그 바로 아래에 끼워 넣는다.
     그 사람이 안 보이면(이름이 바뀌었거나 그 사람도 종결됐다면) 맨 아래로 간다. */
  var where = String(full[shared + CL_EXTRA.indexOf(CL_HEAD_WHERE)] || '').trim();
  var bottom = clLastRow_(main, mHead) + 1;
  if (bottom <= mHead) bottom = mHead + 1;

  var at = bottom, back = false;
  if (where === CL_TOP_MARK) {
    at = mHead + 1; back = true;
  } else if (where) {
    var found = clRowByName_(main, mHead, nameCol, where);
    if (found) { at = found + 1; back = true; }
  }
  if (back && at < bottom) main.insertRowBefore(at);
  else { at = bottom; back = false; }

  clEnsureSize_(main, at, shared + 1);
  clCopyFormat_(main, mHead, at, shared + 1);
  main.getRange(at, 1, 1, shared).setValues([data]);
  main.getRange(at, shared + 1).insertCheckboxes().setValue(false);

  done.deleteRow(row);
  clLog_(ss, '종결 복원 — ' + String(data[nameCol - 1]).replace(/\n/g, ' ').trim()
    + (back ? ' (' + at + '행, 있던 자리)' : ' (맨 아래 — 있던 자리를 못 찾았습니다)'));
}

/* 성명 열에서 이름으로 행을 찾는다 (줄바꿈·공백 무시, 같은 이름이면 첫 줄) */
function clRowByName_(sh, head, nameCol, name) {
  var last = sh.getLastRow();
  if (last <= head) return 0;
  var key = clNorm_(name);
  if (!key) return 0;
  var v = sh.getRange(head + 1, nameCol, last - head, 1).getValues();
  for (var i = 0; i < v.length; i++) {
    if (clNorm_(v[i][0]) === key) return head + 1 + i;
  }
  return 0;
}

/* ══════════════════════════════════════════════════════════════
   도구
   ══════════════════════════════════════════════════════════════ */

/* 쓰려는 칸이 시트 격자 밖이면 넓힌다.

   구글 시트는 격자 크기가 정해져 있어서, 마지막 행 아래에 빈 행이 없으면
   그 자리에 쓸 수 없다. 「목표 범위 좌표가 시트 크기를 벗어납니다」 가 그 뜻이다.

   종결 탭이 38행까지 꽉 찬 채로 39행에 쓰려다 이 오류가 났고, 그동안
   종결 체크가 아무 말 없이 안 넘어갔다. 빈 행을 정리해 지우고 나면 이 일이
   난다 — 예전에는 빈 행이 남아 있어 우연히 되던 것이다. */
function clEnsureSize_(sh, row, col) {
  var r = sh.getMaxRows(), c = sh.getMaxColumns();
  if (row > r) sh.insertRowsAfter(r, row - r);
  if (col > c) sh.insertColumnsAfter(c, col - c);
}

/* 새로 옮겨 온 행이 위 행들과 똑같아 보이도록 서식과 데이터 확인을 함께 복사한다.

   서식(PASTE_FORMAT)만 복사하면 체크박스가 따라오지 않는다. 체크박스는 서식이
   아니라 데이터 확인이기 때문이다. 그러면 선임계·공소장·증거기록 칸이 네모가
   아니라 글자 FALSE / TRUE 로 보인다. 지위·단계 드롭다운도 마찬가지다.
   그래서 PASTE_DATA_VALIDATION 을 한 번 더 붙인다.

   값은 건드리지 않는다. */
function clCopyFormat_(sh, head, at, cols) {
  var src = head + 1;                 // 첫 데이터 행을 본으로 삼는다
  if (src >= at || src > sh.getLastRow()) src = at - 1;
  if (src <= head || src >= at) return;
  cols = Math.min(cols, sh.getMaxColumns());
  var from = sh.getRange(src, 1, 1, cols), to = sh.getRange(at, 1, 1, cols);
  try {
    from.copyTo(to, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  } catch (err) { /* 서식 복사는 실패해도 값 이동은 계속한다 */ }
  try {
    from.copyTo(to, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
  } catch (err) { /* 체크박스 복사도 마찬가지 */ }
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

/* 종결 탭이 형사사건과 같은 열 구성인지.
   여기서 아니라고 하면 행을 옮기지도, 양식을 맞추지도 않는다. */
function clAligned_(main, mHead, done, dHead, shared) {
  var mainHead = main.getRange(mHead, 1, 1, shared).getValues()[0];
  var width = Math.max(done.getLastColumn(), shared);
  if (done.getMaxColumns() < shared) return false;
  var dRow = done.getRange(dHead, 1, 1, Math.min(width, done.getMaxColumns())).getValues()[0];
  for (var c = 0; c < shared; c++) {
    if (clNorm_(dRow[c]) !== clNorm_(mainHead[c])) return false;
  }
  return true;
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

/* 머리글 목록에서 이름으로 열 번호를 찾는다.
   딱 맞는 이름을 먼저 찾고, 없을 때만 앞부분 일치로 넘어간다.
   앞부분 일치만 쓰면 '관할' 을 찾을 때 '관할경찰서' 가 먼저 걸려
   법원 이름이 경찰서 칸으로 들어간다. */
function clFind_(headRow, key) {
  var c, h;
  for (c = 0; c < headRow.length; c++) {
    if (clNorm_(headRow[c]) === key) return c + 1;                 // 정확히 같은 이름
  }
  for (c = 0; c < headRow.length; c++) {
    h = clNorm_(headRow[c]);
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
/* 값 대조용 자루. 체크 안 된 체크박스(false)는 담긴 정보가 없으므로 뺀다.
   빈 칸과 똑같이 봐야 '값이 사라졌다' 는 헛경보가 뜨지 않는다. */
function clBag_(arr) {
  var bag = [];
  for (var i = 0; i < arr.length; i++) {
    if (arr[i] === false) continue;
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
  // 시트에 붙은 프로젝트면 스크롤되는 창으로 보여준다 (alert 는 1200자에서 잘린다)
  if (typeof uiShow_ === 'function') { uiShow_(text); return; }
  try {
    var t = text.length > 1200 ? text.substring(0, 1200) + '\n\n... 전체 내용은 아래 [실행 로그]에서 확인하세요' : text;
    SpreadsheetApp.getUi().alert(t);
  } catch (err) { /* 독립 프로젝트에서는 알림창이 없음 */ }
}
