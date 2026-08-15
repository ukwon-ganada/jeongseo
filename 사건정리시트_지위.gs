/* 법무법인 정서 — 사건정리 시트: 성명 칸에서 당사자 지위 분리
   ───────────────────────────────────────────────────────────────
   [무엇을 하나]
     성명 칸에 이름과 지위가 같이 들어가 있는 것을 두 칸으로 나눕니다.

       지금   C4  천준명
                 (피고인)

       바뀜   C4  천준명          D4  피고인 ▾

     지위 칸은 클릭해서 고를 수도 있고, 그냥 타이핑해도 됩니다.
     '피' 만 쳐도 피고인·피의자·피해자·피고소인·피고발인 으로 좁혀집니다.

   [이름 속 괄호는 건드리지 않습니다]
     맨 끝 괄호만 지위로 뗍니다.
       김영환(국선 김영환) (피고인)  →  이름 '김영환(국선 김영환)' / 지위 '피고인'
       박찬(박동순) (신청인)         →  이름 '박찬(박동순)'        / 지위 '신청인'

   [적용 범위]  형사사건 탭 (항소사건·종결 탭은 건드리지 않습니다)

   [설치]
     Apps Script 왼쪽 [파일] 옆 + → [스크립트] → 이름을 지위 로 하고
     이 파일 전체를 붙여넣기 → 저장(Ctrl+S)

   [실행 순서]  반드시 이 순서로
     1) previewParty   무엇이 어떻게 나뉠지 미리 봅니다. 시트는 안 건드립니다.
     2) runParty       실제로 나눕니다. 나누기 전에 백업을 자동으로 뜹니다.

   [이 작업은 셀 값을 실제로 바꿉니다]
     성명 칸에서 '(피고인)' 부분이 지워지고 옆 칸으로 옮겨갑니다.
     그래서 나눈 값을 다시 합쳐 원본과 맞춰보는 대조를 넣었습니다.
     한 행이라도 어긋나면 경고합니다.
   ─────────────────────────────────────────────────────────────── */

var PT_SHEET_ID = '1YCf77KxxotM4RnxePAhO16C7xbwEiHq4SuF5DN5vWto';
var PT_TAB = '형사사건';

var PT_HEADER_ROW = 3;
var PT_FIRST_ROW = 4;
var PT_NAME_COL = 3;    // C열 성명
var PT_ROLE_COL = 4;    // D열 지위 (새로 만들 자리)
var PT_HEAD = '지위';
var PT_WIDTH = 90;

// 지위 목록 — 여기만 고치시면 드롭다운이 바뀝니다
var PARTY_ROLES = [
  '피고인', '피의자', '고소인', '피해자', '피고소인', '피고발인',
  '고발인', '신청인', '참고인', '증인', '행위자', '보호소년'
];

// 목록에 없는 값도 입력할 수 있게 할지 (true = 작은 경고만, false = 아예 막음)
var ALLOW_OTHER = true;

// 표기가 다른 것을 목록의 표준 이름으로 바꿔 넣는다
var ROLE_ALIAS = { '피고인2': '피고인' };

/* ── 실행 ── */

function previewParty() {
  var r = ptProcess_(true);
  Logger.log(r);
  ptAlert_(r);
}

function runParty() {
  var backup = ptBackup_();
  var body = ptProcess_(false);
  var full = '백업 먼저 만들었습니다:\n' + backup + '\n\n' + body;
  Logger.log(full);
  ptAlert_(full);
}

/* ── 본체 ── */

