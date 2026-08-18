/* 법무법인 정서 — 네이버웍스 메시지방 ↔ 사건정리 시트 매칭 (nw_match.gs)
   ───────────────────────────────────────────────────────────────
   「사건정리」 구글시트에 붙이는 Apps Script 모듈.
   메시지방(네이버웍스 대화방)과 시트의 사건을 대조해서
   ① 방은 있는데 시트에 없는 사건, ② 시트에는 있는데 방이 없는 사건을
   한 탭에서 바로 볼 수 있게 만든다.

   만들어지는 탭
     · 「방-사건 매칭」   결과 대시보드(자동 생성·자동 갱신, 직접 고치지 말 것)
     · 「메시지방 목록」  방 이름 원본(봇이 자동으로 채우거나, 직접 붙여넣어도 됨)

   갱신 시점
     · 시트를 고치면        → onChange 트리거(약 10초 debounce)
     · 방이 생기거나 없어지면 → 네이버웍스 봇 callback(doPost) → 즉시
     · 그 외 안전망          → 10분마다 시간 기반 트리거

   설치: 「🔗 방-사건 매칭」 메뉴 → 자동 갱신 켜기
   설정: 프로젝트 설정 → 스크립트 속성 (NW_* 5개, 자세한 건 설정가이드 참고)

   ※ 이 파일의 함수 이름은 전부 NWM_ 로 시작한다.
     기존 스크립트(기일가져오기·변경기록 등)와 절대 부딪히지 않게 하기 위함이다.
   ─────────────────────────────────────────────────────────────── */

/* ── 상수 ── */
var NWM_MATCH_SHEET = '방-사건 매칭';
var NWM_ROOMS_SHEET = '메시지방 목록';
/* 사건이 들어있지 않은 탭(대조 대상에서 제외) */
var NWM_SKIP_SHEETS = ['변경기록', '기록', '설정', NWM_MATCH_SHEET, NWM_ROOMS_SHEET];

var NWM_ROOMS_HEADER = ['방 이름', '방 ID(channelId)', '상태', '최근 확인', '출처', '메모'];
var NWM_COLS = 7;

var NWM_C = {
  ink:   '#1a2740',
  head:  '#eef1f6',
  red:   '#c0392b',
  amber: '#b06a00',
  green: '#1a7f3c',
  gray:  '#6b7280'
};

/* ══════════════════════════════════════════════════════════════
   메뉴 / 트리거
   ══════════════════════════════════════════════════════════════ */

/** 설치형 onOpen 트리거가 부르는 함수(기존 onOpen 과 부딪히지 않는다). */
function NWM_onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🔗 방-사건 매칭')
    .addItem('🔄 지금 새로고침', 'NWM_rebuild')
    .addItem('📡 네이버웍스에서 방 이름 갱신', 'NWM_refreshRoomsFromApi')
    .addSeparator()
    .addItem('⏱ 자동 갱신 켜기(트리거 설치)', 'NWM_installTriggers')
    .addItem('⏹ 자동 갱신 끄기', 'NWM_removeTriggers')
    .addSeparator()
    .addItem('⚙️ 연동 상태 확인', 'NWM_showStatus')
    .addToUi();
}

/** 자동 갱신에 필요한 트리거를 모두 설치한다(중복 설치해도 안전). */
function NWM_installTriggers() {
  NWM_removeTriggers();
  var ss = SpreadsheetApp.getActive();
  ScriptApp.newTrigger('NWM_onOpen').forSpreadsheet(ss).onOpen().create();
  ScriptApp.newTrigger('NWM_onChange').forSpreadsheet(ss).onChange().create();
  ScriptApp.newTrigger('NWM_tick').timeBased().everyMinutes(10).create();
  NWM_rebuild();
  NWM_toast_('자동 갱신을 켰습니다. 시트를 고치면 10초 안에 매칭 탭이 갱신됩니다.');
}

