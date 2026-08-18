/* 법무법인 정서 — 사건정리 시트: 메뉴
   ───────────────────────────────────────────────────────────────
   [무엇을 하나]
     시트 상단에 「사건정리」 메뉴를 답니다.
     이제 어느 파일에 무슨 함수가 있는지 몰라도 됩니다. 메뉴에서 고르면 됩니다.

   [왜 이제야 되나]
     예전에는 스크립트가 시트와 따로 있는 독립 프로젝트였습니다. 독립 프로젝트는
     시트 화면을 건드릴 수 없어(getUi 가 막힘) 메뉴도 팝업도 만들 수 없었습니다.
     이 파일은 시트에 붙은 프로젝트에서만 동작합니다.

   [이 파일이 하는 일 둘]
     ① onOpen — 시트를 열 때 메뉴를 답니다 (트리거를 따로 걸 필요 없음)
     ② uiShow_ — 결과를 스크롤되는 창으로 보여줍니다
                 (기본 alert 는 1200자에서 잘려서 미리보기 결과가 다 안 보입니다)

   [메뉴에 함수 이름만 적으면 되는 이유]
     한 프로젝트 안의 파일들은 이름을 함께 씁니다. 그래서 runGridLines 가
     세로선 파일에 있든 어디에 있든 메뉴에서 그냥 부르면 됩니다.

   [설치]
     시트에서  확장 프로그램 → Apps Script  로 들어가
     [+] → 스크립트 로 파일을 만들고 이 내용을 붙여넣은 뒤 Ctrl+S.
     그다음 시트를 새로고침(F5)하면 메뉴가 보입니다.

   [메뉴가 안 보이면]
     · 시트를 새로고침하셨는지 (F5)
     · 이 프로젝트가 시트에 붙어 있는지 — 시트에서 확장 프로그램 → Apps Script
       로 열리는 프로젝트여야 합니다. 따로 만든 독립 프로젝트면 안 됩니다.
   ─────────────────────────────────────────────────────────────── */

/* ══════════════════════════════════════════════════════════════
   트리거가 켜져 있는지 — 메뉴 이름에 보여 주려고
   ══════════════════════════════════════════════════════════════ */

/* 「켜기」 를 눌러야 도는 것들이 있는데, 안 눌렀는지 시트 어디서도
   알 수 없었습니다. 종결 체크가 안 넘어가던 일이 그래서 생겼습니다.
   메뉴 이름에 ● / ○ 를 붙여 눈에 보이게 합니다.

   한계 둘:
     · 지금 로그인한 사람의 트리거만 보입니다. 남이 건 것은 안 보입니다
     · 메뉴는 시트를 열 때 그려집니다. 켠 뒤 새로고침해야 바뀝니다  */

var MN_TRIGS = null;          // null = 아직 안 봄 · false = 볼 수 없었음

/* 핸들러 이름 → 걸린 개수.
   onOpen 은 단순 트리거라 권한이 좁습니다(AuthMode.LIMITED).
   거기서 getProjectTriggers() 가 막힐 수 있어 반드시 감쌉니다.
   막히면 false 를 내고, 메뉴는 예전과 똑같은 이름을 씁니다 — 나빠지지 않습니다. */
function mnLoadTrigs_() {
  try {
    var m = {};
    ScriptApp.getProjectTriggers().forEach(function (t) {
      var h = t.getHandlerFunction();
      m[h] = (m[h] || 0) + 1;
    });
    return m;
  } catch (err) {
    return false;
  }
}

function mnLabel_(base, handler) {
  if (MN_TRIGS === null) MN_TRIGS = mnLoadTrigs_();          // 한 번만 받아 쓴다
  if (MN_TRIGS === false) return base + '  켜기';
  return base + (MN_TRIGS[handler] ? '  \u25cf 켜져 있음 — 다시 걸기'
                                   : '  \u25cb 꺼져 있음 — 켜기');
}