function ptProcess_(dryRun) {
  var ss = SpreadsheetApp.openById(PT_SHEET_ID);
  var sh = ss.getSheetByName(PT_TAB);
  if (!sh) return '[' + PT_TAB + '] 탭을 찾지 못했습니다.';

  var split = ptIsSplit_(sh);
  var lastRow = ptLastRow_(sh);
  if (lastRow < PT_FIRST_ROW) return '데이터가 없습니다.';
  var n = lastRow - PT_FIRST_ROW + 1;

  // 나뉘기 전이면 성명 한 열, 나뉜 뒤면 성명·지위 두 열을 읽는다
  var src = sh.getRange(PT_FIRST_ROW, PT_NAME_COL, n, split ? 2 : 1).getValues();

  var names = [], roles = [];
  var counts = {}, blank = [], skipped = [], mismatch = [], kept = 0, done = 0;
  var samples = [];

  for (var i = 0; i < n; i++) {
    var row = PT_FIRST_ROW + i;
    var rawName = src[i][0];
    var rawRole = split ? String(src[i][1] == null ? '' : src[i][1]).trim() : '';
    var flat = String(rawName == null ? '' : rawName).replace(/\s+/g, ' ').trim();

    // 이미 지위가 채워져 있으면 그대로 둔다
    if (rawRole) {
      names.push([flat]);
      roles.push([rawRole]);
      counts[rawRole] = (counts[rawRole] || 0) + 1;
      kept++;
      continue;
    }

    if (!flat) { names.push(['']); roles.push(['']); continue; }

    var m = flat.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
    if (!m) {
      // 끝 괄호가 없음 — 이름만 있는 행
      names.push([flat]);
      roles.push(['']);
      blank.push(row + '행 ' + flat);
      continue;
    }

    var name = m[1].trim();
    var found = m[2].trim();
    var role = ROLE_ALIAS[found] || found;

    // 목록에 없는 값이면 건드리지 않는다 (사람 이름을 지위로 잘못 떼는 사고 방지)
    if (PARTY_ROLES.indexOf(role) < 0) {
      names.push([flat]);
      roles.push(['']);
      skipped.push(row + '행  ' + flat + '   → 떼어낸 값 「' + found + '」 가 목록에 없음');
      continue;
    }

    // 되돌려 붙여 원본과 같은지 확인
    if ((name + '(' + found + ')').replace(/\s/g, '') !== flat.replace(/\s/g, '')) {
      mismatch.push(row + '행  원본 「' + flat + '」 → 이름 「' + name + '」 지위 「' + found + '」');
    }

    names.push([name]);
    roles.push([role]);
    counts[role] = (counts[role] || 0) + 1;
    done++;
    if (samples.length < 8) samples.push(row + '행  ' + flat + '   →   ' + name + '  |  ' + role);
  }

  var out = [];
  out.push(dryRun ? '=== 미리보기 (시트는 바뀌지 않았습니다) ===' : '=== 적용 완료 ===');
  out.push('[' + PT_TAB + '] ' + PT_FIRST_ROW + '~' + lastRow + '행 · ' + n + '건');
  out.push('');
  if (split) out.push('※ 지위 열이 이미 있습니다 — 열은 새로 만들지 않고, 이미 채워진 ' + kept + '건은 그대로 둡니다.');
  out.push('나눈 행          ' + done + '건');
  out.push('지위 표기 없음   ' + blank.length + '건');
  out.push('건너뛴 행        ' + skipped.length + '건');

  var keys = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
  if (keys.length) {
    out.push('');
    out.push('지위별 건수');
    keys.forEach(function (k) { out.push('   ' + k + '  ' + counts[k] + '건'); });
  }
  if (samples.length) {
    out.push('');
    out.push('표본');
    samples.forEach(function (s) { out.push('   ' + s); });
  }
  if (blank.length) {
    out.push('');
    out.push('지위 표기가 없어 빈칸으로 두는 행');
    blank.slice(0, 15).forEach(function (s) { out.push('   ' + s); });
    if (blank.length > 15) out.push('   ... 외 ' + (blank.length - 15) + '건');
  }
  if (skipped.length) {
    out.push('');
    out.push('!! 목록에 없는 값이라 건드리지 않은 행 — 직접 확인하세요');
    skipped.forEach(function (s) { out.push('   ' + s); });
  }
  if (mismatch.length) {
    out.push('');
    out.push('!! 되돌려 붙였을 때 원본과 다른 행 !!');
    mismatch.forEach(function (s) { out.push('   ' + s); });
  }

  if (dryRun) {
    out.push('');
    out.push('실제로 나누려면 runParty 를 실행하세요.');
    return out.join('\n');
  }

  /* ── 여기부터 실제 변경 ── */

  if (mismatch.length) {
    out.push('');
    out.push('대조에 실패한 행이 있어 아무것도 바꾸지 않았습니다. 백업은 그대로 두셔도 됩니다.');
    return out.join('\n');
  }

  // ① 열 만들기 (처음 한 번만)
  if (!split) sh.insertColumnAfter(PT_NAME_COL);

  // ② 머리글
  sh.getRange(PT_HEADER_ROW, PT_ROLE_COL).setValue(PT_HEAD);

  // ③ 값 쓰기 — 363행을 한 번에 (셀마다 반복하면 시간 초과)
  sh.getRange(PT_FIRST_ROW, PT_NAME_COL, n, 1).setValues(names);
  sh.getRange(PT_FIRST_ROW, PT_ROLE_COL, n, 1).setValues(roles);

  // ④ 드롭다운 — 클릭해서 고르기 + 타이핑하면 좁혀지기가 함께 됩니다
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(PARTY_ROLES, true)
    .setAllowInvalid(ALLOW_OTHER)
    .setHelpText('당사자 지위를 고르거나 직접 입력하세요.')
    .build();
  sh.getRange(PT_FIRST_ROW, PT_ROLE_COL, n, 1).setDataValidation(rule);

  // ⑤ 모양
  sh.setColumnWidth(PT_ROLE_COL, PT_WIDTH);
  sh.getRange(PT_FIRST_ROW, PT_ROLE_COL, n, 1)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');

  out.push('');
  out.push('재조합 대조 — ' + n + '건 모두 일치');

  try {
    if (typeof append_ === 'function') {
      append_(ss, ptUser_(), PT_TAB, '-', '',
        '지위 열 분리 (나눔 ' + done + ' / 빈칸 ' + blank.length + ' / 건너뜀 ' + skipped.length + ')', '일괄정리');
    }
  } catch (err) { /* 수정로그 스크립트가 없으면 넘어감 */ }

  return out.join('\n');
}