/** 이 모듈이 만든 트리거만 지운다(다른 스크립트 트리거는 건드리지 않는다). */
function NWM_removeTriggers() {
  var mine = ['NWM_onOpen', 'NWM_onChange', 'NWM_tick', 'NWM_rebuildDeferred'];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (mine.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  PropertiesService.getScriptProperties().deleteProperty('NWM_PENDING');
}

/** 시트가 바뀔 때마다 호출된다. 연속 편집은 한 번으로 묶는다. */
function NWM_onChange(e) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('NWM_WRITING') === '1') return;   // 우리가 쓰는 중이면 무시(무한루프 방지)
  NWM_scheduleRebuild_();
}

/** 10분마다: 방 이름을 다시 읽어오고 매칭을 새로 만든다. */
function NWM_tick() {
  if (NWM_isConfigured_()) {
    try { NWM_refreshRoomsFromApi_(true); } catch (err) { NWM_log_('방 이름 갱신 실패: ' + err); }
  }
  NWM_rebuild();
}

/** debounce — 연속 편집 중에는 예약만 해두고 10초 뒤 한 번만 돈다. */
function NWM_scheduleRebuild_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('NWM_PENDING') === '1') return;
  props.setProperty('NWM_PENDING', '1');
  ScriptApp.newTrigger('NWM_rebuildDeferred').timeBased().after(10 * 1000).create();
}

function NWM_rebuildDeferred() {
  PropertiesService.getScriptProperties().deleteProperty('NWM_PENDING');
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'NWM_rebuildDeferred') ScriptApp.deleteTrigger(t);
  });
  NWM_rebuild();
}

/* ══════════════════════════════════════════════════════════════
   사건 읽기 — 모든 사건 탭에서 성명·사건번호를 긁어온다
   ══════════════════════════════════════════════════════════════ */

/** 공백을 모두 없앤 비교용 문자열 */
function NWM_norm_(v) { return String(v == null ? '' : v).replace(/\s+/g, ''); }

/** 헤더 후보 중 정확히 일치하는 열을 먼저 찾고, 없으면 포함하는 열을 찾는다. */
function NWM_findCol_(hdr, cands) {
  var i, j;
  for (j = 0; j < cands.length; j++) {
    for (i = 0; i < hdr.length; i++) if (hdr[i] === cands[j]) return i;
  }
  for (j = 0; j < cands.length; j++) {
    for (i = 0; i < hdr.length; i++) if (hdr[i] && hdr[i].indexOf(cands[j]) >= 0) return i;
  }
  return -1;
}

/** 위쪽 몇 줄 안에서 '성명/이름' 또는 '사건번호'가 들어간 줄을 헤더로 본다. */
function NWM_findHeaderRow_(values) {
  var limit = Math.min(values.length, 12);
  for (var r = 0; r < limit; r++) {
    var row = values[r].map(NWM_norm_);
    var hasName = row.some(function (c) { return c.indexOf('성명') >= 0 || c === '이름'; });
    var hasNo = row.some(function (c) { return c.indexOf('사건번호') >= 0; });
    if (hasName || hasNo) return r;
  }
  return -1;
}

/** '강경아,정영식' · '이현우(이현우1)' · '김대진 外2' → 이름 조각들 */
function NWM_splitNames_(s) {
  return String(s == null ? '' : s)
    .replace(/外\s*\d*/g, ' ')
    .split(/[\n,、·/()（）\[\]]/)
    .map(function (t) { return t.replace(/\s+/g, ''); })
    .filter(function (t, i, a) {
      if (!t || t.length < 2) return false;
      if (/^[\d\-.\s]+$/.test(t)) return false;            // 주민번호·숫자만
      if (/^\d{6}[-]?\d{0,7}$/.test(t)) return false;
      return a.indexOf(t) === i;                            // 중복 제거
    });
}

