/* 법무법인 정서 — 사건정리 시트: 표 양식 통일 (격자·글자·행높이)
   ───────────────────────────────────────────────────────────────
   [무엇을 하나]
     다섯 탭의 표 생김새를 하나로 맞춥니다.

       격자      머리글부터 마지막 줄까지 사방·안쪽 전부 옅은 회색
       머리글    회색 바탕 + 굵게, 아래 선도 격자와 같은 톤
       글자      맑은 고딕 · 형사사건과 같은 크기
       행 높이   형사사건과 같게

   [예전 방식을 버렸습니다]
     전에는 세로선만 긋고 '기존 가로선은 null 로 두면 안 건드린다' 고 했는데,
     실제로는 형사사건의 가로선이 함께 지워졌습니다.
     이제는 여섯 자리를 모두 true 로 넘겨 격자를 통째로 다시 긋습니다.
     남길 것이 없으니 어긋날 여지도 없습니다.

   [머리글 아래 짙은 선을 없앱니다]
     머리글 아래에만 #9e9e9e 짙은 선이 깔려 그림자처럼 보였습니다.
     격자와 같은 #d9d9d9 로 낮춥니다. 머리글은 회색 바탕과 굵은 글씨로
     충분히 구분됩니다.

   [형사사건을 본으로 삼습니다]
     글자 크기와 행 높이를 숫자로 박지 않고 형사사건 탭에서 읽어 옵니다.
     getRowHeight 는 픽셀을 돌려주는데 40.5 는 포인트라 숫자를 박으면
     단위를 헷갈리기 쉽습니다. 나중에 형사 탭을 바꾸시면 나머지가 따라옵니다.

   [건드리지 않는 것]
     값 · 정렬 · 열 너비 · 조건부 서식 · 체크박스 · 드롭다운 ·
     머리글 줄 말고 손으로 칠하신 배경색

     값은 앞뒤로 MD5 지문을 떠서 한 글자도 안 바뀐 것을 확인합니다.

   [수정로그만 행 높이는 그대로]
     390줄짜리 기계 기록이라 늘리면 스크롤만 길어집니다.
     같이 맞추고 싶으시면 아래 VL_KEEP_ROW_H 에서 이름만 빼세요.

   [설치]
     Apps Script 왼쪽에서 세로선 파일을 열고 Ctrl+A 로 전체 선택한 뒤
     이 내용을 붙여넣고 Ctrl+S

     새 파일로 만들지 마세요. previewGridLines 가 두 벌이 되어 어느 쪽이
     도는지 알 수 없게 됩니다.

   [정렬은 기일과 단계로만]
     구글시트는 필터를 걸면 모든 칸에 정렬 단추가 생기고 일부만 뺄 수 없습니다.
     그래서 필터를 아예 걷어내고, 형사 탭은 아래 두 명령으로만 정렬합니다.

       sortCriminalByHearing   기일 빠른 순
       sortCriminalByStage     단계 순 (①경찰 → ②검찰 → ③재판),
                               같은 단계 안에서는 기일 빠른 순

     기일은 글자 그대로 세우지 않고 날짜를 읽어서 세웁니다. '2026-09-04' 와
     '2026. 9. 10.' 과 '26.8.13.' 세 가지 모양이 섞여 있어, 글자순으로 하면
     9월이 8월 앞으로 오기 때문입니다. 빈 칸은 맨 뒤로 갑니다.

     항소 탭은 항소정리.gs 의 sortByHearing · sortByDeadline 을 쓰세요.

   [실행]
     · previewGridLines  → runGridLines
     · sortCriminalByHearing               형사 탭 기일 순
     · sortCriminalByStage                 형사 탭 단계 순 (→ 기일 순)
     · removeGridLines                     격자만 걷어내기

   [주의]
     서식.gs 의 runFormat 은 격자를 지우고 가로선만 다시 긋습니다.
     그 함수를 돌리셨다면 runGridLines 를 한 번 더 실행해 주세요.
   ─────────────────────────────────────────────────────────────── */

