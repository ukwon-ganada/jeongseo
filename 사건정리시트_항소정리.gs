/* 법무법인 정서 — 사건정리 시트: 항소 탭 정리
   ───────────────────────────────────────────────────────────────
   [무엇을 하나]
     ① 성명 칸에서 (피고인) 표기를 떼고 이름만 남깁니다.

          백찬용                    백찬용
           (피고인)      ──▶

     ② 선임계 옆에 항소장·항소이유서 체크칸을 만듭니다.

          … 사건명 │ 선임계 │ 항소장 ☐ │ 항소이유서 ☐ │ 사건번호 │ …

   [피고인이 아닌 줄은 건드리지 않습니다]
     항소인이 전부 피고인은 아닙니다. 실제로 세어 보니 피고인 39 · 피해자 2 ·
     고소인 1 이었습니다. (피고인) 만 떼고, 피해자·고소인 표기는 그대로 둡니다.
     우리가 어느 편을 대리하는지 한눈에 보여야 하기 때문입니다.

   [체크는 손으로 하셔야 합니다]
     체크 칸을 42건 다 훑어봤지만 36건이 비어 있고, 제출이 확인되는 줄은
     하나뿐이었습니다 (5행 박찬우 '26. 8. 14. 항소장제출').
     근거 없이 채우면 나머지가 '제출 안 함'처럼 읽혀 오히려 틀린 표가 됩니다.
     그래서 전부 빈 네모로 깔고, 미리보기에서 짚어드립니다.

   [머리글 줄과 열 자리를 알아서 찾습니다]
     '성명'(또는 '이름')이 적힌 줄을 머리글로 보고, 선임계 열도 이름으로
     찾습니다. 행을 올리거나 열을 옮기셔도 깨지지 않습니다.

   [설치]
     Apps Script 에서 [+] → 스크립트로 새 파일을 만들고
     이 내용을 붙여넣은 뒤 Ctrl+S

   [실행]
     · previewAppeal  → runAppeal

     두 번 돌려도 안전합니다. 이미 뗀 이름과 이미 있는 열은 그냥 둡니다.

   [끝나고]
     열이 늘었으니 runGridLines 를 한 번 더 돌려 새 칸에도 세로선을 그어 주세요.
   ─────────────────────────────────────────────────────────────── */

var AP_SHEET_ID = '1YCf77KxxotM4RnxePAhO16C7xbwEiHq4SuF5DN5vWto';
var AP_TAB = '항소사건';

// 이름에서 뗄 표기. 여기 적힌 것만 뗍니다 (피해자·고소인은 그대로 둡니다)
var AP_STRIP = ['피고인'];

// 선임계 오른쪽에 만들 체크칸 — 적은 순서대로 들어갑니다
var AP_NEW_COLS = ['항소장', '항소이유서'];
var AP_ANCHOR = '선임계';

/* ══════════════════════════════════════════════════════════════
   실행
   ══════════════════════════════════════════════════════════════ */

function previewAppeal() { apShow_(apProcess_(true)); }

