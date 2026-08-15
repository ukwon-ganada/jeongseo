/* 법무법인 정서 — 사건정리 시트: 재판부 칸 정리 + 관할 법원 채우기
   ───────────────────────────────────────────────────────────────
   [무엇을 하나]
     ① 재판부(N열)  로웨어에서 온
          형사7단독 (전화:(032)860-1729 (재판일자 : 화ㆍ목))
        → 셀에는  형사7단독  만 남기고,
          전화번호·재판일자는 셀에 마우스를 올리면 뜨는 메모로 옮깁니다.
     ② 관할(M열)  비어 있는 칸을 재판부 전화번호 국번으로 알아내 채웁니다.
        이미 적혀 있는 칸은 건드리지 않습니다.

   [설치]
     Apps Script 왼쪽 [파일] 옆 + → [스크립트] → 이름을 관할정리 로 하고
     이 파일 전체를 붙여넣기 → 저장(Ctrl+S)
     ※ 수정로그 스크립트와 같은 프로젝트에 두시면 됩니다.

   [실행 순서]  반드시 이 순서로
     1) previewCleanup   무엇이 어떻게 바뀔지 미리 봅니다. 시트는 안 건드립니다.
     2) runCleanup       실제로 고칩니다. 고치기 전에 백업을 자동으로 하나 뜹니다.

   [되돌리기]
     runCleanup 이 만든 백업 파일을 열어 되돌리시면 됩니다.
     원본 문구는 각 셀 메모의 '원본' 줄에도 그대로 남겨둡니다.
   ─────────────────────────────────────────────────────────────── */

var TARGET_SHEET_ID = '1YCf77KxxotM4RnxePAhO16C7xbwEiHq4SuF5DN5vWto';

/* 손볼 탭 — 형사사건 하나뿐입니다.
   열은 머리글 이름으로 찾으므로 왼쪽에 열이 늘어나도 깨지지 않습니다.

   종결 탭은 대상에서 뺐습니다. 열 배치가 바뀌면서 재판부 열이 아예 없어져
   관할정리가 할 일이 없고, 옛 열 번호를 그대로 두면 엉뚱한 칸을 건드립니다. */
var CLEAN_TARGETS = [
  { sheet: '형사사건', headRow: 3, firstRow: 4 }
];

/* 전화 국번 → 법원.
   국번만으로 정하므로, 확실하지 않은 국번은 일부러 넣지 않았습니다.
   새 법원이 나오면 여기에 한 줄 추가하시면 됩니다. */
var COURT_BY_PREFIX = {
  '3480': '대법원',
  '3415': '서울동부지방법원',
  '860':  '인천지방법원',
  '320':  '인천지방법원 부천지원',
  '639':  '수원고등법원',
  '210':  '수원지방법원',
  '481':  '수원지방법원 안산지원',
  '470':  '수원지방법원 안양지원',
  '828':  '의정부지방법원',
  '841':  '청주지방법원 충주지원'
};

var PHONE_RE = /(?:\(0\d{1,2}\)|0\d{1,2}-)?(\d{3,4})-\d{4}/g;
// 재판부가 아니라 수사관 이름이 잘못 들어간 칸을 걸러내기 위한 표시
var INVESTIGATOR_RE = /(수사관|경위|경감|경사|형사\d팀|수사\d팀)/;
var BENCH_RE = /(단독|형사부|합의부|재판부|제\s*\d)/;

/* ── 실행 ── */

// 미리보기: 시트를 고치지 않고 결과만 보고합니다
function previewCleanup() {
  var report = process_(true);
  Logger.log(report);
  alertLong_(report);
}

// 실제 적용
function runCleanup() {
  var backupUrl = backupBeforeCleanup_();
  var report = process_(false);
  var full = '백업 먼저 만들었습니다:\n' + backupUrl + '\n\n' + report;
  Logger.log(full);
  alertLong_(full);
}

/* ── 본체 ── */

