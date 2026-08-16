/* 법무법인 정서 — 사건정리 시트: 기일 자동 채우기 (슈파베이스 → 시트)
   ───────────────────────────────────────────────────────────────
   [무엇을 하나]
     로웨어 사건정보가 올라가 있는 슈파베이스 cases 표에서 기일을 받아
     형사사건·항소사건 탭의 기일 칸을 채웁니다.

     맞추는 열쇠는 사건번호입니다.  시트 사건번호  ↔  cases.l_code

   [모양은 이미 맞습니다]
     슈파베이스  next_date '2026-08-26' + next_contents '공판기일(413호법정 10:30)'
     시트        2026-08-26 공판기일(413호법정 10:30)

     지금 시트에 적힌 것도 로웨어에서 같은 방식으로 옮겨 적은 것이라
     두 칸을 붙이면 그대로 이어집니다. 정렬도 그대로 맞습니다.

   [빈 값으로는 덮지 않습니다]
     다음 기일이 아직 안 잡힌 사건은 next_date 가 비어 있습니다 (전체의 20%).
     그런 사건은 시트 칸을 건드리지 않습니다. 빈 값으로 덮으면 적어 두신
     기일이 지워지기 때문입니다.

   [덮어쓴 값은 수정로그에 남습니다]
     기존 값이 있는데 로웨어 값과 다르면 로웨어 값으로 덮되,
     수정로그에 '기존 → 새 값' 이 한 줄씩 남습니다. 되찾을 수 있습니다.

   [설치]
     ① Apps Script 에서 [+] → 스크립트, 이름 '기일가져오기'
     ② 이 내용을 붙여넣기
     ③ 아래 HR_KEY 에 anon key 를 넣기 (Project Settings → API → anon public)
     ④ Ctrl+S

     service_role 키는 절대 넣지 마세요. 그건 모든 접근 제한을 무시합니다.

   [실행]  사건정리 → 기일 가져오기
     ① 접속 확인     제대로 연결되는지, 몇 건 받아오는지
     ② 미리보기      무엇이 채워지고 무엇이 덮이는지. 시트는 그대로
     ③ 실행          백업 → 채우기
     매일 아침 자동 켜기 / 끄기
   ─────────────────────────────────────────────────────────────── */

var HR_SHEET_ID = '1YCf77KxxotM4RnxePAhO16C7xbwEiHq4SuF5DN5vWto';

/* ── 슈파베이스 ── */
var HR_URL = 'https://nyjyemjsperpakrrgzcc.supabase.co';
var HR_KEY = '';                    // ← anon key 를 여기에 (service_role 아님)
var HR_TABLE = 'cases';

// cases 표의 칸 이름
var HR_COL = {
  code: 'l_code',                   // 사건번호  '2026고단101290'
  date: 'next_date',                // 기일 날짜  '2026-08-26'
  time: 'next_time',                // 기일 시각  '10:30'
  contents: 'next_contents',        // 종류+법정  '공판기일(413호법정 10:30)'
  updated: 'updated_at'             // 갱신시각
};

/* 채울 탭. form 은 날짜를 어떤 모양으로 쓸지입니다.
   지금 두 탭이 쓰던 모양을 그대로 씁니다. */
var HR_TABS = [
  { name: '형사사건', form: 'YYYY-MM-DD' },
  { name: '항소사건', form: 'YY.MM.DD' }
];

// 매일 아침 몇 시에 (24시간제)
var HR_HOUR = 7;

// 한 번에 받아올 줄 수 (봇과 같은 방식)
var HR_PAGE = 1000;

/* ══════════════════════════════════════════════════════════════
   실행
   ══════════════════════════════════════════════════════════════ */

function checkHearingSetup() { hrShow_(hrCheck_()); }

function previewHearings() { hrShow_(hrProcess_(true)); }

function runHearings() {
  var head;
  try {
    head = '백업 먼저 만들었습니다:\n' + hrBackup_('기일가져오기');
  } catch (err) {
    hrShow_('백업을 만들지 못해 아무것도 바꾸지 않았습니다.\n\n'
      + '이유: ' + hrMsg_(err) + '\n\n'
      + '드라이브 용량이 찼거나 권한이 없을 때 이렇게 됩니다.');
    return;
  }
  var body;
  try {
    body = hrProcess_(false);
  } catch (err) {
    hrShow_(head + '\n\n작업 중 오류가 나서 멈췄습니다.\n\n이유: ' + hrMsg_(err)
      + (err && err.stack ? '\n\n' + err.stack : ''));
    return;
  }
  hrShow_(head + '\n\n' + body);
}

