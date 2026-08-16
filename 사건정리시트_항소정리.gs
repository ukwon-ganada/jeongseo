/* 법무법인 정서 — 사건정리 시트: 항소 탭 전면 재편
   ───────────────────────────────────────────────────────────────
   [무엇을 하나]
     항소 탭 열을 아래 순서로 다시 잡고, 체크칸 셋과 마감일 칸을 만듭니다.

       A 성 명        B 구속여부 ■색   C 사건번호      D 사건명
       E 선임계 ☐     F 항소장 ☐       G 항소이유서 ☐  H 항소이유마감일
       I 관할         J 기일           K 체크          L 1심사건번호
       M 1심 관할법원 N 상고여부

     · 성명에서 (피고인) 을 떼고 이름만 남깁니다
     · 사건번호를 앞으로 당깁니다 (지금은 선임계 뒤에 있습니다)
     · 항소장 · 항소이유서 · 항소이유마감일 칸을 새로 만듭니다

   [구속여부는 세 가지로 나눠 칠합니다]

       인천구치소 (3049)  구속됨      붉은  #fce8e6
       불구속             불구속      녹색  #e6f4ea
       (빈칸)             아직 모름   색 없음

     정적 색이 아니라 조건부 서식이라, 나중에 입력하셔도 엔터 치는 순간
     저절로 칠해집니다. 빈칸은 색이 없으니 아직 확인 안 한 사건이 눈에 띕니다.

   [피고인이 아닌 줄은 건드리지 않습니다]
     항소인이 전부 피고인은 아닙니다. 실제로 세어 보니 피고인 39 · 피해자 2 ·
     고소인 1 이었습니다. (피고인) 만 떼고 피해자·고소인 표기는 그대로 둡니다.
     우리가 어느 편을 대리하는지 한눈에 보여야 하기 때문입니다.

   [법정 열은 없앱니다 — 확인하신 대로]
     지금 법정 열에 27건이 들어 있습니다. 미리보기가 27건을 전부 찍어 주니
     필요한 것이 있으면 옮겨 적으신 뒤 실행하세요. 백업에는 그대로 남습니다.
     머리글 없는 A열(1·2·3 세 개뿐인 잔재)도 함께 없앱니다.

   [아직 안 낸 항소이유서는 노랗게]
     항소이유서 칸이 빈 네모면 노란 바탕이 깔립니다. 체크하시면 규칙이 안 맞아
     색이 저절로 빠지고 원래대로 돌아옵니다. 손댈 것이 없습니다.

   [정렬은 항소이유마감일 · 기일 두 칸으로만]
     구글시트는 필터를 걸면 모든 칸에 정렬 단추가 생기고 일부만 뺄 수 없습니다.
     그래서 필터를 아예 걷어내고, 정렬은 아래 두 명령으로만 합니다.

       sortByDeadline   항소이유마감일 빠른 순
       sortByHearing    기일 빠른 순

     글자 그대로 줄 세우지 않고 날짜를 읽어서 세웁니다. '26. 9. 11.' 처럼 빈칸이
     섞인 줄이 있어 글자순으로 하면 9월이 8월 앞으로 오기 때문입니다.
     날짜가 없거나 '기일 미지정' 인 줄은 맨 뒤로 갑니다.

   [체크는 손으로 하셔야 합니다]
     체크 칸을 42건 다 훑어봤지만 제출이 확인되는 줄은 하나뿐이었습니다
     (5행 박찬우 '26. 8. 14. 항소장제출'). 근거 없이 한 줄만 체크하면
     나머지가 '제출 안 함'처럼 읽혀 오히려 틀린 표가 됩니다.
     전부 빈 네모로 깔고, 미리보기에서 짚어드립니다.

   [설치]
     Apps Script 에서 [+] → 스크립트로 새 파일을 만들고
     이 내용을 붙여넣은 뒤 Ctrl+S

   [실행]
     · previewAppeal  → runAppeal

     두 번 돌려도 안전합니다. 이미 재편된 탭은 그냥 둡니다.

   [끝나고]
     열이 바뀌었으니 runGridLines 를 한 번 더 돌려 세로선을 다시 그어 주세요.
   ─────────────────────────────────────────────────────────────── */