function process_(dryRun) {
  var ss = SpreadsheetApp.openById(TARGET_SHEET_ID);
  var lines = [];
  var total = { bench: 0, court: 0, skipped: 0 };
  var courtCount = {};
  var investigators = [];
  var unresolved = [];

  CLEAN_TARGETS.forEach(function (t) {
    var sh = ss.getSheetByName(t.sheet);
    if (!sh) { lines.push('[' + t.sheet + '] 탭을 찾지 못했습니다 — 건너뜁니다'); return; }

    var cols = resolveCleanCols_(sh, t);
    if (!cols.bench || !cols.court || !cols.caseNo) {
      lines.push('[' + t.sheet + '] 관할·재판부·사건번호 열을 찾지 못해 건너뜁니다'
        + ' (관할=' + cols.court + ' 재판부=' + cols.bench + ' 사건번호=' + cols.caseNo + ')');
      return;
    }

    var first = t.headRow ? t.headRow + 1 : t.firstRow;
    var last = sh.getLastRow();
    if (last < first) { lines.push('[' + t.sheet + '] 데이터가 없습니다'); return; }
    var n = last - first + 1;

    var benchRange = sh.getRange(first, cols.bench, n, 1);
    var courtRange = sh.getRange(first, cols.court, n, 1);
    var caseRange = sh.getRange(first, cols.caseNo, n, 1);

    var bench = benchRange.getValues();
    var notes = benchRange.getNotes();
    var court = courtRange.getValues();
    var cases = caseRange.getValues();

    var changedBench = 0, changedCourt = 0;

    for (var i = 0; i < n; i++) {
      var raw = String(bench[i][0] == null ? '' : bench[i][0]).trim();
      var caseNo = String(cases[i][0] == null ? '' : cases[i][0]).replace(/\n/g, ' ').trim();
      var flat = raw.replace(/\n/g, ' ').trim();

      // 재판부가 아니라 수사관 이름이 들어간 칸 — 손대지 않고 목록만 남김
      if (flat && INVESTIGATOR_RE.test(flat) && !BENCH_RE.test(flat)) {
        investigators.push(t.sheet + ' ' + (first + i) + '행: ' + flat);
        total.skipped++;
      } else if (flat.indexOf('(전화') >= 0) {
        // ① 재판부 이름과 부가정보 분리
        var split = splitBench_(flat);
        bench[i][0] = split.name;
        notes[i][0] = buildNote_(split, raw);
        changedBench++;
        total.bench++;
      }

      // ② 관할이 비어 있으면 채움
      if (!String(court[i][0] || '').trim()) {
        var guess = guessCourt_(caseNo, flat);
        if (guess) {
          court[i][0] = guess;
          courtCount[guess] = (courtCount[guess] || 0) + 1;
          changedCourt++;
          total.court++;
        } else if (caseNo && /\d{4}(고합|고단|고정|고약|노|도|초재|불제)/.test(caseNo)) {
          unresolved.push(t.sheet + ' ' + (first + i) + '행: ' + caseNo
            + (flat ? '  [' + flat.substring(0, 30) + ']' : '  [재판부 비어있음]'));
        }
      }
    }

    if (!dryRun && (changedBench || changedCourt)) {
      if (changedBench) { benchRange.setValues(bench); benchRange.setNotes(notes); }
      if (changedCourt) courtRange.setValues(court);
    }
    lines.push('[' + t.sheet + '] ' + first + '~' + last + '행'
      + '  (관할=' + clLetter_(cols.court) + ' 재판부=' + clLetter_(cols.bench)
      + ' 사건번호=' + clLetter_(cols.caseNo) + ')'
      + '  재판부 정리 ' + changedBench + '건 / 관할 채움 ' + changedCourt + '건');
  });

  var out = [];
  out.push(dryRun ? '=== 미리보기 (시트는 바뀌지 않았습니다) ===' : '=== 적용 완료 ===');
  out = out.concat(lines);
  out.push('');
  out.push('합계  재판부 정리 ' + total.bench + '건 / 관할 채움 ' + total.court + '건');

  var keys = Object.keys(courtCount).sort(function (a, b) { return courtCount[b] - courtCount[a]; });
  if (keys.length) {
    out.push('');
    out.push('채워진 관할');
    keys.forEach(function (k) { out.push('   ' + k + '  ' + courtCount[k] + '건'); });
  }

  if (investigators.length) {
    out.push('');
    out.push('재판부 칸에 수사관 이름이 들어간 곳 ' + investigators.length + '건 — 손대지 않았습니다');
    investigators.slice(0, 20).forEach(function (s) { out.push('   ' + s); });
    if (investigators.length > 20) out.push('   ... 외 ' + (investigators.length - 20) + '건');
  }

  if (unresolved.length) {
    out.push('');
    out.push('관할을 못 채운 곳 ' + unresolved.length + '건 — 직접 확인이 필요합니다');
    unresolved.slice(0, 25).forEach(function (s) { out.push('   ' + s); });
    if (unresolved.length > 25) out.push('   ... 외 ' + (unresolved.length - 25) + '건');
  }

  if (!dryRun) {
    try {
      var msg = '재판부 ' + total.bench + '건 정리, 관할 ' + total.court + '건 채움';
      if (typeof append_ === 'function') append_(ss, currentUserSafe_(), '-', '-', '', msg, '일괄정리');
    } catch (err) { /* 수정로그 스크립트가 없으면 그냥 넘어감 */ }
  }
  return out.join('\n');
}