var VL_SHEET_ID = '1YCf77KxxotM4RnxePAhO16C7xbwEiHq4SuF5DN5vWto';

// 글자 크기·행 높이를 읽어 올 본보기 탭
var VL_REF = '형사사건';

// 격자 색 — 가로·세로·머리글 아래 모두 같은 톤. 더 옅게 하려면 '#e8eaed'
var VL_COLOR = '#d9d9d9';

// 머리글 바탕
var VL_HEAD_BG = '#f2f2f2';

// 글꼴. 본보기 탭에서 읽지 못했을 때만 씁니다
var VL_FONT = '맑은 고딕';
var VL_SIZE = 10;

// 행 높이를 건드리지 않을 탭
var VL_KEEP_ROW_H = ['수정로그'];

// 아예 건너뛸 탭
var VL_SKIP = [];

/* 필터 단추를 걷어낼지.
   구글시트는 필터를 걸면 모든 칸에 정렬 단추가 생기고 일부만 뺄 수 없습니다.
   그래서 필터를 아예 없애고, 정렬은 아래 명령으로만 합니다. */
var VL_DROP_FILTER = true;

// 정렬할 탭
var VL_SORT_TAB = '형사사건';

/* ══════════════════════════════════════════════════════════════
   실행
   ══════════════════════════════════════════════════════════════ */

function previewGridLines() { vlShow_(vlProcess_(true, true)); }

function runGridLines() { vlRun_('표양식통일', function () { return vlProcess_(false, true); }); }

function removeGridLines() { vlRun_('격자제거', function () { return vlProcess_(false, false); }); }

/* 백업 → 본 작업 → 결과 보고.
   백업이 실패하면 (드라이브 용량·권한) 왜 멈췄는지 보이게 한다. */
function vlRun_(what, work) {
  var head;
  try {
    head = '백업 먼저 만들었습니다:\n' + vlBackup_(what);
  } catch (err) {
    vlShow_('백업을 만들지 못해 아무것도 바꾸지 않았습니다.\n\n'
      + '이유: ' + (err && err.message ? err.message : err) + '\n\n'
      + '드라이브 용량이 찼거나 권한이 없을 때 이렇게 됩니다.\n'
      + '오래된 [백업] 사건정리 … 파일을 지우고 다시 실행해 주세요.');
    return;
  }
  var body;
  try {
    body = work();
  } catch (err) {
    vlShow_(head + '\n\n작업 중 오류가 나서 멈췄습니다.\n\n'
      + '이유: ' + (err && err.message ? err.message : err)
      + (err && err.stack ? '\n\n' + err.stack : ''));
    return;
  }
  vlShow_(head + '\n\n' + body);
}