var AP_SHEET_ID = '1YCf77KxxotM4RnxePAhO16C7xbwEiHq4SuF5DN5vWto';
var AP_TAB = '항소사건';

/* 새 열 구성. 이 순서 그대로 만들어집니다.
   지금 탭에 같은 이름의 열이 있으면 값을 옮겨 오고, 없으면 빈 칸으로 만듭니다. */
var AP_LAYOUT = ['성 명', '구속여부', '사건번호', '사건명',
  '선임계', '항소장', '항소이유서', '항소이유마감일',
  '관할', '기일', '체크', '1심사건번호', '1심 관할법원', '상고여부'];

// 일부러 없애는 열. 여기 적힌 열에서만 값이 사라져도 봐줍니다.
var AP_DROP = ['법정'];

// 체크박스로 만들 칸
var AP_BOXES = ['선임계', '항소장', '항소이유서'];

// 날짜로 볼 칸
var AP_DATE = '항소이유마감일';

// 이름에서 뗄 표기. 여기 적힌 것만 뗍니다 (피해자·고소인은 그대로 둡니다)
var AP_STRIP = ['피고인'];

/* 구속여부 칸 색 — 위에 적힌 규칙이 이깁니다.
   '불구속' 도 '값이 있는 칸'이라 아래 규칙에 걸리므로 반드시 먼저 와야 합니다. */
var AP_CUSTODY = [
  { when: 'contains', text: '불구속', bg: '#e6f4ea', fg: '#137333' },  // 불구속 — 녹색
  { when: 'notEmpty', bg: '#fce8e6', fg: '#b3261e' }                   // 구속됨 — 붉은
];

/* 아직 체크 안 된 칸을 눈에 띄게 할 열.
   체크하면 색이 저절로 빠집니다 (조건부 서식이라 규칙이 안 맞으면 원래대로). */
var AP_TODO_COLS = ['항소이유서'];
var AP_TODO_BG = '#fff2cc';      // 아직 안 한 일 — 노란 계열
var AP_TODO_FG = '#7f6000';

/* 정렬은 이 두 칸으로만. 나머지 칸에는 정렬·필터 단추를 두지 않습니다.
   구글시트는 필터를 걸면 모든 칸에 단추가 생기고 일부만 뺄 수 없어서,
   필터를 아예 걷어내고 아래 두 명령으로 정렬합니다. */
var AP_SORT_COLS = ['항소이유마감일', '기일'];

// 체크 칸에서 항소이유서 마감일을 읽어 채울지
var AP_READ_DEADLINE = true;

/* ══════════════════════════════════════════════════════════════
   실행
   ══════════════════════════════════════════════════════════════ */

function previewAppeal() { apShow_(apProcess_(true)); }

function runAppeal() { apRun_('항소탭재편', apProcess_); }

/* 백업 → 본 작업 → 결과 보고.
   백업이 실패하면 (드라이브 용량·권한) 왜 멈췄는지 보이게 한다. */
function apRun_(what, work) {
  var head;
  try {
    head = '백업 먼저 만들었습니다:\n' + apBackup_(what);
  } catch (err) {
    apShow_('백업을 만들지 못해 아무것도 바꾸지 않았습니다.\n\n'
      + '이유: ' + (err && err.message ? err.message : err) + '\n\n'
      + '드라이브 용량이 찼거나 권한이 없을 때 이렇게 됩니다.\n'
      + '오래된 [백업] 사건정리 … 파일을 지우고 다시 실행해 주세요.');
    return;
  }
  var body;
  try {
    body = work(false);
  } catch (err) {
    apShow_(head + '\n\n작업 중 오류가 나서 멈췄습니다.\n\n'
      + '이유: ' + (err && err.message ? err.message : err)
      + (err && err.stack ? '\n\n' + err.stack : ''));
    return;
  }
  apShow_(head + '\n\n' + body);
}

