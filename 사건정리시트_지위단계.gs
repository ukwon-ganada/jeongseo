/* 법무법인 정서 — 사건정리 시트: 당사자 지위 + 진행단계
   ───────────────────────────────────────────────────────────────
   [왜 필요한가]
     피의자·피고인은 고정된 값이 아닙니다. 기소 전에는 피의자,
     기소되어 재판으로 넘어가면 피고인입니다.
     반면 고소인·피해자·피고소인·피고발인은 단계와 무관합니다.

     그래서 지위를 그냥 적어두면 곧 틀린 값이 됩니다.
     실제로 지금 피의자로 적혀 있는데 이미 재판단계인 사건이 4건 있습니다.

   [무엇을 하나]
     성명 오른쪽에 [지위] [단계] 두 칸을 만들고,
     단계가 바뀌면 지위가 따라 바뀌게 합니다.

       C 성 명   D 지위     E 단계
       김한곤    고소인    ①경찰
       박큰별    피의자    ②검찰
       천준명    피고인    ③재판

     단계 칸에만 색을 넣습니다. 나머지 표는 무채색 그대로 둡니다 —
     색이 한 군데만 있어야 눈이 거기로 갑니다.
     번호를 붙였으므로 정렬하면 ①경찰 → ②검찰 → ③재판 순서로 모입니다.

   [단계는 이렇게 판정합니다]
     칸이 비었는지가 아니라 무엇이 들어있는지를 봅니다.
     재판부 칸에 수사관 이름이 들어 있는 등 예외가 많기 때문입니다.

       ③재판  사건번호가 법원 번호(고합·고단·고정·고약·노·도·초재 등)
               또는 관할이 …법원/…지원   또는 재판부가 …단독/…형사부
       ②검찰  형제번호·관할검찰청·검사 칸에 값
               또는 사건번호가 …불제      또는 관할이 검찰청·지검·지청
       ①경찰  관할경찰서·경찰사건번호·담당수사관 칸에 값

   [설치]
     Apps Script 왼쪽 [파일] 옆 + → [스크립트] → 이름을 지위단계 로 하고
     이 파일 전체를 붙여넣기 → 저장(Ctrl+S)
     ※ 예전에 만든 '지위' 파일이 있으면 그건 지워주세요. 이 파일이 대신합니다.

   [실행 순서]  반드시 이 순서로
     1) previewMoveInvestigators → runMoveInvestigators
          재판부 칸에 잘못 들어간 수사관 이름을 담당수사관 칸으로 옮깁니다.
          단계 판정은 이걸 건너뛰어도 정확합니다(재판부가 아닌 값은 어차피
          무시합니다). 값을 제자리에 두기 위한 정리 작업입니다.
     2) previewParty → runParty
          지위·단계 두 칸을 만들고 채웁니다.
     3) setupStageAutoUpdate
          이후로는 사건번호나 재판부를 입력하는 순간
          그 행의 단계와 지위가 저절로 맞춰집니다.

   [그 밖의 명령]
     refreshStages           전체를 다시 계산 (여러 행을 한꺼번에 붙여넣은 뒤)
     removeStageAutoUpdate   자동 갱신 중지
   ─────────────────────────────────────────────────────────────── */

var PT_SHEET_ID = '1YCf77KxxotM4RnxePAhO16C7xbwEiHq4SuF5DN5vWto';
var PT_TAB = '형사사건';

/* 머리글 줄과 데이터 시작 줄은 고정하지 않고 그때그때 찾습니다.
   예전에는 '머리글은 3행'으로 못박아 두었는데, 머리글이 1행으로 올라가자
   머리글을 데이터로 착각했습니다. 이제 '성명'이 적힌 줄을 찾아 씁니다. */
var PT_HEADER_ROW = 0;   // ptSetRows_() 가 채웁니다
var PT_FIRST_ROW = 0;

var PT_HEAD_ROLE = '지위';
var PT_HEAD_STAGE = '단계';
var PT_W_ROLE = 90;
var PT_W_STAGE = 80;