/* draw 가 true 면 양식을 맞추고, false 면 격자만 걷어낸다. */
function vlProcess_(dryRun, draw) {
  var ss = SpreadsheetApp.openById(VL_SHEET_ID);
  var sheets = ss.getSheets();

  var style = vlRefStyle_(ss);

  var out = [];
  out.push(dryRun ? '=== 미리보기 (시트는 바뀌지 않았습니다) ==='
    : (draw ? '=== 표 양식 통일 완료 ===' : '=== 격자 제거 완료 ==='));
  if (draw) {
    out.push('본보기 [' + VL_REF + '] — 글자 ' + style.font + ' ' + style.size
      + 'pt · 행 높이 ' + style.bodyH + ' · 머리글 높이 ' + style.headH);
    out.push('격자 ' + VL_COLOR + ' (머리글 아래 짙은 선도 이 톤으로 낮춥니다)');
  } else {
    out.push('격자만 지웁니다. 글자·행높이·값은 그대로입니다.');
  }

  var before = dryRun ? '' : vlSum_(ss);
  var jobs = [], skipped = [], failed = [];

  sheets.forEach(function (sh) {
    var name = sh.getName();
    if (VL_SKIP.indexOf(name) >= 0) { skipped.push(name + ' (건너뛰기 목록)'); return; }

    var head = vlHeadRow_(sh);
    var last = vlLastRow_(sh, head);
    var cols = vlLastCol_(sh, head);
    if (last < head || cols < 1) { skipped.push(name + ' (데이터 없음)'); return; }

    jobs.push({ sh: sh, name: name, head: head, last: last, cols: cols,
      keepH: VL_KEEP_ROW_H.indexOf(name) >= 0 });
  });

  jobs.forEach(function (j) {
    out.push('');
    out.push('[' + j.name + '] ' + j.head + '행~' + j.last + '행 · '
      + j.cols + '열 (' + vlL_(1) + '~' + vlL_(j.cols) + ')'
      + (draw && j.keepH ? '   ※ 행 높이는 그대로' : ''));
    if (dryRun) return;

    try {
      var all = j.sh.getRange(j.head, 1, j.last - j.head + 1, j.cols);

      if (!draw) {
        all.setBorder(false, false, false, false, false, false);
        return;
      }

      // ① 격자 — 여섯 자리 모두 true. 남길 것이 없으니 어긋날 여지도 없다
      all.setBorder(true, true, true, true, true, true,
        VL_COLOR, SpreadsheetApp.BorderStyle.SOLID);

      // ② 글자 — 크기와 글꼴만. 색·굵기·정렬은 건드리지 않는다
      all.setFontFamily(style.font).setFontSize(style.size);

      // ③ 머리글 — 바탕과 굵기. 아래 선은 ①에서 이미 같은 톤으로 그어졌다
      j.sh.getRange(j.head, 1, 1, j.cols)
        .setBackground(VL_HEAD_BG).setFontWeight('bold');

      // ④ 행 높이
      if (!j.keepH) {
        j.sh.setRowHeight(j.head, style.headH);
        if (j.last > j.head) {
          j.sh.setRowHeights(j.head + 1, j.last - j.head, style.bodyH);
        }
      }

      // ⑤ 필터 단추 — 모든 칸에 생겨 버리므로 걷어낸다
      if (VL_DROP_FILTER) {
        var f = j.sh.getFilter();
        if (f) { f.remove(); j.dropped = true; }
      }
    } catch (err) {
      // 한 탭이 실패해도 나머지 탭은 계속한다
      failed.push(j.name + ' — ' + (err && err.message ? err.message : err));
      out.push('   !! 건너뜀 — ' + (err && err.message ? err.message : err));
    }
  });

  if (skipped.length) {
    out.push('');
    out.push('■ 건드리지 않은 탭');
    skipped.forEach(function (s) { out.push('   ' + s); });
  }

  if (dryRun) {
    out.push('');
    out.push('실제로 맞추려면 runGridLines 를 실행하세요.');
    return out.join('\n');
  }

  var after = vlSum_(ss);
  out.push('');
  var drop = jobs.filter(function (j) { return j.dropped; });
  if (drop.length) {
    out.push('필터 단추를 걷어낸 탭 ' + drop.length + '개 — '
      + drop.map(function (j) { return j.name; }).join(' · '));
    out.push('정렬은 sortCriminalByHearing (형사사건 기일 순) 으로 하세요.');
  }
  out.push(before === after
    ? '값 대조 — 한 글자도 바뀌지 않았습니다'
    : '!! 값이 바뀌었습니다 — 백업으로 되돌려 주세요 !!');
  if (failed.length) out.push('실패한 탭 ' + failed.length + '개 — ' + failed.join(' / '));

  vlLog_(ss, (draw ? '다섯 탭 표 양식 통일' : '격자 제거')
    + ' (' + (jobs.length - failed.length) + '개 탭)');
  return out.join('\n');
}

/* ══════════════════════════════════════════════════════════════
   정렬 — 형사사건 기일 순
   ══════════════════════════════════════════════════════════════ */