/* 시트를 열 때 저절로 돕니다 */
function onOpen() {
  MN_TRIGS = null;
  var ui = SpreadsheetApp.getUi();

  ui.createMenu('사건정리')
    .addSubMenu(ui.createMenu('표 양식')
      .addItem('격자·글자 맞추기  — 미리보기', 'previewGridLines')
      .addItem('격자·글자 맞추기  실행', 'runGridLines')
      .addSeparator()
      .addItem('기일 표기 맞추기  — 미리보기', 'previewFixDates')
      .addItem('기일 표기 맞추기  실행', 'runFixDates')
      .addSeparator()
      .addItem('격자만 걷어내기', 'removeGridLines'))

    .addSubMenu(ui.createMenu('정렬')
      .addItem('형사 — 단계 → 기일 순', 'sortCriminalByStage')
      .addItem('형사 — 기일 순', 'sortCriminalByHearing')
      .addSeparator()
      .addItem('항소 — 항소이유마감일 순', 'sortByDeadline')
      .addItem('항소 — 기일 순', 'sortByHearing')
      .addSeparator()
      .addItem('※ 머리글 단추로도 정렬됩니다', 'uiSortHint'))

    .addSubMenu(ui.createMenu('기일 가져오기')
      .addItem('① 접속 확인', 'checkHearingSetup')
      .addItem('② 미리보기', 'previewHearings')
      .addItem('③ 실행', 'runHearings')
      .addSeparator()
      .addItem('기일 글자색 입히기', 'runHearingColors')
      .addSeparator()
      .addItem(mnLabel_('매일 아침 자동', 'hearingDaily'), 'setupHearingDaily')
      .addItem('매일 아침 자동  끄기', 'removeHearingDaily'))

    .addSubMenu(ui.createMenu('항소 탭')
      .addItem('재편하기  — 미리보기', 'previewAppeal')
      .addItem('재편하기  실행', 'runAppeal'))

    .addSubMenu(ui.createMenu('종결 처리')
      .addItem('구조 맞추기  — 미리보기', 'previewAlignClosed')
      .addItem('구조 맞추기  실행', 'runAlignClosed')
      .addSeparator()
      .addItem('양식 맞추기  — 미리보기', 'previewDoneFormat')
      .addItem('양식 맞추기  실행', 'runDoneFormat')
      .addItem('양식 대조해 보기', 'verifyDoneFormat')
      .addSeparator()
      .addItem('체크박스 깔기  — 미리보기', 'previewCloseButtons')
      .addItem('체크박스 깔기  실행', 'runCloseButtons')
      .addSeparator()
      .addItem(mnLabel_('체크하면 옮기기', 'onCloseEdit'), 'setupCloseButtons')
      .addItem('체크하면 옮기기  끄기', 'removeCloseButtons'))

    .addSubMenu(ui.createMenu('체크박스')
      .addItem('선임계  — 미리보기', 'previewRetainer')
      .addItem('선임계  실행', 'runRetainer')
      .addSeparator()
      .addItem('공소장·증거기록  — 미리보기', 'previewCheckbox')
      .addItem('공소장·증거기록  실행', 'runCheckbox')
      .addSeparator()
      .addItem(mnLabel_('선임계 날짜 자동', 'onRetainerEdit'), 'setupRetainerDate')
      .addItem('선임계 날짜 자동  끄기', 'removeRetainerDate')
      .addItem('선임계 날짜 지금 보기', 'showRetainerDates'))

    .addSubMenu(ui.createMenu('지위·단계')
      .addItem('지위·단계 만들기  — 미리보기', 'previewParty')
      .addItem('지위·단계 만들기  실행', 'runParty')
      .addSeparator()
      .addItem('단계 다시 계산', 'refreshStages')
      .addItem(mnLabel_('자동 갱신', 'onStageEdit'), 'setupStageAutoUpdate')
      .addItem('자동 갱신  끄기', 'removeStageAutoUpdate'))

    .addSubMenu(ui.createMenu('관할·재판부 정리')
      .addItem('재판부·관할 정리  — 미리보기', 'previewCleanup')
      .addItem('재판부·관할 정리  실행', 'runCleanup'))

    .addSeparator()

    .addSubMenu(ui.createMenu('백업')
      .addItem('지금 백업 만들기', 'runBackupNow')
      .addSeparator()
      .addItem('백업으로 되돌리기  — 미리보기', 'previewRestore')
      .addItem('백업으로 되돌리기  실행', 'runRestore')
      .addSeparator()
      .addItem(mnLabel_('수정기록·자동백업', 'logEdit'), 'setup')
      .addItem('수정기록·자동백업  끄기', 'uninstall'))

    .addItem('지금 무엇이 켜져 있나 보기', 'uiTriggers')
    .addItem('도움말 — 무엇이 무엇인지', 'uiHelp')
    .addToUi();
}

/* ══════════════════════════════════════════════════════════════
   결과 보여주기
   ══════════════════════════════════════════════════════════════ */