function runAppeal() { apRun_('항소탭정리', apProcess_); }

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

  var lastCol = Math.max(sh.getLastColumn(), 1);
  var headRow = sh.getRange(head, 1, 1, lastCol).getValues()[0];
  var nameCol = apFindCol_(headRow, '성명') || apFindCol_(headRow, '이름');
  var anchor = apFindCol_(headRow, AP_ANCHOR);
  if (!nameCol) return '성명 열을 찾지 못했습니다.';
  if (!anchor) return '[' + AP_ANCHOR + '] 열을 찾지 못했습니다.';

  var last = apLastRow_(sh, head, nameCol);
  if (last <= head) return '[' + AP_TAB + '] 데이터가 없습니다.';
  var n = last - head;

  var out = [];
  out.push(dryRun ? '=== 미리보기 (시트는 바뀌지 않았습니다) ===' : '=== 항소 탭 정리 완료 ===');
  out.push('[' + AP_TAB + '] 머리글 ' + head + '행 · 데이터 ' + (head + 1) + '~' + last + '행 (' + n + '건)');

  /* ── ① 이름에서 (피고인) 떼기 ── */

  var names = sh.getRange(head + 1, nameCol, n, 1).getValues();
  var newNames = [], changed = [], kept = [], plain = 0, mismatch = [];

  for (var i = 0; i < n; i++) {
    var v = names[i][0];
    var flat = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    var m = flat.match(/^(.*?)\s*\(([^()]*)\)\s*$/);

    if (!m) { newNames.push([v]); plain++; continue; }        // 괄호 없음 — 그대로

    var role = m[2].trim();
    if (AP_STRIP.indexOf(role) < 0) {                          // 피해자·고소인 등
      newNames.push([v]);                                      // 셀 값에 손대지 않는다
      kept.push('   ' + (head + 1 + i) + '행  ' + flat);
      continue;
    }

    var bare = m[1].trim();
    if (!bare) { newNames.push([v]); plain++; continue; }      // 이름이 비면 두고 본다
    newNames.push([bare]);
    changed.push('   ' + (head + 1 + i) + '행  ' + flat + '  →  ' + bare);

    // 재조합 대조 — 뗀 이름에 표기를 도로 붙이면 원래 값이 되어야 한다
    if ((bare + ' (' + role + ')') !== flat) {
      mismatch.push((head + 1 + i) + '행 「' + flat + '」');
    }
  }

  out.push('');
  out.push('■ (피고인) 을 떼는 줄 ' + changed.length + '건');
  changed.slice(0, 12).forEach(function (s) { out.push(s); });
  if (changed.length > 12) out.push('   ... 외 ' + (changed.length - 12) + '건');

  if (kept.length) {
    out.push('');
    out.push('■ 그대로 두는 줄 ' + kept.length + '건 — 피고인이 아니라 표기를 남깁니다');
    kept.forEach(function (s) { out.push(s); });
  }
  if (plain) out.push('   괄호 표기가 없어 손대지 않는 줄  ' + plain + '건');

  if (mismatch.length) {
    out.push('');
    out.push('!! 재조합이 어긋나는 줄 ' + mismatch.length + '건 — 아무것도 바꾸지 않았습니다 !!');
    mismatch.forEach(function (s) { out.push('   ' + s); });
    return out.join('\n');
  }

  /* ── ② 선임계 옆에 체크칸 ── */

  var want = [], already = [];
  AP_NEW_COLS.forEach(function (h) {
    if (apFindCol_(headRow, h)) already.push(h); else want.push(h);
  });

  out.push('');
  if (want.length) {
    out.push('■ ' + AP_ANCHOR + '(' + apL_(anchor) + '열) 오른쪽에 새 칸 ' + want.length + '개');
    want.forEach(function (h, k) {
      out.push('   ' + apL_(anchor + 1 + k) + '열  ' + h + '  — ' + n + '건 모두 미체크');
    });
    out.push('   ' + apL_(anchor + 1) + '열부터 오른쪽 열은 ' + want.length + '칸씩 밀립니다');
  }
  if (already.length) out.push('   이미 있어 새로 만들지 않는 칸: ' + already.join(' · '));

  // 체크 칸에 제출이 적힌 줄 — 손으로 체크하실 수 있게 짚어 준다
  var hint = apHints_(sh, head, last, headRow, nameCol);
  if (hint.length) {
    out.push('');
    out.push('■ 체크 칸에 제출이 적힌 줄 — 보시고 손으로 체크해 주세요');
    hint.forEach(function (s) { out.push('   ' + s); });
  }

  if (dryRun) {
    out.push('');
    out.push('실제로 바꾸려면 runAppeal 을 실행하세요.');
    return out.join('\n');
  }

  /* ── 실제 변경 ── */

  // 성명 밖의 값이 그대로인지 보려고 먼저 떠 둔다
  var before = sh.getRange(head, 1, last - head + 1, lastCol).getValues();

  if (changed.length) sh.getRange(head + 1, nameCol, n, 1).setValues(newNames);

  if (want.length) {
    sh.insertColumnsAfter(anchor, want.length);
    var srcHead = sh.getRange(head, anchor);
    var srcBody = sh.getRange(head + 1, anchor, n, 1);

    want.forEach(function (h, k) {
      var col = anchor + 1 + k;
      // 선임계 칸과 똑같이 보이도록 서식만 복사한다 (값은 따로 쓴다)
      try { srcHead.copyTo(sh.getRange(head, col), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false); }
      catch (err) { }
      try { srcBody.copyTo(sh.getRange(head + 1, col, n, 1), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false); }
      catch (err) { }
      sh.getRange(head, col).setValue(h);
      sh.getRange(head + 1, col, n, 1).insertCheckboxes().setValues(apFalses_(n));
      sh.setColumnWidth(col, sh.getColumnWidth(anchor));
    });
  }

  /* ── 대조 ── */

  var after = sh.getRange(head, 1, last - head + 1, Math.max(sh.getLastColumn(), lastCol)).getValues();
  var moved = apDiff_(before, after, nameCol, anchor, want.length, lastCol);

  out.push('');
  out.push('재조합 대조 — ' + changed.length + '건 모두 일치');
  out.push(moved.length
    ? '!! 성명 밖의 값이 ' + moved.length + '군데 바뀌었습니다 — 백업으로 되돌려 주세요 !!'
    : '성명 밖의 값 — 바뀐 것 없음');
  moved.slice(0, 10).forEach(function (s) { out.push('   ' + s); });

  apLog_(ss, '항소 탭 이름 정리 ' + changed.length + '건'
    + (want.length ? ' · ' + want.join('·') + ' 칸 추가' : ''));

  out.push('');
  out.push('열이 늘었으니 runGridLines 를 한 번 더 돌려 새 칸에도 세로선을 그어 주세요.');
  return out.join('\n');
}