/* 단계 — 번호를 붙여야 정렬했을 때 절차 순서대로 모입니다 */
var STAGE_POLICE = '①경찰';
var STAGE_PROS = '②검찰';
var STAGE_TRIAL = '③재판';
var STAGES = [
  { label: STAGE_POLICE, bg: '#eceff1', fg: '#37474f' },
  { label: STAGE_PROS, bg: '#e1f0fa', fg: '#0b4f6c' },
  { label: STAGE_TRIAL, bg: '#fce8e6', fg: '#b3261e' }
];

// 지위 목록 — 여기만 고치시면 드롭다운이 바뀝니다
var PARTY_ROLES = [
  '피고인', '피의자', '고소인', '피해자', '피고소인', '피고발인',
  '고발인', '신청인', '참고인', '증인', '행위자', '보호소년'
];
var ALLOW_OTHER = true;                       // 목록 밖 값도 입력 가능 (작은 경고만)
var ROLE_ALIAS = { '피고인2': '피고인' };      // 표기가 다른 것을 표준 이름으로

/* 판정에 쓰는 무늬 */
var RE_COURT_NO = /\d{4}\s*(고합|고단|고정|고약|노|도|초재|재고단|전고단)\s*\d/;
var RE_SPECIAL_NO = /\d{4}\s*(동버|푸|서|모)\s*\d/;   // 소년보호·가정보호 등 특수절차
var RE_PROS_NO = /\d{4}\s*(형제|불제)\s*\d/;
var RE_COURT_NAME = /(법원|지원|고법)/;
var RE_PROS_NAME = /(검찰청|지검|지청)/;
var RE_BENCH = /(단독|형사부|합의부|재판부|제\s*\d)/;

/* ══════════════════════════════════════════════════════════════
   ① 재판부 칸의 수사관 이름을 담당수사관 칸으로
   ══════════════════════════════════════════════════════════════ */

function previewMoveInvestigators() { ptShow_(ptMove_(true)); }

function runMoveInvestigators() {
  var backup = ptBackup_('수사관이동');
  ptShow_('백업 먼저 만들었습니다:\n' + backup + '\n\n' + ptMove_(false));
}