/* 스크롤되는 창으로 결과를 보여준다.
   기본 alert 는 1200자에서 잘려 미리보기 결과가 다 안 보인다.
   각 파일의 *Show_ 가 이 함수가 있으면 이리로 넘긴다. */
function uiShow_(text) {
  var body = String(text == null ? '' : text);
  var html = '<style>'
    + 'body{margin:0;font-family:"맑은 고딕",Malgun Gothic,sans-serif;background:#fff;}'
    + 'pre{margin:0;padding:14px 16px;white-space:pre-wrap;word-break:break-all;'
    + 'font-family:"D2Coding","맑은 고딕",monospace;font-size:12.5px;line-height:1.65;color:#202124;}'
    + '</style><pre>' + uiEscape_(body) + '</pre>';

  try {
    SpreadsheetApp.getUi().showModalDialog(
      HtmlService.createHtmlOutput(html).setWidth(760).setHeight(560), '사건정리');
  } catch (err) {
    // 시트에 붙지 않은 프로젝트에서는 창을 못 띄운다 — 로그로 남긴다
    Logger.log(body);
  }
}

function uiEscape_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ══════════════════════════════════════════════════════════════
   안내
   ══════════════════════════════════════════════════════════════ */

function uiSortHint() {
  uiShow_('=== 정렬하는 두 가지 방법 ===\n\n'
    + '① 머리글 단추 (보통은 이것으로 충분합니다)\n'
    + '   머리글 오른쪽 작은 단추를 누르고 [시트 정렬 A→Z] 를 고르세요.\n'
    + '   기일이든 단계든 어느 칸이든 됩니다. 줄이 통째로 움직이므로\n'
    + '   칸 색과 메모가 값과 함께 따라갑니다.\n\n'
    + '   단추가 안 보이면  표 양식 → 격자·글자 맞추기  를 한 번 실행하세요.\n\n'
    + '② 이 메뉴의 정렬 명령\n'
    + '   머리글 단추는 한 칸 기준으로만 세웁니다.\n'
    + '   「단계 → 기일 순」 처럼 두 단계로 세우려면 이 메뉴를 쓰세요.\n\n'
    + '=== 기일 순서가 이상하면 ===\n\n'
    + '   기본 정렬은 글자순이라 표기가 섞여 있으면 어긋납니다.\n'
    + '     2026. 9. 10.  이  2026-08-20  보다 앞으로 옴\n\n'
    + '   표 양식 → 기일 표기 맞추기 를 한 번만 실행하시면 됩니다.');
}

/* 눌러서 부르는 것이라 온전한 권한으로 돕니다.
   메뉴 이름의 ● / ○ 가 안 뜰 때는 이쪽으로 보세요. */
function uiTriggers() {
  var list = [
    ['기일 가져오기', '매일 아침 자동',     'hearingDaily'],
    ['종결 처리',     '체크하면 옮기기',    'onCloseEdit'],
    ['지위·단계',     '자동 갱신',          'onStageEdit'],
    ['체크박스',      '선임계 날짜 자동',    'onRetainerEdit'],
    ['백업',          '수정기록 (수정로그)', 'logEdit'],
    ['백업',          '탭 추가·삭제 기록',   'logChange'],
    ['백업',          '매일 21시 자동백업',  'dailyBackup']
  ];

  var m = mnLoadTrigs_();
  if (m === false) {
    uiShow_('트리거 목록을 볼 권한이 없습니다.\n\n'
      + '확장 프로그램 → Apps Script → 왼쪽 시계 모양(트리거) 에서\n'
      + '직접 보실 수 있습니다.');
    return;
  }

  var out = ['=== 지금 켜져 있는 것 ===', ''];
  var off = [];
  list.forEach(function (r) {
    var n = m[r[2]] || 0;
    out.push((n ? '  \u25cf ' : '  \u25cb ') + r[0] + '   ' + r[1]
      + (n > 1 ? '   (' + n + '개 겹쳐 있음)' : ''));
    if (!n) off.push(r[0] + ' — ' + r[1]);
  });

  if (off.length) {
    out.push('');
    out.push('■ 꺼져 있는 것 — 그 메뉴에서 「켜기」 를 누르세요');
    off.forEach(function (t) { out.push('   ' + t); });
  }

  out.push('');
  out.push('=== 알아 두실 것 ===');
  out.push('  · 여기 보이는 것은 지금 로그인하신 계정이 건 트리거뿐입니다.');
  out.push('    다른 분이 건 것은 안 보입니다. 그래서 \u25cb 로 떠도 남이 건 것이');
  out.push('    돌고 있을 수 있습니다.');
  out.push('  · 「겹쳐 있음」 이 뜨면 같은 일이 두 번 돕니다. 「끄기」 를 눌러도');
  out.push('    내 것만 지워지니, 남은 것은 그 계정으로 지워야 합니다.');
  out.push('  · 메뉴 이름의 \u25cf \u25cb 는 시트를 열 때 정해집니다.');
  out.push('    켜기·끄기 를 누른 뒤에는 새로고침해야 바뀝니다.');

  uiShow_(out.join('\n'));
}