/* ── 분리 규칙 ── */

// '형사7단독 (전화:(032)860-1729 (재판일자 : 화ㆍ목))'
//   → { name:'형사7단독', phones:['(032)860-1729'], info:'재판일자 : 화ㆍ목' }
function splitBench_(flat) {
  var at = flat.indexOf('(전화');
  var name = flat.substring(0, at).trim().replace(/[\s,]+$/, '');
  var rest = flat.substring(at);

  var phones = [];
  var m;
  PHONE_RE.lastIndex = 0;
  while ((m = PHONE_RE.exec(rest)) !== null) phones.push(m[0]);

  var info = rest
    .replace(PHONE_RE, '')
    .replace(/전화\s*:?/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\(\s*\)/g, '')
    .trim()
    .replace(/^[\s(),:\/\[\]]+/, '')
    .replace(/[\s(),:\/\[\]]+$/, '')
    .trim();

  return { name: name, phones: phones, info: info };
}

function buildNote_(split, raw) {
  var out = [];
  if (split.phones.length) out.push('전화  ' + split.phones.join('  '));
  if (split.info) out.push('안내  ' + split.info);
  out.push('');
  out.push('원본  ' + String(raw).replace(/\n/g, ' ').trim());
  return out.join('\n');
}

function guessCourt_(caseNo, bench) {
  // 대법원 사건은 원심 법원 전화가 적혀 있어도 대법원이 맞음 — 가장 먼저 판단
  if (/\d{4}도\d/.test(caseNo)) return '대법원';
  // 서울고등법원 인천원외재판부는 인천지법 건물을 쓰므로 국번이 같음 — 표기로 구분
  if (/^인천\s*제/.test(bench) || bench.indexOf('원외재판부') >= 0) return '서울고등법원(인천)';

  var m;
  PHONE_RE.lastIndex = 0;
  while ((m = PHONE_RE.exec(bench)) !== null) {
    var hit = COURT_BY_PREFIX[m[1]];
    if (hit) return hit;
  }
  return '';
}

/* ── 도구 ── */

// 열 번호를 정한다.
// 머리글이 있으면 이름으로 찾고(열이 밀려도 안전), 없으면 적어둔 번호를 쓴다.
//   '관할' 과 '관할경찰서', '사건번호' 와 '경찰사건번호' 가 헷갈리지 않도록
//   공백을 뺀 머리글이 정확히 일치할 때만 잡는다.
function resolveCleanCols_(sh, t) {
  var lastCol = sh.getLastColumn();
  var row = sh.getRange(t.headRow, 1, 1, lastCol).getValues()[0];
  var out = { court: 0, bench: 0, caseNo: 0 };

  for (var c = 0; c < row.length; c++) {
    var h = String(row[c] == null ? '' : row[c]).replace(/\s/g, '');
    if (!h) continue;
    if (!out.bench && h.indexOf('재판부') === 0) out.bench = c + 1;
    else if (!out.caseNo && h === '사건번호') out.caseNo = c + 1;
    else if (!out.court && h === '관할') out.court = c + 1;
  }
  return out;
}

// 열 번호 → 알파벳 (보고용).
// 서식 파일에도 같은 일을 하는 colLetter_ 가 있는데, Apps Script 는 파일끼리
// 전역 이름을 공유하므로 겹치지 않게 다른 이름을 쓴다.
function clLetter_(c) {
  var s = '';
  while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - m - 1) / 26; }
  return s;
}

function backupBeforeCleanup_() {
  var stamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  var name = '[백업] 사건정리 — ' + stamp + ' (관할정리 직전)';
  var folder;
  try {
    folder = (typeof backupFolder_ === 'function')
      ? backupFolder_()
      : DriveApp.createFolder('사건정리 백업');
  } catch (err) {
    folder = DriveApp.getRootFolder();
  }
  return DriveApp.getFileById(TARGET_SHEET_ID).makeCopy(name, folder).getUrl();
}

function currentUserSafe_() {
  try { return Session.getActiveUser().getEmail() || '(로그인 정보 없음)'; }
  catch (err) { return '(로그인 정보 없음)'; }
}

// 알림창은 글자 수 제한이 있어 앞부분만 띄우고, 전체는 실행 로그에서 봅니다
function alertLong_(text) {
  try {
    var t = text.length > 1200 ? text.substring(0, 1200) + '\n\n... 전체 내용은 아래 [실행 로그]에서 확인하세요' : text;
    SpreadsheetApp.getUi().alert(t);
  } catch (err) { /* 독립 프로젝트에서는 알림창이 없음 — 실행 로그로 확인 */ }
}