/* 매일 아침 자동 — 미리보기 없이 도는 것이라 백업은 뜨지 않습니다.
   대신 바뀐 값이 전부 수정로그에 남습니다 (21:00 자동 백업도 따로 있습니다). */
function hearingDaily() {
  if (!HR_KEY) return;                       // 키가 비면 아무 일도 하지 않는다
  try { hrProcess_(false); } catch (err) { hrLog_(null, '기일 가져오기 실패 — ' + hrMsg_(err)); }
}

function setupHearingDaily() {
  removeHearingDaily();
  ScriptApp.newTrigger('hearingDaily').timeBased().atHour(HR_HOUR).nearMinute(40).everyDays(1).create();
  hrShow_('매일 아침 ' + HR_HOUR + '시경에 기일을 가져오도록 켰습니다.\n\n'
    + '바뀐 값은 수정로그에 남습니다.\n끄시려면 「매일 아침 자동 끄기」.');
}

function removeHearingDaily() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'hearingDaily') ScriptApp.deleteTrigger(t);
  });
}

/* ══════════════════════════════════════════════════════════════
   ① 접속 확인
   ══════════════════════════════════════════════════════════════ */

function hrCheck_() {
  var out = ['=== 슈파베이스 접속 확인 ==='];
  out.push('주소   ' + HR_URL);
  out.push('표     ' + HR_TABLE);

  if (!HR_KEY) {
    out.push('');
    out.push('!! anon key 가 비어 있습니다 !!');
    out.push('');
    out.push('슈파베이스 → Project Settings → API → anon public 을 복사해서');
    out.push('이 파일 맨 위 HR_KEY = \'\' 의 따옴표 사이에 넣고 Ctrl+S 하세요.');
    out.push('service_role 키는 넣지 마세요.');
    return out.join('\n');
  }

  var rows;
  try {
    rows = hrFetchAll_();
  } catch (err) {
    out.push('');
    out.push('!! 받아오지 못했습니다 !!');
    out.push('이유: ' + hrMsg_(err));
    out.push('');
    out.push('· 401 / JWT  → 키가 틀렸습니다');
    out.push('· 404        → 표 이름(' + HR_TABLE + ')이 틀렸습니다');
    out.push('· 그 밖      → 주소를 확인해 주세요');
    return out.join('\n');
  }

  var withDate = rows.filter(function (r) { return hrText_(r[HR_COL.date]); }).length;
  out.push('');
  out.push('받았습니다 — 모두 ' + rows.length + '건 · 기일 있는 것 ' + withDate + '건 ('
    + Math.round(withDate / Math.max(rows.length, 1) * 100) + '%)');

  if (!rows.length) return out.join('\n');

  // 칸 이름이 실제로 오는지
  var sample = rows[0];
  out.push('');
  out.push('■ 칸 확인');
  ['code', 'date', 'time', 'contents', 'updated'].forEach(function (k) {
    var name = HR_COL[k];
    var got = Object.prototype.hasOwnProperty.call(sample, name);
    out.push('   ' + (got ? 'OK ' : '!! ') + name
      + (got ? '   ' + hrText_(sample[name]).substring(0, 34) : '   ← 이 이름의 칸이 없습니다'));
  });

  // 기일이 있는 줄 하나를 예시로
  var ex = null;
  for (var i = 0; i < rows.length && !ex; i++) if (hrText_(rows[i][HR_COL.date])) ex = rows[i];
  if (ex) {
    out.push('');
    out.push('■ 시트에 이렇게 들어갑니다');
    HR_TABS.forEach(function (t) {
      out.push('   [' + t.name + ']  ' + hrText_(ex[HR_COL.code]) + '  →  ' + hrMake_(ex, t.form));
    });
  }

  out.push('');
  out.push('여기까지 됐으면 ② 미리보기 로 넘어가세요. 시트는 아직 그대로입니다.');
  return out.join('\n');
}