function apProcess_(dryRun) {
  var ss = SpreadsheetApp.openById(AP_SHEET_ID);
  var sh = ss.getSheetByName(AP_TAB);
  if (!sh) return '[' + AP_TAB + '] 탭을 찾지 못했습니다.';

  var head = apHeadRow_(sh);
  if (!head) return '머리글 줄을 찾지 못했습니다 (성명 열이 있는지 확인해 주세요).';

  var srcCols = Math.max(sh.getLastColumn(), 1);
  var oldHead = sh.getRange(head, 1, 1, srcCols).getValues()[0];
  var nameCol = apFindCol_(oldHead, '성명') || apFindCol_(oldHead, '이름');
  if (!nameCol) return '성명 열을 찾지 못했습니다.';

  var last = apLastRow_(sh, head, nameCol);
  if (last <= head) return '[' + AP_TAB + '] 데이터가 없습니다.';
  var n = last - head;
  var total = AP_LAYOUT.length;

  var out = [];
  out.push(dryRun ? '=== 미리보기 (시트는 바뀌지 않았습니다) ===' : '=== 항소 탭 재편 완료 ===');
  out.push('[' + AP_TAB + '] 머리글 ' + head + '행 · 데이터 ' + (head + 1) + '~' + last
    + '행 (' + n + '건) · ' + srcCols + '열 → ' + total + '열');

  /* ── 어느 열을 어디로 보낼지 ── */

  var plan = [];      // 새 열마다 { from: 옛 열번호 또는 0 }
  var moves = [];
  AP_LAYOUT.forEach(function (h, i) {
    var from = apFindCol_(oldHead, apNorm_(h));
    plan.push(from);
    moves.push('   ' + apL_(i + 1) + '  ' + h
      + (from ? '   ← ' + apL_(from) + '열' : '   ← 새로 만듭니다'));
  });

  var used = {};
  plan.forEach(function (c) { if (c) used[c] = true; });

  // 갈 곳이 없어지는 열
  var dropped = [];
  for (var c = 1; c <= srcCols; c++) {
    if (used[c]) continue;
    var hn = apNorm_(oldHead[c - 1]);
    var cnt = 0;
    for (var r = head + 1; r <= last; r++) {
      if (String(sh.getRange(r, c).getValue() || '').trim()) cnt++;
    }
    if (!hn && !cnt) continue;                       // 머리글도 값도 없는 열은 조용히
    dropped.push({ col: c, head: hn || '(머리글 없음)', cnt: cnt });
  }

  out.push('');
  out.push('■ 새 열 구성');
  moves.forEach(function (s) { out.push(s); });

  /* ── 값 옮기기 ── */

  var old = sh.getRange(head + 1, 1, n, srcCols).getValues();
  var rows = [], changed = [], kept = [], plain = 0, mismatch = [];
  var nameIdx = AP_LAYOUT.indexOf('성 명') >= 0 ? AP_LAYOUT.indexOf('성 명') : 0;
  var deadIdx = AP_LAYOUT.indexOf(AP_DATE);
  var checkIdx = AP_LAYOUT.indexOf('체크');
  var deadlines = [];

  for (var i = 0; i < n; i++) {
    var row = [];
    for (var k = 0; k < total; k++) {
      var from = plan[k];
      row.push(from ? old[i][from - 1] : '');
    }

    // 성명에서 (피고인) 떼기
    var v = row[nameIdx];
    var flat = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    var m = flat.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
    if (!m) {
      plain++;
    } else {
      var role = m[2].trim();
      if (AP_STRIP.indexOf(role) < 0) {
        kept.push('   ' + (head + 1 + i) + '행  ' + flat);   // 셀 값에 손대지 않는다
      } else {
        var bare = m[1].trim();
        if (!bare) {
          plain++;
        } else {
          row[nameIdx] = bare;
          changed.push('   ' + (head + 1 + i) + '행  ' + flat + '  →  ' + bare);
          // 재조합 대조 — 뗀 이름에 표기를 도로 붙이면 원래 값이 되어야 한다
          if ((bare + ' (' + role + ')') !== flat) {
            mismatch.push((head + 1 + i) + '행 「' + flat + '」');
          }
        }
      }
    }

    // 체크 칸에서 항소이유서 마감일 읽기
    if (AP_READ_DEADLINE && deadIdx >= 0 && checkIdx >= 0 && !row[deadIdx]) {
      var d = apDeadline_(row[checkIdx]);
      if (d) {
        row[deadIdx] = d;
        deadlines.push('   ' + (head + 1 + i) + '행  ' + String(row[nameIdx])
          + '  →  ' + Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd'));
      }
    }

    rows.push(row);
  }

  /* ── 값 대조 ── */

  var allowed = {};
  dropped.forEach(function (d) {
    if (AP_DROP.indexOf(d.head) >= 0 || d.head === '(머리글 없음)') allowed[d.col] = true;
  });

  var onPurpose = [], lost = [];
  for (var i2 = 0; i2 < n; i2++) {
    var bag = apBag_(rows[i2]);
    for (var c2 = 1; c2 <= srcCols; c2++) {
      var ov = String(old[i2][c2 - 1] == null ? '' : old[i2][c2 - 1]).replace(/\s+/g, ' ').trim();
      if (!ov || ov === 'false') continue;
      if (bag.indexOf(ov) >= 0) continue;                    // 새 배치 어딘가에 있다
      var line = (head + 1 + i2) + '행  ' + apL_(c2) + '「' + ov.substring(0, 26) + '」';
      if (allowed[c2]) onPurpose.push(line);
      else if (c2 === nameCol) continue;                     // 이름은 일부러 바꾼 열
      else lost.push(line);
    }
  }

  out.push('');
  out.push('■ (피고인) 을 떼는 줄 ' + changed.length + '건');
  changed.slice(0, 8).forEach(function (s) { out.push(s); });
  if (changed.length > 8) out.push('   ... 외 ' + (changed.length - 8) + '건');

  if (kept.length) {
    out.push('');
    out.push('■ 그대로 두는 줄 ' + kept.length + '건 — 피고인이 아니라 표기를 남깁니다');
    kept.forEach(function (s) { out.push(s); });
  }
  if (plain) out.push('   괄호 표기가 없어 손대지 않는 줄  ' + plain + '건');

  if (deadlines.length) {
    out.push('');
    out.push('■ 체크 칸에서 읽어 채우는 항소이유마감일 ' + deadlines.length + '건');
    deadlines.forEach(function (s) { out.push(s); });
    out.push('   (원래 체크 칸 글은 지우지 않습니다)');
  }

  if (onPurpose.length) {
    out.push('');
    out.push('■ 일부러 버리는 값 ' + onPurpose.length + '건 — 없애기로 한 열에서 나온 것입니다');
    out.push('   필요한 것이 있으면 지금 옮겨 적으세요. 백업에도 남습니다.');
    onPurpose.forEach(function (s) { out.push(s); });
  }

  var dup = apDupes_(rows, nameIdx, AP_LAYOUT.indexOf('사건번호'), head);
  if (dup.length) {
    out.push('');
    out.push('■ 같은 사람·같은 사건번호가 두 줄 이상 ' + dup.length + '쌍');
    out.push('   담긴 내용이 짝마다 달라 합치지 않았습니다. 보시고 정리해 주세요.');
    dup.forEach(function (s) { out.push('   ' + s); });
  }

  var hint = apHints_(rows, nameIdx, checkIdx, head);
  if (hint.length) {
    out.push('');
    out.push('■ 체크 칸에 제출이 적힌 줄 — 보시고 손으로 체크해 주세요');
    hint.forEach(function (s) { out.push('   ' + s); });
  }

  out.push('');
  out.push(lost.length
    ? '!! 그 밖에 사라지는 값 ' + lost.length + '건 !!'
    : '그 밖에 사라지는 값 — 없음');
  lost.slice(0, 15).forEach(function (s) { out.push('   ' + s); });

  if (mismatch.length) {
    out.push('');
    out.push('!! 재조합이 어긋나는 줄 ' + mismatch.length + '건 !!');
    mismatch.forEach(function (s) { out.push('   ' + s); });
  }

  if (dryRun) {
    out.push('');
    out.push('실제로 바꾸려면 runAppeal 을 실행하세요.');
    return out.join('\n');
  }
  if (lost.length || mismatch.length) {
    out.push('');
    out.push('문제가 있어 아무것도 바꾸지 않았습니다.');
    return out.join('\n');
  }

  /* ── 실제 변경 ── */

  if (sh.getMaxColumns() < total) {
    sh.insertColumnsAfter(sh.getMaxColumns(), total - sh.getMaxColumns());
  }

  // 옛 체크박스가 새 자리와 어긋나므로 걷어내고 다시 깐다
  sh.getRange(head + 1, 1, n, sh.getMaxColumns()).clearDataValidations();
  sh.getRange(head, 1, 1, sh.getMaxColumns()).clearContent();
  sh.getRange(head + 1, 1, n, sh.getMaxColumns()).clearContent();

  sh.getRange(head, 1, 1, total).setValues([AP_LAYOUT]);
  sh.getRange(head + 1, 1, n, total).setValues(rows);

  // 남는 열은 지운다 (법정·번호 자리)
  if (sh.getMaxColumns() > total) {
    sh.deleteColumns(total + 1, sh.getMaxColumns() - total);
  }

  AP_BOXES.forEach(function (h) {
    var col = AP_LAYOUT.indexOf(h) + 1;
    if (!col) return;
    var rg = sh.getRange(head + 1, col, n, 1);
    var vals = rg.getValues();
    rg.insertCheckboxes();
    rg.setValues(vals.map(function (x) { return [x[0] === true]; }));
  });

  if (deadIdx >= 0) {
    sh.getRange(head + 1, deadIdx + 1, n, 1).setNumberFormat('yyyy-mm-dd');
  }

  apCustodyColors_(sh, AP_LAYOUT.indexOf('구속여부') + 1, head + 1, n);
  apTodoColors_(sh, head + 1, n);

  // 정렬 단추는 두 칸으로만 — 필터를 걷어낸다 (아래 설명 참고)
  var hadFilter = false;
  try {
    var f = sh.getFilter();
    if (f) { f.remove(); hadFilter = true; }
  } catch (err) { }

  out.push('');
  out.push('재조합 대조 — ' + changed.length + '건 모두 일치');
  out.push('구속여부 칸 색 — 구속 붉은 · 불구속 녹색 · 빈칸 색 없음 (조건부 서식)');
  out.push('항소이유서 미체크 ' + n + '건을 노랗게 — 체크하면 저절로 빠집니다');
  if (hadFilter) out.push('모든 칸에 있던 필터 단추를 걷어냈습니다');
  out.push('정렬은 sortByDeadline (항소이유마감일) · sortByHearing (기일) 두 개로만');
  apLog_(ss, '항소 탭 재편 ' + total + '열 · 이름 정리 ' + changed.length + '건'
    + (onPurpose.length ? ' · 버린 값 ' + onPurpose.length + '건' : ''));

  out.push('');
  out.push('열이 바뀌었으니 runGridLines 를 한 번 더 돌려 세로선을 다시 그어 주세요.');
  return out.join('\n');
}

/* ══════════════════════════════════════════════════════════════
   도구
   ══════════════════════════════════════════════════════════════ */

/* 구속여부 칸 색 — 이 열을 겨냥한 기존 규칙만 걷어내고 새로 건다.
   '불구속' 규칙이 반드시 먼저 와야 한다. 불구속도 '값이 있는 칸'이라
   아래 규칙에 걸리는데, 구글시트는 앞선 규칙이 이기기 때문이다. */
function apCustodyColors_(sh, col, first, n) {
  if (!col || n < 1) return;
  var range = sh.getRange(first, col, n, 1);
  var keep = sh.getConditionalFormatRules().filter(function (rule) {
    var rs = rule.getRanges();
    for (var i = 0; i < rs.length; i++) {
      if (rs[i].getColumn() === col && rs[i].getNumColumns() === 1) return false;
    }
    return true;
  });
  AP_CUSTODY.forEach(function (s) {
    var b = SpreadsheetApp.newConditionalFormatRule();
    b = (s.when === 'contains') ? b.whenTextContains(s.text) : b.whenCellNotEmpty();
    keep.push(b.setBackground(s.bg).setFontColor(s.fg).setRanges([range]).build());
  });
  sh.setConditionalFormatRules(keep);
}

/* 아직 체크 안 된 칸을 눈에 띄게 한다.
   체크하면 규칙이 안 맞아 색이 저절로 빠지고 원래대로 돌아온다. */
function apTodoColors_(sh, first, n) {
  if (n < 1) return;
  var cols = [];
  AP_TODO_COLS.forEach(function (h) {
    var c = AP_LAYOUT.indexOf(h) + 1;
    if (c) cols.push(c);
  });
  if (!cols.length) return;

  var keep = sh.getConditionalFormatRules().filter(function (rule) {
    var rs = rule.getRanges();
    for (var i = 0; i < rs.length; i++) {
      if (cols.indexOf(rs[i].getColumn()) >= 0 && rs[i].getNumColumns() === 1) return false;
    }
    return true;
  });
  cols.forEach(function (c) {
    var range = sh.getRange(first, c, n, 1);
    keep.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$' + apL_(c) + first + '=FALSE')
      .setBackground(AP_TODO_BG).setFontColor(AP_TODO_FG)
      .setRanges([range]).build());
  });
  sh.setConditionalFormatRules(keep);
}