function ptMove_(dryRun) {
  var ss = SpreadsheetApp.openById(PT_SHEET_ID);
  var sh = ss.getSheetByName(PT_TAB);
  if (!sh) return '[' + PT_TAB + '] 탭을 찾지 못했습니다.';
  if (!ptSetRows_(sh)) return '머리글 줄을 찾지 못했습니다 (성명 열이 있는지 확인해 주세요).';

  var c = ptCols_(sh);
  if (!c.bench || !c.officer) {
    return '재판부 또는 담당수사관 열을 찾지 못했습니다 (재판부='
      + ptL_(c.bench) + ' 담당수사관=' + ptL_(c.officer) + ').';
  }
  var last = ptLastRow_(sh, c.name);
  if (last < PT_FIRST_ROW) return '데이터가 없습니다.';
  var n = last - PT_FIRST_ROW + 1;

  var bench = sh.getRange(PT_FIRST_ROW, c.bench, n, 1).getValues();
  var officer = sh.getRange(PT_FIRST_ROW, c.officer, n, 1).getValues();

  var move = [], vague = [], clash = [], stay = 0;

  for (var i = 0; i < n; i++) {
    var b = String(bench[i][0] == null ? '' : bench[i][0]).replace(/\n/g, ' ').trim();
    if (!b) continue;
    if (RE_BENCH.test(b)) { stay++; continue; }          // 진짜 재판부는 그대로

    var row = PT_FIRST_ROW + i;
    var h = String(officer[i][0] == null ? '' : officer[i][0]).trim();
    move.push({ i: i, row: row, text: b, prev: h });
    if (h) clash.push(row + '행');
    // 직함이 없어 수사관인지 단정할 수 없는 것
    if (!/(수사관|경위|경감|경사|경장|형사|팀)/.test(b)) vague.push(row + '행 「' + b + '」');
  }

  var out = [];
  out.push(dryRun ? '=== 미리보기 (시트는 바뀌지 않았습니다) ===' : '=== 이동 완료 ===');
  out.push('[' + PT_TAB + '] 재판부 ' + ptL_(c.bench) + ' → 담당수사관 ' + ptL_(c.officer));
  out.push('');
  out.push('옮길 값        ' + move.length + '건');
  out.push('재판부라 그대로 ' + stay + '건');
  out.push('담당수사관 칸에 이미 값이 있어 아래 줄에 붙일 행  ' + clash.length + '건'
    + (clash.length ? '  (' + clash.join(', ') + ')' : ''));
  move.slice(0, 25).forEach(function (m) { out.push('   ' + m.row + '행  ' + m.text.substring(0, 30)); });
  if (move.length > 25) out.push('   ... 외 ' + (move.length - 25) + '건');
  if (vague.length) {
    out.push('');
    out.push('직함이 없어 수사관인지 단정할 수 없는 값 ' + vague.length + '건 — 옮기되 확인해 주세요');
    vague.forEach(function (s) { out.push('   ' + s); });
  }

  if (dryRun) {
    out.push('');
    out.push('실제로 옮기려면 runMoveInvestigators 를 실행하세요.');
    return out.join('\n');
  }

  move.forEach(function (m) {
    officer[m.i][0] = m.prev ? m.prev + '\n' + m.text : m.text;
    bench[m.i][0] = '';
  });
  sh.getRange(PT_FIRST_ROW, c.bench, n, 1).setValues(bench);
  sh.getRange(PT_FIRST_ROW, c.officer, n, 1).setValues(officer);

  ptLog_(ss, '재판부 칸의 수사관 이름 ' + move.length + '건을 담당수사관으로 이동');
  return out.join('\n');
}

/* ══════════════════════════════════════════════════════════════
   ② 지위·단계 열 만들기
   ══════════════════════════════════════════════════════════════ */

function previewParty() { ptShow_(ptParty_(true)); }

function runParty() {
  var backup = ptBackup_('지위단계');
  ptShow_('백업 먼저 만들었습니다:\n' + backup + '\n\n' + ptParty_(false));
}

