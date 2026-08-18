/* 법무법인 정서 — 사건정리 시트: 선임계 제출일 자동 기록
   ───────────────────────────────────────────────────────────────
   [무엇을 하나]
     선임계를 체크하면 그 칸 메모에 오늘 날짜가 저절로 들어갑니다.
     체크를 풀면 그 줄만 지워집니다.

       선임계 ☑  ← 마우스를 올리면   선임계 2026-08-18 제출

     기일 칸에 법정·시각을, 재판부 칸에 전화번호를 메모로 두는 것과 같은 방식입니다.
     열을 늘리지 않으므로 종결 이동(형사사건과 종결의 열 수가 같아야 합니다)에
     아무 영향이 없습니다.

   [어느 탭에서]
     형사사건 · 항소사건 · 종결 — 선임계 열이 있는 탭 모두

   [날짜를 고치고 싶으면]
     그 칸에서 오른쪽 클릭 → 메모 수정. 손으로 고친 날짜는 덮어쓰지 않습니다.
     (체크를 풀었다 다시 하면 오늘 날짜로 새로 들어갑니다)

   [이미 체크돼 있던 것들]
     언제 냈는지 알 길이 없어 비워 둡니다. 앞으로 체크하는 것부터 남습니다.
     지난 것을 아신다면 그 칸 메모에 손으로 적어 두시면 됩니다.

   [설치]
     Apps Script 에 이 파일을 만들어 붙여넣고 Ctrl+S
     그다음  사건정리 → 체크박스 → 「선임계 날짜 자동  켜기」

   [끄기]  removeRetainerDate
   ─────────────────────────────────────────────────────────────── */

var RD_SHEET_ID = '1YCf77KxxotM4RnxePAhO16C7xbwEiHq4SuF5DN5vWto';
var RD_TABS = ['형사사건', '항소사건', '종결'];
var RD_HEAD = '선임계';
var RD_WORD = '제출';

// 메모에서 우리가 적은 줄을 알아보는 표시 — '선임계 2026-08-18 제출'
var RD_LINE = /^선임계\s+\d{4}-\d{2}-\d{2}(\s|$)/;


/* ══════════════════════════════════════════════════════════════
   켜기 · 끄기
   ══════════════════════════════════════════════════════════════ */

function setupRetainerDate() {
  var ss = SpreadsheetApp.openById(RD_SHEET_ID);
  removeRetainerDate();
  ScriptApp.newTrigger('onRetainerEdit').forSpreadsheet(ss).onEdit().create();
  rdShow_('켰습니다.\n\n이제 ' + RD_TABS.join(' · ') + ' 탭에서 선임계를 체크하면\n'
    + '그 칸 메모에 오늘 날짜가 들어갑니다.\n\n'
    + '체크를 풀면 그 줄만 지워집니다.\n'
    + '날짜를 고치시려면 그 칸에서 오른쪽 클릭 → 메모 수정.');
}

function removeRetainerDate() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onRetainerEdit') ScriptApp.deleteTrigger(t);
  });
}


/* ══════════════════════════════════════════════════════════════
   체크할 때
   ══════════════════════════════════════════════════════════════ */

/* 가볍게 짭니다 — openById 도 잠금도 쓰지 않고 고친 칸만 건드립니다.
   이 시트에는 이미 편집마다 도는 트리거가 여럿(수정로그·지위단계·종결이동)
   있어서, 여기까지 무거우면 한 번 체크에 몇십 초씩 걸립니다. */
function onRetainerEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (RD_TABS.indexOf(sh.getName()) < 0) return;

  var head = rdHeadRow_(sh);
  if (!head) return;
  var col = rdFind_(sh.getRange(head, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0], RD_HEAD);
  if (!col) return;

  // 고친 범위가 선임계 열을 건드리지 않으면 그냥 끝
  if (e.range.getColumn() > col || e.range.getLastColumn() < col) return;

  var top = Math.max(e.range.getRow(), head + 1);
  var bottom = e.range.getRow() + e.range.getNumRows() - 1;
  if (bottom < top) return;

  var n = bottom - top + 1;
  var rg = sh.getRange(top, col, n, 1);
  var vals = rg.getValues();
  var notes = rg.getNotes();
  var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  var mine = RD_HEAD + ' ' + today + ' ' + RD_WORD;

  var next = [], touched = false;
  for (var i = 0; i < n; i++) {
    var was = notes[i][0] || '';
    var now = (vals[i][0] === true) ? rdAdd_(was, mine) : rdStrip_(was);
    next.push([now]);
    if (now !== was) touched = true;
  }
  if (touched) rg.setNotes(next);
}