/* ══════════════════════════════════════════════════════════════
   정렬 — 항소이유마감일 · 기일 두 칸으로만
   ══════════════════════════════════════════════════════════════ */

function sortByDeadline() { apRun_('마감일정렬', function () { return apSort_('항소이유마감일'); }); }

function sortByHearing() { apRun_('기일정렬', function () { return apSort_('기일'); }); }

/* 줄을 세운다.

   [예전에 사고가 났던 자리다 — 반드시 Range.sort 를 써야 한다]
     처음에는 값을 읽어 새 순서로 setValues 로 다시 썼다. setValues 는 값만 쓴다.
     칸에 붙어 있던 배경색·메모·데이터 확인은 제자리에 남아, 값이 이사 간 뒤
     엉뚱한 사건에 붙었다. 형사 탭에서 실제로 이 사고가 났다.

     Range.sort 는 구글시트가 줄을 통째로 옮기므로 색·메모·체크박스가 값과
     함께 따라간다. 다시는 setValues 로 정렬하지 말 것.

   [그런데 Range.sort 는 칸 값 기준으로만 세운다]
     기일은 '26.10.01 10:20공판' 처럼 적혀 있는데 '26. 9. 11. 15:00' 처럼 빈칸이
     섞인 줄이 있어 글자순으로 세우면 9월이 8월 앞으로 온다.
     그래서 오른쪽 끝에 임시 열을 빌려 계산한 열쇠를 채우고, 그 열로 세운 뒤
     임시 열을 되돌린다.

   비었거나 '기일 미지정' 인 줄은 맨 뒤로 보낸다. */