function ptParty_(dryRun) {
  var ss = SpreadsheetApp.openById(PT_SHEET_ID);
  var sh = ss.getSheetByName(PT_TAB);
  if (!sh) return '[' + PT_TAB + '] 탭을 찾지 못했습니다.';
  if (!ptSetRows_(sh)) return '머리글 줄을 찾지 못했습니다 (성명 열이 있는지 확인해 주세요).';

  var c = ptCols_(sh);
  if (!c.name) return '성명 열을 찾지 못했습니다. ' + PT_HEADER_ROW + '행 머리글을 확인해 주세요.';

  var last = ptLastRow_(sh, c.name);
  if (last < PT_FIRST_ROW) return '데이터가 없습니다.';
  var n = last - PT_FIRST_ROW + 1;

  // 판정에 쓸 값을 미리 읽는다 (열을 넣으면 번호가 밀리므로 삽입 전에 읽어야 한다)
  var raw = ptRead_(sh, c, PT_FIRST_ROW, n);

  var names = [], roles = [], stages = [];
  var roleCnt = {}, stageCnt = {};
  var blank = [], skipped = [], mismatch = [], converted = [], held = [], oddPd = [];
  var kept = 0, samples = [];

  for (var i = 0; i < n; i++) {
    var row = PT_FIRST_ROW + i;
    var flat = String(raw.name[i] == null ? '' : raw.name[i]).replace(/\s+/g, ' ').trim();
    var stage = ptStageOf_(raw, i);

    if (!flat) { names.push(['']); roles.push(['']); stages.push([stage]); continue; }

    var name = flat, found = '', role = String(raw.role[i] || '').trim();

    if (role) {
      // 이미 지위가 채워진 행 — 이름은 그대로, 지위는 유지
      kept++;
    } else {
      var m = flat.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
      if (!m) {
        blank.push(row + '행 ' + flat);
        names.push([flat]); roles.push(['']); stages.push([stage]);
        if (stage) stageCnt[stage] = (stageCnt[stage] || 0) + 1;
        continue;
      }
      name = m[1].trim();
      found = m[2].trim();
      role = ROLE_ALIAS[found] || found;

      if (PARTY_ROLES.indexOf(role) < 0) {
        skipped.push(row + '행  ' + flat + '   → 떼어낸 값 「' + found + '」 가 목록에 없음');
        names.push([flat]); roles.push(['']); stages.push([stage]);
        if (stage) stageCnt[stage] = (stageCnt[stage] || 0) + 1;
        continue;
      }
      if ((name + '(' + found + ')').replace(/\s/g, '') !== flat.replace(/\s/g, '')) {
        mismatch.push(row + '행  원본 「' + flat + '」 → 이름 「' + name + '」 지위 「' + found + '」');
      }
    }

    // 단계에 맞춰 지위를 조정
    var adj = ptRoleForStage_(role, stage, String(raw.caseNo[i] || ''));
    if (adj.changed) converted.push(row + '행  ' + name + '  피의자 → 피고인   근거 ' + adj.why);
    if (adj.hold) held.push(row + '행  ' + name + '  ' + adj.why + ' — 특수절차라 그대로 둡니다');
    if (adj.odd) oddPd.push(row + '행  ' + name + '  피고인인데 단계가 ' + (stage || '미정'));
    role = adj.role;

    names.push([name]);
    roles.push([role]);
    stages.push([stage]);
    roleCnt[role] = (roleCnt[role] || 0) + 1;
    if (stage) stageCnt[stage] = (stageCnt[stage] || 0) + 1;
    if (samples.length < 6) samples.push(row + '행  ' + name + '  |  ' + role + '  |  ' + (stage || '미정'));
  }

  var out = [];
  out.push(dryRun ? '=== 미리보기 (시트는 바뀌지 않았습니다) ===' : '=== 적용 완료 ===');
  out.push('[' + PT_TAB + '] ' + PT_FIRST_ROW + '~' + last + '행 · ' + n + '건');
  out.push('성명 ' + ptL_(c.name) + ' → 지위 ' + ptL_(c.name + 1) + ' · 단계 ' + ptL_(c.name + 2)
    + (c.role && c.stage ? '' : '  (새로 만듭니다)'));
  out.push('');
  out.push('■ 단계');
  [STAGE_POLICE, STAGE_PROS, STAGE_TRIAL].forEach(function (s) {
    out.push('   ' + s + '  ' + (stageCnt[s] || 0) + '건');
  });
  out.push('   미정   ' + (n - (stageCnt[STAGE_POLICE] || 0) - (stageCnt[STAGE_PROS] || 0) - (stageCnt[STAGE_TRIAL] || 0)) + '건');
  out.push('');
  out.push('■ 지위');
  Object.keys(roleCnt).sort(function (a, b) { return roleCnt[b] - roleCnt[a]; })
    .forEach(function (k) { out.push('   ' + k + '  ' + roleCnt[k] + '건'); });
  if (kept) out.push('   (이미 채워져 있어 그대로 둔 행 ' + kept + '건)');
  out.push('   지위 표기 없음  ' + blank.length + '건');
  out.push('   목록 밖이라 건너뜀  ' + skipped.length + '건');

  if (converted.length) {
    out.push('');
    out.push('■ 단계에 맞춰 지위를 바꾼 행 ' + converted.length + '건');
    converted.forEach(function (s) { out.push('   ' + s); });
  }
  if (held.length) {
    out.push('');
    out.push('■ 특수절차라 바꾸지 않은 행 ' + held.length + '건');
    held.forEach(function (s) { out.push('   ' + s); });
  }
  if (oddPd.length) {
    out.push('');
    out.push('■ 피고인인데 재판단계가 아닌 행 ' + oddPd.length + '건 — 손대지 않았습니다. 확인해 주세요');
    oddPd.forEach(function (s) { out.push('   ' + s); });
  }
  if (samples.length) {
    out.push('');
    out.push('■ 표본');
    samples.forEach(function (s) { out.push('   ' + s); });
  }
  if (blank.length) {
    out.push('');
    out.push('지위 표기가 없어 빈칸으로 두는 행');
    blank.slice(0, 12).forEach(function (s) { out.push('   ' + s); });
    if (blank.length > 12) out.push('   ... 외 ' + (blank.length - 12) + '건');
  }
  if (skipped.length) {
    out.push('');
    out.push('!! 목록에 없는 값이라 건드리지 않은 행');
    skipped.forEach(function (s) { out.push('   ' + s); });
  }
  if (mismatch.length) {
    out.push('');
    out.push('!! 되돌려 붙였을 때 원본과 다른 행 !!');
    mismatch.forEach(function (s) { out.push('   ' + s); });
  }

  if (dryRun) {
    out.push('');
    out.push('실제로 만들려면 runParty 를 실행하세요.');
    return out.join('\n');
  }

  if (mismatch.length) {
    out.push('');
    out.push('대조에 실패한 행이 있어 아무것도 바꾸지 않았습니다.');
    return out.join('\n');
  }

  /* ── 실제 변경 ── */

  var need = (c.role ? 0 : 1) + (c.stage ? 0 : 1);
  if (need) sh.insertColumnsAfter(c.name + (c.role ? 1 : 0), need);

  var roleCol = c.name + 1, stageCol = c.name + 2;
  sh.getRange(PT_HEADER_ROW, roleCol).setValue(PT_HEAD_ROLE);
  sh.getRange(PT_HEADER_ROW, stageCol).setValue(PT_HEAD_STAGE);

  sh.getRange(PT_FIRST_ROW, c.name, n, 1).setValues(names);
  sh.getRange(PT_FIRST_ROW, roleCol, n, 1).setValues(roles);
  sh.getRange(PT_FIRST_ROW, stageCol, n, 1).setValues(stages);

  // 지위 드롭다운 — 클릭해서 고르기 + 타이핑하면 좁혀지기가 함께 됩니다
  sh.getRange(PT_FIRST_ROW, roleCol, n, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(PARTY_ROLES, true).setAllowInvalid(ALLOW_OTHER)
      .setHelpText('당사자 지위를 고르거나 직접 입력하세요.').build());

  // 단계 드롭다운 — 손으로 바로잡고 싶을 때를 위해
  sh.getRange(PT_FIRST_ROW, stageCol, n, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList([STAGE_POLICE, STAGE_PROS, STAGE_TRIAL], true).setAllowInvalid(true)
      .setHelpText('보통은 저절로 채워집니다. 필요하면 직접 고치셔도 됩니다.').build());

  sh.setColumnWidth(roleCol, PT_W_ROLE);
  sh.setColumnWidth(stageCol, PT_W_STAGE);
  sh.getRange(PT_FIRST_ROW, roleCol, n, 2)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');

  ptStageColors_(sh, stageCol, PT_FIRST_ROW, n);

  out.push('');
  out.push('재조합 대조 — ' + n + '건 모두 일치');
  ptLog_(ss, '지위·단계 열 생성 (지위 전환 ' + converted.length + '건)');
  return out.join('\n');
}