/* ── 도구 ── */

function ptIsSplit_(sh) {
  var h = String(sh.getRange(PT_HEADER_ROW, PT_ROLE_COL).getValue() || '').replace(/\s/g, '');
  return h.indexOf(PT_HEAD) === 0;
}

function ptLastRow_(sh) {
  var last = sh.getLastRow();
  if (last < PT_FIRST_ROW) return PT_FIRST_ROW - 1;
  var v = sh.getRange(PT_FIRST_ROW, PT_NAME_COL, last - PT_FIRST_ROW + 1, 1).getValues();
  for (var i = v.length - 1; i >= 0; i--) {
    if (String(v[i][0] == null ? '' : v[i][0]).trim()) return PT_FIRST_ROW + i;
  }
  return PT_FIRST_ROW - 1;
}

function ptBackup_() {
  var stamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  var name = '[백업] 사건정리 — ' + stamp + ' (지위분리 직전)';
  var folder;
  try {
    folder = (typeof backupFolder_ === 'function') ? backupFolder_() : DriveApp.createFolder('사건정리 백업');
  } catch (err) {
    folder = DriveApp.getRootFolder();
  }
  return DriveApp.getFileById(PT_SHEET_ID).makeCopy(name, folder).getUrl();
}

function ptUser_() {
  try { return Session.getActiveUser().getEmail() || '(로그인 정보 없음)'; }
  catch (err) { return '(로그인 정보 없음)'; }
}

function ptAlert_(text) {
  try {
    var t = text.length > 1200 ? text.substring(0, 1200) + '\n\n... 전체 내용은 아래 [실행 로그]에서 확인하세요' : text;
    SpreadsheetApp.getUi().alert(t);
  } catch (err) { /* 독립 프로젝트에서는 알림창이 없음 */ }
}
