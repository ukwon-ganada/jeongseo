/* 법무법인 정서 PWA - 기일연기/변경신청서 (yeongi.js)
   ───────────────────────────────────────────────────────────────
   독립 모듈. index.html 에는 진입점 버튼 + <script src="yeongi.js"> 만 둔다.
   화면(입력폼·출력미리보기)·전용 CSS 는 이 파일이 <body>에 1회 주입한다.

   흐름(단일 단계):
     goYeongi() → [데이터 입력 폼] → [📄 한글 다운로드] (확인창 없음)
     · 사유 작성 = Supabase Edge Function 'draft-yeongi'(Claude) 호출 (API키는 서버 시크릿)
     · 한글 다운로드 = templates/*.hwpx 를 JSZip 으로 채워 다운로드 (시크릿 불필요)
     · 도장 날인(선택) = 담당변호사 첫 번째가 '서고은'일 때, HWPX에 직인 이미지를 담당변호사
       '은' 위에 겹쳐 삽입(지름 1.5cm). 체크 해제 시 이미지 없이 기존과 동일한 파일.

   검색 자동연동(autofill.js onFill):
     · 이름/사건번호로 검색 → 우리 의뢰인의 지위(원고·피고·신청인·피신청인·채권자·채무자) 자동선택
     · 형사/민사 자동판별 · 사건명(사건번호+사건명) · 재판부(법원+재판부) 자동조합
     · 지정된 기일 = 가장 가까운 기일(next_date, 날짜만) 자동, 기일종류(선고/변론) 자동

   분기:
     · 형사      : 피고인의 (국선)변호인, 단일 서명
     · 민사 동의  : 앞/뒤 양측 소송대리인, '위 동의함', 위동의함부터 2페이지
     · 민사 부동의 / 대리인부존재 : 우리측 소송대리인만, 부동의 문구, 자동맞춤 v4

   의존: showScreen · initAutofillFor(autofill.js) · JU(util.js) · FSDoc(fsdoc.js)
        · renderAttChips/addAttorney/attChipClick(index.html) · SUPABASE_URL·SUPABASE_KEY · JSZip(CDN)
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var TPL = {
    criminal: './templates/yeongi_criminal.hwpx',
    consent: './templates/yeongi_civil_consent.hwpx',
    dissent: './templates/yeongi_civil_dissent.hwpx',
    bojeong: './templates/yeongi_bojeong.hwpx'
  };
  var BUDGET_PT = 590;        // A4 1장 예산(머리/꼬리말 반영 ~601pt - 여유)
  var ROLE_LABEL = {          // 상단 칸 라벨(정렬 공백 포함)
    '피고인': '피 고 인', '원고': '원    고', '피고': '피    고',
    '신청인': '신 청 인', '피신청인': '피신청인', '채권자': '채 권 자', '채무자': '채 무 자'
  };
  // 당사자쌍: [앞(원고측) 지위, 뒤(피고측) 지위]
  var PAIR = { wongo: ['원고', '피고'], sincheong: ['신청인', '피신청인'], chaegwon: ['채권자', '채무자'] };
  var INTRO_CIVIL = '위 사건에 관하여 {dt}으로 {kind}기일이 지정되었으나, 귀 재판부께서 다음과 같은 사유를 혜량해주시어 {kind}기일을 변경하여 주시기 요청드립니다.';
  var DISSENT_BODY = '상대방 소송대리인에게 그 동의를 구하였으나, 부동의하여 부득이 일방으로 제출하게 되었습니다.';
  var NOAGENT_BODY = '상대방의 소송대리인이 지정되어 있지 아니하여 그 동의를 구할 수 없어 부득이 일방으로 제출하게 되었습니다.';

  function esc(v) { return JU.esc(v); }
  function todayISO() { return JU.todayISO(); }
  function xmlEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function fnUrl(name) { return (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '') + '/functions/v1/' + name; }
  function cleanCaseName(name) { return String(name || '').replace(/\[전자\]\s*/g, '').trim(); }
  function normDate(s) {
    var m = String(s || '').match(/(\d{4})[-.\/]?\s*(\d{1,2})[-.\/]?\s*(\d{1,2})/);
    if (!m) return '';
    return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  }
  function splitCsv(v) { return String(v || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean); }
  function introCivil(dt, kind) { return INTRO_CIVIL.replace('{dt}', dt || '').replace(/\{kind\}/g, kind || '변론'); }
  // 창고 지위 → 당사자쌍 유형 + 우리측(앞=0/뒤=1) — autofill.mapMgPosition 과 동일 규칙
  function mapPos(position) {
    if (!position) return null;
    var p = String(position);
    if (p.indexOf('피신청인') >= 0) return { ptype: 'sincheong', idx: 1 };
    if (p.indexOf('신청인') >= 0) return { ptype: 'sincheong', idx: 0 };
    if (p.indexOf('채무자') >= 0) return { ptype: 'chaegwon', idx: 1 };
    if (p.indexOf('채권자') >= 0) return { ptype: 'chaegwon', idx: 0 };
    if (p.indexOf('피고') >= 0 && p.indexOf('피고인') < 0) return { ptype: 'wongo', idx: 1 };
    if (p.indexOf('원고') >= 0) return { ptype: 'wongo', idx: 0 };
    return null;
  }

  /* ══════════════════════════════════════════════════════════════
     HWPX 채우기 엔진 (Python 프로토타입 이식) — 서식 보존, 텍스트만 치환.
     ══════════════════════════════════════════════════════════════ */
  var PARA_RE = /<hp:p\b[\s\S]*?<\/hp:p>/g;

  function splitParas(sec) { return sec.match(PARA_RE) || []; }
  function headOf(sec, paras) { return sec.slice(0, sec.indexOf(paras[0])); }
  function tailOf(sec) { var i = sec.lastIndexOf('</hp:p>'); return sec.slice(i + 7); }
  function pText(p) {
    var out = '', re = /<hp:t>([\s\S]*?)<\/hp:t>/g, m;
    while ((m = re.exec(p))) out += m[1].replace(/<[^>]+>/g, '');
    return out;
  }
  function setT(p, txt) { return p.replace(/<hp:t>[\s\S]*?<\/hp:t>/, '<hp:t>' + xmlEsc(txt) + '</hp:t>'); }
  function setNthT(p, n, txt) {
    var i = -1;
    return p.replace(/<hp:t>[\s\S]*?<\/hp:t>/g, function (m) { i++; return i === n ? '<hp:t>' + xmlEsc(txt) + '</hp:t>' : m; });
  }
  function setRun9(p, txt) {
    return p.replace(/(charPrIDRef="9"><hp:t>)[\s\S]*?(<\/hp:t>)/, '$1' + xmlEsc(txt) + '$2');
  }
  function setPB(p) { return p.replace(/pageBreak="0"/, 'pageBreak="1"'); }
  // 당사자 칸: 라벨(정렬 공백 포함) + 4칸 공백 + 이름
  function partyRow(label, name) { return (ROLE_LABEL[label] || label) + '    ' + (name || ''); }

  function units(t) { var u = 0; for (var i = 0; i < t.length; i++) u += t.charCodeAt(i) >= 0x1100 ? 1 : 0.5; return u; }
  function estimateList(paras, hdr, sp220) {
    var ls = {}, ch = {}, m;
    var lre = /<hh:paraPr id="(\d+)"[\s\S]*?<hh:lineSpacing[^>]*value="(\d+)"/g;
    while ((m = lre.exec(hdr))) ls[m[1]] = parseInt(m[2], 10);
    var cre = /<hh:charPr id="(\d+)" height="(\d+)"/g;
    while ((m = cre.exec(hdr))) ch[m[1]] = parseInt(m[2], 10);
    var tot = 0;
    for (var i = 0; i < paras.length; i++) {
      var p = paras[i];
      var ppr = (p.match(/paraPrIDRef="(\d+)"/) || [])[1];
      var cpr = (p.match(/charPrIDRef="(\d+)"/) || [])[1];
      var sp = ls[ppr] != null ? ls[ppr] : 160; if (sp === 220) sp = sp220;
      var pt = (cpr != null && ch[cpr] != null ? ch[cpr] : 1200) / 100;
      var t = pText(p), cpl = Math.max(1, 36 * 12 / pt);
      var lines = t.trim() ? Math.max(1, Math.ceil(units(t) / cpl)) : 1;
      tot += lines * pt * sp / 100;
    }
    return tot;
  }
  function planPage(out, hdr, dateKey) {
    if (estimateList(out, hdr, 220) <= BUDGET_PT) return [220, -1];
    if (estimateList(out, hdr, 190) <= BUDGET_PT) return [190, -1];
    var dateI = -1, attachI = -1;
    for (var i = 0; i < out.length; i++) {
      var t = pText(out[i]).trim();
      if (dateI < 0 && t.indexOf(dateKey) >= 0) dateI = i;
      if (attachI < 0 && (t === '첨부서류' || t === '첨 부 서 류')) attachI = i;
    }
    if (dateI >= 0 && estimateList(out.slice(0, dateI), hdr, 220) <= BUDGET_PT) return [220, dateI];
    if (attachI >= 0) return [220, attachI];
    return [220, dateI];
  }
  function applySpacing(hdr, sp) {
    return sp === 220 ? hdr : hdr.replace(/(<hh:lineSpacing[^>]*value=")220(")/g, '$1' + sp + '$2');
  }
  function fixIntent(hdr, bodyPpr, val) {
    var re = new RegExp('<hh:paraPr id="' + bodyPpr + '"[\\s\\S]*?</hh:paraPr>');
    return hdr.replace(re, function (blk) { return blk.replace(/(<hc:intent value=")-?\d+(")/, '$1' + val + '$2'); });
  }

  // ── 형사 ──
  function fillCriminal(sec, hdr, c) {
    var P = splitParas(sec), head = headOf(sec, P), tail = tailOf(sec);
    var plural = c.parties.length > 1, gukseon = !!c.gukseon;
    var role = c.role || '피고인', label = ROLE_LABEL[role] || role;
    var title = (c.titleKind || '') + '기일' + (c.titleAction || '변경') + '신청서';
    var p0 = P[0].replace(/<hp:t>[\s\S]*?기일[\s\S]*?신청서<\/hp:t>/, '<hp:t>' + xmlEsc(title) + '</hp:t>');
    var pCase = setT(P[2], '사    건  ' + c.caseLine);
    var pParty = setT(P[3], label + '  ' + c.parties.join(', '));
    var pReason = setT(P[6], c.reason);
    var pDate = setT(P[12], c.date);
    var sig = '  위 ' + role + (plural ? '들' : '') + '의 ' + (gukseon ? '국선변호인' : '변호인');
    var pSig = setT(P[13], sig);
    var pCourt = setT(P[17], c.court + ' 귀중');
    var lw = c.lawyers;
    var pLaw = setRun9(P[15], '담당변호사 ' + lw[0]);
    var extra = [];
    for (var i = 1; i < lw.length; i++) extra.push(setRun9(P[15], '　　　　　 ' + lw[i]));

    var pWish = c.wish ? setT(P[6], ' ※희망기일- ' + c.wish) : null;
    var out = [p0, P[1], pCase, pParty, P[4], P[5], pReason];
    if (pWish) out.push(pWish);
    out.push(P[7]);
    var attach = c.attachments || [];
    if (attach.length) {
      out.push(setT(P[8], '첨 부 서 류'));
      for (var j = 0; j < attach.length; j++) out.push(setT(P[9], (j + 1) + '. ' + attach[j]));
      out.push(P[11]);
    }
    out.push(pDate); out.push(pSig);
    if (!gukseon) out.push(P[14]);
    out.push(pLaw); out = out.concat(extra);
    out.push(P[16]); out.push(pCourt);

    var bodyPpr = (P[6].match(/paraPrIDRef="(\d+)"/) || [])[1];
    hdr = fixIntent(hdr, bodyPpr, 1321);
    var plan = planPage(out, hdr, c.date), sp = plan[0], brk = plan[1];
    if (brk >= 0) out[brk] = setPB(out[brk]);
    return [head + out.join('') + tail, applySpacing(hdr, sp)];
  }

  // ── 민사 부동의 / 대리인부존재 (dissent 템플릿) ──
  function fillCivilDissent(sec, hdr, c) {
    var P = splitParas(sec), head = headOf(sec, P), tail = tailOf(sec);
    var role = c.role;
    var kindWord = c.titleKind === '선고' ? '선고' : '변론';
    var title = (c.titleKind || '변론') + '기일' + (c.titleAction || '변경') + '신청서';
    var p0 = P[0].replace(/<hp:t>[\s\S]*?신청서<\/hp:t>/, '<hp:t>' + xmlEsc(title) + '</hp:t>');
    var out = [
      p0, P[1],
      setT(P[2], '사    건    ' + c.caseLine),
      setT(P[3], partyRow(c.frontLabel, c.frontName)),
      setT(P[4], partyRow(c.backLabel, c.backName)),
      P[5],
      setT(P[6], introCivil(c.hearingDt, kindWord)),
      P[7], P[8], P[9],
      setT(P[10], '변경신청사유 : ' + c.reason),
      P[11],
      setNthT(P[12], 1, c.noAgent ? NOAGENT_BODY : DISSENT_BODY),
      P[13],
      setT(P[14], ' ※희망기일- ' + c.wish),
      P[15]
    ];
    var attach = c.attachments || [];
    if (attach.length) {
      out.push(setT(P[16], '첨부서류'));
      for (var j = 0; j < attach.length; j++) out.push(setT(P[18], (j + 1) + '. ' + attach[j]));
      out.push(P[19]);
    }
    out.push(setT(P[21], c.date));
    out.push(P[22]);
    out.push(setT(P[23], '                                   위 ' + role + '의 소송대리인'));
    var lw = c.lawyers;
    out.push(P[24].replace(/담당변호사 [^<]*/, '담당변호사 ' + lw[0]));
    for (var k = 1; k < lw.length; k++) out.push(setT(P[25], '                                                  ' + lw[k]));
    out.push(P[27]); out.push(setT(P[28], c.court + ' 귀중'));

    var plan = planPage(out, hdr, c.date), sp = plan[0], brk = plan[1];
    if (brk >= 0) out[brk] = setPB(out[brk]);
    return [head + out.join('') + tail, applySpacing(hdr, sp)];
  }

  // ── 보정기한연기신청서 (bojeong 템플릿) — 짧은 서면(자동맞춤 불필요) ──
  //  P: 0 제목 · 2 사건 · 3 앞당사자 · 4 뒤당사자 · 6 사유(본문) · 10 작성일
  //     12 우리지위 소송대리인 · 13 법무법인 정서 · 14 담당변호사 · 17 법원 귀중
  function fillBojeong(sec, hdr, c) {
    var P = splitParas(sec), head = headOf(sec, P), tail = tailOf(sec);
    var lw = c.lawyers || ['서고은'];
    var out = [
      P[0], P[1],
      setT(P[2], '사    건    ' + c.caseLine),
      setT(P[3], partyRow(c.frontLabel, c.frontName)),
      setT(P[4], partyRow(c.backLabel, c.backName)),
      P[5],
      setT(P[6], c.reason),
      P[7], P[8], P[9],
      setT(P[10], c.date),
      P[11],
      setT(P[12], '          ' + c.role + ' 소송대리인 '),
      P[13],
      setT(P[14], '                                    담당변호사 ' + lw[0])
    ];
    for (var i = 1; i < lw.length; i++) out.push(setT(P[14], '                                    ' + lw[i]));
    out.push(P[15]); out.push(P[16]);
    out.push(setT(P[17], c.court + ' 귀중'));
    return [head + out.join('') + tail, hdr];
  }

  // ── 민사 동의 (consent 템플릿) ──
  function fillCivilConsent(sec, hdr, c) {
    var P = splitParas(sec), head = headOf(sec, P), tail = tailOf(sec);
    var lw = c.lawyers;
    var kindWord = c.titleKind === '선고' ? '선고' : '변론';
    var title = (c.titleKind || '') + '기일' + (c.titleAction || '변경') + ' 신청서';
    var oppLabel = c.ourIdx === 1 ? c.frontLabel : c.backLabel;
    P[0] = P[0].replace(/<hp:t>[\s\S]*?신청서<\/hp:t>/, '<hp:t>' + xmlEsc(title) + '</hp:t>');
    P[2] = setT(P[2], '사    건    ' + c.caseLine);
    P[3] = setT(P[3], partyRow(c.frontLabel, c.frontName));
    P[4] = setT(P[4], partyRow(c.backLabel, c.backName));
    P[6] = setT(P[6], introCivil(c.hearingDt, kindWord));
    P[10] = setT(P[10], '변경신청사유 : ' + c.reason);
    P[16] = setT(P[16], ' ※희망기일- ' + c.wish);
    P[22] = setT(P[22], c.date);
    var consent = setT(P[21], '위 동의함.');
    var court = setT(P[32], c.court + ' 귀중');
    function ourBlock(headLabel) {
      var rows = [setT(P[24], headLabel), setT(P[25], '법무법인 정서'), setT(P[30], '담당 변호사  ' + lw[0])];
      for (var i = 1; i < lw.length; i++) rows.push(setT(P[30], '                    ' + lw[i]));
      return rows;
    }
    function oppBlock(headLabel) {
      return [setT(P[24], headLabel), setT(P[25], c.oppOffice), setT(P[26], '변호사 ' + c.oppLawyer)];
    }
    var out = P.slice(0, 12);
    var attach = c.attachments || [];
    if (attach.length) {
      out.push(setT(P[12], '첨 부 서 류')); out.push(P[13]);
      for (var j = 0; j < attach.length; j++) out.push(setT(P[14], (j + 1) + '. ' + attach[j]));
      out.push(P[15]);
    }
    out = out.concat([P[16], P[17], P[18], P[19], P[20]]);
    if (c.ourIdx === 1) { // 우리가 뒤(피고측): 위동의함부터 2페이지
      out.push(setPB(consent)); out.push(P[22]); out.push(P[23]);
      out = out.concat(oppBlock('위 ' + c.frontLabel + '의 소송대리인'), [P[27]]);
      out = out.concat(ourBlock('위 ' + c.backLabel + '의 소송대리인'));
      out.push(P[31]); out.push(court);
    } else {              // 우리가 앞(원고측)
      out.push(P[22]); out.push(P[23]);
      out = out.concat(ourBlock('위 ' + c.frontLabel + '의 소송대리인'), [P[27]]);
      out.push(setPB(consent));
      out = out.concat(oppBlock('위 ' + c.backLabel + '의 소송대리인'));
      out.push(P[31]); out.push(court);
    }
    return [head + out.join('') + tail, hdr]; // 동의는 220% 유지(무조건 2페이지)
  }

  /* ── 도장(직인) 이미지 삽입 (HWPX/OWPML) ──
     · window.SEAL_SEOGOEUN(base64 PNG)을 BinData/image1.png 로 넣고,
       header refList 에 binData, content.hpf 에 manifest item 을 추가한 뒤,
       담당변호사('서고은') 문단에 떠 있는(플로팅) 그림 run 을 넣어 '은' 위에 겹친다.
     · 위치/크기 상수는 아래에서 조정(1.5cm 실제 도장 크기). */
  var SEAL_MM = 15;                                             // 지름 1.5cm
  var SEAL_HU = Math.round(SEAL_MM / 10 * 7200 / 2.54);         // ≈4252 HWPUNIT
  var SEAL_HOFF = 700;   // 오른쪽정렬 기준 가로 미세조정(+오른쪽/−왼쪽) — '은'에 맞춤
  var SEAL_VOFF = -1150; // 글자 줄 위로 끌어올려 겹치게(−위)

  function dataUrlToU8(u) {
    var b64 = String(u || '').split(',')[1] || '';
    var bin = atob(b64), a = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }
  function pngSize(u8) { // PNG IHDR width/height (offset 16..23)
    if (!u8 || u8.length < 24) return [504, 480];
    var w = ((u8[16] << 24) | (u8[17] << 16) | (u8[18] << 8) | u8[19]) >>> 0;
    var h = ((u8[20] << 24) | (u8[21] << 16) | (u8[22] << 8) | u8[23]) >>> 0;
    return [w || 504, h || 480];
  }
  function buildPic(pxW, pxH) {
    var oW = pxW * 75, oH = pxH * 75, half = Math.round(SEAL_HU / 2); // 96DPI: px×75 = HWPUNIT
    // 도장 실제 크기 = orgSz × scaMatrix. 원본 해상도와 무관하게 1.5cm(curSz)로 찍히도록 배율을 curSz/orgSz 로 준다.
    var cW = SEAL_HU, cH = Math.round(SEAL_HU * pxH / pxW);   // 너비 1.5cm, 높이는 원본 비율 유지
    var sx = (cW / oW).toFixed(6), sy = (cH / oH).toFixed(6); // 배율 = 표시/원본
    return '<hp:run charPrIDRef="0">' +
      '<hp:pic reverse="0" isBWModeOnly="0" id="1932510121" zOrder="20" numberingType="PICTURE" textWrap="IN_FRONT_OF_TEXT" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="1932510121">' +
      '<hp:offset x="0" y="0"/>' +
      '<hp:orgSz width="' + oW + '" height="' + oH + '"/>' +
      '<hp:curSz width="' + cW + '" height="' + cH + '"/>' +
      '<hp:flip horizontal="0" vertical="0"/>' +
      '<hp:rotationInfo angle="0"/>' +
      '<hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="' + sx + '" e2="0" e3="0" e4="0" e5="' + sy + '" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>' +
      '<hc:img binaryItemIDRef="image1" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>' +
      '<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="' + oW + '" y="0"/><hc:pt2 x="' + oW + '" y="' + oH + '"/><hc:pt3 x="0" y="' + oH + '"/></hp:imgRect>' +
      '<hp:imgClip left="0" right="' + oW + '" top="0" bottom="' + oH + '"/>' +
      '<hp:inMargin left="0" right="0" top="0" bottom="0"/>' +
      '<hp:sz width="' + cW + '" widthRelTo="ABSOLUTE" height="' + cH + '" heightRelTo="ABSOLUTE" protect="0"/>' +
      '<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="0" allowOverlap="1" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="RIGHT" vertOffset="' + SEAL_VOFF + '" horzOffset="' + SEAL_HOFF + '"/>' +
      '<hp:outMargin left="0" right="0" top="0" bottom="0"/>' +
      '<hp:shapeComment/>' +
      '</hp:pic></hp:run>';
  }
  // 담당변호사('서고은') 문단 맨 앞에 그림 run 삽입 (없으면 원본 그대로)
  function injectSealPic(sec, pic) {
    var paras = sec.match(PARA_RE) || [];
    for (var i = 0; i < paras.length; i++) {
      var t = pText(paras[i]);
      if (t.indexOf('담당') >= 0 && t.indexOf('서고은') >= 0) {
        return sec.replace(paras[i], paras[i].replace(/^(<hp:p\b[^>]*>)/, '$1' + pic));
      }
    }
    return sec;
  }
  function injectBinData(hdr) {
    if (hdr.indexOf('<hh:binDataList') >= 0) return hdr;
    return hdr.replace('<hh:refList>', '<hh:refList><hh:binDataList itemCnt="1"><hh:binData id="1" type="EMBEDDING"/></hh:binDataList>');
  }
  function injectHpfManifest(hpf) {
    if (hpf.indexOf('BinData/image1.png') >= 0) return hpf;
    return hpf.replace('<opf:manifest>', '<opf:manifest><opf:item id="image1" href="BinData/image1.png" media-type="image/png" isEmbeded="1"/>');
  }
  function injectOdfManifest(s) {
    if (s.indexOf('BinData/image1.png') >= 0) return s;
    var entry = '<odf:file-entry odf:full-path="BinData/image1.png" odf:media-type="image/png"/>';
    if (s.indexOf('</odf:manifest>') >= 0) return s.replace('</odf:manifest>', entry + '</odf:manifest>');
    return s.replace(/<odf:manifest([^>]*)\/>/, '<odf:manifest$1>' + entry + '</odf:manifest>');
  }

  // 템플릿 로드 → 채우기 → Blob
  function loadJSZip() {
    return new Promise(function (res, rej) {
      if (window.JSZip) return res(window.JSZip);
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
      s.onload = function () { res(window.JSZip); };
      s.onerror = function () { rej(new Error('JSZip 로드 실패')); };
      document.head.appendChild(s);
    });
  }
  function buildHwpx(cfg) {
    var tpl = cfg.caseType === '보정' ? TPL.bojeong
      : cfg.caseType === '민사' ? (cfg.consent === '동의' ? TPL.consent : TPL.dissent)
        : TPL.criminal;
    var wantSeal = !!cfg.stamp && cfg.lawyers && cfg.lawyers[0] === '서고은' &&
      typeof window !== 'undefined' && window.SEAL_SEOGOEUN;
    var Zip;
    return loadJSZip()
      .then(function (JSZip) { Zip = JSZip; return fetch(tpl); })
      .then(function (r) { if (!r.ok) throw new Error('템플릿 로드 실패: ' + tpl); return r.arrayBuffer(); })
      .then(function (buf) { return Zip.loadAsync(buf); })
      .then(function (zip) {
        return Promise.all([
          zip.file('Contents/section0.xml').async('string'),
          zip.file('Contents/header.xml').async('string'),
          zip.file('mimetype').async('uint8array'),
          wantSeal ? zip.file('Contents/content.hpf').async('string') : Promise.resolve(null),
          zip
        ]);
      })
      .then(function (arr) {
        var sec = arr[0], hdr = arr[1], mime = arr[2], hpf = arr[3], zip = arr[4], out;
        if (cfg.caseType === '보정') {
          out = fillBojeong(sec, hdr, cfg);
        } else if (cfg.caseType === '민사') {
          out = (cfg.consent === '동의') ? fillCivilConsent(sec, hdr, cfg) : fillCivilDissent(sec, hdr, cfg);
        } else {
          out = fillCriminal(sec, hdr, cfg);
        }
        sec = out[0]; hdr = out[1];
        // 줄 레이아웃 캐시(linesegarray) 제거 — 원문 기준 좌표가 남으면 한글이 '손상/변조'로 차단. 한글이 열 때 재계산.
        sec = sec.replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g, '').replace(/<hp:linesegarray\s*\/>/g, '');
        var sealBin = null;
        if (wantSeal) {
          var u8 = dataUrlToU8(window.SEAL_SEOGOEUN), wh = pngSize(u8);
          var sec2 = injectSealPic(sec, buildPic(wh[0], wh[1]));
          if (sec2 !== sec) {            // 담당변호사 문단을 찾아 삽입 성공한 경우에만
            sec = sec2;
            hdr = injectBinData(hdr);
            hpf = injectHpfManifest(hpf);
            sealBin = u8;
          }
        }
        var zo = new Zip();
        zo.file('mimetype', mime, { compression: 'STORE' });
        var names = Object.keys(zip.files).filter(function (n) { return n !== 'mimetype' && !zip.files[n].dir; });
        return Promise.all(names.map(function (n) {
          if (n === 'Contents/section0.xml') return Promise.resolve([n, sec]);
          if (n === 'Contents/header.xml') return Promise.resolve([n, hdr]);
          if (n === 'Contents/content.hpf' && sealBin) return Promise.resolve([n, hpf]);
          if (n === 'META-INF/manifest.xml' && sealBin) return zip.file(n).async('string').then(function (s) { return [n, injectOdfManifest(s)]; });
          return zip.file(n).async('uint8array').then(function (d) { return [n, d]; });
        })).then(function (entries) {
          entries.forEach(function (e) { zo.file(e[0], e[1]); });
          if (sealBin) zo.file('BinData/image1.png', sealBin);
          return zo.generateAsync({ type: 'blob', mimeType: 'application/hwp+zip' });
        });
      });
  }

  /* ══════════════════════════════════════════════════════════════
     상태 + cfg
     ══════════════════════════════════════════════════════════════ */
  var state = null;
  function defaultState() {
    return {
      caseType: '형사', kind: '', action: '변경',
      ptype: 'wongo', ourIdx: 0,
      client: '', opponent: '', caseLine: '', court: '',
      hearingDt: '', wish: '', memo: '', reason: '', bojeongDate: '',
      attorneys: ['서고은'], attachments: '대법원 나의 사건 검색', date: fmtDate(todayISO()),
      gukseon: false, consent: '부동의', oppOffice: '', oppLawyer: '', stamp: true
    };
  }
  // state → 엔진 cfg
  function toCfg(s) {
    var cfg = {
      caseType: s.caseType,
      titleKind: s.kind, titleAction: s.action || '변경',
      caseLine: s.caseLine, court: s.court,
      hearingDt: s.hearingDt, wish: s.wish, reason: s.reason,
      lawyers: (s.attorneys && s.attorneys.length) ? s.attorneys.slice() : ['서고은'],
      attachments: splitCsv(s.attachments),
      date: s.date || fmtDate(todayISO()),
      stamp: !!s.stamp
    };
    if (s.caseType === '민사' || s.caseType === '보정') {
      var pair = PAIR[s.ptype] || PAIR.wongo;
      cfg.frontLabel = pair[0]; cfg.backLabel = pair[1]; cfg.ourIdx = s.ourIdx;
      cfg.role = pair[s.ourIdx];
      cfg.frontName = s.ourIdx === 0 ? s.client : s.opponent;
      cfg.backName = s.ourIdx === 1 ? s.client : s.opponent;
      if (s.caseType === '보정') {
        cfg.titleAction = '연기';
        cfg.bojeongDate = s.bojeongDate;
      } else {
        cfg.consent = s.consent || '부동의';
        cfg.noAgent = cfg.consent === '대리인부존재';
        cfg.oppOffice = s.oppOffice; cfg.oppLawyer = s.oppLawyer;
      }
    } else {
      cfg.role = '피고인';
      cfg.parties = splitCsv(s.client); if (!cfg.parties.length) cfg.parties = [''];
      cfg.gukseon = !!s.gukseon;
    }
    return cfg;
  }
  function ourRole(s) {
    if (s.caseType === '형사') return '피고인';
    return (PAIR[s.ptype] || PAIR.wongo)[s.ourIdx];
  }
  // 서면 제목(파일명·문서 공용)
  function docTitle(cfg) {
    if (cfg.caseType === '보정') return '보정기한' + (cfg.titleAction || '연기') + '신청서';
    if (cfg.caseType === '민사') {
      if (cfg.consent === '동의') return (cfg.titleKind || '') + '기일' + (cfg.titleAction || '변경') + ' 신청서';
      return (cfg.titleKind || '변론') + '기일' + (cfg.titleAction || '변경') + '신청서';
    }
    return (cfg.titleKind || '') + '기일' + (cfg.titleAction || '변경') + '신청서';
  }
  // 파일명: 서면이름_의뢰인명_사건번호 사건명_작성일(YYYYMMDD)
  function ymd(dateStr) {
    var m = String(dateStr || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    return m ? m[1] + ('0' + m[2]).slice(-2) + ('0' + m[3]).slice(-2) : '';
  }
  function downloadName(s, cfg) {
    var client = s.caseType === '형사' ? (splitCsv(s.client)[0] || '') : (s.client || '');
    var parts = [docTitle(cfg), client, s.caseLine, ymd(s.date)].filter(Boolean);
    return parts.join('_').replace(/[\/\\:*?"<>|\n\r]+/g, ' ').replace(/\s+/g, ' ').trim() + '.hwpx';
  }

  /* ══════════════════════════════════════════════════════════════
     전용 CSS (1회)
     ══════════════════════════════════════════════════════════════ */
  var STYLE_ID = 'yeongi-style';
  var YG_CSS =
    /* 입력폼 오버레이 */
    '#yeongiForm{display:none;position:fixed;inset:0;z-index:1100;background:#fff;flex-direction:column;}' +
    '#yeongiForm.active{display:flex;}' +
    /* 선택칸: 기존 서면과 동일한 알약(fs-chip) — 라벨을 왼쪽에 붙여 한 줄로 컴팩트하게 */
    '#yeongiForm .yg-pick{display:flex;align-items:center;gap:10px;margin:0 0 9px;}' +
    '#yeongiForm .yg-pick-l{flex:none;min-width:52px;font-size:13px;color:var(--gray-700,#555);}' +
    '#yeongiForm .yg-pick .fs-chips{flex:1;gap:6px;}' +
    '#yeongiForm .fs-chips .fs-chip{padding:6px 13px;font-size:13px;}' +
    '#yeongiForm .yg-row2{display:flex;gap:10px;}' +
    '#yeongiForm .yg-row2>.fs-field{flex:1;min-width:0;}' +
    /* 조건부 필드: 기본 숨김 후 사건구분별로 표시 */
    '#yeongiForm .yg-crim,#yeongiForm .yg-opp,#yeongiForm .yg-consent-pick,#yeongiForm .yg-consent-opp,#yeongiForm .yg-bojeong{display:none;}' +
    '#yeongiForm.is-crim .yg-crim{display:block;}' +
    '#yeongiForm.is-civil .yg-opp,#yeongiForm.is-bojeong .yg-opp{display:block;}' +
    '#yeongiForm.is-civil .yg-consent-pick{display:flex;}' +
    '#yeongiForm.is-civil.show-opp .yg-consent-opp{display:block;}' +
    '#yeongiForm.is-bojeong .yg-bojeong{display:block;}' +
    /* 보정: 기일종류·신청구분·기일행·첨부 숨김 */
    '#yeongiForm.is-bojeong .yg-hide-bojeong{display:none;}' +
    '#yeongiForm .fs-chip.yg-disabled{opacity:.4;pointer-events:none;}' +
    '#yeongiForm textarea.fs-input{min-height:92px;resize:vertical;line-height:1.5;}' +
    '#yeongiForm .yg-ai{display:flex;gap:8px;align-items:center;margin:10px 0 12px;}' +
    '#yeongiForm .yg-ai-btn{position:relative;isolation:isolate;overflow:hidden;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;padding:9px 16px;border:1px solid rgba(255,255,255,.6);border-radius:999px;font:inherit;font-weight:800;color:#16263f;box-shadow:0 3px 12px -2px rgba(120,140,210,.45),inset 0 1px 0 rgba(255,255,255,.65);cursor:pointer;}' +
    '#yeongiForm .yg-ai-btn::before{content:"";position:absolute;inset:0;z-index:-1;border-radius:inherit;background:linear-gradient(110deg,#ffb3d1,#ffe0ad,#b6f2d8,#b6d8ff,#d9c2ff,#ffb3d1);background-size:200% 100%;animation:yg-ai-flow 4s linear infinite;}' +
    '#yeongiForm .yg-ai-btn::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(110deg,transparent 40%,rgba(255,255,255,.7) 50%,transparent 60%);transform:translateX(-140%);animation:yg-ai-sweep 4s ease-in-out infinite;}' +
    '#yeongiForm .yg-ai-ic{width:13px;height:13px;fill:currentColor;}' +
    '#yeongiForm .yg-ai-btn:disabled{opacity:.55;cursor:default;}' +
    '@keyframes yg-ai-flow{0%{background-position:0% 50%}100%{background-position:-200% 50%}}' +
    '@keyframes yg-ai-sweep{0%{transform:translateX(-140%)}45%,100%{transform:translateX(140%)}}' +
    '@media (prefers-reduced-motion:reduce){#yeongiForm .yg-ai-btn::before,#yeongiForm .yg-ai-btn::after{animation:none;}}' +
    '#yeongiForm .yg-ai-hint{font-size:12px;color:#8a8f98;}';
  function injectStyle() { FSDoc.injectOnce(STYLE_ID, YG_CSS); }

  /* ══════════════════════════════════════════════════════════════
     화면 껍데기 (1회) — 입력폼 + 출력화면
     ══════════════════════════════════════════════════════════════ */
  var SHELL_ID = 'yeongi-shell';
  function injectShell() {
    if (document.getElementById(SHELL_ID)) return;
    var wrap = document.createElement('div');
    wrap.id = SHELL_ID;
    wrap.innerHTML =
      /* ── 입력폼 ── */
      '<div id="yeongiForm">' +
        '<div class="fs-card">' +
          '<div class="fs-head">' +
            '<button class="fs-close" onclick="closeYeongiForm()" aria-label="닫기"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
            '<div class="fs-title">기일연기·변경 신청서</div>' +
          '</div>' +
          '<div class="fs-body">' +
            '<div class="yg-pick"><span class="yg-pick-l">사건 구분</span><div class="fs-chips" id="yg-casetype">' +
              '<span class="fs-chip on" data-v="형사" onclick="ygCaseType(\'형사\')">형사</span>' +
              '<span class="fs-chip" data-v="민사" onclick="ygCaseType(\'민사\')">민사</span>' +
              '<span class="fs-chip" data-v="보정" onclick="ygCaseType(\'보정\')">보정기한</span></div></div>' +
            '<div class="yg-pick yg-hide-bojeong"><span class="yg-pick-l">기일 종류</span><div class="fs-chips" id="yg-kind"></div></div>' +
            '<div class="yg-pick yg-hide-bojeong"><span class="yg-pick-l">신청 구분</span><div class="fs-chips" id="yg-action">' +
              '<span class="fs-chip on" data-v="변경" onclick="ygAction(\'변경\')">변경</span>' +
              '<span class="fs-chip" data-v="연기" onclick="ygAction(\'연기\')">연기</span></div></div>' +

            '<div class="fs-section">사건 정보</div>' +
            '<div class="yg-row2">' +
              '<div class="fs-field"><label class="fs-label" id="yg-client-label">의뢰인명</label><input type="text" class="fs-input" id="yg-client" placeholder="홍길동"></div>' +
              '<div class="fs-field"><label class="fs-label">사건명</label><input type="text" class="fs-input" id="yg-caseline" placeholder="2024고단1234 사기"></div>' +
            '</div>' +
            '<div class="fs-field yg-opp"><label class="fs-label" id="yg-opp-label">상대방</label><input type="text" class="fs-input" id="yg-opponent" placeholder="상대방 이름"></div>' +
            '<div class="fs-field"><label class="fs-label">재판부</label><input type="text" class="fs-input" id="yg-court" placeholder="인천지방법원 형사1단독"></div>' +
            '<div class="fs-field yg-bojeong"><label class="fs-label">보정명령 송달일 <span class="fs-hint">(사유에 반영)</span></label><input type="text" class="fs-input" id="yg-bojeongdate" placeholder="2026. 7. 1."></div>' +
            '<div class="fs-field yg-crim"><label class="fs-label"><input type="checkbox" id="yg-gukseon"> 국선사건 <span class="fs-hint">(법무법인 정서 줄 생략 + 국선변호인)</span></label></div>' +

            '<div class="fs-section">사유</div>' +
            '<div class="yg-row2 yg-hide-bojeong">' +
              '<div class="fs-field"><label class="fs-label">지정된 기일 <span class="fs-hint">(검색 시 자동, 시각 수기)</span></label><input type="text" class="fs-input" id="yg-hearingdt" placeholder="2024. 3. 22. 10:00"></div>' +
              '<div class="fs-field"><label class="fs-label">희망기일</label><input type="text" class="fs-input" id="yg-wish" placeholder="2024. 4. 12., 4. 19."></div>' +
            '</div>' +
            '<div class="fs-field"><label class="fs-label">사유 메모 <span class="fs-hint">(간단히 적으면 AI가 정서 문체로 작성)</span></label>' +
              '<textarea class="fs-input" id="yg-memo" placeholder="예: 같은날 다른 재판 있음 / 담당변호사 퇴사 / 기록등사 지연"></textarea>' +
              '<div class="yg-ai"><button type="button" class="yg-ai-btn" id="yg-ai-btn" onclick="ygDraft()"><svg class="yg-ai-ic" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.7 6.1a3 3 0 0 0 2.2 2.2L22 12l-6.1 1.7a3 3 0 0 0-2.2 2.2L12 22l-1.7-6.1a3 3 0 0 0-2.2-2.2L2 12l6.1-1.7a3 3 0 0 0 2.2-2.2z"/></svg>AI</button><span class="yg-ai-hint" id="yg-ai-hint"></span></div></div>' +
            '<div class="fs-field"><label class="fs-label">사유 <span class="fs-hint">(검토·수정 후 다운로드)</span></label>' +
              '<textarea class="fs-input" id="yg-reason" placeholder="여기에 사유 문단이 들어갑니다"></textarea></div>' +
            '<div class="yg-pick yg-consent-pick"><span class="yg-pick-l">상대방 동의</span><div class="fs-chips" id="yg-consent">' +
              '<span class="fs-chip" data-v="동의" onclick="ygConsent(\'동의\')">동의</span>' +
              '<span class="fs-chip on" data-v="부동의" onclick="ygConsent(\'부동의\')">부동의</span>' +
              '<span class="fs-chip" data-v="대리인부존재" onclick="ygConsent(\'대리인부존재\')">대리인 없음</span></div></div>' +
            '<div class="yg-consent-opp">' +
              '<div class="yg-row2">' +
                '<div class="fs-field"><label class="fs-label">상대방 사무소</label><input type="text" class="fs-input" id="yg-oppoffice" placeholder="법률사무소 ○○"></div>' +
                '<div class="fs-field"><label class="fs-label">상대방 변호사</label><input type="text" class="fs-input" id="yg-opplawyer" placeholder="변호사 이름"></div>' +
              '</div>' +
            '</div>' +

            '<div class="fs-section">서명 · 첨부</div>' +
            '<div class="fs-field"><label class="fs-label">담당변호사 <span class="fs-hint">(여러 명 선택 시 순서대로 나열)</span></label>' +
              '<div class="fs-chips att-chips" id="yg-att" onclick="attChipClick(event,\'yg\')"></div>' +
              '</div>' +
            '<div class="fs-field yg-hide-bojeong"><label class="fs-label">첨부서류 <span class="fs-hint">(여러 개는 쉼표로, 없으면 비움)</span></label><input type="text" class="fs-input" id="yg-attach" placeholder="퇴직증명서"></div>' +
            '<div class="fs-field"><label class="fs-label">작성일</label><input type="text" class="fs-input" id="yg-date" placeholder="2024. 3. 7."></div>' +
            '<div class="fs-field"><label class="fs-label"><input type="checkbox" id="yg-stamp"> 서고은 도장 날인 <span class="fs-hint">(담당변호사 첫 번째가 서고은일 때 서명란에 직인)</span></label></div>' +
          '</div>' +
          '<div class="fs-foot">' +
            '<button class="fs-btn ghost" onclick="closeYeongiForm()">취소</button>' +
            '<button class="fs-btn primary" onclick="ygDownload()">한글 다운로드</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
  }

  /* ── DOM 유틸 ── */
  function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v == null ? '' : v; }
  function getVal(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
  function segSet(groupId, v) {
    var g = document.getElementById(groupId); if (!g) return;
    g.querySelectorAll('[data-v]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === v); });
  }
  function segOn(groupId) {
    var g = document.getElementById(groupId); if (!g) return '';
    var b = g.querySelector('[data-v].on'); return b ? b.getAttribute('data-v') : '';
  }
  function fmtDate(iso) {
    var p = ('' + iso).split('-'); if (p.length !== 3) return iso;
    return p[0] + '. ' + parseInt(p[1], 10) + '. ' + parseInt(p[2], 10) + '.';
  }

  // 기일종류 옵션(형사=없음/선고, 민사=없음/변론/선고)
  function kindOptions(caseType) {
    if (caseType === '보정') return [];
    return caseType === '민사'
      ? [['', '없음'], ['변론', '변론'], ['선고', '선고']]
      : [['', '없음'], ['선고', '선고']];
  }
  function renderKindSeg(caseType, selected) {
    var g = document.getElementById('yg-kind'); if (!g) return;
    g.innerHTML = kindOptions(caseType).map(function (o) {
      var on = (o[0] === selected);
      return '<span class="fs-chip' + (on ? ' on' : '') + '" data-v="' + o[0] + '" onclick="ygKind(\'' + o[0] + '\')">' + o[1] + '</span>';
    }).join('');
  }
  // 지위에 따라 라벨 갱신(민사: 의뢰인=우리지위 / 상대방=반대지위)
  function updateRoleLabels() {
    var cl = document.getElementById('yg-client-label');
    var ol = document.getElementById('yg-opp-label');
    if (state.caseType !== '형사') {
      var pair = PAIR[state.ptype] || PAIR.wongo;
      if (cl) cl.textContent = '의뢰인명 (' + pair[state.ourIdx] + ')';
      if (ol) ol.textContent = '상대방 (' + pair[state.ourIdx === 0 ? 1 : 0] + ')';
    } else {
      if (cl) cl.textContent = '피고인 (여러 명은 쉼표로)';
    }
  }

  function ensureUI() { injectStyle(); injectShell(); }
  function applyCaseTypeClass() {
    var f = document.getElementById('yeongiForm'); if (!f) return;
    f.classList.toggle('is-civil', state.caseType === '민사');
    f.classList.toggle('is-crim', state.caseType === '형사');
    f.classList.toggle('is-bojeong', state.caseType === '보정');
    f.classList.toggle('show-opp', state.caseType === '민사' && state.consent === '동의');
  }

  window.ygCaseType = function (v) {
    state.caseType = v; segSet('yg-casetype', v);
    if (v === '보정') state.action = '연기';  // 보정은 항상 연기
    // 기일종류 옵션 교체(현재 선택이 새 옵션에 없으면 '없음')
    var valid = kindOptions(v).map(function (o) { return o[0]; });
    if (valid.indexOf(state.kind) < 0) state.kind = '';
    renderKindSeg(v, state.kind);
    applyCaseTypeClass(); updateRoleLabels();
  };
  window.ygConsent = function (v) { state.consent = v; segSet('yg-consent', v); applyCaseTypeClass(); };
  window.ygKind = function (v) { state.kind = v; segSet('yg-kind', v); lockActionForSeon(); };
  window.ygAction = function (v) {
    if (v === '변경' && state.kind === '선고') return; // 선고는 항상 연기(변경 잠금)
    state.action = v; segSet('yg-action', v);
  };
  // 선고 선택 시: 신청 구분을 '연기'로 고정하고 '변경' 버튼 비활성화
  function lockActionForSeon() {
    var g = document.getElementById('yg-action'); if (!g) return;
    var lock = (state.kind === '선고');
    g.querySelectorAll('[data-v]').forEach(function (b) {
      if (b.getAttribute('data-v') === '변경') b.classList.toggle('yg-disabled', lock);
    });
    if (lock) { state.action = '연기'; segSet('yg-action', '연기'); }
  }

  function fillFormFromState() {
    segSet('yg-casetype', state.caseType);
    renderKindSeg(state.caseType, state.kind);
    segSet('yg-action', state.action);
    lockActionForSeon();
    setVal('yg-client', state.client); setVal('yg-caseline', state.caseLine);
    setVal('yg-opponent', state.opponent); setVal('yg-court', state.court);
    setVal('yg-hearingdt', state.hearingDt); setVal('yg-wish', state.wish);
    setVal('yg-memo', state.memo); setVal('yg-reason', state.reason);
    setVal('yg-attach', state.attachments); setVal('yg-bojeongdate', state.bojeongDate);
    setVal('yg-date', state.date || fmtDate(todayISO()));
    setVal('yg-att-new', '');
    segSet('yg-consent', state.consent);
    setVal('yg-oppoffice', state.oppOffice); setVal('yg-opplawyer', state.oppLawyer);
    var gk = document.getElementById('yg-gukseon'); if (gk) gk.checked = !!state.gukseon;
    var st = document.getElementById('yg-stamp'); if (st) st.checked = !!state.stamp;
    if (typeof renderAttChips === 'function') renderAttChips('yg', (state.attorneys && state.attorneys.length) ? state.attorneys : ['서고은']);
    applyCaseTypeClass(); updateRoleLabels();
  }

  // 폼 → state
  function collect() {
    state.caseType = segOn('yg-casetype') || state.caseType;
    state.kind = segOn('yg-kind');
    state.action = segOn('yg-action') || '변경';
    state.client = getVal('yg-client'); state.caseLine = getVal('yg-caseline');
    state.opponent = getVal('yg-opponent'); state.court = getVal('yg-court');
    state.hearingDt = getVal('yg-hearingdt'); state.wish = getVal('yg-wish');
    state.memo = getVal('yg-memo'); state.reason = getVal('yg-reason');
    state.attachments = getVal('yg-attach');
    state.bojeongDate = getVal('yg-bojeongdate');
    state.date = getVal('yg-date') || fmtDate(todayISO());
    var atts = [];
    document.querySelectorAll('#yg-att .fs-chip.on').forEach(function (c) { atts.push(c.dataset.att); });
    state.attorneys = atts.length ? atts : ['서고은'];
    var st = document.getElementById('yg-stamp'); state.stamp = !!(st && st.checked);
    if (state.caseType === '민사') {
      state.consent = segOn('yg-consent') || '부동의';
      state.oppOffice = getVal('yg-oppoffice'); state.oppLawyer = getVal('yg-opplawyer');
    } else if (state.caseType === '형사') {
      var gk = document.getElementById('yg-gukseon'); state.gukseon = !!(gk && gk.checked);
    }
  }

  /* ── 검색 자동연동: 사건 행 하나로 지위·기일·조합 채우기 ── */
  function fetchDept(code, num, cb) {
    var url = fnUrl('court-lookup');
    var key = (typeof SUPABASE_KEY !== 'undefined' ? SUPABASE_KEY : '');
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'apikey': key },
      body: JSON.stringify({ schKey: String(code), schVal: String(num) })
    }).then(function (r) { return r.json(); })
      .then(function (d) { cb((d && d.court_dept) || ''); })
      .catch(function () { cb(''); });
  }
  function ygOnFill(row) {
    if (!state) return;
    var m = mapPos(row.client_position || '');
    var caseType = m ? '민사' : '형사';
    if (m) { state.ptype = m.ptype; state.ourIdx = m.idx; }
    window.ygCaseType(caseType);
    setVal('yg-client', row.l_client || '');
    var line = [row.l_code, cleanCaseName(row.l_name)].filter(Boolean).join(' ');
    setVal('yg-caseline', line);
    var baseCourt = row.court || '';
    setVal('yg-court', baseCourt);
    if (row.l_code && row.l_num) {
      fetchDept(row.l_code, row.l_num, function (dept) {
        if (dept) setVal('yg-court', (baseCourt ? baseCourt + ' ' : '') + dept);
      });
    }
    if (row.next_date) setVal('yg-hearingdt', fmtDate(normDate(row.next_date)));
    var nc = row.next_contents || '';
    var kind = /선고/.test(nc) ? '선고' : (caseType === '민사' && /변론/.test(nc) ? '변론' : '');
    window.ygKind(kind);
    updateRoleLabels();
  }

  function openForm() {
    ensureUI();
    fillFormFromState();
    document.getElementById('yeongiForm').classList.add('active');
    if (typeof initAutofillFor === 'function') initAutofillFor('yg-client', { onFill: ygOnFill });
  }

  window.goYeongi = function () { ensureUI(); state = defaultState(); openForm(); };
  window.closeYeongiForm = function () { var f = document.getElementById('yeongiForm'); if (f) f.classList.remove('active'); };

  // ✨ AI작성 (Claude Edge Function 호출)
  window.ygDraft = function () {
    var btn = document.getElementById('yg-ai-btn'), hint = document.getElementById('yg-ai-hint');
    var memo = getVal('yg-memo');
    if (!memo && !getVal('yg-hearingdt') && !getVal('yg-bojeongdate')) { if (hint) hint.textContent = '사유 메모를 먼저 적어주세요.'; return; }
    var caseType = segOn('yg-casetype') || state.caseType;
    var kind = segOn('yg-kind');
    var role = caseType === '형사' ? '피고인의 변호인' : (ourRole(state) + '의 소송대리인');
    btn.disabled = true; if (hint) hint.textContent = 'AI가 작성 중…';
    if (window.aiFieldStart) aiFieldStart('yg-reason', 'AI가 사유를 작성하고 있어요');
    var payload = {
      caseType: caseType, role: role,
      caseName: getVal('yg-caseline'), memo: memo
    };
    if (caseType === '보정') {
      payload.bojeongDate = getVal('yg-bojeongdate');
    } else {
      payload.hearingKind = kind === '선고' ? '선고' : (caseType === '민사' ? '변론' : '공판');
      payload.action = segOn('yg-action');
      payload.hearingDt = getVal('yg-hearingdt');
    }
    fetch(fnUrl('draft-yeongi'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'apikey': (typeof SUPABASE_KEY !== 'undefined' ? SUPABASE_KEY : '') },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); }).then(function (d) {
      btn.disabled = false;
      if (d && d.ok && d.reason) { aiFieldDone('yg-reason', d.reason); if (hint) hint.textContent = '작성 완료 — 검토·수정 후 다운로드하세요.'; }
      else { aiFieldStop('yg-reason'); if (hint) hint.textContent = '작성 실패: ' + ((d && d.reason) || 'unknown') + ' (직접 입력 가능)'; }
    }).catch(function (e) { btn.disabled = false; aiFieldStop('yg-reason'); if (hint) hint.textContent = '오류: ' + e.message; });
  };

  // 📄 한글(HWPX) 다운로드 — 폼 값을 수집해 바로 생성(확인창 없음)
  window.ygDownload = function () {
    if (!state) state = defaultState();
    collect();
    var cfg = toCfg(state);
    if (!cfg.reason) { alert('사유를 먼저 작성해주세요 (✨ 버튼 또는 직접 입력).'); return; }
    buildHwpx(cfg).then(function (blob) {
      var name = downloadName(state, cfg);
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }).catch(function (e) { alert('HWPX 생성 실패: ' + e.message); });
  };

  /* node 검증용 (브라우저에서는 무시됨) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      fillCriminal: fillCriminal, fillCivilConsent: fillCivilConsent, fillCivilDissent: fillCivilDissent,
      fillBojeong: fillBojeong, docTitle: docTitle, downloadName: downloadName,
      estimateList: estimateList, planPage: planPage, setT: setT, toCfg: toCfg, mapPos: mapPos,
      buildPic: buildPic, injectSealPic: injectSealPic, injectBinData: injectBinData,
      injectHpfManifest: injectHpfManifest, injectOdfManifest: injectOdfManifest, pngSize: pngSize
    };
  }
})();