/* ══════════════════════════════════════════════════════════════
   ②③ 미리보기 · 실행
   ══════════════════════════════════════════════════════════════ */

function hrProcess_(dryRun) {
  var out = [];
  out.push(dryRun ? '=== 미리보기 (시트는 바뀌지 않았습니다) ===' : '=== 기일 가져오기 완료 ===');

  if (!HR_KEY) {
    out.push('');
    out.push('anon key 가 비어 있어 아무것도 하지 않았습니다.');
    out.push('① 접속 확인 을 눌러 안내를 보세요.');
    return out.join('\n');
  }

  var rows;
  try {
    rows = hrFetchAll_();
  } catch (err) {
    out.push('');
    out.push('슈파베이스에서 받아오지 못해 아무것도 바꾸지 않았습니다.');
    out.push('이유: ' + hrMsg_(err));
    return out.join('\n');
  }

  // 사건번호 → 줄. 같은 사건번호가 여럿이면 갱신시각이 최근인 것
  var byCode = {}, dup = 0;
  rows.forEach(function (r) {
    var code = hrNorm_(r[HR_COL.code]);
    if (!code) return;
    var old = byCode[code];
    if (!old) { byCode[code] = r; return; }
    dup++;
    if (hrText_(r[HR_COL.updated]) > hrText_(old[HR_COL.updated])) byCode[code] = r;
  });

  var withDate = rows.filter(function (r) { return hrText_(r[HR_COL.date]); }).length;
  out.push('슈파베이스 ' + rows.length + '건 · 기일 있는 것 ' + withDate + '건'
    + (dup ? ' · 사건번호가 겹친 줄 ' + dup + '건(최근 것만 씀)' : ''));

  var ss = SpreadsheetApp.openById(HR_SHEET_ID);
  var totalFill = 0, totalOver = 0, changes = [];

  HR_TABS.forEach(function (t) {
    var sh = ss.getSheetByName(t.name);
    if (!sh) { out.push(''); out.push('[' + t.name + '] 탭 없음 — 건너뜀'); return; }

    var head = hrHeadRow_(sh);
    var cols = Math.max(sh.getLastColumn(), 1);
    var headRow = sh.getRange(head, 1, 1, cols).getValues()[0];
    var codeCol = hrFind_(headRow, '사건번호');
    var dateCol = hrFind_(headRow, '기일');
    var nameCol = hrFind_(headRow, '성명') || hrFind_(headRow, '이름');
    if (!codeCol || !dateCol) {
      out.push(''); out.push('[' + t.name + '] 사건번호 또는 기일 열을 찾지 못함 — 건너뜀');
      return;
    }

    var last = hrLastRow_(sh, head, nameCol || codeCol);
    var n = last - head;
    if (n < 1) { out.push(''); out.push('[' + t.name + '] 데이터 없음'); return; }

    var codes = sh.getRange(head + 1, codeCol, n, 1).getValues();
    var dates = sh.getRange(head + 1, dateCol, n, 1).getValues();
    var names = nameCol ? sh.getRange(head + 1, nameCol, n, 1).getValues() : null;

    var next = [], fill = 0, over = 0, miss = [], noDate = 0, same = 0, blank = 0;

    for (var i = 0; i < n; i++) {
      var cur = dates[i][0];
      var code = hrNorm_(codes[i][0]);
      if (!code) { next.push([cur]); blank++; continue; }

      var rec = byCode[code];
      if (!rec) {
        next.push([cur]);
        if (miss.length < 40) {
          miss.push((head + 1 + i) + '행  ' + code
            + (names ? '  ' + hrText_(names[i][0]).replace(/\s+/g, ' ') : ''));
        }
        continue;
      }

      var made = hrMake_(rec, t.form);
      if (!made) { next.push([cur]); noDate++; continue; }   // 로웨어에 기일 없음 — 안 건드림

      var curFlat = hrText_(cur).replace(/\s+/g, ' ').trim();
      if (curFlat === made) { next.push([cur]); same++; continue; }

      next.push([made]);
      if (!curFlat) {
        fill++;
      } else {
        over++;
        changes.push({ tab: t.name, cell: hrL_(dateCol) + (head + 1 + i),
          name: names ? hrText_(names[i][0]).replace(/\s+/g, ' ').trim() : code,
          from: curFlat, to: made });
      }
    }

    out.push('');
    out.push('[' + t.name + '] ' + n + '건');
    out.push('   빈 칸 채우기      ' + fill + '건');
    out.push('   덮어쓰기          ' + over + '건');
    out.push('   이미 같음          ' + same + '건');
    out.push('   로웨어에 기일 없음  ' + noDate + '건  (안 건드립니다)');
    out.push('   사건번호로 못 찾음  ' + miss.length + '건');
    if (blank) out.push('   사건번호가 빈 줄    ' + blank + '건');

    if (miss.length) {
      out.push('');
      out.push('   ■ 슈파베이스에서 못 찾은 사건번호');
      miss.slice(0, 15).forEach(function (s) { out.push('      ' + s); });
      if (miss.length > 15) out.push('      ... 외 ' + (miss.length - 15) + '건');
    }

    totalFill += fill;
    totalOver += over;

    if (!dryRun && (fill || over)) {
      sh.getRange(head + 1, dateCol, n, 1).setValues(next);
    }
  });

  if (changes.length) {
    out.push('');
    out.push('■ 덮어쓸 줄 ' + changes.length + '건 — 기존 값은 수정로그에 남습니다');
    changes.slice(0, 20).forEach(function (c) {
      out.push('   [' + c.tab + '] ' + c.cell + '  ' + c.name);
      out.push('      ' + c.from.substring(0, 46));
      out.push('      →  ' + c.to.substring(0, 46));
    });
    if (changes.length > 20) out.push('   ... 외 ' + (changes.length - 20) + '건');
  }

  if (dryRun) {
    out.push('');
    out.push('빈 칸 ' + totalFill + '건을 채우고 ' + totalOver + '건을 덮습니다.');
    out.push('실제로 하려면 ③ 실행 을 누르세요.');
    return out.join('\n');
  }

  // 덮어쓴 값을 한 줄씩 로그에 남긴다
  changes.forEach(function (c) {
    hrLog_(ss, '기일 ' + c.tab + ' ' + c.cell + ' ' + c.name
      + ' — ' + c.from.substring(0, 60) + '  →  ' + c.to.substring(0, 60));
  });
  hrLog_(ss, '기일 가져오기 — 빈 칸 ' + totalFill + '건 채움 · ' + totalOver + '건 덮어씀');

  out.push('');
  out.push('빈 칸 ' + totalFill + '건을 채우고 ' + totalOver + '건을 덮었습니다.');
  if (totalOver) out.push('덮어쓴 값은 수정로그에서 되찾으실 수 있습니다.');
  return out.join('\n');
}