/* ══════════════════════════════════════════════════════════════
   ③ 입력하면 즉시 갱신
   ══════════════════════════════════════════════════════════════ */

function setupStageAutoUpdate() {
  var ss = SpreadsheetApp.openById(PT_SHEET_ID);
  removeStageAutoUpdate();
  ScriptApp.newTrigger('onStageEdit').forSpreadsheet(ss).onEdit().create();
  ptShow_('자동 갱신을 켰습니다.\n\n이제 사건번호·관할·재판부 같은 칸을 입력하면\n'
    + '그 행의 단계가 바로 바뀌고, 피의자였다면 피고인으로 함께 바뀝니다.');
}

function removeStageAutoUpdate() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onStageEdit') ScriptApp.deleteTrigger(t);
  });
}

function onStageEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (sh.getName() !== PT_TAB) return;
  if (!ptSetRows_(sh)) return;

  var top = e.range.getRow();
  var bottom = top + e.range.getNumRows() - 1;
  if (bottom < PT_FIRST_ROW) return;
  var from = Math.max(top, PT_FIRST_ROW);
  if (bottom - from > 300) return;   // 너무 많으면 refreshStages 로 하는 편이 낫다

  var lock = LockService.getDocumentLock();
  try { lock.waitLock(5000); } catch (err) { return; }
  try {
    ptRecalc_(sh, from, bottom);
  } finally {
    lock.releaseLock();
  }
}