/** '2026고합100177' → ['2026고합100177','26고합100177'] (방 이름이 두 자리 연도를 쓰는 경우 대비) */
function NWM_caseNoKeys_(s) {
  var t = NWM_norm_(s);
  if (!t) return [];
  var m = t.match(/(\d{2,4})\s*([가-힣]{1,4})\s*(\d+)/);
  if (!m) return t.length >= 4 ? [t] : [];
  var y = m[1].length === 4 ? m[1] : '20' + m[1];
  return [y + m[2] + m[3], y.slice(2) + m[2] + m[3]];
}

/** 사건 탭 전부를 훑어 사건 목록을 만든다. */
function NWM_readCases_(ss) {
  var out = [];
  ss.getSheets().forEach(function (sh) {
    var tab = sh.getName();
    if (NWM_SKIP_SHEETS.indexOf(tab) >= 0) return;
    if (sh.isSheetHidden()) return;
    if (sh.getLastRow() < 2) return;

    var values = sh.getDataRange().getDisplayValues();
    var hi = NWM_findHeaderRow_(values);
    if (hi < 0) return;

    var hdr = values[hi].map(NWM_norm_);
    var cName   = NWM_findCol_(hdr, ['성명', '이름', '피고인', '의뢰인']);
    var cNo     = NWM_findCol_(hdr, ['사건번호']);
    var cTitle  = NWM_findCol_(hdr, ['사건명']);
    var cStage  = NWM_findCol_(hdr, ['단계', '당사자지위', '지위']);
    var cDate   = NWM_findCol_(hdr, ['기일']);
    var cClosed = NWM_findCol_(hdr, ['종결']);
    if (cName < 0 && cNo < 0) return;

    var tabClosed = tab.indexOf('종결') >= 0;

    for (var r = hi + 1; r < values.length; r++) {
      var row = values[r];
      var nm = cName >= 0 ? String(row[cName] || '').trim() : '';
      var no = cNo   >= 0 ? String(row[cNo]   || '').trim() : '';
      if (!nm && !no) continue;

      var names = NWM_splitNames_(nm);
      var nos = NWM_caseNoKeys_(no);
      if (!names.length && !nos.length) continue;

      out.push({
        tab: tab,
        row: r + 1,
        name: nm,
        caseNo: no,
        title: cTitle >= 0 ? String(row[cTitle] || '') : '',
        stage: cStage >= 0 ? String(row[cStage] || '') : '',
        date:  cDate  >= 0 ? String(row[cDate]  || '') : '',
        closed: tabClosed || (cClosed >= 0 && String(row[cClosed]).toUpperCase() === 'TRUE'),
        names: names,
        nos: nos,
        rooms: []
      });
    }
  });
  return out;
}

/* ══════════════════════════════════════════════════════════════
   메시지방 목록 읽기 / 쓰기
   ══════════════════════════════════════════════════════════════ */

function NWM_roomsSheet_(ss) {
  var sh = ss.getSheetByName(NWM_ROOMS_SHEET);
  if (sh) return sh;
  sh = ss.insertSheet(NWM_ROOMS_SHEET);
  sh.getRange(1, 1, 1, NWM_ROOMS_HEADER.length).setValues([NWM_ROOMS_HEADER])
    .setFontWeight('bold').setBackground(NWM_C.head).setFontColor(NWM_C.ink);
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 320);
  sh.setColumnWidth(2, 260);
  sh.setColumnWidth(4, 150);
  sh.setColumnWidth(6, 260);
  sh.getRange('A2').setNote(
    '봇을 연동하면 이 목록은 자동으로 채워집니다.\n' +
    '연동 전에는 네이버웍스 대화방 이름을 A열에 한 줄씩 직접 붙여넣어도 됩니다.\n' +
    '사건방이 아닌 공지방·사무국방은 C열(상태)에 「제외」라고 적으면 대조에서 빠집니다.');
  return sh;
}