/* ══════════════════════════════════════════════════════════════
   도구
   ══════════════════════════════════════════════════════════════ */

/* 성명 열을 뺀 나머지 값이 그대로인지 본다.
   새 열이 anchor 오른쪽에 들어갔으므로 그만큼 자리를 옮겨 맞춰 본다. */
function apDiff_(before, after, nameCol, anchor, added, oldCols) {
  var bad = [];
  for (var r = 0; r < before.length; r++) {
    for (var c = 1; c <= oldCols; c++) {
      if (c === nameCol) continue;                       // 성명은 일부러 바꾼 열
      var to = (c <= anchor) ? c : c + added;            // anchor 오른쪽은 밀렸다
      var x = before[r][c - 1], y = (after[r] || [])[to - 1];
      var sx = (x == null ? '' : String(x)), sy = (y == null ? '' : String(y));
      if (sx !== sy) bad.push(apL_(c) + '열 ' + (r + 1) + '번째 줄 「' + sx.substring(0, 20) + '」');
    }
  }
  return bad;
}

/* 체크 칸에서 제출이 적힌 줄을 찾아 짚어 준다 (자동으로 체크하지는 않는다) */
function apHints_(sh, head, last, headRow, nameCol) {
  var col = apFindCol_(headRow, '체크');
  if (!col) return [];
  var n = last - head;
  var vals = sh.getRange(head + 1, col, n, 1).getValues();
  var names = sh.getRange(head + 1, nameCol, n, 1).getValues();
  var hit = [];
  for (var i = 0; i < n; i++) {
    var t = String(vals[i][0] == null ? '' : vals[i][0]).replace(/\s+/g, ' ').trim();
    if (!t) continue;
    // '제출기한' 은 기한이지 제출이 아니다
    if (!/(항소장|항소이유서|상고장|상고이유서)/.test(t)) continue;
    if (!/제출/.test(t) || /제출\s*기한/.test(t.replace(/\s/g, ''))) continue;
    var nm = String(names[i][0] == null ? '' : names[i][0]).replace(/\s+/g, ' ').trim();
    hit.push((head + 1 + i) + '행  ' + nm + '  │ ' + t.substring(0, 44));
  }
  return hit;
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
   딱 맞는 이름을 먼저 찾고, 없을 때만 앞부분 일치로 넘어간다. */
function apFindCol_(headRow, key) {
  var c, h;
  for (c = 0; c < headRow.length; c++) {
    if (apNorm_(headRow[c]) === key) return c + 1;
  }
  for (c = 0; c < headRow.length; c++) {
    h = apNorm_(headRow[c]);
    if (h && (h.indexOf(key) === 0 || key.indexOf(h) === 0)) return c + 1;
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

function apFalses_(n) {
  var a = [];
  for (var i = 0; i < n; i++) a.push([false]);
  return a;
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