// 전체 다시 계산 (여러 행을 한꺼번에 붙여넣은 뒤)
function refreshStages() {
  var ss = SpreadsheetApp.openById(PT_SHEET_ID);
  var sh = ss.getSheetByName(PT_TAB);
  if (!sh) { ptShow_('[' + PT_TAB + '] 탭을 찾지 못했습니다.'); return; }
  if (!ptSetRows_(sh)) { ptShow_('머리글 줄을 찾지 못했습니다.'); return; }
  var c = ptCols_(sh);
  var last = ptLastRow_(sh, c.name);
  var r = ptRecalc_(sh, PT_FIRST_ROW, last);
  ptShow_('전체 다시 계산했습니다.\n\n단계 바뀐 행 ' + r.stage + '건\n지위 바뀐 행 ' + r.role + '건');
}

// from~to 행의 단계와 지위를 다시 계산. 바뀐 칸만 씁니다.
function ptRecalc_(sh, from, to) {
  if (!PT_HEADER_ROW && !ptSetRows_(sh)) return { stage: 0, role: 0 };
  var c = ptCols_(sh);
  if (!c.name || !c.role || !c.stage) return { stage: 0, role: 0 };
  if (to < from) return { stage: 0, role: 0 };
  var n = to - from + 1;

  var raw = ptRead_(sh, c, from, n);
  var roleRange = sh.getRange(from, c.role, n, 1);
  var stageRange = sh.getRange(from, c.stage, n, 1);
  var roles = roleRange.getValues();
  var stages = stageRange.getValues();

  var dr = 0, ds = 0;
  for (var i = 0; i < n; i++) {
    if (!String(raw.name[i] == null ? '' : raw.name[i]).trim()) continue;
    var stage = ptStageOf_(raw, i);
    if (String(stages[i][0] || '') !== stage) { stages[i][0] = stage; ds++; }

    var adj = ptRoleForStage_(String(roles[i][0] || '').trim(), stage, String(raw.caseNo[i] || ''));
    if (adj.changed) { roles[i][0] = adj.role; dr++; }
  }
  if (ds) stageRange.setValues(stages);
  if (dr) roleRange.setValues(roles);
  return { stage: ds, role: dr };
}

/* ══════════════════════════════════════════════════════════════
   판정
   ══════════════════════════════════════════════════════════════ */

// 칸이 비었는지가 아니라 무엇이 들어있는지로 단계를 정한다
function ptStageOf_(raw, i) {
  var caseNo = String(raw.caseNo[i] || '').replace(/\n/g, ' ');
  var court = String(raw.court[i] || '').replace(/\n/g, ' ');
  var bench = String(raw.bench[i] || '').replace(/\n/g, ' ');

  if (RE_COURT_NO.test(caseNo) || RE_SPECIAL_NO.test(caseNo)
    || (court && RE_COURT_NAME.test(court) && !RE_PROS_NAME.test(court))
    || (bench && RE_BENCH.test(bench))) return STAGE_TRIAL;

  if (ptAny_(raw.prosCase[i], raw.prosOffice[i], raw.prosecutor[i])
    || RE_PROS_NO.test(caseNo)
    || (court && RE_PROS_NAME.test(court))) return STAGE_PROS;

  if (ptAny_(raw.policeStation[i], raw.policeCase[i], raw.officer[i])) return STAGE_POLICE;

  return '';
}