/** 메시지방 목록 → [{title, channelId, status, source, memo, row}] (나간 방 제외) */
function NWM_readRooms_(ss) {
  var sh = NWM_roomsSheet_(ss);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var v = sh.getRange(2, 1, last - 1, NWM_ROOMS_HEADER.length).getDisplayValues();
  var out = [];
  for (var i = 0; i < v.length; i++) {
    var title = String(v[i][0] || '').trim();
    var status = String(v[i][2] || '').trim();
    if (!title) continue;
    if (status === '나감' || status === '삭제' || status === '제외') continue;   // '제외' = 사건방 아님(공지방 등)
    out.push({
      title: title,
      channelId: String(v[i][1] || '').trim(),
      status: status || '사용중',
      source: String(v[i][4] || '').trim() || '수동',
      memo: String(v[i][5] || '').trim(),
      row: i + 2,
      cases: []
    });
  }
  return out;
}

/** channelId 기준으로 방 한 줄을 추가하거나 갱신한다. */
function NWM_upsertRoom_(ss, channelId, title, status, source) {
  var sh = NWM_roomsSheet_(ss);
  var last = sh.getLastRow();
  var ids = last >= 2 ? sh.getRange(2, 2, last - 1, 1).getDisplayValues() : [];
  var target = -1;
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0] || '').trim() === channelId) { target = i + 2; break; }
  }
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  if (target < 0) {
    sh.appendRow([title || '(이름 없음)', channelId, status || '사용중', stamp, source || '봇', '']);
  } else {
    if (title) sh.getRange(target, 1).setValue(title);
    sh.getRange(target, 3).setValue(status || '사용중');
    sh.getRange(target, 4).setValue(stamp);
    sh.getRange(target, 5).setValue(source || '봇');
  }
}

/* ══════════════════════════════════════════════════════════════
   매칭
   ══════════════════════════════════════════════════════════════ */

/**
 * 방 이름 안에 사건번호가 들어있으면 '사건번호', 성명이 들어있으면 '성명'으로 맞춘다.
 * 사건번호 일치가 더 강한 근거이므로, 같은 방에 둘 다 걸리면 사건번호 쪽만 남긴다.
 */
function NWM_match_(cases, rooms) {
  rooms.forEach(function (room) {
    var rt = NWM_norm_(room.title);
    var byNo = [], byName = [];
    cases.forEach(function (c) {
      var hitNo = c.nos.some(function (k) { return k && rt.indexOf(k) >= 0; });
      if (hitNo) { byNo.push({ c: c, how: '사건번호' }); return; }
      var hitName = c.names.some(function (n) { return rt.indexOf(n) >= 0; });
      if (hitName) byName.push({ c: c, how: '성명' });
    });
    var hits = byNo.length ? byNo : byName;
    hits.forEach(function (h) {
      room.cases.push(h);
      h.c.rooms.push({ room: room, how: h.how });
    });
  });
}

/* ══════════════════════════════════════════════════════════════
   대시보드 그리기
   ══════════════════════════════════════════════════════════════ */

function NWM_rebuild() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20 * 1000)) return;                  // 겹쳐 돌지 않게
  var props = PropertiesService.getScriptProperties();
  props.setProperty('NWM_WRITING', '1');
  try {
    var ss = SpreadsheetApp.getActive();
    var cases = NWM_readCases_(ss);
    var rooms = NWM_readRooms_(ss);
    NWM_match_(cases, rooms);
    NWM_render_(ss, cases, rooms);
  } finally {
    SpreadsheetApp.flush();
    props.deleteProperty('NWM_WRITING');
    lock.releaseLock();
  }
}