/* 기일 빠른 순. 같은 날이면 시각 순 */
function sortCriminalByHearing() {
  vlShow_(vlSort_(VL_SORT_TAB, [{ head: '기일', kind: 'date' }]));
}

/* 단계 순 (①경찰 → ②검찰 → ③재판). 같은 단계 안에서는 기일 빠른 순.
   단계만으로 세우면 같은 단계끼리 순서가 없어 눈에 안 들어옵니다. */
function sortCriminalByStage() {
  vlShow_(vlSort_(VL_SORT_TAB, [{ head: '단계', kind: 'text' }, { head: '기일', kind: 'date' }]));
}

/* 열쇠 여러 개로 줄을 세운다. 앞의 열쇠가 먼저, 같으면 다음 열쇠.
   끝까지 같으면 원래 순서를 지킨다.

   글자 그대로 세우지 않고 날짜를 읽는다. 형사사건 기일에는 세 가지 모양이 섞여
   있어서 글자순으로 하면 '2026. 9. 10.' 이 '2026-08-20' 보다 앞으로 온다.

     2026-09-04 16:00                       하이픈
     2026-08-20 공판기일(412호법정 11:30)     하이픈 + 뒤에 시각
     2026. 9. 10. 10:30 공판기일             점 + 빈칸
     26.8.13. 무죄                          두 자리 연도

   단계는 ①②③ 로 시작해 글자순이 곧 단계 순이다.
   빈 칸은 어느 열쇠든 맨 뒤로 보낸다. */
function vlSort_(tabName, keys) {
  var ss = SpreadsheetApp.openById(VL_SHEET_ID);
  var sh = ss.getSheetByName(tabName);
  if (!sh) return '[' + tabName + '] 탭을 찾지 못했습니다.';

  var head = vlHeadRow_(sh);
  var cols = vlLastCol_(sh, head);
  var last = vlLastRow_(sh, head);
  var n = last - head;
  if (n < 2) return '줄일 것이 없습니다.';

  var headRow = sh.getRange(head, 1, 1, cols).getValues()[0];
  for (var k = 0; k < keys.length; k++) {
    keys[k].col = 0;
    for (var c = 0; c < headRow.length; c++) {
      if (vlNorm_(headRow[c]).indexOf(vlNorm_(keys[k].head)) === 0) { keys[k].col = c + 1; break; }
    }
    if (!keys[k].col) return '[' + keys[k].head + '] 열을 찾지 못했습니다.';
  }

  var rows = sh.getRange(head + 1, 1, n, cols).getValues();
  var keyed = rows.map(function (r, i) {
    return {
      r: r, i: i,
      k: keys.map(function (key) {
        return (key.kind === 'date') ? vlDateKey_(r[key.col - 1]) : vlTextKey_(r[key.col - 1]);
      })
    };
  });
  keyed.sort(function (a, b) {
    for (var j = 0; j < a.k.length; j++) {
      var x = a.k[j], y = b.k[j];
      if (x === y) continue;
      if (x === Infinity) return 1;                  // 빈 칸은 언제나 뒤로
      if (y === Infinity) return -1;
      return (x < y) ? -1 : 1;
    }
    return a.i - b.i;                                 // 끝까지 같으면 원래 순서
  });

  sh.getRange(head + 1, 1, n, cols).setValues(keyed.map(function (x) { return x.r; }));

  var label = keys.map(function (key) { return key.head; }).join(' → ');
  var filled = keyed.filter(function (x) { return x.k[0] !== Infinity; }).length;
  var moved = keyed.filter(function (x, i) { return x.i !== i; }).length;
  vlLog_(ss, '[' + tabName + '] ' + label + ' 순으로 정렬 (' + filled + '건)');
  return '=== [' + tabName + '] ' + label + ' 순으로 줄 세웠습니다 ===\n'
    + n + '건 중 ' + keys[0].head + ' 가 적힌 ' + filled + '건이 앞으로, '
    + (n - filled) + '건은 맨 뒤로.\n자리가 바뀐 줄 ' + moved + '건.';
}

