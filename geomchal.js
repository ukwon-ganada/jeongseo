/* 법무법인 정서 PWA - 검찰 열람·등사 신청서 (geomchal.js)
   ───────────────────────────────────────────────────────────────
   독립 모듈. yeollam.js(법원)의 짝. 검찰사건사무규칙 별지 제170호의2서식.
   yeollam.js 갈림길에서 검찰 선택 시 openGeomchalForm() 호출.

   ★ 정밀 재현 방식: 서면 표는 HWPX 원본에서 좌표를 추출(GM_TBL/GM_BF)해
     그대로 그린다(손수 표 작성 X). 열너비·행높이·셀병합·테두리(투명 포함)·
     문단 정렬·글자크기까지 원본과 동일. 자리표시자([a]…[g])만 폼 값으로 치환.
     추출 스크립트: scratchpad/hwpx_extract.py + emit_js.py (저장소 밖).

   진입점: openGeomchalForm()   흐름: 폼 → 완료 → 서면(6쪽) → window.print()
   6쪽: 신청서 · 별지 서류표목 · 수수료납부서 · 서약서①(변호사) · 서약서②(사무원) · 위임장
   페이지 구성/흐름은 GM_DOC(원본 문단 순서), 표는 GM_TBL, 테두리는 GM_BF.

   의존: showScreen(id), SEAL_SEOGOEUN(전역 도장), initAutofillFor()(자동완성), JU(util.js)

   자리표시자: [a]변호사 [a-1]변호사생년월일 [a-2]등록번호(법인공통)
     [b]형제번호(l_code) [c]지위(client_position) [d]의뢰인(l_client) [e]죄명(l_name)
     [f]작성일 [g]검사장 앞=검찰청명(기본 인천지방검찰청) / (p5·p6 수임인 성명=사무원)
     [g-1]사무원 생년월일
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  /* ── 상수 ─────────────────────────────────────────── */
  var ATTORNEYS = [
    { name: '서고은', birth: '840219' },
    { name: '정필성', birth: '' },
    { name: '김홍일', birth: '' },
    { name: '양선화', birth: '' },
    { name: '우숭민', birth: '' },
    { name: '이예나', birth: '' },
    { name: '손영우', birth: '' }
  ];
  var FIRM_REGNO = '395-86-03063';   // 등록번호[a-2] — 전 변호사 공통

  var CLERKS = [
    { name: '원가을', birth: '941103' },
    { name: '신주연', birth: '980828' },
    { name: '강민지', birth: '950109' },
    { name: '최인혜', birth: '820410' }
  ];
  var CLERKS_KEY = 'jeongseo_geomchal_clerks';

  var PROS_OFFICE_DEFAULT = '인천지방검찰청';  // [g] 검사장 앞 기본값

  /* ── 도우미 (util.js 위임) ── */
  function esc(v) { return JU.esc(v); }
  function todayISO() { return JU.todayISO(); }
  function fmtKDate(iso) {
    var m = ('' + (iso || '')).match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!m) return '';
    return m[1] + '년 ' + parseInt(m[2], 10) + '월 ' + parseInt(m[3], 10) + '일';
  }
  function normBirth(s) { return ('' + (s || '')).replace(/[^0-9]/g, '').slice(0, 6); }
  function loadClerks() {
    var list = CLERKS.slice();
    try {
      var arr = JSON.parse(localStorage.getItem(CLERKS_KEY) || '[]') || [];
      arr.forEach(function (c) {
        if (c && c.name && !list.some(function (x) { return x.name === c.name; })) list.push(c);
      });
    } catch (e) {}
    return list;
  }
  function saveClerk(name, birth) {
    name = (name || '').trim(); if (!name) return;
    if (CLERKS.some(function (x) { return x.name === name; })) return;
    var extra = [];
    try { extra = JSON.parse(localStorage.getItem(CLERKS_KEY) || '[]') || []; } catch (e) {}
    var f = extra.find(function (x) { return x.name === name; });
    if (f) { if (birth) f.birth = normBirth(birth); }
    else extra.push({ name: name, birth: normBirth(birth) });
    try { localStorage.setItem(CLERKS_KEY, JSON.stringify(extra)); } catch (e) {}
  }
  function clerkBirth(name) {
    var c = loadClerks().find(function (x) { return x.name === name; });
    return c ? c.birth : '';
  }
  function attorneyBirth(name) {
    var a = ATTORNEYS.find(function (x) { return x.name === name; });
    return a ? a.birth : '';
  }

  /* ══════════════════════════════════════════════════════════════
     HWPX 원본 추출 데이터 (자동생성 — 손수정 금지)
     GM_TBL: 표[ {w:[열너비mm], r:[ {h:행높이mm, c:[ [col,cs,rs,bf,va,[[ha,text,pt]…]] …]} …]} ]
     GM_BF : { bfId: [Lt,Lw, Rt,Rw, Tt,Tw, Bt,Bw] }  (t: n=none s=solid d=double, w:mm)
     ══════════════════════════════════════════════════════════════ */
  var GM_TBL = [{"w":[20.9,16.5,9.4,1.7,24.0,23.1,0.9,8.0,12.6,3.4,24.4,12.1,12.1],"r":[{"h":9.17,"c":[[0,13,1,2,"c",[["j","■ 검찰사건사무규칙 [별지 제170호의2서식] <개정 2014.6.26>",8.0,0]]]]},{"h":22.6,"c":[[0,13,1,2,"c",[["c","열람ㆍ등사 신청서",16.0,1],["c","(「형사소송법」 제266조의3제1항제1호 및 제2호)",12.0,0]]]]},{"h":5.82,"c":[[0,12,1,5,"c",[["j","※ [  ]에는 해당되는 곳에 √표를 합니다.",8.0,0]]],[12,1,1,5,"c",[["r","(앞쪽)",8.0,0]]]]},{"h":8.34,"c":[[0,3,1,6,"c",[["j","접수번호",9.0,0]]],[3,6,1,7,"c",[["j","접수일자",9.0,0]]],[9,4,1,8,"c",[["j","처리기간    48시간",9.0,0]]]]},{"h":2.84,"c":[[0,13,1,9,"c",[["l","",10.0,0]]]]},{"h":10.64,"c":[[0,1,3,10,"c",[["c","신청인",11.0,0]]],[1,7,1,11,"c",[["j","성명  법무법인 정서",11.0,0],["j","      담당 변호사 [a]",11.0,0]]],[8,5,1,12,"c",[["j","생년월일  [a-1]",11.0,0],["j","등록번호 [a-2]",11.0,0]]]]},{"h":9.35,"c":[[1,7,1,13,"c",[["j","주소 인천 미추홀구 한나루로436, 501호(두원빌딩)",11.0,0]]],[8,5,1,14,"c",[["j","전화번호  032) 868- 7171",11.0,0],["j","팩스번호  032) 868-7676",11.0,0]]]]},{"h":26.33,"c":[[1,1,1,15,"c",[["c","피고인과의",11.0,0],["c","관계",11.0,0]]],[2,11,1,16,"c",[["j","[ ] 피고인 본인      [●] 변 호 인 ",11.0,0],["j","[ ] 피고인의 (                           )",11.0,0],["j","※ 피고인의 법정대리인, 특별대리인, 배우자, 직계친족, 형제자매인 경우에는 위임장 첨부",11.0,0],["j","※ 변호인이 있는 피고인은 열람만 신청 가능",11.0,0]]]]},{"h":2.35,"c":[[0,13,1,9,"c",[["l","",10.0,0]]]]},{"h":14.64,"c":[[0,1,2,10,"c",[["c","사  건",11.0,0]]],[1,5,1,11,"c",[["j","사건번호  [b]",11.0,0]]],[6,7,1,12,"c",[["j","[c]  [d]",11.0,0]]]]},{"h":9.0,"c":[[1,12,1,16,"c",[["j","죄    명  [e]",11.0,0]]]]},{"h":2.35,"c":[[0,13,1,9,"c",[["l","",10.0,0]]]]},{"h":8.93,"c":[[0,1,1,17,"c",[["c","신청사유",11.0,0]]],[1,12,1,12,"c",[["j","[●] 당해 사건 소송 준비",10.0,0]]]]},{"h":24.87,"c":[[0,1,1,18,"c",[["c","신청내용",11.0,0]]],[1,12,1,16,"c",[["j","[●] 위 사건에 관한 서류 등의 목록의 열람ㆍ등사",10.0,0],["j","[●] 검사가 증거로 신청할 서류 등의 열람ㆍ등사(제1호)",10.0,0],["j","[  ] 검사가 증인으로 신청할 사람의 성명ㆍ사건과의 관계 등을 기재한 서면의 교부 또는 그 사람이 공판기일 전에 행한 진술을 기재한 서류 등의 열람ㆍ등사(제2호)",10.0,0]]]]},{"h":4.87,"c":[[0,13,1,19,"c",[["l","",10.0,0]]]]},{"h":12.63,"c":[[0,13,1,2,"c",[["j","「형사소송법」 제266조의3제1항에 따라 위와 같이 열람ㆍ등사, 서면의 교부를 신청합니다. ",11.0,0],["r","                              [f]",11.0,0]]]]},{"h":16.46,"c":[[0,13,1,20,"c",[["r","신청인  변호사   [a]  (서명 또는 인)",12.0,0],["j","[g] 검사장  귀하",13.0,1]]]]},{"h":9.47,"c":[[0,13,1,21,"c",[["l","",10.0,0]]]]},{"h":4.52,"c":[[0,1,3,22,"c",[["c","검 사",11.0,0],["c","결 정",11.0,0]]],[1,3,1,23,"c",[["c","서류 등 목록",10.0,0]]],[4,6,1,23,"c",[["c","제1호 서류 등 ",10.0,0]]],[10,3,1,24,"c",[["c","제2호 서면 및 서류 등",10.0,0]]]]},{"h":4.52,"c":[[1,3,1,25,"c",[["c","허 가",10.0,0]]],[4,1,1,26,"c",[["c","허 가",10.0,0]]],[5,2,1,27,"c",[["c","거 부",10.0,0]]],[7,3,1,28,"c",[["c","범위제한",10.0,0]]],[10,1,1,26,"c",[["c","교부(허가)",10.0,0]]],[11,2,1,27,"c",[["c","불교부(거부)",10.0,0]]]]},{"h":14.15,"c":[[1,3,1,25,"c",[["l","",10.0,0]]],[4,1,1,26,"c",[["l","",10.0,0]]],[5,2,1,27,"c",[["l","",10.0,0]]],[7,3,1,28,"c",[["l","",10.0,0]]],[10,1,1,26,"c",[["l","",10.0,0]]],[11,2,1,27,"c",[["l","",10.0,0]]]]},{"h":6.0,"c":[[0,13,1,29,"c",[["r","210㎜ × 297㎜(백상지 80g/㎡)",8.0,0]]]]}]},{"w":[15.4,79.3,22.3,22.3,22.3,22.3],"r":[{"h":9.23,"c":[[0,1,2,31,"c",[["c","순 번",12.0,1]]],[1,1,2,31,"c",[["c","서류 등의 표목",12.0,1]]],[2,3,1,32,"c",[["c","허 가 여 부",12.0,1]]],[5,1,2,31,"c",[["c","비 고",12.0,1]]]]},{"h":10.27,"c":[[2,1,1,31,"c",[["c","허   가",12.0,1]]],[3,1,1,31,"c",[["c","거   부",12.0,1]]],[4,1,1,31,"c",[["c","범위제한",12.0,1]]]]},{"h":12.52,"c":[[0,1,1,33,"c",[["c","1",12.0,1]]],[1,1,1,33,"c",[["c","[서류이름1]",12.0,0]]],[2,1,1,33,"c",[["l","",10.0,0]]],[3,1,1,33,"c",[["l","",10.0,0]]],[4,1,1,33,"c",[["l","",10.0,0]]],[5,1,1,33,"c",[["l","",10.0,0]]]]},{"h":12.51,"c":[[0,1,1,30,"c",[["c","2",12.0,1]]],[1,1,1,30,"c",[["c","[서류이름2]",12.0,0]]],[2,1,1,30,"c",[["l","",10.0,0]]],[3,1,1,30,"c",[["l","",10.0,0]]],[4,1,1,30,"c",[["l","",10.0,0]]],[5,1,1,30,"c",[["l","",10.0,0]]]]},{"h":12.51,"c":[[0,1,1,30,"c",[["c","3",12.0,1]]],[1,1,1,30,"c",[["l","",10.0,0]]],[2,1,1,30,"c",[["l","",10.0,0]]],[3,1,1,30,"c",[["l","",10.0,0]]],[4,1,1,30,"c",[["l","",10.0,0]]],[5,1,1,30,"c",[["l","",10.0,0]]]]},{"h":12.51,"c":[[0,1,1,30,"c",[["c","4",12.0,1]]],[1,1,1,30,"c",[["l","",10.0,0]]],[2,1,1,30,"c",[["l","",10.0,0]]],[3,1,1,30,"c",[["l","",10.0,0]]],[4,1,1,30,"c",[["l","",10.0,0]]],[5,1,1,30,"c",[["l","",10.0,0]]]]},{"h":12.51,"c":[[0,1,1,30,"c",[["c","5",12.0,1]]],[1,1,1,30,"c",[["l","",10.0,0]]],[2,1,1,30,"c",[["l","",10.0,0]]],[3,1,1,30,"c",[["l","",10.0,0]]],[4,1,1,30,"c",[["l","",10.0,0]]],[5,1,1,30,"c",[["l","",10.0,0]]]]},{"h":12.52,"c":[[0,1,1,30,"c",[["c","6",12.0,1]]],[1,1,1,30,"c",[["l","",10.0,0]]],[2,1,1,30,"c",[["l","",10.0,0]]],[3,1,1,30,"c",[["l","",10.0,0]]],[4,1,1,30,"c",[["l","",10.0,0]]],[5,1,1,30,"c",[["l","",10.0,0]]]]},{"h":12.51,"c":[[0,1,1,30,"c",[["c","7",12.0,1]]],[1,1,1,30,"c",[["l","",10.0,0]]],[2,1,1,30,"c",[["l","",10.0,0]]],[3,1,1,30,"c",[["l","",10.0,0]]],[4,1,1,30,"c",[["l","",10.0,0]]],[5,1,1,30,"c",[["l","",10.0,0]]]]},{"h":12.51,"c":[[0,1,1,30,"c",[["c","8",12.0,1]]],[1,1,1,30,"c",[["l","",10.0,0]]],[2,1,1,30,"c",[["l","",10.0,0]]],[3,1,1,30,"c",[["l","",10.0,0]]],[4,1,1,30,"c",[["l","",10.0,0]]],[5,1,1,30,"c",[["l","",10.0,0]]]]},{"h":12.51,"c":[[0,1,1,30,"c",[["c","9",12.0,1]]],[1,1,1,30,"c",[["l","",10.0,0]]],[2,1,1,30,"c",[["l","",10.0,0]]],[3,1,1,30,"c",[["l","",10.0,0]]],[4,1,1,30,"c",[["l","",10.0,0]]],[5,1,1,30,"c",[["l","",10.0,0]]]]},{"h":12.51,"c":[[0,1,1,30,"c",[["c","10",12.0,1]]],[1,1,1,30,"c",[["l","",10.0,0]]],[2,1,1,30,"c",[["l","",10.0,0]]],[3,1,1,30,"c",[["l","",10.0,0]]],[4,1,1,30,"c",[["l","",10.0,0]]],[5,1,1,30,"c",[["l","",10.0,0]]]]},{"h":12.52,"c":[[0,1,1,30,"c",[["c","11",12.0,1]]],[1,1,1,30,"c",[["l","",10.0,0]]],[2,1,1,30,"c",[["l","",10.0,0]]],[3,1,1,30,"c",[["l","",10.0,0]]],[4,1,1,30,"c",[["l","",10.0,0]]],[5,1,1,30,"c",[["l","",10.0,0]]]]},{"h":12.51,"c":[[0,1,1,30,"c",[["c","12",12.0,1]]],[1,1,1,30,"c",[["l","",10.0,0]]],[2,1,1,30,"c",[["l","",10.0,0]]],[3,1,1,30,"c",[["l","",10.0,0]]],[4,1,1,30,"c",[["l","",10.0,0]]],[5,1,1,30,"c",[["l","",10.0,0]]]]},{"h":12.51,"c":[[0,1,1,30,"c",[["c","13",12.0,1]]],[1,1,1,30,"c",[["l","",10.0,0]]],[2,1,1,30,"c",[["l","",10.0,0]]],[3,1,1,30,"c",[["l","",10.0,0]]],[4,1,1,30,"c",[["l","",10.0,0]]],[5,1,1,30,"c",[["l","",10.0,0]]]]},{"h":12.51,"c":[[0,1,1,30,"c",[["c","14",12.0,1]]],[1,1,1,30,"c",[["l","",10.0,0]]],[2,1,1,30,"c",[["l","",10.0,0]]],[3,1,1,30,"c",[["l","",10.0,0]]],[4,1,1,30,"c",[["l","",10.0,0]]],[5,1,1,30,"c",[["l","",10.0,0]]]]},{"h":12.51,"c":[[0,1,1,30,"c",[["c","15",12.0,1]]],[1,1,1,30,"c",[["l","",10.0,0]]],[2,1,1,30,"c",[["l","",10.0,0]]],[3,1,1,30,"c",[["l","",10.0,0]]],[4,1,1,30,"c",[["l","",10.0,0]]],[5,1,1,30,"c",[["l","",10.0,0]]]]}]},{"w":[36.0,18.0,94.9,38.0],"r":[{"h":31.49,"c":[[0,4,1,35,"c",[["c","수  수  료  납  부  서",20.0,1],["j","일금   (금액 한글로, (예시 오 백원))    원정 (￦   (합계금 숫자) 원)",12.0,0]]]]},{"h":10.51,"c":[[0,4,1,36,"c",[["c","내                                용",13.0,0]]]]},{"h":12.52,"c":[[0,1,1,37,"c",[["c","구      분",12.0,0]]],[1,1,1,30,"c",[["c","수  량",12.0,0]]],[2,1,1,30,"c",[["c","산   출   내   역",12.0,0]]],[3,1,1,38,"c",[["c","금      액",12.0,0]]]]},{"h":14.5,"c":[[0,1,1,37,"c",[["c","열람수수료",12.0,0]]],[1,1,1,30,"c",[["r","(0)건",12.0,0]]],[2,1,1,30,"c",[["j","열람을 구하는 사건 1건당 500원",12.0,0]]],[3,1,1,38,"c",[["j","             원",12.0,0]]]]},{"h":15.15,"c":[[0,1,1,37,"c",[["c","등사수수료",12.0,0]]],[1,1,1,30,"c",[["r"," (0)건",12.0,0]]],[2,1,1,30,"c",[["j","등사할 부분이 속해 있는 사건 1건당 500원, ",12.0,0],["j","검찰설비를 이용한 경우 등사문서 1장당 50원",12.0,0]]],[3,1,1,38,"c",[["j","             원",12.0,0]]]]},{"h":14.52,"c":[[0,1,1,37,"c",[["c","등본수수료",12.0,0]]],[1,1,1,30,"c",[["r","(0)장",12.0,0]]],[2,1,1,30,"c",[["j","원본 5장까지 1,000원, 초과 1장당 50원",12.0,0]]],[3,1,1,38,"c",[["j","             원",12.0,0]]]]},{"h":14.5,"c":[[0,1,1,37,"c",[["c","초본수수료",12.0,0]]],[1,1,1,30,"c",[["r","(0)건",12.0,0]]],[2,1,1,30,"c",[["j","원본 5장까지 1,000원, 초과 1장당 50원",12.0,0]]],[3,1,1,38,"c",[["j","             원",12.0,0]]]]},{"h":13.51,"c":[[0,2,1,37,"c",[["c","합    계    금",12.0,0]]],[2,2,1,38,"c",[["r"," 원",13.0,0]]]]},{"h":63.02,"c":[[0,4,1,36,"c",[["j","      ",12.0,0],["j","      위 금액은 기록(열람, 등사, 등본, 초본)의 수수료로서 「사건기록 열람 ․ 등사의 방법",12.0,0],["j","  및 수수료 등에 관한 규칙」 제8조에 따라 아래에 붙인 수입인지로 납부함.",12.0,0],["j","",12.0,0],["c","  [f]",12.0,0],["c","                               위  납부인 :   변호사   [a] (서명 또는 날인)",12.0,0]]]]},{"h":41.95,"c":[[0,4,1,39,"c",[["c","수 입 인 지  붙 이 는  곳",12.0,0],["c","(여백이 모자라면 뒷면에 붙여 주세요)",12.0,0]]]]}]}];
  var GM_BF = {"2":["n",0.1,"n",0.1,"n",0.1,"n",0.1],"5":["n",0.1,"n",0.1,"n",0.1,"s",0.12],"6":["n",0.1,"s",0.12,"s",0.12,"s",0.12],"7":["s",0.12,"s",0.12,"s",0.12,"s",0.12],"8":["s",0.12,"n",0.1,"s",0.12,"s",0.12],"9":["n",0.1,"n",0.1,"s",0.12,"s",0.12],"10":["n",0.1,"s",0.12,"s",0.12,"s",0.12],"11":["s",0.12,"s",0.12,"s",0.12,"s",0.12],"12":["s",0.12,"n",0.1,"s",0.12,"s",0.12],"13":["s",0.12,"s",0.12,"s",0.12,"s",0.12],"14":["s",0.12,"n",0.1,"s",0.12,"s",0.12],"15":["s",0.12,"s",0.12,"s",0.12,"s",0.12],"16":["s",0.12,"n",0.1,"s",0.12,"s",0.12],"17":["n",0.1,"s",0.12,"s",0.12,"s",0.12],"18":["n",0.1,"s",0.12,"s",0.12,"s",0.12],"19":["n",0.1,"n",0.1,"s",0.12,"n",0.1],"20":["n",0.1,"n",0.1,"n",0.1,"s",0.7],"21":["n",0.1,"n",0.1,"s",0.7,"s",0.7],"22":["s",0.12,"d",0.5,"s",0.7,"s",0.12],"23":["d",0.5,"d",0.5,"s",0.7,"s",0.12],"24":["d",0.5,"s",0.12,"s",0.7,"s",0.12],"25":["d",0.5,"d",0.5,"s",0.12,"s",0.12],"26":["d",0.5,"s",0.12,"s",0.12,"s",0.12],"27":["s",0.12,"s",0.12,"s",0.12,"s",0.12],"28":["s",0.12,"d",0.5,"s",0.12,"s",0.12],"29":["n",0.1,"n",0.1,"s",0.12,"n",0.1],"30":["s",0.12,"s",0.12,"s",0.12,"s",0.12],"31":["s",0.12,"s",0.12,"s",0.12,"d",0.5],"32":["s",0.12,"s",0.12,"s",0.12,"s",0.12],"33":["s",0.12,"s",0.12,"d",0.5,"s",0.12],"35":["s",0.4,"s",0.4,"s",0.4,"s",0.12],"36":["s",0.4,"s",0.4,"s",0.12,"s",0.12],"37":["s",0.4,"s",0.12,"s",0.12,"s",0.12],"38":["s",0.12,"s",0.4,"s",0.12,"s",0.12],"39":["s",0.4,"s",0.4,"s",0.12,"s",0.4]};
  var GM_FILL = {"6":"#BBBBBB","7":"#BBBBBB","8":"#BBBBBB","22":"#BBBBBB","23":"#BBBBBB","24":"#BBBBBB","25":"#BBBBBB","26":"#BBBBBB","27":"#BBBBBB","28":"#BBBBBB","31":"#C0C0C0","32":"#C0C0C0"};
  var GM_DOC = [[["tbl",0],["p","r",10.0,0,160,"(신문용지 54g/㎡)"]],[["p","j",12.0,0,160,"<별지>"],["tbl",1],["p","c",12.0,0,160,"※ 범위제한의 구체적 내용 (예: 열람 가, 등사 불가 또는 등사허가 범위) 등을 비고란에 기재"]],[["p","j",10.0,0,160,"[별지 서식]"],["tbl",2],["p","j",10.0,0,160,"23231-53211일										    210㎜×297㎜"],["p","j",10.0,0,160,"98. 2. 25. 승인										 (신문용지 54g/㎡)"]],[["p","c",20.0,1,320,"서 약 서"],["p","l",11.0,0,330,"    귀 청  [b] 소송기록을 열람 또는 등사함에 있어, 형사소송법 제266조의 16 및 형사소송법 제59조의2 제5항에 따라"],["p","l",11.0,0,330,"- 열람 또는 등사에 의하여 알게 된 사항을 당해 사건 또는 관련 소송의 준비에"],["p","l",11.0,0,330,"  사용할 목적이 아닌 다른 목적으로 다른 사람에게 교부 또는 제시(전기통신"],["p","l",11.0,0,330,"  설비를 이용하여 제공하는 것을 포함한다)하지 않을 것과"],["p","l",11.0,0,330,"- 공공의 질서 또는 선량한 풍속을 해하거나 피고인의 개선 및 갱생을 방해"],["p","l",11.0,0,330,"  하거나 사건관계인의 명예 또는 생활의 평온을 해하는 행위를 하지 아니할"],["p","l",11.0,0,330,"  것을 서약합니다."],["p","l",11.0,1,330,""],["p","l",11.0,1,330,"[f]"],["p","l",11.0,0,330,"주 소(전화) :  인천 미추홀구 한나루로 436, 501호(두원빌딩)"],["p","l",11.0,0,330,"주민등록번호(생년월일) :  [a-1]"],["p","l",11.0,0,200,"성      명 :  법무법인 정서"],["p","l",14.0,1,330,"             변호사   [a]   (서명 또는 날인)"],["p","l",10.0,0,330,""],["p","j",20.0,1,220,"[g] 검사장 귀하   "]],[["p","c",20.0,1,320,"서 약 서"],["p","l",11.0,0,330,"    귀 청  2026형제36763 소송기록을 열람 또는 등사함에 있어, 형사소송법 제266조의 16 및 형사소송법 제59조의2 제5항에 따라"],["p","l",11.0,0,330,"- 열람 또는 등사에 의하여 알게 된 사항을 당해 사건 또는 관련 소송의 준비에"],["p","l",11.0,0,330,"  사용할 목적이 아닌 다른 목적으로 다른 사람에게 교부 또는 제시(전기통신"],["p","l",11.0,0,330,"  설비를 이용하여 제공하는 것을 포함한다)하지 않을 것과"],["p","l",11.0,0,330,"- 공공의 질서 또는 선량한 풍속을 해하거나 피고인의 개선 및 갱생을 방해"],["p","l",11.0,0,330,"  하거나 사건관계인의 명예 또는 생활의 평온을 해하는 행위를 하지 아니할"],["p","l",11.0,0,330,"  것을 서약합니다."],["p","l",11.0,1,330,""],["p","l",11.0,1,330,""],["p","l",11.0,1,330,"[f]"],["p","l",11.0,0,330,"주 소(전화) :  인천 미추홀구 한나루로 436, 501호(두원빌딩)"],["p","l",11.0,0,330,"주민등록번호(생년월일) :  [g-1]"],["p","l",11.0,0,200,"성      명 : [g]  (서명 또는 날인)"],["p","l",11.0,0,200,""],["p","l",10.0,0,330,""],["p","j",20.0,1,220,"[g] 검사장 귀하   "]],[["p","c",32.0,0,200,"위 임 장"],["p","j",11.0,0,200,""],["p","j",13.0,0,220,"  귀 청  2026형제36763 증거기록에 대한 열람·등사함에 있어, 사건기록 열람·등사의 방법 및 수수료 등에 관한 규칙 제4조(열람·등사의 방법) 제3항에 의거 아래 수임인에게 증거기록의 열람·등사에 관하여 위임함."],["p","j",13.0,0,220,""],["p","c",20.0,0,220,"- 수 임 인 -  "],["p","j",13.0,0,220,"	○ 성    명 :  [g]"],["p","j",13.0,0,220,"	○ 생년월일 :  [g-1]"],["p","j",13.0,0,220,"	○ 연 락 처 :  032) 868-7676"],["p","j",13.0,0,220,""],["p","j",13.0,0,220," 붙임 : 사무원증.   끝."],["p","l",13.0,0,220,"   "],["p","c",13.0,0,220,"[f]"],["p","c",13.0,0,220,""],["p","c",13.0,0,220,""],["p","r",13.0,0,220,"                       위 임 인 : 법무법인 정서"],["p","r",13.0,0,220," 변호사 [a] (서명 또는 날인)"],["p","r",13.0,0,220,""],["p","l",10.0,0,220,""],["p","l",10.0,0,220,""],["p","j",20.0,1,220,"[g] 검사장 귀하  "]]];

  /* ── 테두리 CSS ── */
  function bfEdge(ty, w) {
    if (ty === 'n' || !ty) return '0';
    var style = (ty === 'd') ? 'double' : 'solid';
    var mm = (ty === 'd') ? Math.max(w, 0.5) : w;
    return mm + 'mm ' + style + ' #000';
  }
  function bfStyle(bf) {
    var a = GM_BF[bf]; var out = '';
    if (a) {
      out = 'border-left:' + bfEdge(a[0], a[1]) +
        ';border-right:' + bfEdge(a[2], a[3]) +
        ';border-top:' + bfEdge(a[4], a[5]) +
        ';border-bottom:' + bfEdge(a[6], a[7]) + ';';
    }
    var fill = (typeof GM_FILL !== 'undefined') ? GM_FILL[bf] : null;
    if (fill) out += 'background:' + fill + ';';
    return out;
  }
  var HAMAP = { l: 'left', c: 'center', r: 'right', j: 'justify', d: 'justify' };
  var VAMAP = { t: 'top', c: 'middle', b: 'bottom' };

  // 자리표시자 치환. tok = {attorney,birth,regno,casenum,position,client,charge,
  //   writeDate,office,clerk,clerkBirth} (모두 esc 완료)
  function fillTokens(s, tok) {
    // '[g] 검사장' 의 [g] = 검찰청명(먼저) → 나머지 [g] = 수임인(사무원)
    s = s.split('[g] 검사장').join(tok.office + ' 검사장');
    // p5·p6 에 예시로 박힌 형제번호 → 실제 형제번호
    if (tok.casenum) s = s.split('2026형제36763').join(tok.casenum);
    var pairs = [
      ['[a-1]', tok.birth], ['[a-2]', tok.regno], ['[g-1]', tok.clerkBirth],
      ['[a]', tok.attorney], ['[b]', tok.casenum], ['[c]', tok.position],
      ['[d]', tok.client], ['[e]', tok.charge], ['[f]', tok.writeDate], ['[g]', tok.clerk]
    ];
    for (var i = 0; i < pairs.length; i++) {
      if (pairs[i][1] != null) s = s.split(pairs[i][0]).join(pairs[i][1]);
    }
    return s;
  }

  // '(서명 또는 인)'·'(서명 또는 날인)'을 클릭하면 날인되는 슬롯으로 감싼다
  function wrapSign(s) {
    return s.replace(/\(서명 또는 (?:날인|인)\)/g,
      '<span class="gm-sign-slot" onclick="gmStamp(this)" title="클릭하면 도장이 찍힙니다">$&</span>');
  }

  // 문단(셀/문서 공용) 스타일: 정렬·크기·굵기·줄간격
  function paraStyle(ha, pt, bold, ls) {
    var st = 'text-align:' + (HAMAP[ha] || 'left') + ';';
    if (pt) st += 'font-size:' + pt + 'pt;';
    if (bold) st += 'font-weight:bold;';
    if (ls) st += 'line-height:' + (ls / 100) + ';';
    return st;
  }

  /* 편집/계산 셀 (2p 서류표목 · 3p 수수료). 해당 셀만 커스텀 HTML, 아니면 null */
  function editableCell(tIdx, ri, col, paras) {
    if (tIdx === 1 && col === 1 && ri >= 2) {
      var slot = ri - 2;
      return '<div class="gm-doc-cell" contenteditable="true" data-doc="' + slot +
        '" oninput="gmDocEdit(this)">' + esc(docList[slot] || '') + '</div>';
    }
    if (tIdx === 2) {
      if (ri >= 3 && ri <= 6 && col === 1) {
        var fi = ri - 3;
        var txt = (paras[0] && paras[0][1]) || '';
        var unit = (txt.indexOf('장') >= 0) ? '장' : '건';
        return '<div style="text-align:center"><span class="gm-fee-qtywrap">(<input class="gm-fee-qty" data-fee="' + fi +
          '" type="text" inputmode="numeric" value="' + (feeQty[fi] || 0) +
          '" oninput="gmFee()">)' + unit + '</span></div>';
      }
      if (ri >= 3 && ri <= 6 && col === 3) {
        return '<div style="text-align:right;padding-right:1mm"><span class="gm-fee-amt" data-fee="' + (ri - 3) + '">0</span> 원</div>';
      }
      if (ri === 7 && col === 2) {
        return '<div style="text-align:right;padding-right:1mm"><span class="gm-fee-total">0</span> 원</div>';
      }
    }
    return null;
  }

  function feeText(s) {
    s = s.replace('(합계금 숫자)', '<span class="gm-fee-total-num">0</span>');
    s = s.replace('(금액 한글로, (예시 오 백원))', '<span class="gm-fee-total-kr">영</span>');
    return s;
  }

  // 표 하나를 원본 좌표대로 그림 (tIdx: 편집/계산 셀 판별)
  function renderTable(tbl, tok, tIdx) {
    var total = 0; for (var i = 0; i < tbl.w.length; i++) total += tbl.w[i];
    var h = '<table class="gm-tbl" style="width:' + (Math.round(total * 100) / 100) + 'mm"><colgroup>';
    for (i = 0; i < tbl.w.length; i++) h += '<col style="width:' + tbl.w[i] + 'mm">';
    h += '</colgroup><tbody>';
    tbl.r.forEach(function (row, ri) {
      h += '<tr style="height:' + row.h + 'mm">';
      row.c.forEach(function (c) {
        var col = c[0], cs = c[1], rs = c[2], bf = c[3], va = c[4], paras = c[5];
        var st = bfStyle(bf) + 'vertical-align:' + (VAMAP[va] || 'middle') + ';';
        var custom = editableCell(tIdx, ri, col, paras);
        var inner;
        if (custom != null) {
          inner = custom;
        } else {
          inner = paras.map(function (p) {
            var body = wrapSign(fillTokens(esc(p[1]), tok));
            if (tIdx === 2) body = feeText(body);
            return '<div style="' + paraStyle(p[0], p[2], p[3], 0) + '">' + body + '</div>';
          }).join('');
        }
        h += '<td' + (cs > 1 ? ' colspan="' + cs + '"' : '') +
          (rs > 1 ? ' rowspan="' + rs + '"' : '') + ' style="' + st + '">' + inner + '</td>';
      });
      h += '</tr>';
    });
    return h + '</tbody></table>';
  }

  // 문단 블록 1개 렌더 (['p', ha, pt, bold, ls, text])
  function renderPara(b, tok) {
    var content = wrapSign(fillTokens(esc(b[5]), tok));
    if (content === '') content = ' ';
    return '<div class="gm-para" style="' + paraStyle(b[1], b[2], b[3], b[4]) + '">' +
      content + '</div>';
  }

  /* ── 서면 렌더 (6페이지, HWPX 원본 흐름 GM_DOC) ── */
  function renderGeomchal(v) {
    v = v || {};
    var tok = {
      attorney: esc(v.attorney || '서고은'),
      birth: esc(v.birth || ''),
      regno: esc(v.regno || FIRM_REGNO),
      casenum: esc(v.casenum || ''),
      position: esc(v.position || ''),
      client: esc(v.client || ''),
      charge: esc(v.charge || ''),
      writeDate: esc(v.writeDate || ''),
      office: esc(v.prosOffice || PROS_OFFICE_DEFAULT),
      clerk: esc(v.clerk || ''),
      clerkBirth: esc(v.clerkBirth || '')
    };
    var html = GM_DOC.map(function (page) {
      return '<div class="gm-page">' + page.map(function (b) {
        return (b[0] === 'tbl') ? renderTable(GM_TBL[b[1]], tok, b[1]) : renderPara(b, tok);
      }).join('') + '</div>';
    }).join('');
    return html;
  }

  /* ══════════════════════════════════════════════════════════════
     전용 CSS 주입 (1회)
     ══════════════════════════════════════════════════════════════ */
  var STYLE_ID = 'geomchal-style';
  var GM_CSS =
      '.gm-wrap{overflow:auto;padding:16px;background:#e9e9ec;min-height:100%;}' +
      /* A4 폭 + HWPX 마진(상20·좌우10·하10mm). 화면 높이는 내용에 맞춤(과도한 아래 여백 제거),' +
         쪽당 A4 는 인쇄 규칙(@page + page-break)로 보장. 회색 음영은 인쇄에도 유지. */
      '.gm-page{width:210mm;background:#fff;margin:0 auto 16px;box-sizing:border-box;' +
        'padding:20mm 10mm 12mm 10mm;-webkit-print-color-adjust:exact;print-color-adjust:exact;' +
        "font-family:'함초롬바탕','HCR Batang','바탕',Batang,serif;color:#000;}" +
      /* 표: border-collapse 로 공유변 병합(원본 테두리 모델과 동일). 열너비는 colgroup 고정 */
      '.gm-tbl{border-collapse:collapse;table-layout:fixed;margin:0 auto;-webkit-print-color-adjust:exact;print-color-adjust:exact;}' +
      '.gm-tbl td{padding:0.2mm 1mm;line-height:1.18;word-break:keep-all;vertical-align:middle;' +
        'font-size:10pt;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact;}' +
      '.gm-tbl td>div{white-space:pre-wrap;}' +
      /* 문단(서약서·위임장 등 표 밖 텍스트). 줄간격은 문단별 인라인(원본 lineSpacing) */
      '.gm-para{white-space:pre-wrap;font-size:10pt;word-break:keep-all;tab-size:6;-moz-tab-size:6;}' +
      /* 2p 서류표목 편집칸 */
      '.gm-doc-cell{min-height:1em;outline:none;cursor:text;}' +
      '.gm-doc-cell:focus{background:#eef4ff;}' +
      '@media print{.gm-doc-cell:focus{background:transparent;}}' +
      /* 3p 수수료 입력·계산 */
      '.gm-fee-qtywrap{white-space:nowrap;}' +
      '.gm-fee-qty{width:2.2em;border:none;border-bottom:0.2mm solid #888;background:#eef4ff;' +
        'font:inherit;text-align:center;padding:0;margin:0;-webkit-appearance:none;}' +
      '@media print{.gm-fee-qty{background:transparent;border-bottom:none;}}' +
      '.gm-fee-amt,.gm-fee-total{font-weight:600;}' +
      /* 서명란 클릭-날인 */
      '.gm-sign-slot{cursor:pointer;position:relative;}' +
      /* 도장: 서명 슬롯 기준 절대배치로 이름 위에 겹쳐 찍음(칸/줄 안 늘림) */
      '.gm-seal{width:1.8cm;height:1.8cm;position:absolute;left:-1.2em;top:50%;' +
        'transform:translateY(-50%);z-index:5;pointer-events:none;}' +
      '@media print{.gm-sign-slot{cursor:auto;}}' +
      /* 입력폼 (오버레이) */
      '#geomchalForm{display:none;position:fixed;inset:0;z-index:1100;background:#fff;flex-direction:column;}' +
      '#geomchalForm.active{display:flex;}' +
      /* 인쇄 */
      '@media print{' +
        '.gm-wrap{overflow:visible;padding:0;background:#fff;}' +
        '.gm-page{margin:0;box-shadow:none;page-break-after:always;}' +
        '.gm-page:last-child{page-break-after:auto;}' +
        '@page{size:A4;margin:0;}' +
      '}';
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID; s.textContent = GM_CSS;
    document.head.appendChild(s);
  }

  /* ══════════════════════════════════════════════════════════════
     화면 껍데기 (입력폼 + 서면)
     ══════════════════════════════════════════════════════════════ */
  var SHELL_ID = 'geomchal-shell';
  function injectShell() {
    if (document.getElementById(SHELL_ID)) return;
    var attOpts = ATTORNEYS.map(function (a) {
      return '<option value="' + esc(a.name) + '"' + (a.name === '서고은' ? ' selected' : '') + '>' + esc(a.name) + '</option>';
    }).join('');
    var clerkOpts = '<option value="">(선택 안 함)</option>' + loadClerks().map(function (c) {
      return '<option value="' + esc(c.name) + '">' + esc(c.name) + '</option>';
    }).join('');

    var wrap = document.createElement('div');
    wrap.id = SHELL_ID;
    wrap.innerHTML =
      '<div id="geomchalForm">' +
        '<div class="fs-card">' +
        '<div class="fs-head">' +
          '<button class="fs-close" onclick="closeGeomchalForm()" aria-label="닫기"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
          '<div class="fs-title">열람·등사 신청서 (검찰)</div>' +
        '</div>' +
        '<div class="fs-body">' +
          '<div class="fs-section">사건 정보</div>' +
          '<div class="fs-field"><label class="fs-label">의뢰인</label><input type="text" class="fs-input" id="gm-client" data-af="l_client" placeholder="홍길동"></div>' +
          '<div class="fs-field"><label class="fs-label">지위</label><input type="text" class="fs-input" id="gm-position" data-af="client_position" placeholder="피의자"></div>' +
          '<div class="fs-field"><label class="fs-label">사건번호 (형제번호)</label><input type="text" class="fs-input" id="gm-casenum" data-af="l_code" placeholder="2026형제11173"></div>' +
          '<div class="fs-field"><label class="fs-label">죄명</label><input type="text" class="fs-input" id="gm-charge" data-af="l_name" placeholder="횡령"></div>' +
          '<div class="fs-field"><label class="fs-label">검찰청</label><input type="text" class="fs-input" id="gm-prosoffice" value="' + esc(PROS_OFFICE_DEFAULT) + '"></div>' +
          '<div class="fs-field"><label class="fs-label">작성일 (오늘 자동)</label><input type="date" class="fs-input" id="gm-writedate"></div>' +
          '<div class="fs-section">신청인</div>' +
          '<div class="fs-field"><label class="fs-label">담당변호사</label><select class="fs-input" id="gm-attorney">' + attOpts + '</select></div>' +
          '<div class="fs-field"><label class="fs-label">담당사무원 <span class="fs-hint">(위임장·서약서②용)</span></label><select class="fs-input" id="gm-clerk">' + clerkOpts + '</select></div>' +
        '</div>' +
        '<div class="fs-foot">' +
          '<button class="fs-btn ghost" onclick="closeGeomchalForm()">취소</button>' +
          '<button class="fs-btn primary" onclick="applyGeomchalForm()">완료</button>' +
        '</div>' +
        '</div>' +
      '</div>' +
      '<div id="screen-geomchal" class="screen">' +
        '<div class="sj-appbar no-print">' +
          '<button class="sj-back" onclick="showScreen(\'screen-home\')">‹ 처음으로</button>' +
          '<div class="sj-title">열람·등사 신청서 (검찰)</div>' +
          '<button class="sj-edit-btn" onclick="editGeomchal()">수정</button>' +
          '<button class="sj-print-btn" onclick="window.print()">출력</button>' +
        '</div>' +
        '<div class="gm-wrap"><div id="gm-host"></div></div>' +
      '</div>';
    document.body.appendChild(wrap);
  }

  /* ══════════════════════════════════════════════════════════════
     상태 & 진입점
     ══════════════════════════════════════════════════════════════ */
  var state = null;
  function ensureUI() { injectStyle(); injectShell(); }

  /* ── 2p 서류 목록 · 3p 수수료 수량 (서면 위에서 편집, 렌더 간 유지) ── */
  var DOC_DEFAULT = ['증거기록', '소송기록 일체, 미디어파일 일체(CD 등)'];
  var docList = DOC_DEFAULT.slice();
  var feeQty = [0, 1, 0, 0];   // 열람·등사·등본·초본 (등사 기본 1건)
  var FEE_UNIT = [500, 500];   // 열람·등사 = 건당 500

  // 서류표목 편집 → 목록 갱신
  window.gmDocEdit = function (el) {
    var i = parseInt(el.getAttribute('data-doc'), 10);
    if (!isNaN(i)) docList[i] = el.textContent;
  };

  // 숫자 → 한글 금액(합계 '일금')
  function numKorean(n) {
    n = Math.round(n || 0); if (n === 0) return '영';
    var d = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
    var u = ['', '십', '백', '천'], big = ['', '만', '억', '조'];
    var s = '', gi = 0;
    while (n > 0) {
      var grp = n % 10000; n = Math.floor(n / 10000);
      if (grp > 0) {
        var gs = '', t = grp, ui = 0;
        while (t > 0) { var dig = t % 10; if (dig > 0) gs = d[dig] + u[ui] + gs; t = Math.floor(t / 10); ui++; }
        s = gs + big[gi] + s;
      }
      gi++;
    }
    return s;
  }

  // 수수료 계산: 수량 입력 → 금액·합계 갱신 (법정 계산)
  window.gmFee = function () {
    var qs = document.querySelectorAll('.gm-fee-qty');
    for (var k = 0; k < qs.length; k++) {
      var fi = parseInt(qs[k].getAttribute('data-fee'), 10);
      feeQty[fi] = parseInt(('' + qs[k].value).replace(/[^0-9]/g, ''), 10) || 0;
    }
    var amt = [0, 0, 0, 0];
    amt[0] = feeQty[0] * 500;                                   // 열람: 건×500
    amt[1] = feeQty[1] * 500;                                   // 등사: 건×500
    amt[2] = feeQty[2] > 0 ? 1000 + Math.max(0, feeQty[2] - 5) * 50 : 0; // 등본: 5장 1000, 초과 50
    amt[3] = feeQty[3] > 0 ? 1000 + Math.max(0, feeQty[3] - 5) * 50 : 0; // 초본: 5 1000, 초과 50
    var total = amt[0] + amt[1] + amt[2] + amt[3];
    document.querySelectorAll('.gm-fee-amt').forEach(function (el) {
      var i = parseInt(el.getAttribute('data-fee'), 10);
      el.textContent = amt[i].toLocaleString();
    });
    var tt = document.querySelector('.gm-fee-total'); if (tt) tt.textContent = total.toLocaleString();
    var tn = document.querySelector('.gm-fee-total-num'); if (tn) tn.textContent = total.toLocaleString();
    var tk = document.querySelector('.gm-fee-total-kr'); if (tk) tk.textContent = numKorean(total);
  };

  window.openGeomchalForm = function () {
    ensureUI();
    docList = DOC_DEFAULT.slice(); feeQty = [0, 1, 0, 0];   // 새 문서 → 서류/수수료 초기화(등사 기본 1건)
    document.getElementById('gm-client').value = '';
    document.getElementById('gm-position').value = '';
    document.getElementById('gm-casenum').value = '';
    document.getElementById('gm-charge').value = '';
    document.getElementById('gm-prosoffice').value = PROS_OFFICE_DEFAULT;
    document.getElementById('gm-writedate').value = todayISO();
    document.getElementById('gm-attorney').value = '서고은';
    document.getElementById('gm-clerk').value = '';
    document.getElementById('geomchalForm').classList.add('active');
    if (typeof initAutofillFor === 'function') initAutofillFor('gm-casenum');
  };

  window.closeGeomchalForm = function () {
    var f = document.getElementById('geomchalForm');
    if (f) f.classList.remove('active');
  };

  /* ── 서명란 클릭 → 도장 날인(토글) ──
     실제 도장처럼 서명 위에 겹쳐 찍는다(절대배치 → 칸/줄 안 늘어남, 글자와 겹쳐도 무방).
     담당변호사가 서고은이고 전역 직인(SEAL_SEOGOEUN)이 있을 때. 다시 클릭하면 제거. */
  window.gmStamp = function (el) {
    if (!el) return;
    var exist = el.querySelector('.gm-seal');
    if (exist) { exist.parentNode.removeChild(exist); return; }   // 토글 제거
    var att = state && state.attorney;
    var seal = (typeof SEAL_SEOGOEUN !== 'undefined') ? SEAL_SEOGOEUN : '';
    if (att !== '서고은' || !seal) {
      if (typeof showToast === 'function') showToast('서고은 변호사만 직인이 등록돼 있습니다 (그 외는 실물 날인)');
      return;
    }
    var img = document.createElement('img');
    img.className = 'gm-seal'; img.src = seal; img.alt = '';
    el.appendChild(img);   // 슬롯(position:relative) 기준 절대배치 → 이름 위에 겹쳐 찍힘
  };

  window.applyGeomchalForm = function () {
    var attorney = (document.getElementById('gm-attorney') || {}).value || '서고은';
    var clerk = (document.getElementById('gm-clerk') || {}).value || '';
    state = {
      attorney: attorney,
      birth: attorneyBirth(attorney),
      regno: FIRM_REGNO,
      client: (document.getElementById('gm-client') || {}).value || '',
      position: (document.getElementById('gm-position') || {}).value || '',
      casenum: (document.getElementById('gm-casenum') || {}).value || '',
      charge: (document.getElementById('gm-charge') || {}).value || '',
      prosOffice: (document.getElementById('gm-prosoffice') || {}).value || PROS_OFFICE_DEFAULT,
      clerk: clerk,
      clerkBirth: clerkBirth(clerk),
      writeDate: fmtKDate((document.getElementById('gm-writedate') || {}).value || todayISO())
    };
    document.getElementById('gm-host').innerHTML = renderGeomchal(state);
    if (typeof window.gmFee === 'function') window.gmFee();   // 수수료 초기 계산
    closeGeomchalForm();
    if (typeof showScreen === 'function') showScreen('screen-geomchal');
  };

  window.editGeomchal = function () {
    ensureUI();
    if (!state) { window.openGeomchalForm(); return; }
    document.getElementById('gm-client').value = state.client || '';
    document.getElementById('gm-position').value = state.position || '';
    document.getElementById('gm-casenum').value = state.casenum || '';
    document.getElementById('gm-charge').value = state.charge || '';
    document.getElementById('gm-prosoffice').value = state.prosOffice || PROS_OFFICE_DEFAULT;
    document.getElementById('gm-attorney').value = state.attorney || '서고은';
    document.getElementById('gm-clerk').value = state.clerk || '';
    var m = ('' + (state.writeDate || '')).match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
    document.getElementById('gm-writedate').value = m
      ? m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) : todayISO();
    document.getElementById('geomchalForm').classList.add('active');
    if (typeof initAutofillFor === 'function') initAutofillFor('gm-casenum');
  };

  /* node 검증용 */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { renderGeomchal: renderGeomchal, GM_CSS: GM_CSS, fmtKDate: fmtKDate, normBirth: normBirth };
  }

})();
