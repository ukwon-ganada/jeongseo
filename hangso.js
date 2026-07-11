/* 법무법인 정서 PWA - 항소·상고장 (hangso.js)
   ───────────────────────────────────────────────────────────────
   독립 모듈. 표준 HWPX 를 채워 한글파일로 다운로드.
   흐름(참고자료·기일연기와 동일): goHangso() → [입력폼] → [한글 다운로드]

   상단 칩: 형사 / 민가사  ·  항소 / 상고 (4조합, 템플릿·필드 전환)
     · 형사: templates/hangso.hwpx · sanggo.hwpx (피고인, 항소이유 ■/□, 국선)
     · 민가사: templates/minga_hangso.hwpx · minga_sanggo.hwpx
              (원고·피고 + 의뢰인 쪽, 원 판결의 표시·항소/상고 취지 수동 입력)

   국선(형사): '변호인' 앞 '국선' + '법무법인 정서' 줄 생략
   도장(체크): 담당변호사 첫 번째가 '서고은'일 때 서명란 이름 위 직인 겹침
   의뢰인 이름의 '(국선 …)' 주석은 서면에서 제거.

   의존: HWPXFill(hwpxfill.js) · JU(util.js) · FSDoc(fsdoc.js)
        · renderAttChips/addAttorney/attChipClick(index.html) · initAutofillFor(autofill.js)
        · window.SEAL_SEOGOEUN(전역 도장, 선택)
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var TPL_H = { 항소: './templates/hangso.hwpx', 상고: './templates/sanggo.hwpx' };       // 형사
  var TPL_M = { 항소: './templates/minga_hangso.hwpx', 상고: './templates/minga_sanggo.hwpx' }; // 민가사
  var REASONS = ['사실오인', '법리오해', '양형부당'];

  function todayISO() { return JU.todayISO(); }
  function fmtKDate(iso) { var m = ('' + (iso || '')).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/); return m ? m[1] + '. ' + parseInt(m[2], 10) + '. ' + parseInt(m[3], 10) + '.' : ''; }
  function fmtDot(iso) { var m = ('' + (iso || '')).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/); return m ? m[1] + '.' + ('0' + m[2]).slice(-2) + '.' + ('0' + m[3]).slice(-2) : ''; }
  function ymd(s) { var m = String(s || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/); return m ? m[1] + ('0' + m[2]).slice(-2) + ('0' + m[3]).slice(-2) : ''; }
  function spaced(name) { return String(name || '').trim().split('').join(' '); }
  function reEsc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function xe(s) { return HWPXFill.esc(s); }
  function splitLines(v) { return String(v || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean); }
  // 압축폼: 한 칸의 '사건번호 사건명' → 첫 공백 기준 분리(사건번호=첫 토큰)
  function splitCase(v) { v = String(v || '').trim(); var i = v.indexOf(' '); return i < 0 ? { casenum: v, casename: '' } : { casenum: v.slice(0, i).trim(), casename: v.slice(i + 1).trim() }; }
  // 압축폼: 한 칸의 '법원 재판부' → 마지막 공백 기준 분리(재판부=마지막 토큰, 지원명 포함 법원 대응)
  function splitCourt(v) { v = String(v || '').trim(); var i = v.lastIndexOf(' '); return i < 0 ? { court: v, courtDiv: '' } : { court: v.slice(0, i).trim(), courtDiv: v.slice(i + 1).trim() }; }
  function hasBatchim(s) { var ch = String(s || '').trim().slice(-1); if (!ch) return true; var c = ch.charCodeAt(0); if (c < 0xAC00 || c > 0xD7A3) return true; return (c - 0xAC00) % 28 !== 0; }
  function dropPara(ctx, text) {
    var re = new RegExp('<hp:p\\b[^>]*>(?:(?!</hp:p>)[\\s\\S])*?' + reEsc(text) + '[\\s\\S]*?</hp:p>');
    ctx.section = ctx.section.replace(re, '');
  }
  function uncheckBox(ctx, name) {
    var re = new RegExp('■((?:(?!■)[\\s\\S])*?' + reEsc(name) + ')');
    ctx.section = ctx.section.replace(re, '□$1');
  }
  function fillParty(ctx, jiwi) {
    if (!jiwi || jiwi === '피고인') return;
    ctx.replace('피 고 인', spaced(jiwi));
    ctx.replace('피고인은', jiwi + (hasBatchim(jiwi) ? '은' : '는'));
    ctx.replace('피고인', jiwi);
  }

  /* ── 여러 줄(원 판결의 표시·취지) 채우기 ── 샘플 문단 블록을 사용자 줄로 재구성 ── */
  function paraText(p) { return (p.match(/<hp:t>[\s\S]*?<\/hp:t>/g) || []).map(function (t) { return t.replace(/<[^>]+>/g, ''); }).join('').replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }
  function setParaText(p, text) { var first = true; return p.replace(/<hp:t>[\s\S]*?<\/hp:t>/g, function () { if (first) { first = false; return '<hp:t>' + xe(text) + '</hp:t>'; } return '<hp:t></hp:t>'; }); }
  function setLines(ctx, sampleFirst, sampleCount, lines) {
    var paras = ctx.section.match(/<hp:p\b[\s\S]*?<\/hp:p>/g) || [];
    var start = -1;
    for (var i = 0; i < paras.length; i++) { if (paraText(paras[i]).indexOf(sampleFirst) >= 0) { start = i; break; } }
    if (start < 0 || start + sampleCount > paras.length) return;
    var use = (lines && lines.length) ? lines : [''];
    var rebuilt = use.map(function (l) { return setParaText(paras[start], l); }).join('');
    var s = ctx.section, bs = s.indexOf(paras[start]), last = paras[start + sampleCount - 1], be = s.indexOf(last) + last.length;
    ctx.section = s.slice(0, bs) + rebuilt + s.slice(be);
  }
  /* 빈 문단(header 아래 빈 줄)에 사용자 줄을 채워 넣기 — minga_sanggo(placeholder) 전용.
     빈 run(<hp:run .../>)에 <hp:t>텍스트</hp:t>를 넣어 재구성. header 아래 count개 슬롯을 소비. */
  function fillEmptyParaLine(tpl, text) { return tpl.replace(/<hp:run\b([^>]*)\/>/, '<hp:run$1><hp:t>' + xe(text) + '</hp:t></hp:run>'); }
  function setLinesInto(ctx, headerText, count, lines) {
    var s = ctx.section, paras = s.match(/<hp:p\b[\s\S]*?<\/hp:p>/g) || [], header = null;
    for (var i = 0; i < paras.length; i++) { if (paraText(paras[i]).indexOf(headerText) >= 0) { header = paras[i]; break; } }
    if (!header) return;
    var hpos = s.indexOf(header); if (hpos < 0) return;
    var after = hpos + header.length, rest = s.slice(after), cursor = 0, slotFirst = null;
    for (var k = 0; k < count; k++) {
      var sub = rest.slice(cursor), m = sub.match(/<hp:p\b[\s\S]*?<\/hp:p>/);
      if (!m) return;
      if (k === 0) slotFirst = m[0];
      cursor += sub.indexOf(m[0]) + m[0].length;
    }
    var use = (lines && lines.length) ? lines : [''];
    var rebuilt = use.map(function (l) { return fillEmptyParaLine(slotFirst, l); }).join('');
    ctx.section = s.slice(0, after) + rebuilt + rest.slice(cursor);
  }

  /* ══════════ 형사 항소장 ══════════ */
  function fillHangso(ctx, c) {
    ctx.replace('2025고단4209', c.casenum || '').replace('사기', c.casename || '')
       .replace('함 석 훈', spaced(c.defendant)).replace('2026. 7. 9.', c.sentDate || '')
       .replace('2026. 7. 10.', c.writeDate || '').replace('인천지방법원', c.court || '').replace('형사7단독', c.courtDiv || '');
    REASONS.forEach(function (r) { if (c.reasons.indexOf(r) < 0) uncheckBox(ctx, r); });
    ctx.replace('(국선)변호인', c.gukseon ? '국선변호인' : '변호인');
    if (c.gukseon) dropPara(ctx, '법무법인 정서');
    if (c.attorney !== '서고은') ctx.replace('서 고 은', spaced(c.attorney));
    fillParty(ctx, c.jiwi);
  }
  /* ══════════ 형사 상고장 ══════════ */
  function fillSanggo(ctx, c) {
    ctx.replace('2025노3460', c.casenum || '').replace('전자금융거래법위반', c.casename || '')
       .replace('조용순', c.defendant || '').replace('2026.07.06', c.sentDate || '')
       .replace('2026. 7. 11.', c.writeDate || '').replace('수원지방법원', c.court || '').replace('제8-1형사부(항소)', c.courtDiv || '');
    if (c.result && c.result !== '항소기각') ctx.replace('항소기각', c.result);
    if (c.gukseon) ctx.replace('위 피고인의 변호인', '위 피고인의 국선변호인');
    if (c.gukseon) dropPara(ctx, '법무법인 정서');
    if (c.attorney !== '서고은') ctx.replace('서 고 은', spaced(c.attorney));
    if (c.attorney2) ctx.replace('우 숭 민', spaced(c.attorney2)); else dropPara(ctx, '우 숭 민');
    fillParty(ctx, c.jiwi);
  }

  /* ══════════ 민가사 항소장 ══════════
     minga_hangso.hwpx 샘플: 2025가단210684 운송료 / 원고 엄대봉(항소인) /
       피고 주식회사 비피알코퍼레이션(피항소인) / 인천지방법원 2026.05.20 선고 2026.05.26 송달 /
       원판결표시(2줄) / 항소취지(4줄) / 2026. 7. 11. / 원고(항소인) 소송대리인 / 인천지방법원 민사13단독 귀중 */
  function fillMingaHangso(ctx, c) {
    // 당사자 지위 라벨: 기본(의뢰인=원고)은 템플릿 그대로(원고 항소인 / 피고 피항소인).
    // 의뢰인=피고면 스왑 — 피고 라벨은 전각공백 태그로 분리돼 있어 run 구간을 통째로 교체.
    if (c.side === '피고') {
      ctx.replace('(항  소  인)', '(피항소인)');
      ctx.section = ctx.section.replace(/<hp:t>\(피<\/hp:t>[\s\S]*?<hp:t>인\)<\/hp:t>/, '<hp:t>(항소인)</hp:t>');
    }
    ctx.replace('원고(항소인) 소송대리인', c.side + '(항소인) 소송대리인')
       .replace('2025가단210684 운송료', (c.casenum || '') + ' ' + (c.casename || ''))
       .replace('엄대봉', c.plaintiff || '').replace('주식회사 비피알코퍼레이션', c.defendant2 || '')
       .replace('인천지방법원에서', (c.court || '') + '에서')
       .replace('2026. 05. 20.', c.sentDate || '').replace('2026. 05. 26.', c.serveDate || '')
       .replace('2026. 7. 11.', c.writeDate || '');
    setLines(ctx, '1. 원고의 청구를 기각한다.', 2, c.verdictLines);
    setLines(ctx, '1. 제1심판결을 취소한다.', 4, c.purposeLines);
    // 담당변호사(첫줄 서 고 은, 둘째줄 우 숭 민)
    if (c.attorney !== '서고은') ctx.replace('서 고 은', spaced(c.attorney));
    if (c.attorney2) ctx.replace('우 숭 민', spaced(c.attorney2)); else dropPara(ctx, '우 숭 민');
    // 마무리줄: 법원 재판부 한 칸
    ctx.replace('인천지방법원 민사13단독 귀중', (c.court || '') + (c.courtDiv ? ' ' + c.courtDiv : '') + ' 귀중');
  }

  /* ══════════ 민가사 상고장 ══════════
     minga_sanggo.hwpx(placeholder 템플릿): 사건 '2026나50613  손해배상(기)' /
       상고인(피고,항소인) '상고인 이름' + '(상고인 주소입력공간)' /
       피상고인(원고,피항소인) '피상고인 이름' + '(피상고인 주소입력공간)' /
       intro '인천지방법원이 2026. 2. 13.에 선고한…' / 원판결표시·상고취지(빈 슬롯) /
       작성일 ' 2026. 7. 12.' / 담당변호사 서 고 은(직인 박힘) / 대법원 귀중
     주의: '상고인 이름'은 '피상고인 이름'의 부분문자열 → 피상고인 먼저 치환. */
  function fillMingaSanggo(ctx, c) {
    ctx.replace('2026나50613  손해배상(기)', (c.casenum || '') + '  ' + (c.casename || ''))
       .replace('피상고인 이름', c.defendant2 || '').replace('상고인 이름', c.plaintiff || '')
       .replace('(피상고인 주소입력공간)', c.addr2 || '').replace('(상고인 주소입력공간)', c.addr1 || '')
       .replace('인천지방법원이', (c.court || '') + '이')
       .replace('2026. 2. 13.', c.sentDate || '')
       .replace('2026. 7. 12.', c.writeDate || '');
    setLinesInto(ctx, '원 판결의 표시', 2, c.verdictLines);
    setLinesInto(ctx, '상 고 취 지', 4, c.purposeLines);
    if (c.attorney !== '서고은') ctx.replace('서 고 은', spaced(c.attorney)).replace('서고은', c.attorney);
    // 도장(image1)은 템플릿에 서고은 '은' 위로 박혀 있음 → 날인 원하면 유지, 아니면 제거
    if (!c.keepSeal) ctx.stripSeal();
  }

  /* ══════════ 상태 ══════════ */
  var state = null;
  function defaultState() {
    return {
      cat: '형사', type: '항소', jiwi: '피고인',
      defendant: '', casenum: '', casename: '', court: '', courtDiv: '', sentDate: '', serveDate: '',
      reasons: REASONS.slice(), result: '항소기각', gukseon: false,
      plaintiff: '', defendant2: '', side: '원고', verdict: '', purpose: '',
      addr1: '', addr1b: '', addr2: '', addr2b: '',
      attorneys: ['서고은'], writeDate: todayISO(), stamp: true
    };
  }
  function toCfg(s) {
    var atts = (s.attorneys && s.attorneys.length) ? s.attorneys.slice() : ['서고은'];
    var sentFmt = (s.cat === '민가사') ? (s.type === '상고' ? fmtKDate(s.sentDate) : fmtKDate(s.sentDate)) : (s.type === '상고' ? fmtDot(s.sentDate) : fmtKDate(s.sentDate));
    return {
      cat: s.cat, type: s.type, jiwi: s.jiwi || '피고인',
      defendant: HWPXFill.cleanName(s.defendant), casenum: s.casenum, casename: s.casename,
      court: s.court, courtDiv: s.courtDiv, sentDate: sentFmt, serveDate: fmtKDate(s.serveDate),
      writeDate: fmtKDate(s.writeDate) || fmtKDate(todayISO()),
      reasons: (s.reasons && s.reasons.length) ? s.reasons.slice() : [], result: s.result || '항소기각', gukseon: !!s.gukseon,
      plaintiff: HWPXFill.cleanName(s.plaintiff), defendant2: HWPXFill.cleanName(s.defendant2), side: s.side || '원고',
      verdictLines: splitLines(s.verdict), purposeLines: splitLines(s.purpose),
      addr1: s.addr1, addr1b: s.addr1b, addr2: s.addr2, addr2b: s.addr2b,
      attorney: atts[0], attorney2: atts[1] || '', stamp: !!s.stamp,
      keepSeal: !!s.stamp && atts[0] === '서고은'
    };
  }
  function downloadName(s) {
    var who = s.cat === '민가사' ? (s.plaintiff || s.defendant2) : s.defendant;
    return HWPXFill.safeName([s.type + '장', who, s.casenum, ymd(s.writeDate)]);
  }

  /* ══════════ CSS ══════════ */
  var STYLE_ID = 'hangso-style';
  var HS_CSS =
    '#hangsoForm{display:none;position:fixed;inset:0;z-index:1100;background:#fff;flex-direction:column;}' +
    '#hangsoForm.active{display:flex;}' +
    '#hangsoForm .hs-pick{display:flex;align-items:center;gap:10px;margin:0 0 9px;}' +
    '#hangsoForm .hs-pick-l{flex:none;min-width:64px;font-size:13px;color:var(--gray-700,#555);}' +
    '#hangsoForm .hs-pick .fs-chips{flex:1;gap:6px;}' +
    '#hangsoForm .fs-chips .fs-chip{padding:6px 13px;font-size:13px;cursor:pointer;}' +
    '#hangsoForm textarea.fs-input{min-height:70px;resize:vertical;line-height:1.5;}' +
    '#hangsoForm .hs-sanggo,#hangsoForm .hs-minga,#hangsoForm .hs-minga-sanggo{display:none;}' +
    '#hangsoForm.is-sanggo .hs-hangso{display:none;}' +
    '#hangsoForm.is-sanggo .hs-sanggo{display:block;}' +
    '#hangsoForm.is-minga .hs-hyeongsa{display:none;}' +
    '#hangsoForm.is-minga .hs-minga{display:block;}' +
    '#hangsoForm.is-minga.is-sanggo .hs-minga-sanggo{display:block;}';
  function injectStyle() { FSDoc.injectOnce(STYLE_ID, HS_CSS); }

  /* ══════════ 화면(입력폼) ══════════ */
  var SHELL_ID = 'hangso-shell';
  function injectShell() {
    if (document.getElementById(SHELL_ID)) return;
    var reasonChips = REASONS.map(function (r) { return '<span class="fs-chip on" data-v="' + r + '" onclick="hsToggleReason(this)">' + r + '</span>'; }).join('');
    var wrap = document.createElement('div');
    wrap.id = SHELL_ID;
    wrap.innerHTML =
      '<div id="hangsoForm">' +
        '<div class="fs-card">' +
          '<div class="fs-head">' +
            '<button class="fs-close" onclick="closeHangsoForm()" aria-label="닫기"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
            '<div class="fs-title">항소·상고장</div>' +
          '</div>' +
          '<div class="fs-body">' +
            '<div class="hs-pick"><span class="hs-pick-l">분야</span><div class="fs-chips" id="hs-cat">' +
              '<span class="fs-chip on" data-v="형사" onclick="hsCat(\'형사\')">형사</span>' +
              '<span class="fs-chip" data-v="민가사" onclick="hsCat(\'민가사\')">민사·가사</span></div></div>' +
            '<div class="hs-pick"><span class="hs-pick-l">서면 종류</span><div class="fs-chips" id="hs-type">' +
              '<span class="fs-chip on" data-v="항소" onclick="hsType(\'항소\')">항소장</span>' +
              '<span class="fs-chip" data-v="상고" onclick="hsType(\'상고\')">상고장</span></div></div>' +

            '<div class="fs-section">사건 정보</div>' +
            // 형사 당사자
            '<div class="fs-field hs-hyeongsa"><label class="fs-label">피고인 <span class="fs-hint">(국선 표기는 자동 제거)</span></label><input type="text" class="fs-input" id="hs-defendant" data-af="l_client" placeholder="홍길동"></div>' +
            // 민가사 당사자
            '<div class="hs-pick hs-minga"><span class="hs-pick-l">의뢰인</span><div class="fs-chips" id="hs-side">' +
              '<span class="fs-chip on" data-v="원고" onclick="hsSide(\'원고\')">원고 측</span>' +
              '<span class="fs-chip" data-v="피고" onclick="hsSide(\'피고\')">피고 측</span></div></div>' +
            '<div class="fs-row2 hs-minga"><div class="fs-field"><label class="fs-label">원고</label><input type="text" class="fs-input" id="hs-plaintiff" placeholder="엄대봉"></div>' +
              '<div class="fs-field"><label class="fs-label">피고</label><input type="text" class="fs-input" id="hs-defendant2" placeholder="주식회사 ○○"></div></div>' +
            '<div class="fs-row2 hs-minga hs-minga-sanggo"><div class="fs-field"><label class="fs-label">원고(상고인 측) 주소</label><input type="text" class="fs-input" id="hs-addr1" placeholder="주소(선택)"></div>' +
              '<div class="fs-field"><label class="fs-label">피고(피상고인 측) 주소</label><input type="text" class="fs-input" id="hs-addr2" placeholder="주소(선택)"></div></div>' +

            // 사건번호+사건명 한 칸 · 법원+재판부 한 칸 (압축)
            '<div class="fs-field"><label class="fs-label"><span class="hs-hyeongsa">사건번호 · 죄명</span><span class="hs-minga">사건번호 · 사건명</span> <span class="fs-hint">(사건번호 한 칸 띄우고 사건명)</span></label><input type="text" class="fs-input" id="hs-case" placeholder="2025고단1234 사기"></div>' +
            '<div class="fs-field"><label class="fs-label">원심 법원 · 재판부 <span class="fs-hint">(사건번호로 재판부 자동)</span></label><input type="text" class="fs-input" id="hs-court" data-af="court" placeholder="인천지방법원 형사7단독"></div>' +
            // 선고일 · (송달일 민가사) · 작성일 한 줄
            '<div class="fs-row2"><div class="fs-field"><label class="fs-label">원심 선고일</label><input type="date" class="fs-input" id="hs-sentdate"></div>' +
              '<div class="fs-field hs-minga"><label class="fs-label">송달일</label><input type="date" class="fs-input" id="hs-servedate"></div>' +
              '<div class="fs-field"><label class="fs-label">작성일 <span class="fs-hint">(오늘)</span></label><input type="date" class="fs-input" id="hs-writedate"></div></div>' +

            // 형사 항소이유 / 상고 원심결과
            '<div class="fs-section hs-hyeongsa hs-hangso">항소이유 <span class="fs-hint">(선택 = ■ 표시)</span></div>' +
            '<div class="hs-pick hs-hyeongsa hs-hangso"><div class="fs-chips" id="hs-reasons" style="flex:1">' + reasonChips + '</div></div>' +
            '<div class="fs-field hs-hyeongsa hs-sanggo"><label class="fs-label">원심 결과</label><input type="text" class="fs-input" id="hs-result" value="항소기각" placeholder="항소기각"></div>' +

            // 민가사 주문·취지
            '<div class="fs-section hs-minga">원 판결의 표시 · 취지 <span class="fs-hint">(판결문 보고 입력, 추후 AI 자동)</span></div>' +
            '<div class="fs-field hs-minga"><label class="fs-label">원 판결의 표시 <span class="fs-hint">(주문, 한 줄에 한 항목)</span></label><textarea class="fs-input" id="hs-verdict" placeholder="1. 원고의 청구를 기각한다.\n2. 소송비용은 원고가 부담한다."></textarea></div>' +
            '<div class="fs-field hs-minga"><label class="fs-label"><span class="hs-hangso">항소취지</span><span class="hs-sanggo">상고취지</span> <span class="fs-hint">(한 줄에 한 항목)</span></label><textarea class="fs-input" id="hs-purpose" placeholder="1. 제1심판결을 취소한다.\n2. ..."></textarea></div>' +

            '<div class="fs-section">서명 · 날인</div>' +
            '<div class="fs-field hs-hyeongsa"><label class="fs-label"><input type="checkbox" id="hs-gukseon"> 국선사건 <span class="fs-hint">(변호인 앞 "국선" + "법무법인 정서" 줄 생략)</span></label></div>' +
            '<div class="fs-field"><label class="fs-label">담당변호사 <span class="fs-hint">(여러 명 선택 시 순서대로)</span></label>' +
              '<div class="fs-chips att-chips" id="hs-att" onclick="attChipClick(event,\'hs\')"></div>' +
              '<div class="att-add-row"><input type="text" class="att-add-input" id="hs-att-new" placeholder="추가할 변호사 이름"><button type="button" class="att-add-btn" onclick="addAttorney(\'hs\')">＋ 추가</button></div></div>' +
            '<div class="fs-field"><label class="fs-label"><input type="checkbox" id="hs-stamp"> 서고은 도장 날인 <span class="fs-hint">(담당변호사 첫 번째가 서고은일 때)</span></label></div>' +
          '</div>' +
          '<div class="fs-foot">' +
            '<button class="fs-btn ghost" onclick="closeHangsoForm()">취소</button>' +
            '<button class="fs-btn primary" onclick="hsDownload()">한글 다운로드</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
  }

  /* ══════════ DOM 유틸 ══════════ */
  function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v == null ? '' : v; }
  function getVal(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
  function getRaw(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  function applyClasses() {
    var f = document.getElementById('hangsoForm'); if (!f) return;
    f.classList.toggle('is-minga', state.cat === '민가사');
    f.classList.toggle('is-sanggo', state.type === '상고');
    var t = document.querySelector('#hangsoForm .fs-title');
    if (t) t.textContent = (state.cat === '민가사' ? '민사·가사 ' : '') + state.type + '장';
  }
  window.hsCat = function (v) { state.cat = v; segOn('hs-cat', v); applyClasses(); };
  window.hsType = function (v) { state.type = v; segOn('hs-type', v); applyClasses(); };
  window.hsSide = function (v) { state.side = v; segOn('hs-side', v); };
  window.hsToggleReason = function (el) { el.classList.toggle('on'); };
  function segOn(groupId, v) { var g = document.getElementById(groupId); if (g) g.querySelectorAll('[data-v]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === v); }); }

  function fillFormFromState() {
    setVal('hs-defendant', state.defendant);
    setVal('hs-case', [state.casenum, state.casename].filter(Boolean).join(' '));
    setVal('hs-court', [state.court, state.courtDiv].filter(Boolean).join(' '));
    setVal('hs-sentdate', state.sentDate);
    setVal('hs-servedate', state.serveDate); setVal('hs-result', state.result || '항소기각');
    setVal('hs-plaintiff', state.plaintiff); setVal('hs-defendant2', state.defendant2);
    setVal('hs-addr1', state.addr1); setVal('hs-addr2', state.addr2);
    setVal('hs-verdict', state.verdict); setVal('hs-purpose', state.purpose);
    setVal('hs-writedate', state.writeDate || todayISO()); setVal('hs-att-new', '');
    var gk = document.getElementById('hs-gukseon'); if (gk) gk.checked = !!state.gukseon;
    var st = document.getElementById('hs-stamp'); if (st) st.checked = !!state.stamp;
    document.querySelectorAll('#hs-reasons .fs-chip').forEach(function (c) { c.classList.toggle('on', state.reasons.indexOf(c.getAttribute('data-v')) >= 0); });
    segOn('hs-cat', state.cat); segOn('hs-type', state.type); segOn('hs-side', state.side);
    if (typeof renderAttChips === 'function') renderAttChips('hs', (state.attorneys && state.attorneys.length) ? state.attorneys : ['서고은']);
    applyClasses();
  }
  function collect() {
    state.jiwi = '피고인';
    state.defendant = getVal('hs-defendant');
    var _cs = splitCase(getVal('hs-case')); state.casenum = _cs.casenum; state.casename = _cs.casename;
    var _cd = splitCourt(getVal('hs-court')); state.court = _cd.court; state.courtDiv = _cd.courtDiv;
    state.sentDate = getVal('hs-sentdate');
    state.serveDate = getVal('hs-servedate'); state.result = getVal('hs-result') || '항소기각';
    state.plaintiff = getVal('hs-plaintiff'); state.defendant2 = getVal('hs-defendant2');
    state.addr1 = getVal('hs-addr1'); state.addr2 = getVal('hs-addr2');
    state.verdict = getRaw('hs-verdict'); state.purpose = getRaw('hs-purpose');
    state.writeDate = getVal('hs-writedate') || todayISO();
    var rs = []; document.querySelectorAll('#hs-reasons .fs-chip.on').forEach(function (c) { rs.push(c.getAttribute('data-v')); }); state.reasons = rs;
    var atts = []; document.querySelectorAll('#hs-att .fs-chip.on').forEach(function (c) { atts.push(c.dataset.att); }); state.attorneys = atts.length ? atts : ['서고은'];
    var gk = document.getElementById('hs-gukseon'); state.gukseon = !!(gk && gk.checked);
    var st = document.getElementById('hs-stamp'); state.stamp = !!(st && st.checked);
  }

  /* ══════════ 진입점 ══════════ */
  function ensureUI() { injectStyle(); injectShell(); }
  window.goHangso = function () {
    ensureUI(); state = defaultState(); fillFormFromState();
    document.getElementById('hangsoForm').classList.add('active');
    if (typeof initAutofillFor === 'function') initAutofillFor('hs-case', { caseCombine: 'hs-case', courtDept: 'hs-court', courtDeptAppend: true, sentDate: 'hs-sentdate' });
  };
  window.closeHangsoForm = function () {
    var f = document.getElementById('hangsoForm'); if (f) f.classList.remove('active');
    if (window._gsmgrReturn) { window._gsmgrReturn = false; if (window.goCaseManager) window.goCaseManager(); }
  };

  window.hsDownload = function () {
    if (!state) state = defaultState();
    collect();
    var cfg = toCfg(state);
    var who = cfg.cat === '민가사' ? (cfg.plaintiff || cfg.defendant2) : cfg.defendant;
    if (!cfg.casenum && !who) { alert('사건번호 또는 당사자를 먼저 입력해주세요.'); return; }
    var tpl = (cfg.cat === '민가사' ? TPL_M : TPL_H)[cfg.type];
    var fill = cfg.cat === '민가사'
      ? (cfg.type === '상고' ? fillMingaSanggo : fillMingaHangso)
      : (cfg.type === '상고' ? fillSanggo : fillHangso);
    // 민가사 상고장은 템플릿에 도장이 박혀 있어 주입하지 않음(fillMingaSanggo가 유지/제거) → 이중날인 방지
    var baked = cfg.cat === '민가사' && cfg.type === '상고';
    var wantSeal = !baked && cfg.stamp && cfg.attorney === '서고은' && (typeof window !== 'undefined') && window.SEAL_SEOGOEUN;
    HWPXFill.build({
      url: tpl,
      fill: function (ctx) { fill(ctx, cfg); },
      sealDataUrl: wantSeal ? window.SEAL_SEOGOEUN : null,
      sealAnchor: '담당변호사 ' + spaced(cfg.attorney)
    }).then(function (blob) { HWPXFill.saveBlob(blob, downloadName(state)); })
      .catch(function (e) { alert('HWPX 생성 실패: ' + e.message); });
  };

  /* node 검증용 */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { fillHangso: fillHangso, fillSanggo: fillSanggo, fillMingaHangso: fillMingaHangso, fillMingaSanggo: fillMingaSanggo, toCfg: toCfg, downloadName: downloadName, setLines: setLines };
  }
})();