/* 우리가 적은 줄이 이미 있으면 그대로 둔다 — 손으로 고친 날짜를 덮지 않기 위해서.
   남이 적어 둔 다른 메모는 아래에 그대로 남긴다. */
function rdAdd_(note, line) {
  var lines = String(note || '').split('\n');
  for (var i = 0; i < lines.length; i++) {
    if (RD_LINE.test(lines[i].trim())) return note;      // 이미 날짜가 있다
  }
  var rest = lines.filter(function (s) { return s.trim(); });
  return rest.length ? line + '\n' + rest.join('\n') : line;
}

/* 우리가 적은 줄만 걷어낸다. 다른 메모는 건드리지 않는다. */
function rdStrip_(note) {
  var rest = String(note || '').split('\n').filter(function (s) {
    return s.trim() && !RD_LINE.test(s.trim());
  });
  return rest.join('\n');
}


/* ══════════════════════════════════════════════════════════════
   지금 어떻게 돼 있나
   ══════════════════════════════════════════════════════════════ */

function showRetainerDates() {
  var ss = SpreadsheetApp.openById(RD_SHEET_ID);
  var out = ['=== 선임계 제출일 ==='];

  RD_TABS.forEach(function (tab) {
    var sh = ss.getSheetByName(tab);
    if (!sh) { out.push(''); out.push('[' + tab + '] 탭 없음'); return; }
    var head = rdHeadRow_(sh);
    if (!head) { out.push(''); out.push('[' + tab + '] 머리글 줄을 못 찾음'); return; }
    var hRow = sh.getRange(head, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
    var col = rdFind_(hRow, RD_HEAD);
    if (!col) { out.push(''); out.push('[' + tab + '] 선임계 열 없음'); return; }

    var last = sh.getLastRow();
    var n = last - head;
    if (n < 1) { out.push(''); out.push('[' + tab + '] 자료 없음'); return; }

    var rg = sh.getRange(head + 1, col, n, 1);
    var vals = rg.getValues(), notes = rg.getNotes();
    var on = 0, dated = 0;
    for (var i = 0; i < n; i++) {
      if (vals[i][0] !== true) continue;
      on++;
      var ls = String(notes[i][0] || '').split('\n');
      for (var j = 0; j < ls.length; j++) {
        if (RD_LINE.test(ls[j].trim())) { dated++; break; }
      }
    }
    out.push('');
    out.push('[' + tab + '] 체크된 것 ' + on + '건 · 그 중 날짜 있는 것 ' + dated + '건');
    if (on > dated) {
      out.push('   날짜 없는 ' + (on - dated) + '건은 이 기능을 켜기 전에 체크한 것입니다.');
      out.push('   아시는 날짜가 있으면 그 칸에서 오른쪽 클릭 → 메모 수정 으로 적어 주세요.');
    }
  });

  out.push('');
  out.push('메모 모양:  선임계 2026-08-18 제출');
  rdShow_(out.join('\n'));
}


/* ══════════════════════════════════════════════════════════════
   도구
   ══════════════════════════════════════════════════════════════ */

function rdHeadRow_(sh) {
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

/* 딱 맞는 이름을 먼저 — 앞부분 일치만 쓰면 엉뚱한 열이 걸린다 */
function rdFind_(headRow, key) {
  var c, h;
  for (c = 0; c < headRow.length; c++) {
    if (String(headRow[c] == null ? '' : headRow[c]).replace(/\s/g, '') === key) return c + 1;
  }
  for (c = 0; c < headRow.length; c++) {
    h = String(headRow[c] == null ? '' : headRow[c]).replace(/\s/g, '');
    if (h && h.indexOf(key) === 0) return c + 1;
  }
  return 0;
}

function rdShow_(text) {
  Logger.log(text);
  if (typeof uiShow_ === 'function') { uiShow_(text); return; }
  try { SpreadsheetApp.getUi().alert(String(text).substring(0, 1200)); } catch (err) { }
}