/* 글자 열쇠. 빈 칸은 맨 뒤(Infinity). */
function vlTextKey_(v) {
  var t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return t ? t : Infinity;
}

/* 정렬용 열쇠. 날짜가 없으면 맨 뒤(Infinity). */
function vlDateKey_(v) {
  if (v instanceof Date) return v.getTime();
  var t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (!t) return Infinity;

  var y, mo, d;
  var m = t.match(/(\d{4})\s*-\s*(\d{1,2})\s*-\s*(\d{1,2})/);      // 2026-09-04
  if (!m) m = t.match(/(\d{2,4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})/); // 2026. 9. 10. / 26.8.13.
  if (!m) return Infinity;

  y = parseInt(m[1], 10);
  if (y < 100) y += 2000;
  mo = parseInt(m[2], 10);
  d = parseInt(m[3], 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return Infinity;

  // 날짜 뒤에 붙은 시각만 본다 (날짜 앞의 숫자를 시각으로 잘못 읽지 않도록)
  var rest = t.substring(m.index + m[0].length);
  var hm = rest.match(/(\d{1,2})\s*:\s*(\d{2})/);
  return new Date(y, mo - 1, d,
    hm ? parseInt(hm[1], 10) : 0, hm ? parseInt(hm[2], 10) : 0).getTime();
}

/* ══════════════════════════════════════════════════════════════
   도구
   ══════════════════════════════════════════════════════════════ */

/* 본보기 탭에서 글자 크기와 행 높이를 읽어 온다.
   숫자를 박아 두면 픽셀·포인트를 헷갈리기 쉬워서 실제 값을 읽는다.

   한 칸만 보면 안 된다. 형사사건 2행은 Arial 인데 탭 전체로는 맑은 고딕이
   1197칸 대 137칸으로 훨씬 많다. 한 칸만 읽으면 Arial 이 다섯 탭에 퍼진다.
   그래서 여러 줄을 훑어 제일 많은 값을 쓴다. */
function vlRefStyle_(ss) {
  var s = { font: VL_FONT, size: VL_SIZE, bodyH: 54, headH: 54 };
  var ref = ss.getSheetByName(VL_REF);
  if (!ref) return s;
  try {
    var head = vlHeadRow_(ref);
    var last = vlLastRow_(ref, head);
    var cols = vlLastCol_(ref, head);
    var n = Math.min(30, last - head);
    if (n < 1 || cols < 1) return s;

    var rg = ref.getRange(head + 1, 1, n, cols);
    s.font = vlTop_(rg.getFontFamilies()) || VL_FONT;
    s.size = vlTop_(rg.getFontSizes()) || VL_SIZE;

    s.headH = ref.getRowHeight(head);
    var hs = [];
    for (var r = head + 1; r <= head + n; r++) hs.push([ref.getRowHeight(r)]);
    s.bodyH = vlTop_(hs) || 54;
  } catch (err) { /* 못 읽으면 위 기본값 */ }
  return s;
}

/* 표에서 제일 많이 나오는 값 */
function vlTop_(grid) {
  var count = {}, best = null, most = 0;
  for (var r = 0; r < grid.length; r++) {
    for (var c = 0; c < grid[r].length; c++) {
      var v = grid[r][c];
      if (v === '' || v == null) continue;
      var k = String(v);
      count[k] = (count[k] || 0) + 1;
      if (count[k] > most) { most = count[k]; best = v; }
    }
  }
  return best;
}

// 머리글 줄 — '성명' 또는 '이름'이 적힌 줄. 못 찾으면 1행 (수정로그처럼)
function vlHeadRow_(sh) {
  var probe = Math.min(5, sh.getLastRow());
  var lastCol = Math.max(sh.getLastColumn(), 1);
  if (probe < 1) return 1;
  var vals = sh.getRange(1, 1, probe, lastCol).getValues();
  for (var r = 0; r < probe; r++) {
    for (var c = 0; c < lastCol; c++) {
      var h = vlNorm_(vals[r][c]);
      if (h.indexOf('성명') === 0 || h.indexOf('이름') === 0) return r + 1;
    }
  }
  return 1;
}

/* 마지막 데이터 행 — 성명 열에 값이 있는 마지막 줄.
   성명 열이 없으면 getLastRow (수정로그처럼).
   체크박스가 데이터보다 한참 아래까지 깔려 있어도 성명 열로 재면 정확하다. */
function vlLastRow_(sh, head) {
  var last = sh.getLastRow();
  if (last <= head) return head;

  var lastCol = Math.max(sh.getLastColumn(), 1);
  var headRow = sh.getRange(head, 1, 1, lastCol).getValues()[0];
  var nameCol = 0;
  for (var c = 0; c < headRow.length; c++) {
    var h = vlNorm_(headRow[c]);
    if (h.indexOf('성명') === 0 || h.indexOf('이름') === 0) { nameCol = c + 1; break; }
  }
  if (!nameCol) return last;

  var v = sh.getRange(head + 1, nameCol, last - head, 1).getValues();
  for (var i = v.length - 1; i >= 0; i--) {
    if (String(v[i][0] == null ? '' : v[i][0]).trim()) return head + 1 + i;
  }
  return head;
}

// 마지막 열 — 머리글이 붙어 있는 마지막 열. 없으면 getLastColumn
function vlLastCol_(sh, head) {
  var lastCol = Math.max(sh.getLastColumn(), 1);
  if (head > sh.getLastRow()) return lastCol;
  var row = sh.getRange(head, 1, 1, lastCol).getValues()[0];
  var n = 0;
  for (var c = 0; c < row.length; c++) if (vlNorm_(row[c])) n = c + 1;
  return n || lastCol;
}

function vlNorm_(v) {
  return String(v == null ? '' : v).replace(/\s/g, '');
}

function vlL_(c) {
  var s = '';
  while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - m - 1) / 26; }
  return s;
}