/* ══════════════════════════════════════════════════════════════
   슈파베이스
   ══════════════════════════════════════════════════════════════ */

/* cases 를 전부 받아온다.

   사건번호를 URL 에 넣어 물어보는 방법도 있지만, 전체가 900건 남짓이라
   그냥 다 받는 편이 낫다. 한글이 URL 에 안 들어가니 인코딩 사고도 없고
   길이 제한도 없다. 봇(load_cases)이 쓰는 방식과 같다. */
function hrFetchAll_() {
  var want = [HR_COL.code, HR_COL.date, HR_COL.time, HR_COL.contents, HR_COL.updated].join(',');
  var all = [], offset = 0;

  for (var guard = 0; guard < 50; guard++) {
    var url = HR_URL.replace(/\/+$/, '') + '/rest/v1/' + HR_TABLE
      + '?select=' + encodeURIComponent(want)
      + '&limit=' + HR_PAGE + '&offset=' + offset;

    var res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { apikey: HR_KEY, Authorization: 'Bearer ' + HR_KEY },
      muteHttpExceptions: true
    });

    var code = res.getResponseCode();
    if (code !== 200) {
      throw new Error('HTTP ' + code + ' — ' + res.getContentText().substring(0, 200));
    }

    var body = JSON.parse(res.getContentText());
    all = all.concat(body);
    if (body.length < HR_PAGE) return all;
    offset += HR_PAGE;
  }
  return all;
}

/* 슈파베이스 한 줄 → 시트에 넣을 글.
   기일 날짜가 없으면 아무것도 돌려주지 않는다 (그 칸은 건드리지 않는다). */