function NWM_render_(ss, cases, rooms) {
  var sh = ss.getSheetByName(NWM_MATCH_SHEET);
  if (!sh) {
    sh = ss.insertSheet(NWM_MATCH_SHEET, 0);
  } else {
    sh.clear();
    sh.clearNotes();
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart();   // 지난 번 병합 해제
    var bands = sh.getBandings();
    for (var b = 0; b < bands.length; b++) bands[b].remove();
  }

  var roomsOnly = rooms.filter(function (r) { return !r.cases.length; });
  var openCases = cases.filter(function (c) { return !c.closed; });
  var closedNoRoom = cases.filter(function (c) { return c.closed && !c.rooms.length; }).length;
  var sheetOnly = openCases.filter(function (c) { return !c.rooms.length; });
  var ambiguous = rooms.filter(function (r) { return r.cases.length > 1; });
  var matched = [];
  rooms.forEach(function (r) {
    if (r.cases.length === 1) matched.push({ room: r, c: r.cases[0].c, how: r.cases[0].how });
  });

  var rows = [];        // 2차원 값 배열
  var fmt = [];         // {row, kind, color} 서식 지시
  function blank() { rows.push(new Array(NWM_COLS).join(',').split(',').map(function () { return ''; })); }
  function put(arr) {
    var a = arr.slice(0, NWM_COLS);
    while (a.length < NWM_COLS) a.push('');
    rows.push(a);
    return rows.length;                                   // 1-based row index
  }
  function section(label, color) { fmt.push({ row: put([label]), kind: 'section', color: color }); }
  function thead(arr) { fmt.push({ row: put(arr), kind: 'thead' }); }

  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  fmt.push({ row: put(['🔗 메시지방 ↔ 사건 매칭 현황']), kind: 'title' });
  fmt.push({
    row: put([
      '최근 갱신 ' + stamp + '   ·   메시지방 ' + rooms.length + '개   ·   사건 ' + cases.length +
      '건(진행 ' + openCases.length + ')   ·   안 맞는 항목 ' + (roomsOnly.length + sheetOnly.length) + '건'
    ]),
    kind: 'sub'
  });
  blank();

  /* ① 방은 있는데 시트에 없는 사건 */
  section('🔴  메시지방만 있음 — 시트에 사건이 없습니다 (' + roomsOnly.length + '건)', NWM_C.red);
  if (roomsOnly.length) {
    thead(['방 이름', '방 ID', '상태', '출처', '메모', '', '']);
    roomsOnly.forEach(function (r) {
      put([r.title, r.channelId, r.status, r.source, r.memo, '', '']);
    });
  } else {
    fmt.push({ row: put(['— 없음 —']), kind: 'empty' });
  }
  blank();

  /* ② 시트에는 있는데 방이 없는 사건 */
  section('🟠  시트에만 있음 — 메시지방이 없습니다 (' + sheetOnly.length + '건)', NWM_C.amber);
  if (sheetOnly.length) {
    thead(['탭', '행', '성 명', '사건번호', '사건명', '단계/지위', '기일']);
    sheetOnly.forEach(function (c) {
      put([c.tab, c.row, c.name, c.caseNo, c.title, c.stage, c.date]);
    });
  } else {
    fmt.push({ row: put(['— 없음 —']), kind: 'empty' });
  }
  if (closedNoRoom) {
    fmt.push({ row: put(['※ 종결된 사건 ' + closedNoRoom + '건은 방이 없어도 정상이라 위 목록에서 뺐습니다.']), kind: 'note' });
  }
  blank();

  /* ③ 한 방에 사건이 여러 건 걸린 경우 */
  section('⚠️  확인 필요 — 한 방에 사건이 여러 건 걸립니다 (' + ambiguous.length + '건)', NWM_C.gray);
  if (ambiguous.length) {
    thead(['방 이름', '걸린 사건', '', '', '', '', '']);
    ambiguous.forEach(function (r) {
      var desc = r.cases.map(function (h) {
        return h.c.tab + ' ' + h.c.row + '행 ' + h.c.name + (h.c.caseNo ? ' / ' + h.c.caseNo : '');
      }).join('  |  ');
      put([r.title, desc, '', '', '', '', '']);
    });
  } else {
    fmt.push({ row: put(['— 없음 —']), kind: 'empty' });
  }
  blank();

  /* ④ 정상 매칭 */
  section('🟢  정상 매칭 (' + matched.length + '건)', NWM_C.green);
  if (matched.length) {
    thead(['방 이름', '탭', '행', '성 명', '사건번호', '매칭 근거', '']);
    matched.forEach(function (m) {
      put([m.room.title, m.c.tab, m.c.row, m.c.name, m.c.caseNo, m.how, '']);
    });
  } else {
    fmt.push({ row: put(['— 없음 —']), kind: 'empty' });
  }

  /* 한 번에 쓰기 */
  if (sh.getMaxRows() < rows.length) sh.insertRowsAfter(sh.getMaxRows(), rows.length - sh.getMaxRows());
  if (sh.getMaxColumns() < NWM_COLS) sh.insertColumnsAfter(sh.getMaxColumns(), NWM_COLS - sh.getMaxColumns());
  sh.getRange(1, 1, rows.length, NWM_COLS).setValues(rows);

  /* 서식 */
  sh.getRange(1, 1, Math.max(rows.length, 1), NWM_COLS)
    .setFontFamily('Arial').setFontSize(10).setVerticalAlignment('middle')
    .setBorder(false, false, false, false, false, false);

  fmt.forEach(function (f) {
    var r = sh.getRange(f.row, 1, 1, NWM_COLS);
    if (f.kind === 'title') {
      r.merge().setFontSize(16).setFontWeight('bold').setFontColor(NWM_C.ink);
      sh.setRowHeight(f.row, 34);
    } else if (f.kind === 'sub') {
      r.merge().setFontSize(10).setFontColor(NWM_C.gray);
    } else if (f.kind === 'section') {
      r.merge().setFontSize(12).setFontWeight('bold').setFontColor('#ffffff').setBackground(f.color);
      sh.setRowHeight(f.row, 28);
    } else if (f.kind === 'thead') {
      r.setFontWeight('bold').setBackground(NWM_C.head).setFontColor(NWM_C.ink);
    } else if (f.kind === 'empty' || f.kind === 'note') {
      r.merge().setFontColor(NWM_C.gray).setFontStyle('italic');
    }
  });

  sh.setFrozenRows(2);
  sh.setColumnWidth(1, 300);
  sh.setColumnWidth(2, 170);
  sh.setColumnWidth(3, 90);
  sh.setColumnWidth(4, 150);
  sh.setColumnWidth(5, 300);
  sh.setColumnWidth(6, 130);
  sh.setColumnWidth(7, 170);
  if (sh.getMaxRows() > rows.length + 1) {
    sh.deleteRows(rows.length + 2, sh.getMaxRows() - rows.length - 1);
  }
  if (sh.getMaxColumns() > NWM_COLS) {
    sh.deleteColumns(NWM_COLS + 1, sh.getMaxColumns() - NWM_COLS);
  }
  sh.getRange(1, 1, sh.getMaxRows(), NWM_COLS).setWrap(false);
  sh.setTabColor(roomsOnly.length + sheetOnly.length ? NWM_C.red : NWM_C.green);
}