/* 단계에 맞춘 지위.
   피의자는 재판으로 넘어가면 피고인이 된다.
   고소인·피해자 등은 단계와 무관하므로 건드리지 않는다.
   재판에서 수사로 되돌아가는 일은 없으므로 역방향 전환도 하지 않는다. */
function ptRoleForStage_(role, stage, caseNo) {
  var r = { role: role, changed: false, hold: false, odd: false, why: '' };
  if (role === '피고인' && stage !== STAGE_TRIAL) { r.odd = true; return r; }
  if (role !== '피의자' || stage !== STAGE_TRIAL) return r;

  if (RE_SPECIAL_NO.test(String(caseNo).replace(/\n/g, ' '))) {
    // 소년보호·가정보호 등은 당사자 호칭이 달라 피고인이 아니다
    r.hold = true;
    r.why = String(caseNo).replace(/\n/g, ' ').trim();
    return r;
  }
  r.role = '피고인';
  r.changed = true;
  r.why = String(caseNo).replace(/\n/g, ' ').trim() || '법원 정보 있음';
  return r;
}

function ptAny_() {
  for (var i = 0; i < arguments.length; i++) {
    if (String(arguments[i] == null ? '' : arguments[i]).trim()) return true;
  }
  return false;
}

/* ══════════════════════════════════════════════════════════════
   도구
   ══════════════════════════════════════════════════════════════ */

/* 머리글 이름으로 열을 찾는다.
   순서가 중요하다. '관할경찰서'·'관할검찰청' 을 '관할' 보다 먼저 걸러야
   그 둘이 진짜 '관할' 로 오인식되지 않는다. */
/* 머리글 줄을 찾아 PT_HEADER_ROW / PT_FIRST_ROW 를 채운다.
   '성명'(또는 '이름')이 적힌 줄을 머리글로 본다. 위에서 다섯 줄만 살펴본다.
   머리글이 1행이든 3행이든 알아서 맞추므로, 행을 올리거나 내려도 깨지지 않는다. */
function ptSetRows_(sh) {
  var probe = Math.min(5, sh.getLastRow());
  var lastCol = Math.max(sh.getLastColumn(), 1);
  if (probe < 1) return false;
  var vals = sh.getRange(1, 1, probe, lastCol).getValues();
  for (var r = 0; r < probe; r++) {
    for (var c = 0; c < lastCol; c++) {
      var h = String(vals[r][c] == null ? '' : vals[r][c]).replace(/\s/g, '');
      if (h.indexOf('성명') === 0 || h.indexOf('이름') === 0) {
        PT_HEADER_ROW = r + 1;
        PT_FIRST_ROW = r + 2;
        return true;
      }
    }
  }
  return false;
}

function ptCols_(sh) {
  var lastCol = sh.getLastColumn();
  var row = sh.getRange(PT_HEADER_ROW, 1, 1, lastCol).getValues()[0];
  var o = {
    name: 0, role: 0, stage: 0,
    policeStation: 0, policeCase: 0, officer: 0,
    prosCase: 0, prosOffice: 0, prosecutor: 0,
    caseNo: 0, court: 0, bench: 0
  };
  function set(k, c) { if (!o[k]) o[k] = c; }

  for (var i = 0; i < row.length; i++) {
    var h = String(row[i] == null ? '' : row[i]).replace(/\s/g, '');
    if (!h) continue;
    var c = i + 1;
    if (h.indexOf('관할경찰서') === 0) set('policeStation', c);
    else if (h.indexOf('관할검찰청') === 0) set('prosOffice', c);
    else if (h.indexOf('경찰사건번호') === 0) set('policeCase', c);
    else if (h.indexOf('담당수사관') === 0) set('officer', c);
    else if (h.indexOf('형제번호') === 0) set('prosCase', c);
    else if (h.indexOf('검사') === 0) set('prosecutor', c);
    else if (h === '사건번호') set('caseNo', c);
    else if (h === '관할') set('court', c);
    else if (h.indexOf('재판부') === 0) set('bench', c);
    else if (h.indexOf('성명') === 0 || h.indexOf('이름') === 0) set('name', c);
    else if (h.indexOf(PT_HEAD_ROLE) === 0) set('role', c);
    else if (h.indexOf(PT_HEAD_STAGE) === 0) set('stage', c);
  }
  return o;
}

