/* 법무법인 정서 — 사건정리 시트 서식 정비
   ───────────────────────────────────────────────────────────────
   [무엇을 하나]  보기를 정돈합니다. 셀 값은 건드리지 않습니다.

     · 머리글을 진한 남색 바탕 + 흰 글씨로, 아래에 밑줄
     · 세로 칸막이를 없애고 가로 구분선만 연하게 (격자 느낌 제거)
     · 긴 글(사건명·재판부·체크할것)은 왼쪽 정렬, 짧은 값은 가운데
     · 글꼴 맑은 고딕 10pt 로 통일, 행 높이 정리
     · 머리글 고정 + 왼쪽 3열 고정 + 필터
     · 8/14 기준으로 굳어 있던 배경색을 지우고,
       기일 기준으로 매일 저절로 갱신되는 조건부 서식으로 교체
     · 네이버웍스 방이 있는 사건은 행 전체를 칠하는 대신 왼쪽 끝 파란 막대로

   [값은 바뀌지 않습니다]
     서식 기능만 씁니다. 유일한 예외는 제목 B1 한 칸(사용자 승인).
     그것도 믿지 마시라고, 적용 직전·직후에 모든 탭 전 셀의 값으로
     체크섬을 계산해 대조합니다. 결과가 실행 로그 마지막 줄에 나옵니다.

   [설치]
     Apps Script 왼쪽 [파일] 옆 + → [스크립트] → 이름을 서식 으로 하고
     이 파일 전체를 붙여넣기 → 저장(Ctrl+S)

   [실행 순서]
     1) previewFormat   무엇을 어떻게 바꿀지 미리 봅니다. 시트는 안 건드립니다.
     2) runFormat       실제로 적용합니다. 적용 전 백업을 자동으로 뜹니다.
     · verifyValues     나중에 언제든 값이 그대로인지 다시 대조합니다.

   [권장 순서]  관할정리 → 체크박스 → 서식
     서식은 머리글 이름으로 열을 찾으므로 순서가 뒤바뀌어도 깨지지 않습니다.
     다만 열이 늘어난 뒤 runFormat 을 한 번 더 돌리면 새 열까지 맞춰집니다.
   ─────────────────────────────────────────────────────────────── */

var FM_SHEET_ID = '1YCf77KxxotM4RnxePAhO16C7xbwEiHq4SuF5DN5vWto';

/* ── 색 — 무채색(검정·흰색·회색)만 씁니다 ──
   기일 임박은 색상 대신 회색 농도와 글자 굵기로 구분합니다. */
var C_HEAD_BG = '#000000';   // 머리글 검정
var C_HEAD_FG = '#ffffff';
var C_TITLE = '#000000';
var C_RULE = '#d9d9d9';      // 가로 구분선
var C_BAR = '#000000';       // 왼쪽 막대
var C_BODY_BG = '#ffffff';
var C_SUB_BG = '#f2f2f2';    // 안내문 항목명 바탕

var C_D7_BG = '#e0e0e0', C_D7_FG = '#000000';    // 기일 7일 이내 — 진한 회색 + 굵게
var C_D14_BG = '#f2f2f2', C_D14_FG = '#000000';  // 기일 14일 이내 — 연회색
var C_PAST_FG = '#9e9e9e';                        // 지난 기일 — 회색 글씨

/* 단계 칸에만 쓰는 색. 표 전체는 무채색이고 여기 한 군데만 색이 있어야
   눈이 바로 갑니다. 지위단계 스크립트의 STAGES 와 같은 값을 씁니다. */
var FM_STAGES = [
  { label: '①경찰', bg: '#eceff1', fg: '#37474f' },
  { label: '②검찰', bg: '#e1f0fa', fg: '#0b4f6c' },
  { label: '③재판', bg: '#fce8e6', fg: '#b3261e' }
];

var FONT = '맑은 고딕';
var SIZE = 10;

// 왼쪽에 고정할 열 수 (번호·구속여부·성명). 0 으로 두면 열 고정을 하지 않습니다.
var FREEZE_COLS = 3;

// 제목. 병합을 풀면 옆 칸으로 넘쳐 흐르는데, 열 고정선을 넘지는 못합니다.
// 그래서 고정 범위(A~C) 안에 들어가도록 짧게 씁니다.
var TITLE_TEXT = '형사사건 관리표';