/* ══════════════════════════════════════════════════════════════
   네이버웍스 연동
   ══════════════════════════════════════════════════════════════ */

function NWM_props_() { return PropertiesService.getScriptProperties(); }

function NWM_isConfigured_() {
  var p = NWM_props_();
  return !!(p.getProperty('NW_CLIENT_ID') && p.getProperty('NW_CLIENT_SECRET') &&
            p.getProperty('NW_SERVICE_ACCOUNT') && p.getProperty('NW_PRIVATE_KEY') &&
            p.getProperty('NW_BOT_ID'));
}

function NWM_b64url_(bytesOrString) {
  var b = typeof bytesOrString === 'string'
    ? Utilities.base64EncodeWebSafe(bytesOrString, Utilities.Charset.UTF_8)
    : Utilities.base64EncodeWebSafe(bytesOrString);
  return b.replace(/=+$/, '');
}

/** 서비스 계정(JWT) 방식으로 액세스 토큰을 받아 캐시한다. */
function NWM_accessToken_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('NWM_TOKEN');
  if (hit) return hit;

  var p = NWM_props_();
  var clientId = p.getProperty('NW_CLIENT_ID');
  var clientSecret = p.getProperty('NW_CLIENT_SECRET');
  var serviceAccount = p.getProperty('NW_SERVICE_ACCOUNT');
  var privateKey = String(p.getProperty('NW_PRIVATE_KEY') || '').replace(/\\n/g, '\n');
  if (!clientId || !clientSecret || !serviceAccount || !privateKey) {
    throw new Error('네이버웍스 설정(NW_CLIENT_ID / NW_CLIENT_SECRET / NW_SERVICE_ACCOUNT / NW_PRIVATE_KEY)이 비어 있습니다.');
  }

  var now = Math.floor(Date.now() / 1000);
  var signingInput = NWM_b64url_(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' +
                     NWM_b64url_(JSON.stringify({ iss: clientId, sub: serviceAccount, iat: now, exp: now + 3600 }));
  var assertion = signingInput + '.' +
                  NWM_b64url_(Utilities.computeRsaSha256Signature(signingInput, privateKey));

  var res = UrlFetchApp.fetch('https://auth.worksmobile.com/oauth2/v2.0/token', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded; charset=UTF-8',
    payload: {
      assertion: assertion,
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'bot bot.read'
    },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('토큰 발급 실패(' + res.getResponseCode() + '): ' + res.getContentText());
  }
  var json = JSON.parse(res.getContentText());
  var token = json.access_token;
  var ttl = Math.max(60, Math.min(Number(json.expires_in || 3600) - 120, 3000));
  cache.put('NWM_TOKEN', token, ttl);
  return token;
}