function apSort_(headName) {
  var ss = SpreadsheetApp.openById(AP_SHEET_ID);
  var sh = ss.getSheetByName(AP_TAB);
  if (!sh) return '[' + AP_TAB + '] 탭을 찾지 못했습니다.';
  if (AP_SORT_COLS.indexOf(headName) < 0) return '[' + headName + '] 로는 정렬하지 않습니다.';

  var head = apHeadRow_(sh);
  var cols = Math.max(sh.getLastColumn(), 1);
  var headRow = sh.getRange(head, 1, 1, cols).getValues()[0];
  var nameCol = apFindCol_(headRow, '성명') || apFindCol_(headRow, '이름');
  var col = apFindCol_(headRow, headName);
  if (!col) return '[' + headName + '] 열을 찾지 못했습니다.';

  var last = apLastRow_(sh, head, nameCol);
  var n = last - head;
  if (n < 2) return '줄일 것이 없습니다.';

  var before = sh.getRange(head + 1, 1, n, cols).getValues();
  var first0 = apNorm_(before[0][nameCol - 1]), last0 = apNorm_(before[n - 1][nameCol - 1]);

  var keyRows = [], dated = 0;
  for (var i = 0; i < n; i++) {
    var p = apDatePart_(before[i][col - 1]);
    if (p.charAt(0) !== '힣') dated++;
    keyRows.push([p]);
  }

  // 오른쪽 끝에 임시 열을 하나 빌린다
  var tmp = cols + 1;
  if (sh.getMaxColumns() < tmp) sh.insertColumnsAfter(sh.getMaxColumns(), tmp - sh.getMaxColumns());
  var tmpRange = sh.getRange(head + 1, tmp, n, 1);
  var tmpBack = tmpRange.getValues();
  tmpRange.setValues(keyRows);

  try {
    // 여기가 핵심 — 구글시트가 줄을 통째로 옮긴다 (색·메모가 함께 간다)
    sh.getRange(head + 1, 1, n, tmp).sort({ column: tmp, ascending: true });
  } finally {
    sh.getRange(head + 1, tmp, n, 1).setValues(tmpBack);
  }

  var after = sh.getRange(head + 1, 1, n, cols).getValues();
  var moved = 0;
  for (var m = 0; m < n; m++) {
    if (apNorm_(after[m][nameCol - 1]) !== apNorm_(before[m][nameCol - 1])) moved++;
  }

  apLog_(ss, '[' + AP_TAB + '] ' + headName + ' 순으로 정렬 — 정렬 전 첫 줄 '
    + first0 + ' · 마지막 줄 ' + last0);
  return '=== [' + headName + '] 순으로 줄 세웠습니다 ===\n'
    + n + '건 중 날짜가 있는 ' + dated + '건을 빠른 날짜부터, '
    + (n - dated) + '건은 맨 뒤로.\n자리가 바뀐 줄 ' + moved + '건.\n'
    + '줄을 통째로 옮겼으므로 칸 색과 메모가 값과 함께 따라갔습니다.\n\n'
    + '정렬 전 첫 줄은 ' + first0 + ', 마지막 줄은 ' + last0 + ' 이었습니다.';
}