var BLUE_MARK = '#e8f0fe';   // 지금 칠해져 있는 파란 줄 색

// 왼쪽 정렬할 머리글 (공백 제거 후 부분일치)
var LEFT_HEADS = ['성명', '이름', '사건명', '선임계', '관할경찰서', '담당수사관', '검사',
  '재판부', '체크할것', '체크', '항소여부', '상고여부', '1심관할법원',
  '결과', '비고', '법원'];

// 열 너비 (머리글 부분일치 → 픽셀)
var WIDTHS = [
  ['성명', 100], ['이름', 100], ['지위', 90], ['단계', 80], ['사건명', 230], ['선임계', 120],
  ['관할경찰서', 110], ['경찰사건번호', 100], ['담당수사관', 120], ['결정', 80],
  ['이의여부', 80], ['형제번호', 110], ['관할검찰청', 120], ['검사', 110],
  ['사건번호', 130], ['관할', 140], ['재판부', 160],
  ['공소장', 70], ['증거기록', 70], ['기일', 120], ['법정', 100],
  ['피해자연락처', 120], ['체크할것', 220], ['항소여부', 130], ['구속여부', 100],
  ['법원', 140], ['약식명령일', 110], ['정식재판청구기한', 130],
  ['결과', 220], ['비고', 200],
  ['종결일', 100], ['종결', 60], ['복원', 60]
];

// 탭별 구조: 머리글 줄 / 데이터 시작 줄 / 성명(이름) 열
// 종결은 머리글을 넣은 뒤 기준(1행). 아직 안 넣었으면 머리글 처리만 건너뛴다.
var FM_TABS = [
  { name: '형사사건', headRow: 3, firstRow: 4, nameCol: 3, titleCell: 'B1', tabColor: '#1f3864' },
  { name: '항소사건', headRow: 2, firstRow: 3, nameCol: 3, tabColor: '#0b8043' },
  { name: '약식명령', headRow: 2, firstRow: 3, nameCol: 2, tabColor: '#8e24aa' },
  { name: '종결', headRow: 1, firstRow: 2, nameCol: 3, tabColor: '#999999' }
];

/* ── 실행 ── */

function previewFormat() {
  var r = fmProcess_(true);
  Logger.log(r);
  fmAlert_(r);
}

function runFormat() {
  var backup = fmBackup_();
  var before = valueChecksum_();
  PropertiesService.getScriptProperties().setProperty('FM_CHECKSUM', before);

  var body = fmProcess_(false);

  var after = valueChecksum_();
  var verdict = (before === after)
    ? '값 체크섬 일치 — 데이터 변경 없음 (' + after.substring(0, 12) + ')'
    : '!! 값 체크섬 불일치 — 백업으로 되돌리세요 !!\n   전 ' + before + '\n   후 ' + after;

  var full = '백업 먼저 만들었습니다:\n' + backup + '\n\n' + body + '\n\n' + verdict;
  Logger.log(full);
  fmAlert_(full);
}

// 나중에 다시 대조하고 싶을 때
function verifyValues() {
  var saved = PropertiesService.getScriptProperties().getProperty('FM_CHECKSUM');
  var now = valueChecksum_();
  var msg = !saved
    ? '저장된 체크섬이 없습니다. runFormat 을 실행하면 저장됩니다.\n지금 값 체크섬: ' + now
    : (saved === now
      ? '값이 그대로입니다 — 변경 없음 (' + now.substring(0, 12) + ')'
      : '값이 달라졌습니다.\n   저장 ' + saved + '\n   현재 ' + now
        + '\n(서식 적용 이후 사건을 입력·수정하셨다면 정상입니다.)');
  Logger.log(msg);
  fmAlert_(msg);
}

/* ── 본체 ── */