// 판정에 필요한 열들을 한 번에 읽는다 (열마다 따로 읽으면 느리다)
function ptRead_(sh, c, first, n) {
  function col(idx) {
    if (!idx) { var e = []; for (var i = 0; i < n; i++) e.push(''); return e; }
    return sh.getRange(first, idx, n, 1).getValues().map(function (r) { return r[0]; });
  }
  return {
    name: col(c.name), role: col(c.role), stage: col(c.stage),
    policeStation: col(c.policeStation), policeCase: col(c.policeCase), officer: col(c.officer),
    prosCase: col(c.prosCase), prosOffice: col(c.prosOffice), prosecutor: col(c.prosecutor),
    caseNo: col(c.caseNo), court: col(c.court), bench: col(c.bench)
  };
}

// 단계 칸 색 — 이 열을 겨냥한 기존 규칙만 걷어내고 새로 건다
function ptStageColors_(sh, col, first, n) {
  var range = sh.getRange(first, col, n, 1);
  var keep = sh.getConditionalFormatRules().filter(function (rule) {
    var rs = rule.getRanges();
    for (var i = 0; i < rs.length; i++) {
      if (rs[i].getColumn() === col && rs[i].getNumColumns() === 1) return false;
    }
    return true;
  });
  STAGES.forEach(function (s) {
    keep.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(s.label)
      .setBackground(s.bg).setFontColor(s.fg).setBold(true)
      .setRanges([range]).build());
  });
  sh.setConditionalFormatRules(keep);
}

function ptLastRow_(sh, nameCol) {
  if (!nameCol) return PT_FIRST_ROW - 1;
  var last = sh.getLastRow();
  if (last < PT_FIRST_ROW) return PT_FIRST_ROW - 1;
  var v = sh.getRange(PT_FIRST_ROW, nameCol, last - PT_FIRST_ROW + 1, 1).getValues();
  for (var i = v.length - 1; i >= 0; i--) {
    if (String(v[i][0] == null ? '' : v[i][0]).trim()) return PT_FIRST_ROW + i;
  }
  return PT_FIRST_ROW - 1;
}

function ptL_(c) {
  if (!c) return '-';
  var s = '';
  while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - m - 1) / 26; }
  return s;
}

function ptBackup_(what) {
  var stamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  var name = '[백업] 사건정리 — ' + stamp + ' (' + what + ' 직전)';
  var folder;
  try {
    folder = (typeof backupFolder_ === 'function') ? backupFolder_() : DriveApp.createFolder('사건정리 백업');
  } catch (err) {
    folder = DriveApp.getRootFolder();
  }
  return DriveApp.getFileById(PT_SHEET_ID).makeCopy(name, folder).getUrl();
}

function ptLog_(ss, msg) {
  try {
    if (typeof append_ === 'function') {
      var who = '(로그인 정보 없음)';
      try { who = Session.getActiveUser().getEmail() || who; } catch (e) { }
      append_(ss, who, PT_TAB, '-', '', msg, '일괄정리');
    }
  } catch (err) { /* 수정로그 스크립트가 없으면 넘어감 */ }
}

function ptShow_(text) {
  Logger.log(text);
  try {
    var t = text.length > 1200 ? text.substring(0, 1200) + '\n\n... 전체 내용은 아래 [실행 로그]에서 확인하세요' : text;
    SpreadsheetApp.getUi().alert(t);
  } catch (err) { /* 독립 프로젝트에서는 알림창이 없음 */ }
}