function hrMake_(rec, form) {
  var d = hrText_(rec[HR_COL.date]).trim();
  if (!d) return '';

  var m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  var head = (form === 'YY.MM.DD')
    ? m[1].slice(2) + '.' + m[2] + '.' + m[3]
    : m[1] + '-' + m[2] + '-' + m[3];

  // 종류+법정+시각이 한 덩어리로 들어 있다 — 그대로 쓴다
  var tail = hrText_(rec[HR_COL.contents]).replace(/\s+/g, ' ').trim();
  if (!tail) tail = hrText_(rec[HR_COL.time]).trim();      // 없으면 시각만

  return tail ? head + ' ' + tail : head;
}

/* ══════════════════════════════════════════════════════════════
   도구
   ══════════════════════════════════════════════════════════════ */

// 머리글 줄 — '성명' 또는 '이름'이 적힌 줄. 못 찾으면 1행
function hrHeadRow_(sh) {
  var probe = Math.min(5, sh.getLastRow());
  var lastCol = Math.max(sh.getLastColumn(), 1);
  if (probe < 1) return 1;
  var vals = sh.getRange(1, 1, probe, lastCol).getValues();
  for (var r = 0; r < probe; r++) {
    for (var c = 0; c < lastCol; c++) {
      var h = hrNorm_(vals[r][c]);
      if (h.indexOf('성명') === 0 || h.indexOf('이름') === 0) return r + 1;
    }
  }
  return 1;
}

/* 머리글 이름으로 열 찾기.
   딱 맞는 이름을 먼저 본다 — '사건번호' 를 찾을 때 '1심사건번호' 가
   걸리면 안 되기 때문이다. */
function hrFind_(headRow, key) {
  var c, h;
  for (c = 0; c < headRow.length; c++) if (hrNorm_(headRow[c]) === key) return c + 1;
  for (c = 0; c < headRow.length; c++) {
    h = hrNorm_(headRow[c]);
    if (h && h.indexOf(key) === 0) return c + 1;
  }
  return 0;
}

function hrLastRow_(sh, head, col) {
  var last = sh.getLastRow();
  if (last <= head) return head;
  var v = sh.getRange(head + 1, col, last - head, 1).getValues();
  for (var i = v.length - 1; i >= 0; i--) {
    if (hrText_(v[i][0]).trim()) return head + 1 + i;
  }
  return head;
}

/* 날짜가 오면 글자로 바꿔 준다 (슈파베이스는 글로 주지만 시트는 날짜일 수 있다) */
function hrText_(v) {
  if (v == null) return '';
  if (v instanceof Date) {
    return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd HH:mm').replace(' 00:00', '');
  }
  return String(v);
}

function hrNorm_(v) {
  return hrText_(v).replace(/\s/g, '');
}

function hrL_(c) {
  var s = '';
  while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - m - 1) / 26; }
  return s;
}

function hrMsg_(err) {
  return (err && err.message) ? err.message : String(err);
}

function hrBackup_(what) {
  var stamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  var name = '[백업] 사건정리 — ' + stamp + ' (' + what + ' 직전)';
  var folder;
  try {
    folder = (typeof backupFolder_ === 'function') ? backupFolder_() : DriveApp.createFolder('사건정리 백업');
  } catch (err) {
    folder = DriveApp.getRootFolder();
  }
  return DriveApp.getFileById(HR_SHEET_ID).makeCopy(name, folder).getUrl();
}

function hrLog_(ss, msg) {
  try {
    if (typeof append_ !== 'function') return;
    if (!ss) ss = SpreadsheetApp.openById(HR_SHEET_ID);
    var who = '(로그인 정보 없음)';
    try { who = Session.getActiveUser().getEmail() || who; } catch (e) { }
    append_(ss, who, '-', '-', '', msg, '기일가져오기');
  } catch (err) { /* 수정로그 스크립트가 없으면 넘어감 */ }
}

function hrShow_(text) {
  Logger.log(text);
  if (typeof uiShow_ === 'function') { uiShow_(text); return; }
  try {
    var t = text.length > 1200 ? text.substring(0, 1200) + '\n\n... 전체는 실행 로그에서' : text;
    SpreadsheetApp.getUi().alert(t);
  } catch (err) { /* 창을 못 띄우면 로그로 */ }
}