function fmProcess_(dryRun) {
  var ss = SpreadsheetApp.openById(FM_SHEET_ID);
  var out = [];
  out.push(dryRun ? '=== 미리보기 (시트는 바뀌지 않았습니다) ===' : '=== 서식 적용 완료 ===');

  FM_TABS.forEach(function (t) {
    var sh = ss.getSheetByName(t.name);
    if (!sh) { out.push('[' + t.name + '] 탭 없음 — 건너뜀'); return; }

    var lastRow = lastRow_(sh, t);
    var lastCol = Math.max(sh.getLastColumn(), 4);
    if (lastRow < t.firstRow) { out.push('[' + t.name + '] 데이터 없음'); return; }
    var n = lastRow - t.firstRow + 1;

    // 머리글 줄이 실제로 채워져 있는지 본다.
    // 종결 탭은 머리글을 아직 안 넣었을 수 있어, 빈 줄을 남색으로 칠하지 않도록 한다.
    var headRow = t.headRow;
    if (headRow && !hasHeader_(sh, headRow, lastCol)) headRow = 0;
    t = { name: t.name, headRow: headRow, firstRow: t.firstRow, nameCol: t.nameCol,
          titleCell: t.titleCell, tabColor: t.tabColor };

    var heads = t.headRow ? headMap_(sh, t.headRow, lastCol) : {};
    var barRows = blueRows_(sh, t, lastRow);

    out.push('');
    out.push('[' + t.name + '] ' + t.firstRow + '~' + lastRow + '행 · ' + lastCol + '열 · ' + n + '건');
    if (t.headRow) {
      var found = Object.keys(heads).map(function (k) { return k + '=' + colLetter_(heads[k]); });
      out.push('   찾은 열: ' + found.join(', '));
    } else {
      out.push('   머리글 없음 — 글꼴·정렬·구분선만 적용');
    }
    if (barRows.length) out.push('   왼쪽 파란 막대: ' + barRows.length + '행 (' + barRows.slice(0, 12).join(', ') + (barRows.length > 12 ? ' …' : '') + ')');

    if (dryRun) return;
    styleTab_(sh, t, lastRow, lastCol, heads, barRows);
  });

  // 안내문은 구조가 달라 따로
  var info = ss.getSheetByName('안내문');
  if (info) {
    out.push('');
    out.push('[안내문] ' + info.getLastRow() + '행 — 항목명/설명 두 단으로 정돈');
    if (!dryRun) styleInfo_(info);
  }
  var log = ss.getSheetByName('수정로그');
  if (log && !dryRun) log.setTabColor('#cccccc');

  if (!dryRun) {
    try {
      if (typeof append_ === 'function') append_(ss, fmUser_(), '-', '-', '', '서식 정비 적용', '서식');
    } catch (err) { /* 수정로그 없으면 넘어감 */ }
  }
  return out.join('\n');
}