/* 정렬 열쇠 — 날짜를 자릿수 고정 숫자 글자로. 날짜가 없으면 '힣' 로 맨 뒤. */
function apDatePart_(v) {
  var k = apDateKey_(v);
  if (k === Infinity) return '힣';
  var s = String(Math.round(k / 60000));
  while (s.length < 12) s = '0' + s;
  return s;
}

/* 정렬용 열쇠. 날짜가 없으면 맨 뒤(Infinity). */
function apDateKey_(v) {
  if (v instanceof Date) return v.getTime();
  var t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (!t) return Infinity;
  var m = t.match(/(\d{2,4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})/);
  if (!m) return Infinity;                       // '기일 미지정' 등
  var y = parseInt(m[1], 10);
  if (y < 100) y += 2000;
  var hm = t.match(/(\d{1,2})\s*:\s*(\d{2})/);
  return new Date(y, parseInt(m[2], 10) - 1, parseInt(m[3], 10),
    hm ? parseInt(hm[1], 10) : 0, hm ? parseInt(hm[2], 10) : 0).getTime();
}

/* 체크 칸에서 항소이유서 마감일을 읽는다.
   '26. 8. 23. 항소이유서제출기한' → 2026-08-23
   항소이유서 이야기가 아니거나 날짜가 없으면 아무것도 돌려주지 않는다. */