/** 방 상세 조회 → {channelId, title} (없어진 방이면 null) */
function NWM_apiChannel_(channelId) {
  var botId = NWM_props_().getProperty('NW_BOT_ID');
  var url = 'https://www.worksapis.com/v1.0/bots/' + encodeURIComponent(botId) +
            '/channels/' + encodeURIComponent(channelId);
  var res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + NWM_accessToken_() },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code === 404 || code === 403) return null;            // 봇이 나갔거나 방이 사라짐
  if (code !== 200) throw new Error('방 조회 실패(' + code + '): ' + res.getContentText());
  return JSON.parse(res.getContentText());
}

/** 메뉴에서 부르는 버전 — 알림까지 띄운다. */
function NWM_refreshRoomsFromApi() {
  if (!NWM_isConfigured_()) {
    SpreadsheetApp.getUi().alert(
      '네이버웍스 연동이 아직 설정되지 않았습니다.\n' +
      '연동 전에는 「' + NWM_ROOMS_SHEET + '」 탭 A열에 방 이름을 직접 적어두면 매칭은 그대로 됩니다.');
    return;
  }
  var n = NWM_refreshRoomsFromApi_(false);
  NWM_rebuild();
  NWM_toast_('방 ' + n + '개의 이름을 네이버웍스에서 다시 읽었습니다.');
}

/** 이미 알고 있는 channelId 들의 이름·존재 여부를 다시 확인한다. */
function NWM_refreshRoomsFromApi_(quiet) {
  var ss = SpreadsheetApp.getActive();
  var sh = NWM_roomsSheet_(ss);
  var last = sh.getLastRow();
  if (last < 2) return 0;

  var range = sh.getRange(2, 1, last - 1, NWM_ROOMS_HEADER.length);
  var v = range.getValues();
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  var touched = 0;

  for (var i = 0; i < v.length; i++) {
    var channelId = String(v[i][1] || '').trim();
    if (!channelId) continue;                               // 손으로 적은 방 이름은 그대로 둔다
    var info;
    try { info = NWM_apiChannel_(channelId); }
    catch (err) { if (!quiet) throw err; NWM_log_(String(err)); continue; }
    if (info === null) {
      v[i][2] = '나감';
    } else {
      if (info.title) v[i][0] = info.title;
      v[i][2] = '사용중';
    }
    v[i][3] = stamp;
    touched++;
  }
  range.setValues(v);
  return touched;
}