function styleTab_(sh, t, lastRow, lastCol, heads, barRows) {
  var n = lastRow - t.firstRow + 1;
  var all = sh.getRange(1, 1, lastRow, lastCol);

  // ① 초기화 — 배경 흰색, 테두리 제거, 글꼴 통일
  all.setBackground(C_BODY_BG)
    .setBorder(false, false, false, false, false, false)
    .setFontFamily(FONT).setFontSize(SIZE).setFontColor('#000000')
    .setVerticalAlignment('middle');

  // 굳어 있던 조건부 서식도 정리
  sh.setConditionalFormatRules([]);

  // ② 열 고정선을 가로지르는 병합을 먼저 푼다.
  //    (제목 B1:S1 이 병합돼 있으면 구글시트가 열 고정을 거부한다)
  var unmerged = unmergeStraddling_(sh, FREEZE_COLS);
  if (unmerged.length) Logger.log('[' + t.name + '] 열 고정을 위해 병합 해제: ' + unmerged.join(', '));

  // ③ 제목 (형사사건 탭만)
  if (t.titleCell) {
    sh.getRange(t.titleCell)
      .setValue(TITLE_TEXT)
      .setFontSize(14).setFontWeight('bold').setFontColor(C_TITLE)
      .setHorizontalAlignment('left').setBackground(C_BODY_BG);
    sh.setRowHeight(1, 34);
  }

  // ③ 머리글
  if (t.headRow) {
    var head = sh.getRange(t.headRow, 1, 1, lastCol);
    head.setBackground(C_HEAD_BG).setFontColor(C_HEAD_FG).setFontWeight('bold')
      .setHorizontalAlignment('center').setVerticalAlignment('middle')
      .setWrap(true)
      .setBorder(null, null, true, null, null, null, C_HEAD_BG, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    sh.setRowHeight(t.headRow, 44);
  }

  // ④ 가로 구분선만 (세로선 없음 — 격자 느낌 제거의 핵심)
  var body = sh.getRange(t.firstRow, 1, n, lastCol);
  body.setBorder(null, null, null, null, null, true, C_RULE, SpreadsheetApp.BorderStyle.SOLID);

  // ⑤ 정렬 — 기본 가운데, 긴 글 열만 왼쪽
  body.setHorizontalAlignment('center').setWrap(true);
  if (t.headRow) {
    LEFT_HEADS.forEach(function (key) {
      var c = heads[key];
      if (c) sh.getRange(t.firstRow, c, n, 1).setHorizontalAlignment('left');
    });
  } else {
    // 아직 머리글이 없는 탭 — 종결의 현재 배치에 맞춰 고정 지정
    // C 성명 · D 사건명 · E 선임계 · K 결과 · L 비고
    [3, 4, 5, 11, 12].forEach(function (c) {
      if (c <= lastCol) sh.getRange(t.firstRow, c, n, 1).setHorizontalAlignment('left');
    });
  }

  // ⑥ 번호 열 — 1.0 이 아니라 1 로 보이게 (값은 그대로)
  sh.getRange(t.firstRow, 1, n, 1).setNumberFormat('0').setHorizontalAlignment('center');

  // ⑦ 열 너비
  if (t.headRow) {
    WIDTHS.forEach(function (w) {
      var c = heads[w[0]];
      if (c) sh.setColumnWidth(c, w[1]);
    });
    sh.setColumnWidth(1, 44);   // No
  }

  // ⑧ 행 높이 — 들쭉날쭉한 고정 높이를 풀고 내용에 맞춤
  sh.autoResizeRows(t.firstRow, n);

  // ⑨ 왼쪽 파란 막대 (행 전체를 칠하는 대신)
  barRows.forEach(function (r) {
    sh.getRange(r, 1)
      .setBorder(null, true, null, null, null, null, C_BAR, SpreadsheetApp.BorderStyle.SOLID_THICK);
  });

  // ⑩ 조건부 서식 — 기일 색(매일 자동 갱신) + 단계 칸 색
  applyRules_(sh, t, n, lastCol, heads);

  // ⑪ 틀 고정 · 필터 · 눈금선
  //    하나가 실패해도 나머지 탭 작업이 멈추지 않도록 각각 감싼다
  try { sh.setFrozenRows(t.headRow ? t.headRow : 0); } catch (err) { logSkip_('행 고정', t.name, err); }
  try {
    sh.setFrozenColumns(Math.min(FREEZE_COLS, lastCol));
  } catch (err) {
    logSkip_('열 고정', t.name, err);
    try { sh.setFrozenColumns(0); } catch (e2) { /* 무시 */ }
  }
  try { sh.setHiddenGridlines(true); } catch (err) { /* 구버전 대비 */ }
  if (t.headRow) {
    try {
      var f = sh.getFilter();
      if (f) f.remove();
      sh.getRange(t.headRow, 1, lastRow - t.headRow + 1, lastCol).createFilter();
    } catch (err) { logSkip_('필터', t.name, err); }
  }
  if (t.tabColor) sh.setTabColor(t.tabColor);
}

/* 조건부 서식을 한 번에 다시 세운다.
     · 기일 — 문자열 앞 10글자(YYYY-MM-DD)를 날짜로 읽어 임박도를 회색 농도로
     · 단계 — ①경찰 ②검찰 ③재판 칸에만 색

   서식 스크립트는 규칙을 통째로 갈아끼우므로, 단계 색도 여기서 함께 세워야
   서식을 돌린 뒤 색이 사라지지 않는다. 지위단계 스크립트의 색과 같은 값이다. */
function applyRules_(sh, t, n, lastCol, heads) {
  var rules = [];

  var dateCol = heads['기일'];
  if (dateCol) {
    var wide = sh.getRange(t.firstRow, 1, n, lastCol);
    var ref = '$' + colLetter_(dateCol) + t.firstRow;
    var d = 'IFERROR(DATEVALUE(LEFT(' + ref + ',10)),0)';
    var has = 'AND(' + ref + '<>"",' + d + '>0';

    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=' + has + ',' + d + '>=TODAY(),' + d + '<=TODAY()+7)')
      .setBackground(C_D7_BG).setFontColor(C_D7_FG).setBold(true).setRanges([wide]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=' + has + ',' + d + '>TODAY()+7,' + d + '<=TODAY()+14)')
      .setBackground(C_D14_BG).setFontColor(C_D14_FG).setRanges([wide]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=' + has + ',' + d + '<TODAY())')
      .setFontColor(C_PAST_FG).setRanges([wide]).build());
  }

  var stageCol = heads['단계'];
  if (stageCol) {
    var narrow = sh.getRange(t.firstRow, stageCol, n, 1);
    FM_STAGES.forEach(function (s) {
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo(s.label)
        .setBackground(s.bg).setFontColor(s.fg).setBold(true)
        .setRanges([narrow]).build());
    });
  }

  sh.setConditionalFormatRules(rules);
}