function apDeadline_(v) {
  var t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (t.replace(/\s/g, '').indexOf('항소이유서') < 0) return null;
  var m = t.match(/(\d{2,4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})/);
  if (!m) return null;
  var y = parseInt(m[1], 10);
  if (y < 100) y += 2000;
  var mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(y, mo - 1, d);
}

/* 체크 칸에 제출이 적힌 줄을 짚어 준다 (자동으로 체크하지는 않는다) */
function apHints_(rows, nameIdx, checkIdx, head) {
  if (checkIdx < 0) return [];
  var hit = [];
  rows.forEach(function (r, i) {
    var t = String(r[checkIdx] == null ? '' : r[checkIdx]).replace(/\s+/g, ' ').trim();
    if (!t) return;
    if (!/(항소장|항소이유서|상고장|상고이유서)/.test(t)) return;
    if (!/제출/.test(t) || /제출기한/.test(t.replace(/\s/g, ''))) return;
    hit.push((head + 1 + i) + '행  ' + String(r[nameIdx]) + '  │ ' + t.substring(0, 44));
  });
  return hit;
}

/* 같은 사람·같은 사건번호가 두 줄 이상인지 */
function apDupes_(rows, nameIdx, caseIdx, head) {
  var seen = {}, dup = [];
  rows.forEach(function (r, i) {
    var nm = apNorm_(r[nameIdx]);
    if (!nm) return;
    var no = (caseIdx >= 0) ? apNorm_(r[caseIdx]) : '';
    if (!no) return;                                   // 사건번호가 없으면 판단하지 않는다
    var key = nm + '|' + no;
    if (seen[key] === undefined) { seen[key] = head + 1 + i; return; }
    dup.push(nm + ' (' + no + ')  —  ' + seen[key] + '행 · ' + (head + 1 + i) + '행');
  });
  return dup;
}