/* ── 봇 callback (Web App) ────────────────────────────────────
   네이버웍스 Developer Console 의 Bot > Callback URL 에
   이 프로젝트의 웹 앱 URL 을 등록한다. 뒤에 ?k=<NW_CALLBACK_KEY> 를 붙일 것.
   (Apps Script 웹 앱은 요청 헤더를 읽을 수 없어 서명 검증이 불가능하므로,
    URL 에 붙인 키로 대신 확인한다.)

   ※ 프로젝트에 이미 doPost 가 있다면 이 함수를 직접 등록하지 말고
     기존 doPost 안에서 return NWM_doPost(e); 로 넘겨주면 된다.
   ─────────────────────────────────────────────────────────── */
function NWM_doPost(e) {
  var ok = ContentService.createTextOutput('OK');
  try {
    var key = NWM_props_().getProperty('NW_CALLBACK_KEY');
    if (key && (!e || !e.parameter || e.parameter.k !== key)) return ok;

    var body = JSON.parse(e.postData.contents);
    var type = String(body.type || '');
    var channelId = body.source && body.source.channelId;
    if (!channelId) return ok;

    var ss = SpreadsheetApp.getActive();
    if (type === 'leave') {
      NWM_upsertRoom_(ss, channelId, '', '나감', '봇');
    } else if (type === 'join' || type === 'joined' || type === 'message' || type === 'left') {
      var title = '';
      try { var info = NWM_apiChannel_(channelId); if (info) title = info.title || ''; }
      catch (err) { NWM_log_('callback 방 조회 실패: ' + err); }
      NWM_upsertRoom_(ss, channelId, title, '사용중', '봇');
    } else {
      return ok;
    }
    NWM_scheduleRebuild_();
  } catch (err) {
    NWM_log_('doPost 오류: ' + err);
  }
  return ok;
}

/* ══════════════════════════════════════════════════════════════
   보조
   ══════════════════════════════════════════════════════════════ */

function NWM_showStatus() {
  var p = NWM_props_();
  var have = function (k) { return p.getProperty(k) ? '✅' : '❌'; };
  var triggers = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction().indexOf('NWM_') === 0;
  }).length;
  var ss = SpreadsheetApp.getActive();
  SpreadsheetApp.getUi().alert(
    '방-사건 매칭 상태\n\n' +
    '자동 갱신 트리거: ' + (triggers ? '켜짐(' + triggers + '개)' : '꺼짐') + '\n' +
    '메시지방 목록: ' + NWM_readRooms_(ss).length + '개\n' +
    '사건: ' + NWM_readCases_(ss).length + '건\n\n' +
    '네이버웍스 연동\n' +
    '  NW_CLIENT_ID ' + have('NW_CLIENT_ID') + '\n' +
    '  NW_CLIENT_SECRET ' + have('NW_CLIENT_SECRET') + '\n' +
    '  NW_SERVICE_ACCOUNT ' + have('NW_SERVICE_ACCOUNT') + '\n' +
    '  NW_PRIVATE_KEY ' + have('NW_PRIVATE_KEY') + '\n' +
    '  NW_BOT_ID ' + have('NW_BOT_ID') + '\n' +
    '  NW_CALLBACK_KEY ' + have('NW_CALLBACK_KEY') + '\n\n' +
    (NWM_isConfigured_() ? '연동 설정 완료.' : '연동 전에도 「' + NWM_ROOMS_SHEET + '」 탭에 방 이름을 직접 적으면 매칭됩니다.')
  );
}

function NWM_toast_(msg) {
  try { SpreadsheetApp.getActive().toast(msg, '방-사건 매칭', 6); } catch (err) {}
}

function NWM_log_(msg) {
  try { console.log('[NWM] ' + msg); } catch (err) {}
}