function styleInfo_(sh) {
  var last = sh.getLastRow();
  var all = sh.getRange(1, 1, last, 2);
  all.setBackground(C_BODY_BG).setBorder(false, false, false, false, false, false)
    .setFontFamily(FONT).setFontSize(SIZE).setFontColor('#000000')
    .setVerticalAlignment('middle').setWrap(true)
    .setHorizontalAlignment('left');

  sh.setColumnWidth(1, 200);
  sh.setColumnWidth(2, 620);

  var col1 = sh.getRange(1, 1, last, 1).getValues();
  for (var i = 0; i < last; i++) {
    var v = String(col1[i][0] == null ? '' : col1[i][0]).trim();
    var row = sh.getRange(i + 1, 1, 1, 2);
    if (v.indexOf('■') === 0) {
      // 소제목 줄
      row.setBackground(C_HEAD_BG).setFontColor(C_HEAD_FG).setFontWeight('bold');
    } else if (v) {
      sh.getRange(i + 1, 1).setBackground(C_SUB_BG).setFontWeight('bold');
      row.setBorder(null, null, true, null, null, null, C_RULE, SpreadsheetApp.BorderStyle.SOLID);
    }
  }
  sh.autoResizeRows(1, last);
  sh.setTabColor('#cccccc');
  try { sh.setHiddenGridlines(true); } catch (err) { /* 무시 */ }
}

/* ── 값 무변경 확인 ── */

// 모든 탭 전 셀의 표시값으로 체크섬을 만든다 (제목 B1 은 의도적 변경이라 제외)
function valueChecksum_() {
  var ss = SpreadsheetApp.openById(FM_SHEET_ID);
  var parts = [];
  ss.getSheets().forEach(function (sh) {
    var name = sh.getName();
    if (name === '수정로그') return;   // 실행할 때마다 늘어나므로 제외
    var lr = sh.getLastRow(), lc = sh.getLastColumn();
    if (lr < 1 || lc < 1) return;
    // 표시값이 아니라 실제 값을 본다. 표시 형식(소수점 자릿수 등)을 바꿔도
    // 데이터가 바뀐 것은 아니므로, 서식 변경에 헛경보가 울리지 않는다.
    var vals = sh.getRange(1, 1, lr, lc).getValues();
    parts.push('#' + name);
    for (var r = 0; r < vals.length; r++) {
      for (var c = 0; c < vals[r].length; c++) {
        if (name === '형사사건' && r === 0 && c === 1) continue;  // B1 제목 제외
        var v = vals[r][c];
        parts.push(v instanceof Date ? v.getTime() : String(v));
      }
    }
  });
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, parts.join(''), Utilities.Charset.UTF_8);
  return raw.map(function (b) { return ((b & 0xff) + 0x100).toString(16).slice(1); }).join('');
}

/* ── 도구 ── */

// 그 줄에 글자가 하나라도 있는지 (머리글이 실제로 있는지 판정)
function hasHeader_(sh, row, lastCol) {
  if (row < 1 || row > sh.getMaxRows()) return false;
  var v = sh.getRange(row, 1, 1, lastCol).getValues()[0];
  for (var i = 0; i < v.length; i++) {
    if (String(v[i] == null ? '' : v[i]).trim()) return true;
  }
  return false;
}