/* 값이 그대로인지 대조하는 지문. 표시값이 아니라 실제 값을 본다. */
function vlSum_(ss) {
  var parts = [];
  ss.getSheets().forEach(function (sh) {
    var rows = sh.getLastRow(), cols = sh.getLastColumn();
    if (rows < 1 || cols < 1) { parts.push(sh.getName() + ':'); return; }
    var v = sh.getRange(1, 1, rows, cols).getValues();
    parts.push(sh.getName() + ':' + v.map(function (row) {
      return row.map(function (x) { return x == null ? '' : String(x); }).join('');
    }).join(''));
  });
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, parts.join(''))
    .map(function (b) { return (b < 0 ? b + 256 : b).toString(16); }).join('');
}

function vlBackup_(what) {
  var stamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  var name = '[백업] 사건정리 — ' + stamp + ' (' + what + ' 직전)';
  var folder;
  try {
    folder = (typeof backupFolder_ === 'function') ? backupFolder_() : DriveApp.createFolder('사건정리 백업');
  } catch (err) {
    folder = DriveApp.getRootFolder();
  }
  return DriveApp.getFileById(VL_SHEET_ID).makeCopy(name, folder).getUrl();
}

function vlLog_(ss, msg) {
  try {
    if (typeof append_ === 'function') {
      var who = '(로그인 정보 없음)';
      try { who = Session.getActiveUser().getEmail() || who; } catch (e) { }
      append_(ss, who, '-', '-', '', msg, '표양식');
    }
  } catch (err) { /* 수정로그 스크립트가 없으면 넘어감 */ }
}

function vlShow_(text) {
  Logger.log(text);
  try {
    var t = text.length > 1200 ? text.substring(0, 1200) + '\n\n... 전체 내용은 아래 [실행 로그]에서' : text;
    SpreadsheetApp.getUi().alert(t);
  } catch (err) { /* 독립 프로젝트에서는 알림창이 없음 */ }
}
