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

/* 시트를 열 때 저절로 돕니다 */
function onOpen() {
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
      .addItem('체크하면 옮기기  켜기', 'setupCloseButtons')
      .addItem('체크하면 옮기기  끄기', 'removeCloseButtons'))

    .addSubMenu(ui.createMenu('체크박스')
      .addItem('선임계  — 미리보기', 'previewRetainer')
      .addItem('선임계  실행', 'runRetainer')
      .addSeparator()
      .addItem('공소장·증거기록  — 미리보기', 'previewCheckbox')
      .addItem('공소장·증거기록  실행', 'runCheckbox'))

    .addSubMenu(ui.createMenu('지위·단계')
      .addItem('지위·단계 만들기  — 미리보기', 'previewParty')
      .addItem('지위·단계 만들기  실행', 'runParty')
      .addSeparator()
      .addItem('단계 다시 계산', 'refreshStages')
      .addItem('자동 갱신  켜기', 'setupStageAutoUpdate')
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
      .addItem('수정기록·자동백업  켜기', 'setup')
      .addItem('수정기록·자동백업  끄기', 'uninstall'))

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

function uiHelp() {
  uiShow_('=== 사건정리 메뉴 ===\n\n'
    + '[표 양식]\n'
    + '  격자·글자 맞추기   다섯 탭의 격자·글꼴·행높이를 형사 탭 기준으로 통일하고\n'
    + '                     머리글에 정렬 단추를 답니다.\n'
    + '  기일 표기 맞추기   기일 몇 칸의 날짜 표기를 맞춰 정렬이 정확해집니다.\n'
    + '                     한 번만 하시면 됩니다.\n\n'
    + '[정렬]\n'
    + '  보통은 머리글 단추로 하세요. 두 단계 정렬만 이 메뉴를 씁니다.\n\n'
    + '[항소 탭]\n'
    + '  열을 성명·구속여부·사건번호… 순으로 재편하고 항소장·항소이유서\n'
    + '  체크칸을 만듭니다. 이미 하셨으면 다시 안 하셔도 됩니다.\n\n'
    + '[종결 처리]\n'
    + '  형사 탭 맨 오른쪽 [종결] 을 체크하면 종결 탭으로 넘어가고,\n'
    + '  종결 탭 [복원] 을 체크하면 있던 자리로 돌아옵니다.\n'
    + '  「체크하면 옮기기 켜기」 를 한 번 해두셔야 동작합니다.\n\n'
    + '[체크박스]  선임계·공소장·증거기록을 네모 체크로 바꿉니다.\n'
    + '[지위·단계]  성명에서 지위를 떼고 경찰·검찰·재판 단계를 계산합니다.\n'
    + '[관할·재판부 정리]  재판부 칸의 전화번호를 메모로 옮기고 관할을 채웁니다.\n\n'
    + '[백업]\n'
    + '  매일 21:00 자동 백업 + 수정기록은 「수정기록·자동백업 켜기」 로 켭니다.\n'
    + '  잘못됐을 때는 「백업으로 되돌리기」. 되돌리기 전에도 백업을 뜹니다.\n\n'
    + '=== 공통 ===\n'
    + '  · 「미리보기」 는 시트를 절대 바꾸지 않습니다. 먼저 보시고 실행하세요.\n'
    + '  · 「실행」 은 시작 전에 백업을 자동으로 뜹니다.\n'
    + '  · 시트를 직접 되돌리려면  파일 → 버전 기록  이 가장 정확합니다.');
}