// 머리글 글자에서 공백을 뺀 뒤, 미리 정한 이름과 부분일치로 열을 찾는다
function headMap_(sh, headRow, lastCol) {
  /* 순서가 중요하다. 앞에서부터 부분일치로 잡으므로 구체적인 것을 먼저 둔다.
     '관할경찰서' 와 '관할검찰청' 을 '관할' 보다 앞에 두지 않으면
     그 둘이 진짜 '관할' 열로 오인식된다. */
  var keys = ['구속여부', '성명', '이름', '지위', '단계', '사건명', '선임계',
    '관할경찰서', '관할검찰청', '경찰사건번호', '담당수사관', '결정', '이의여부',
    '형제번호', '검사', '사건번호', '관할', '재판부',
    '공소장', '증거기록', '기일', '법정', '피해자연락처', '체크할것', '체크',
    '항소여부', '상고여부', '1심사건번호', '1심관할법원',
    '법원', '약식명령일', '정식재판청구기한', '결과', '비고',
    '종결일', '종결', '복원'];   // '종결일' 이 '종결' 보다 앞이어야 한다
  var row = sh.getRange(headRow, 1, 1, lastCol).getValues()[0];
  var map = {};
  for (var c = 0; c < row.length; c++) {
    var h = String(row[c] == null ? '' : row[c]).replace(/\s/g, '');
    if (!h) continue;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (map[k]) continue;
      if (h.indexOf(k) === 0 || h === k) { map[k] = c + 1; break; }
    }
  }
  // '관할'과 '관할경찰서'가 겹치지 않게 보정
  if (map['관할'] && map['관할경찰서'] && map['관할'] === map['관할경찰서']) delete map['관할'];
  return map;
}

// 배경을 지우기 전에, 파랗게 칠해진 행 번호를 모아둔다
function blueRows_(sh, t, lastRow) {
  var n = lastRow - t.firstRow + 1;
  if (n < 1) return [];
  var col = Math.min(2, sh.getLastColumn());   // B열로 판정 (S열은 전 행이 파래서 못 씀)
  var bg = sh.getRange(t.firstRow, col, n, 1).getBackgrounds();
  var rows = [];
  for (var i = 0; i < n; i++) {
    if (String(bg[i][0]).toLowerCase() === BLUE_MARK) rows.push(t.firstRow + i);
  }
  return rows;
}

// 열 고정선을 가로지르는 병합을 푼다.
// 구글시트는 '병합된 셀의 일부만 포함된 열'을 고정하지 못한다.
// 병합을 풀어도 값은 왼쪽 위 칸에 그대로 남는다.
function unmergeStraddling_(sh, freezeCols) {
  if (!freezeCols) return [];
  var undone = [];
  sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), Math.max(sh.getLastColumn(), 1))
    .getMergedRanges().forEach(function (m) {
      var c1 = m.getColumn();
      var c2 = c1 + m.getNumColumns() - 1;
      // 고정선(freezeCols 와 그 다음 열 사이)을 걸치고 있으면 푼다
      if (c1 <= freezeCols && c2 > freezeCols) {
        undone.push(m.getA1Notation());
        m.breakApart();
      }
    });
  return undone;
}

function logSkip_(what, tab, err) {
  Logger.log('[' + tab + '] ' + what + ' 건너뜀 — ' + err);
}

function lastRow_(sh, t) {
  var last = sh.getLastRow();
  if (last < t.firstRow) return t.firstRow - 1;
  var names = sh.getRange(t.firstRow, t.nameCol, last - t.firstRow + 1, 1).getValues();
  for (var i = names.length - 1; i >= 0; i--) {
    if (String(names[i][0] == null ? '' : names[i][0]).trim()) return t.firstRow + i;
  }
  return t.firstRow - 1;
}

function colLetter_(c) {
  var s = '';
  while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - m - 1) / 26; }
  return s;
}

function fmBackup_() {
  var stamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  var name = '[백업] 사건정리 — ' + stamp + ' (서식정비 직전)';
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

function fmAlert_(text) {
  try {
    var t = text.length > 1200 ? text.substring(0, 1200) + '\n\n... 전체 내용은 아래 [실행 로그]에서 확인하세요' : text;
    SpreadsheetApp.getUi().alert(t);
  } catch (err) { /* 독립 프로젝트에서는 알림창이 없음 */ }
}