function uiHelp() {
  uiShow_('=== 사건정리 메뉴 ===\n\n'
    + '[표 양식]\n'
    + '  격자·글자 맞추기   다섯 탭의 격자·글꼴·행높이를 형사 탭 기준으로 통일하고\n'
    + '                     머리글에 정렬 단추를 답니다.\n'
    + '  기일 표기 맞추기   기일 칸을 「2026-08-13 공판기일」 한 모양으로 맞춥니다.\n'
    + '                     법정·시각은 메모로 옮겨 두고, 공판기일 파랑 ·\n'
    + '                     선고기일 빨강 글자색도 함께 입힙니다.\n\n'
    + '[정렬]\n'
    + '  보통은 머리글 단추로 하세요. 두 단계 정렬만 이 메뉴를 씁니다.\n\n'
    + '[기일 가져오기]\n'
    + '  로웨어 사건정보(슈파베이스)에서 기일을 받아 형사·항소 탭에 채웁니다.\n'
    + '  사건번호로 맞춥니다. 로웨어에 기일이 없는 사건은 건드리지 않습니다.\n'
    + '  덮어쓴 값은 수정로그에 「기존 → 새 값」 으로 남습니다.\n'
    + '  처음 쓰실 때는 ① 접속 확인 부터. 안 되면 거기서 이유를 알려줍니다.\n\n'
    + '[항소 탭]\n'
    + '  열을 성명·구속여부·사건번호… 순으로 재편하고 항소장·항소이유서\n'
    + '  체크칸을 만듭니다. 이미 하셨으면 다시 안 하셔도 됩니다.\n\n'
    + '[종결 처리]\n'
    + '  형사 탭 맨 오른쪽 [종결] 을 체크하면 종결 탭으로 넘어가고,\n'
    + '  종결 탭 [복원] 을 체크하면 있던 자리로 돌아옵니다.\n'
    + '  「체크하면 옮기기 켜기」 를 한 번 해두셔야 동작합니다.\n'
    + '  켜져 있는지는 그 메뉴 이름의 \u25cf / \u25cb 로 보실 수 있습니다.\n\n'
    + '[체크박스]\n'
    + '  선임계·공소장·증거기록을 네모 체크로 바꿉니다.\n'
    + '  「선임계 날짜 자동」 을 켜두면 선임계를 체크할 때 그 칸 메모에\n'
    + '  제출일이 저절로 들어갑니다 (마우스를 올리면 보입니다).\n'
    + '  체크를 풀면 그 줄만 지워지고, 손으로 고친 날짜는 덮지 않습니다.\n\n'
    + '[지위·단계]  성명에서 지위를 떼고 경찰·검찰·재판 단계를 계산합니다.\n'
    + '[관할·재판부 정리]  재판부 칸의 전화번호를 메모로 옮기고 관할을 채웁니다.\n\n'
    + '[백업]\n'
    + '  매일 21:00 자동 백업 + 수정기록은 「수정기록·자동백업 켜기」 로 켭니다.\n'
    + '  잘못됐을 때는 「백업으로 되돌리기」. 되돌리기 전에도 백업을 뜹니다.\n\n'
    + '=== 공통 ===\n'
    + '  · 「미리보기」 는 시트를 절대 바꾸지 않습니다. 먼저 보시고 실행하세요.\n'
    + '  · 「실행」 은 시작 전에 백업을 자동으로 뜹니다.\n'
    + '  · 시트를 직접 되돌리려면  파일 → 버전 기록  이 가장 정확합니다.\n'
    + '  · 「켜기」 가 필요한 것들은 메뉴 이름에 \u25cf 켜져 있음 / \u25cb 꺼져 있음\n'
    + '    으로 나옵니다. 「지금 무엇이 켜져 있나 보기」 로 한눈에 보실 수도 있습니다.');
}