/* 값 대조용 자루. 체크 안 된 체크박스(false)는 담긴 정보가 없으므로 뺀다. */
function apBag_(arr) {
  var bag = [];
  for (var i = 0; i < arr.length; i++) {
    if (arr[i] === false) continue;
    var v = String(arr[i] == null ? '' : arr[i]).replace(/\s+/g, ' ').trim();
    if (v) bag.push(v);
  }
  return bag;
}

// 머리글 줄 — '성명' 또는 '이름'이 적힌 줄
function apHeadRow_(sh) {
  var probe = Math.min(6, sh.getLastRow());
  var lastCol = Math.max(sh.getLastColumn(), 1);
  if (probe < 1) return 0;
  var vals = sh.getRange(1, 1, probe, lastCol).getValues();
  for (var r = 0; r < probe; r++) {
    for (var c = 0; c < lastCol; c++) {
      var h = apNorm_(vals[r][c]);
      if (h.indexOf('성명') === 0 || h.indexOf('이름') === 0) return r + 1;
    }
  }
  return 0;
}

/* 머리글 이름으로 열 번호를 찾는다.
   딱 맞는 이름을 먼저 찾고, 없을 때만 앞부분 일치로 넘어간다.
   앞부분 일치만 쓰면 '사건번호' 를 찾을 때 '1심사건번호' 가 걸릴 수 있다. */
function apFindCol_(headRow, key) {
  var k = apNorm_(key), c, h;
  for (c = 0; c < headRow.length; c++) {
    if (apNorm_(headRow[c]) === k) return c + 1;
  }
  for (c = 0; c < headRow.length; c++) {
    h = apNorm_(headRow[c]);
    if (h && (h.indexOf(k) === 0 || k.indexOf(h) === 0)) return c + 1;
  }
  return 0;
}

// 성명 열에 값이 있는 마지막 줄
function apLastRow_(sh, head, nameCol) {
  var last = sh.getLastRow();
  if (last <= head) return head;
  var v = sh.getRange(head + 1, nameCol, last - head, 1).getValues();
  for (var i = v.length - 1; i >= 0; i--) {
    if (String(v[i][0] == null ? '' : v[i][0]).trim()) return head + 1 + i;
  }
  return head;
}

function apNorm_(v) {
  return String(v == null ? '' : v).replace(/\s/g, '');
}

function apL_(c) {
  var s = '';
  while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - m - 1) / 26; }
  return s;
}

function apBackup_(what) {
  var stamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  var name = '[백업] 사건정리 — ' + stamp + ' (' + what + ' 직전)';
  var folder;
  try {
    folder = (typeof backupFolder_ === 'function') ? backupFolder_() : DriveApp.createFolder('사건정리 백업');
  } catch (err) {
    folder = DriveApp.getRootFolder();
  }
  return DriveApp.getFileById(AP_SHEET_ID).makeCopy(name, folder).getUrl();
}

function apLog_(ss, msg) {
  try {
    if (typeof append_ === 'function') {
      var who = '(로그인 정보 없음)';
      try { who = Session.getActiveUser().getEmail() || who; } catch (e) { }
      append_(ss, who, AP_TAB, '-', '', msg, '항소정리');
    }
  } catch (err) { /* 수정로그 스크립트가 없으면 넘어감 */ }
}

function apShow_(text) {
  Logger.log(text);
  try {
    var t = text.length > 1200 ? text.substring(0, 1200) + '\n\n... 전체 내용은 아래 [실행 로그]에서' : text;
    SpreadsheetApp.getUi().alert(t);
  } catch (err) { /* 독립 프로젝트에서는 알림창이 없음 */ }
}
