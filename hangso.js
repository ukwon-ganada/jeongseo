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

  /* ══════════ 사건부호 분류(F) ══════════
     사건번호의 부호(연도와 번호 사이 한글)로 분야(형사/민가사)·심급(1심/항소심/상고심) 판정.
     lv 1=1심 → 항소장, 2=항소심(2심) → 상고장, 3=상고심(auto 안함). (대법원 사건부호표 기준) */
  var CODE_MAP={'가단':[1,'민가사'],'가소':[1,'민가사'],'가합':[1,'민가사'],'감고':[1,'형사'],'감노':[2,'형사'],'감도':[3,'형사'],'감오':[3,'형사'],'고단':[1,'형사'],'고정':[1,'형사'],'고합':[1,'형사'],'나':[2,'민가사'],'노':[2,'형사'],'느단':[1,'민가사'],'느합':[1,'민가사'],'다':[3,'민가사'],'도':[3,'형사'],'드':[1,'민가사'],'드단':[1,'민가사'],'드합':[1,'민가사'],'르':[2,'민가사'],'므':[3,'민가사'],'보고':[1,'형사'],'보노':[2,'형사'],'보도':[3,'형사'],'보오':[3,'형사'],'오':[3,'형사'],'재가단':[1,'민가사'],'재가소':[1,'민가사'],'재가합':[1,'민가사'],'재감고':[1,'형사'],'재감노':[2,'형사'],'재감도':[3,'형사'],'재고단':[1,'형사'],'재고정':[1,'형사'],'재고합':[1,'형사'],'재나':[2,'민가사'],'재노':[2,'형사'],'재느단':[1,'민가사'],'재느합':[1,'민가사'],'재다':[3,'민가사'],'재도':[3,'형사'],'재드':[1,'민가사'],'재드단':[1,'민가사'],'재드합':[1,'민가사'],'재르':[2,'민가사'],'재므':[3,'민가사'],'재즈단':[1,'민가사'],'재즈합':[1,'민가사'],'전고':[1,'형사'],'전노':[2,'형사'],'전도':[3,'형사'],'전오':[3,'형사'],'준재가단':[1,'민가사'],'준재가소':[1,'민가사'],'준재가합':[1,'민가사'],'준재나':[2,'민가사'],'준재느단':[1,'민가사'],'준재느합':[1,'민가사'],'준재다':[3,'민가사'],'준재드':[1,'민가사'],'준재드단':[1,'민가사'],'준재드합':[1,'민가사'],'준재르':[2,'민가사'],'준재므':[3,'민가사'],'즈':[1,'민가사'],'즈단':[1,'민가사'],'즈합':[1,'민가사'],'초치':[1,'형사'],'치고':[1,'형사'],'치노':[2,'형사'],'치도':[3,'형사'],'치오':[3,'형사']};
  function classifyCase(cn) {
    var m = String(cn || '').match(/(\d{4})\s*([가-힣]+)/);
    if (!m) return null;
    var e = CODE_MAP[m[2]];
    return e ? { code: m[2], lv: e[0], cat: e[1] } : null;
  }
  /* 지위(A): 창고 client_position → 당사자 쌍{first,second}과 의뢰인 쪽(clientSide). 형사/애매하면 null. */
  function jiwiPair(pos) {
    var p = String(pos || ''); if (!p) return null;
    if (/피신청/.test(p)) return { first: '신청인', second: '피신청인', clientSide: 'second' };
    if (/신청/.test(p)) return { first: '신청인', second: '피신청인', clientSide: 'first' };
    if (/채무/.test(p)) return { first: '채권자', second: '채무자', clientSide: 'second' };
    if (/채권/.test(p)) return { first: '채권자', second: '채무자', clientSide: 'first' };
    if (/피고인|피의자/.test(p)) return null; // 형사
    if (/피고/.test(p)) return { first: '원고', second: '피고', clientSide: 'second' };
    if (/원고/.test(p)) return { first: '원고', second: '피고', clientSide: 'first' };
    return null;
  }
  function spacedLabel(w) { return String(w || '').split('').join(' '); } // '신청인'→'신 청 인'

  // 취지 AI 초안: Edge Function URL + 지침키 선택
  function fnUrl(name) { return (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '') + '/functions/v1/' + name; }
  function apiKey() { return (typeof SUPABASE_KEY !== 'undefined' ? SUPABASE_KEY : ''); }
  // 상고→상고지침, 항소→가사부호면 가사항소지침 아니면 민사항소지침
  function pickGuide(type, casenum) {
    if (type === '상고') return 'sanggo';
    var m = String(casenum || '').match(/\d{4}\s*([가-힣]+)/);
    return m && /^(재|준재)?(드|느|즈|르|므)/.test(m[1]) ? 'gasa_hangso' : 'minsa_hangso';
  }
  // 판결문 앞 N페이지만 잘라 전송(주문·청구취지는 1~2페이지에 있음 → 속도·비용·실패 방지)
  var HS_PDF_PAGES = 2;
  function loadPdfLib() {
    return new Promise(function (res, rej) {
      if (window.PDFLib) return res(window.PDFLib);
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
      s.onload = function () { res(window.PDFLib); };
      s.onerror = function () { rej(new Error('PDF 라이브러리 로드 실패')); };
      document.head.appendChild(s);
    });
  }
  function u8ToB64(u8) { var C = 0x8000, s = ''; for (var i = 0; i < u8.length; i += C) s += String.fromCharCode.apply(null, u8.subarray(i, i + C)); return btoa(s); }
  function readArrayBuffer(file) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = function () { rej(new Error('PDF 읽기 실패')); }; r.readAsArrayBuffer(file); }); }
  // 앞 N페이지만 담은 새 PDF의 base64 반환
  function firstPagesB64(file, n) {
    return Promise.all([loadPdfLib(), readArrayBuffer(file)]).then(function (a) {
      var L = a[0];
      return L.PDFDocument.load(a[1], { ignoreEncryption: true }).then(function (src) {
        var take = Math.min(n, src.getPageCount());
        return L.PDFDocument.create().then(function (out) {
          var idx = []; for (var i = 0; i < take; i++) idx.push(i);
          return out.copyPages(src, idx).then(function (pages) {
            pages.forEach(function (p) { out.addPage(p); });
            return out.save().then(function (bytes) { return u8ToB64(bytes); });
          });
        });
      });
    });
  }
  function hasBatchim(s) { var ch = String(s || '').trim().slice(-1); if (!ch) return true; var c = ch.charCodeAt(0); if (c < 0xAC00 || c > 0xD7A3) return true; return (c - 0xAC00) % 28 !== 0; }
  function dropPara(ctx, text) {
    var re = new RegExp('<hp:p\\b[^>]*>(?:(?!</hp:p>)[\\s\\S])*?' + reEsc(text) + '[\\s\\S]*?</hp:p>');
    ctx.section = ctx.section.replace(re, '');
  }
  // 표(hp:tbl)를 감싼 문단을 통째로 제거 — 표는 한 문단 안에 들어있고, 셀 내부 문단들도 함께 사라짐.
  function dropTable(ctx) {
    var s = ctx.section, i = s.indexOf('<hp:tbl');
    if (i < 0) return;
    var ps = s.lastIndexOf('<hp:p ', i); if (ps < 0) return;
    var te = s.indexOf('</hp:tbl>', i); if (te < 0) return; te += '</hp:tbl>'.length;
    var pe = s.indexOf('</hp:p>', te); if (pe < 0) return; pe += '</hp:p>'.length;
    ctx.section = s.slice(0, ps) + s.slice(pe);
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
    if (c.reasons.length) {
      REASONS.forEach(function (r) { if (c.reasons.indexOf(r) < 0) uncheckBox(ctx, r); });
    } else {
      dropTable(ctx);            // 항소이유를 하나도 선택하지 않으면 표(항소이유란) 자체를 제거
    }
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
    dropPara(ctx, '우 숭 민');   // 둘째 변호사 자리(구 '우숭민') 항상 제거
    fillParty(ctx, c.jiwi);
  }

  /* ══════════ 민가사 항소장 ══════════
     minga_hangso.hwpx 샘플: 2025가단210684 운송료 / 원고 엄대봉(항소인) /
       피고 주식회사 비피알코퍼레이션(피항소인) / 인천지방법원 2026.05.20 선고 2026.05.26 송달 /
       원판결표시(2줄) / 항소취지(4줄) / 2026. 7. 11. / 원고(항소인) 소송대리인 / 인천지방법원 민사13단독 귀중 */
  function fillMingaHangso(ctx, c) {
    var first = c.pairFirst || '원고', second = c.pairSecond || '피고';
    // 당사자 지위 라벨(원고/피고 → 실지위). 기본 원고/피고면 손대지 않음.
    if (first !== '원고') ctx.replace('원       고', spacedLabel(first));
    if (second !== '피고') ctx.replace('피       고', spacedLabel(second));
    // 항소인/피항소인 접미사: 의뢰인이 둘째(second, 피고쪽)면 원고↔피고 라벨을 교환.
    // 표준양식 라벨 구조: 원고쪽 '(항  소  인)'(연속), 피고쪽 '(피<fwSpace>항<fwSpace>소<fwSpace>인)'(전각공백).
    if (c.clientSide === 'second') {
      var TOK = '';
      // ① 피고쪽 (피항소인) → 임시토큰 (전각공백/공백 모두 허용)
      ctx.section = ctx.section.replace(/\(피(?:<hp:fwSpace\/>|\s)*항(?:<hp:fwSpace\/>|\s)*소(?:<hp:fwSpace\/>|\s)*인\)/, TOK);
      // ② 원고쪽 (항  소  인) → 피항소인(전각공백 스타일 유지)
      ctx.replace('(항  소  인)', '(피<hp:fwSpace/>항<hp:fwSpace/>소<hp:fwSpace/>인)');
      // ③ 임시토큰(구 피고 위치) → 항소인
      ctx.section = ctx.section.replace(TOK, '(항  소  인)');
    }
    ctx.replace('원고(항소인) 소송대리인', (c.clientJiwi || '원고') + '(항소인) 소송대리인')
       .replace('2025가단210684 운송료', (c.casenum || '') + ' ' + (c.casename || ''))
       .replace('엄대봉', c.plaintiff || '').replace('주식회사 비피알코퍼레이션', c.defendant2 || '')
       .replace('인천지방법원에서', (c.court || '') + '에서')
       .replace('2026. 05. 20.', c.sentDate || '').replace('2026. 05. 26.', c.serveDate || '')
       .replace('2026. 7. 11.', c.writeDate || '');
    setLines(ctx, '1. 원고의 청구를 기각한다.', 2, c.verdictLines);
    setLines(ctx, '1. 제1심판결을 취소한다.', 4, c.purposeLines);
    // 담당변호사(첫줄 서 고 은, 둘째줄 우 숭 민)
    if (c.attorney !== '서고은') ctx.replace('서 고 은', spaced(c.attorney));
    dropPara(ctx, '우 숭 민');   // 둘째 변호사 자리(구 '우숭민') 항상 제거
    // 마무리줄: 법원 재판부 한 칸
    ctx.replace('인천지방법원 민사13단독 귀중', (c.court || '') + (c.courtDiv ? ' ' + c.courtDiv : '') + ' 귀중');
  }

  /* ══════════ 민가사 상고장 ══════════
     minga_sanggo.hwpx(f8f672e7 양식): 사건 '2026나50613  손해배상(기)' /
       상고인 → '상고인 이름' + '(피고, 항소인)' + '(상고인 주소입력공간)' /
       피상고인 → '피상고인 이름' + '(원고, 피항소인)' + '(피상고인 주소입력공간)' /
         (구 양식과 달리 지위 라벨이 이름 '아래' 별도 문단으로 분리됨)
       intro '인천지방법원이 2026. 2. 13.에 선고한…' /
       원판결표시(샘플 3줄)·상고취지(샘플 2줄) → 빈 슬롯이 아니라 샘플 문구가 박혀 있어 setLines로 교체 /
       작성일 ' 2026. 7. 12.' / 담당변호사 서 고 은(직인 image1 박힘) / 대법원 귀중
     주의: '상고인 이름'은 '피상고인 이름'의 부분문자열 → 피상고인 먼저 치환. */
  function fillMingaSanggo(ctx, c) {
    // 상고인=의뢰인, 피상고인=상대방(의뢰인 쪽에 따라 이름·주소 배치)
    var clientName = c.clientSide === 'second' ? c.defendant2 : c.plaintiff;
    var oppName = c.clientSide === 'second' ? c.plaintiff : c.defendant2;
    var clientAddr = c.clientSide === 'second' ? c.addr2 : c.addr1;
    var oppAddr = c.clientSide === 'second' ? c.addr1 : c.addr2;
    ctx.replace('2026나50613  손해배상(기)', (c.casenum || '') + '  ' + (c.casename || ''))
       .replace('피상고인 이름', oppName || '').replace('상고인 이름', clientName || '')
       .replace('(피상고인 주소입력공간)', oppAddr || '').replace('(상고인 주소입력공간)', clientAddr || '');
    // 당사자 지위 라벨(이름 아래 별도 문단) — 원고/피고 → 실지위. 항소인/피항소인 역할은 기본값 유지
    if (c.clientJiwi && c.clientJiwi !== '피고') ctx.replace('(피고, 항소인)', '(' + c.clientJiwi + ', 항소인)');
    if (c.oppJiwi && c.oppJiwi !== '원고') ctx.replace('(원고, 피항소인)', '(' + c.oppJiwi + ', 피항소인)');
    ctx.replace('인천지방법원이', (c.court || '') + '이')
       .replace('피고는', (c.clientJiwi || '피고') + (hasBatchim(c.clientJiwi || '피고') ? '은' : '는'))
       .replace('2026. 2. 13.', c.sentDate || '')
       .replace('2026. 7. 12.', c.writeDate || '');
    // 원판결의 표시(샘플 3줄)·상고취지(샘플 2줄): 박힌 샘플 문구를 AI/입력 줄로 교체
    setLines(ctx, '1. 원고의 항소를 기각한다.', 3, c.verdictLines);
    setLines(ctx, '1. 원심판결을 파기한다.', 2, c.purposeLines);
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
      plaintiff: '', defendant2: '', side: 'first', pair: { first: '원고', second: '피고' }, verdict: '', purpose: '',
      addr1: '', addr1b: '', addr2: '', addr2b: '',
      attorneys: ['서고은'], writeDate: todayISO(), stamp: true
    };
  }
  function toCfg(s) {
    var atts = (s.attorneys && s.attorneys.length) ? s.attorneys.slice() : ['서고은'];
    var pair = s.pair || { first: '원고', second: '피고' }, side = s.side || 'first';
    var sentFmt = (s.cat === '민가사') ? (s.type === '상고' ? fmtKDate(s.sentDate) : fmtKDate(s.sentDate)) : (s.type === '상고' ? fmtDot(s.sentDate) : fmtKDate(s.sentDate));
    return {
      cat: s.cat, type: s.type, jiwi: s.jiwi || '피고인',
      defendant: HWPXFill.cleanName(s.defendant), casenum: s.casenum, casename: s.casename,
      court: s.court, courtDiv: s.courtDiv, sentDate: sentFmt, serveDate: fmtKDate(s.serveDate),
      writeDate: fmtKDate(s.writeDate) || fmtKDate(todayISO()),
      reasons: (s.reasons && s.reasons.length) ? s.reasons.slice() : [], result: s.result || '항소기각', gukseon: !!s.gukseon,
      plaintiff: HWPXFill.cleanName(s.plaintiff), defendant2: HWPXFill.cleanName(s.defendant2),
      pairFirst: pair.first, pairSecond: pair.second, clientSide: side,
      clientJiwi: side === 'first' ? pair.first : pair.second, oppJiwi: side === 'first' ? pair.second : pair.first,
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
    '#hangsoForm.is-minga.is-sanggo .hs-minga-sanggo{display:block;}' +
    // PC에서 폼 폭을 넓혀 선고일·송달일·작성일 줄이 가로 스크롤 없이 들어오게
    '@media (min-width:768px){#hangsoForm .fs-body,#hangsoForm .fs-head,#hangsoForm .fs-foot{max-width:760px;}}' +
    '#hangsoForm .fs-row2{flex-wrap:nowrap;}' +
    '#hangsoForm .fs-row2>.fs-field{min-width:0;}' +
    '#hangsoForm .fs-row2 .fs-input{min-width:0;width:100%;}' +
    // 판결문 올리기(드롭존) + AI 초안(프리즘) 버튼
    '#hangsoForm .hs-drop{border:1px solid var(--border,#e7e9ee);border-radius:14px;padding:30px 20px;text-align:center;cursor:pointer;background:#fff;transition:border-color .18s,background .18s;}' +
    '#hangsoForm .hs-drop:hover{border-color:#b9c1d0;background:#fcfcfd;}' +
    '#hangsoForm .hs-drop.drag{border-color:#33507f;background:#f4f8fd;}' +
    '#hangsoForm .hs-drop-ic{color:#aeb6c4;margin-bottom:10px;line-height:0;transition:color .18s;}' +
    '#hangsoForm .hs-drop:hover .hs-drop-ic{color:#8b95a8;}' +
    '#hangsoForm .hs-drop.drag .hs-drop-ic,#hangsoForm .hs-drop.has-file .hs-drop-ic{color:#33507f;}' +
    '#hangsoForm .hs-drop-ic svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;}' +
    '#hangsoForm .hs-drop-t1{font-size:14.5px;font-weight:600;letter-spacing:-.01em;color:#1f2a3c;}' +
    '#hangsoForm .hs-drop-t2{font-size:11.5px;color:#98a1b2;margin-top:5px;}' +
    '#hangsoForm .hs-ai{display:flex;gap:8px;align-items:center;margin-top:8px;}' +
    '#hangsoForm .hs-ai-btn{position:relative;isolation:isolate;overflow:hidden;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;padding:9px 16px;border:1px solid rgba(255,255,255,.6);border-radius:999px;font:inherit;font-weight:800;color:#16263f;box-shadow:0 3px 12px -2px rgba(120,140,210,.45),inset 0 1px 0 rgba(255,255,255,.65);cursor:pointer;}' +
    '#hangsoForm .hs-ai-btn::before{content:"";position:absolute;inset:0;z-index:-1;border-radius:inherit;background:linear-gradient(110deg,#ffb3d1,#ffe0ad,#b6f2d8,#b6d8ff,#d9c2ff,#ffb3d1);background-size:200% 100%;animation:hs-ai-flow 4s linear infinite;}' +
    '#hangsoForm .hs-ai-btn::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(110deg,transparent 40%,rgba(255,255,255,.7) 50%,transparent 60%);transform:translateX(-140%);animation:hs-ai-sweep 4s ease-in-out infinite;}' +
    '#hangsoForm .hs-ai-ic{width:13px;height:13px;fill:currentColor;}' +
    '#hangsoForm .hs-ai-btn:disabled{opacity:.5;cursor:default;}' +
    '#hangsoForm .hs-ai-btn:disabled::before,#hangsoForm .hs-ai-btn:disabled::after{animation:none;}' +
    '@keyframes hs-ai-flow{0%{background-position:0% 50%}100%{background-position:-200% 50%}}' +
    '@keyframes hs-ai-sweep{0%{transform:translateX(-140%)}45%,100%{transform:translateX(140%)}}' +
    '@media (prefers-reduced-motion:reduce){#hangsoForm .hs-ai-btn::before,#hangsoForm .hs-ai-btn::after{animation:none;}}' +
    '#hangsoForm .hs-ai-hint{font-size:12px;color:#8a8f98;}';
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
            '<div class="hs-pick hs-minga"><span class="hs-pick-l">의뢰인 <span class="fs-hint">(지위 자동)</span></span><div class="fs-chips" id="hs-side">' +
              '<span class="fs-chip on" data-v="first" onclick="hsSide(\'first\')"><span class="hs-p1">원고</span> 측</span>' +
              '<span class="fs-chip" data-v="second" onclick="hsSide(\'second\')"><span class="hs-p2">피고</span> 측</span></div></div>' +
            '<div class="fs-row2 hs-minga"><div class="fs-field"><label class="fs-label"><span class="hs-p1">원고</span></label><input type="text" class="fs-input" id="hs-plaintiff" placeholder="엄대봉"></div>' +
              '<div class="fs-field"><label class="fs-label"><span class="hs-p2">피고</span></label><input type="text" class="fs-input" id="hs-defendant2" placeholder="주식회사 ○○"></div></div>' +
            // 사건번호+사건명 한 칸 · 법원+재판부 한 칸 (압축)
            '<div class="fs-field"><label class="fs-label"><span class="hs-hyeongsa">사건번호 · 죄명</span><span class="hs-minga">사건번호 · 사건명</span> <span class="fs-hint">(사건번호 한 칸 띄우고 사건명)</span></label><input type="text" class="fs-input" id="hs-case" placeholder="2025고단1234 사기"></div>' +
            '<div class="fs-field"><label class="fs-label">원심 법원 · 재판부 <span class="fs-hint">(사건번호로 재판부 자동)</span></label><input type="text" class="fs-input" id="hs-court" data-af="court" placeholder="인천지방법원 형사7단독"></div>' +
            // 선고일 · (송달일 민가사) · 작성일 한 줄
            '<div class="fs-row2"><div class="fs-field"><label class="fs-label">원심 선고일</label><input type="date" class="fs-input" id="hs-sentdate"></div>' +
              '<div class="fs-field hs-minga"><label class="fs-label">송달일</label><input type="date" class="fs-input" id="hs-servedate"></div>' +
              '<div class="fs-field"><label class="fs-label">작성일 <span class="fs-hint">(오늘)</span></label><input type="date" class="fs-input" id="hs-writedate"></div></div>' +

            // 형사 항소이유 / 상고 원심결과
            '<div class="fs-section hs-hyeongsa hs-hangso">항소이유 <span class="fs-hint">(선택 = ■ 표시 · 모두 미선택 시 항소이유란 생략)</span></div>' +
            '<div class="hs-pick hs-hyeongsa hs-hangso"><div class="fs-chips" id="hs-reasons" style="flex:1">' + reasonChips + '</div></div>' +
            '<div class="fs-field hs-hyeongsa hs-sanggo"><label class="fs-label">원심 결과</label><input type="text" class="fs-input" id="hs-result" value="항소기각" placeholder="항소기각"></div>' +

            // 민가사 주문·취지
            '<div class="fs-section hs-minga">원 판결의 표시 · 취지</div>' +
            '<div class="fs-field hs-minga"><label class="fs-label">판결문 <span class="fs-hint">(앞 2페이지의 주문·청구취지만 읽어 AI가 초안)</span></label>' +
              '<input type="file" id="hs-pdf" accept="application/pdf" style="display:none" onchange="hsPdfChoose(event)">' +
              '<div class="hs-drop" id="hs-drop" onclick="document.getElementById(\'hs-pdf\').click()" ondragover="hsDragOver(event)" ondragleave="hsDragLeave(event)" ondrop="hsDrop(event)">' +
                '<div class="hs-drop-ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/></svg></div>' +
                '<div class="hs-drop-t1" id="hs-pdf-name">판결문 올리기</div>' +
                '<div class="hs-drop-t2" id="hs-pdf-sub">클릭 또는 드래그하여 PDF 첨부</div></div>' +
              '<div class="hs-ai"><button type="button" class="hs-ai-btn" id="hs-ai-btn" onclick="hsRunAi()" disabled>' +
                '<svg class="hs-ai-ic" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.7 6.1a3 3 0 0 0 2.2 2.2L22 12l-6.1 1.7a3 3 0 0 0-2.2 2.2L12 22l-1.7-6.1a3 3 0 0 0-2.2-2.2L2 12l6.1-1.7a3 3 0 0 0 2.2-2.2z"/></svg>AI</button>' +
                '<span class="hs-ai-hint" id="hs-ai-hint"></span></div></div>' +
            '<div class="fs-field hs-minga"><label class="fs-label">원 판결의 표시 <span class="fs-hint">(주문, 한 줄에 한 항목)</span></label><textarea class="fs-input" id="hs-verdict" placeholder="1. 원고의 청구를 기각한다.\n2. 소송비용은 원고가 부담한다."></textarea></div>' +
            '<div class="fs-field hs-minga"><label class="fs-label"><span class="hs-hangso">항소취지</span><span class="hs-sanggo">상고취지</span> <span class="fs-hint">(한 줄에 한 항목)</span></label><textarea class="fs-input" id="hs-purpose" placeholder="1. 제1심판결을 취소한다.\n2. ..."></textarea></div>' +

            '<div class="fs-section">서명 · 날인</div>' +
            '<div class="fs-field hs-hyeongsa"><label class="fs-label"><input type="checkbox" id="hs-gukseon"> 국선사건 <span class="fs-hint">(변호인 앞 "국선" + "법무법인 정서" 줄 생략)</span></label></div>' +
            '<div class="fs-field"><label class="fs-label">담당변호사 <span class="fs-hint">(여러 명 선택 시 순서대로)</span></label>' +
              '<div class="fs-chips att-chips" id="hs-att" onclick="attChipClick(event,\'hs\')"></div>' +
              '</div>' +
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
  // 지위 라벨(원고/피고 → 실지위) UI 갱신: 칩·필드 라벨의 .hs-p1/.hs-p2 텍스트 + 의뢰인 쪽 선택
  function hsApplyPairUI() {
    var p = state.pair || { first: '원고', second: '피고' };
    document.querySelectorAll('#hangsoForm .hs-p1').forEach(function (e) { e.textContent = p.first; });
    document.querySelectorAll('#hangsoForm .hs-p2').forEach(function (e) { e.textContent = p.second; });
    segOn('hs-side', state.side);
  }
  // F: 사건번호 부호 → 분야(형사/민가사)·심급으로 칩 자동선택
  window.hsApplyCode = function (caseStr) {
    if (!state) return;
    var cn = String(caseStr || '').trim().split(/\s+/)[0];
    var cls = classifyCase(cn); if (!cls) return;
    window.hsCat(cls.cat);
    if (cls.lv === 1) window.hsType('항소'); else if (cls.lv === 2) window.hsType('상고');
  };
  // A: 창고 지위 → 당사자 쌍·의뢰인 쪽 자동선택(민가사)
  function hsApplyPosition(pos) {
    var jp = jiwiPair(pos); if (!jp) return;
    window.hsCat('민가사');
    state.pair = { first: jp.first, second: jp.second }; state.side = jp.clientSide;
    hsApplyPairUI();
  }
  // 의뢰인 이름 자동채우기: 형사는 피고인 칸(data-af로 이미 채워짐), 민가사는 지위(쪽)에 맞는 칸
  function hsFillClientName(name) {
    var clean = HWPXFill.cleanName(name); if (!clean) return;
    if (state.cat === '형사') { var d = document.getElementById('hs-defendant'); if (d) d.value = clean; return; }
    var id = state.side === 'second' ? 'hs-defendant2' : 'hs-plaintiff';
    var el = document.getElementById(id); if (el) el.value = clean;
  }
  // 판결문 PDF 업로드 → Edge Function(draft-chwiji)로 주문·취지·상대방 AI 초안 → 폼에 채움
  // 업로드/AI 분리: 판결문을 먼저 올려두고(pdfFile), AI 초안 버튼을 눌러야 실행
  var pdfFile = null;
  function hsSetPdf(f) {
    if (!f) return;
    if (!/pdf/i.test(f.type || '') && !/\.pdf$/i.test(f.name || '')) {
      var h0 = document.getElementById('hs-ai-hint'); if (h0) h0.textContent = 'PDF 파일만 올릴 수 있습니다.'; return;
    }
    pdfFile = f;
    var nm = document.getElementById('hs-pdf-name'); if (nm) nm.textContent = f.name;
    var sub = document.getElementById('hs-pdf-sub'); if (sub) sub.textContent = '다시 올리려면 클릭';
    var dz = document.getElementById('hs-drop'); if (dz) dz.classList.add('has-file');
    var btn = document.getElementById('hs-ai-btn'); if (btn) btn.disabled = false;
    var h = document.getElementById('hs-ai-hint'); if (h) h.textContent = '‘AI’ 버튼을 누르세요.';
  }
  window.hsPdfChoose = function (ev) {
    var f = ev.target && ev.target.files && ev.target.files[0];
    if (ev.target) ev.target.value = ''; // 같은 파일 재선택 허용
    hsSetPdf(f);
  };
  window.hsDragOver = function (e) { e.preventDefault(); e.currentTarget.classList.add('drag'); };
  window.hsDragLeave = function (e) { e.currentTarget.classList.remove('drag'); };
  window.hsDrop = function (e) {
    e.preventDefault(); e.currentTarget.classList.remove('drag');
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    hsSetPdf(f);
  };
  window.hsRunAi = function () {
    var hint = document.getElementById('hs-ai-hint');
    if (!pdfFile) { if (hint) hint.textContent = '먼저 판결문을 올려주세요.'; return; }
    var btn = document.getElementById('hs-ai-btn'); if (btn) btn.disabled = true;
    if (window.aiFieldStart) {
      aiFieldStart('hs-verdict', 'AI가 주문·청구취지를 분석하고 있어요');
      aiFieldStart('hs-purpose', 'AI가 항소·상고취지를 작성하고 있어요');
    }
    if (hint) hint.textContent = '판결문 앞 ' + HS_PDF_PAGES + '페이지 준비 중…';
    collect();
    var cfg = toCfg(state);
    var clientName = cfg.clientSide === 'second' ? cfg.defendant2 : cfg.plaintiff;
    firstPagesB64(pdfFile, HS_PDF_PAGES).then(function (b64) {
      if (hint) hint.textContent = 'AI가 주문·청구취지 분석 중… (10~20초)';
      return fetch(fnUrl('draft-chwiji'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'apikey': apiKey() },
        body: JSON.stringify({
          pdf: b64, type: cfg.type, guideKey: pickGuide(cfg.type, cfg.casenum),
          casenum: cfg.casenum, casename: cfg.casename, court: cfg.court,
          clientJiwi: cfg.clientJiwi, oppJiwi: cfg.oppJiwi, clientName: clientName
        })
      });
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (btn) btn.disabled = false;
      if (d && d.ok) {
        if (d.verdictLines && d.verdictLines.length) aiFieldDone('hs-verdict', d.verdictLines.join('\n')); else aiFieldStop('hs-verdict');
        if (d.purposeLines && d.purposeLines.length) aiFieldDone('hs-purpose', d.purposeLines.join('\n')); else aiFieldStop('hs-purpose');
        // 상대방 이름은 반대쪽 이름 칸에
        var oppNameId = cfg.clientSide === 'second' ? 'hs-plaintiff' : 'hs-defendant2';
        if (d.oppName) setVal(oppNameId, d.oppName);
        // 주소는 화면 칸 없이 상태에만 저장(자리별 addr1=앞·addr2=뒤) → 상고장 서면에 자동 반영
        if (cfg.clientSide === 'first') { state.addr1 = d.clientAddr || ''; state.addr2 = d.oppAddr || ''; }
        else { state.addr1 = d.oppAddr || ''; state.addr2 = d.clientAddr || ''; }
        if (hint) hint.textContent = 'AI 초안 완료 — 반드시 검토·수정 후 다운로드하세요.';
      } else {
        aiFieldStop('hs-verdict'); aiFieldStop('hs-purpose');
        if (hint) hint.textContent = '실패: ' + ((d && d.reason) || 'unknown') + ((d && d.detail) ? ' — ' + d.detail : '') + ' (직접 입력 가능)';
      }
    }).catch(function (e) { if (btn) btn.disabled = false; aiFieldStop('hs-verdict'); aiFieldStop('hs-purpose'); if (hint) hint.textContent = '오류: ' + e.message + ' (직접 입력 가능)'; });
  };
  function hsResetPdfUI() {
    pdfFile = null;
    var nm = document.getElementById('hs-pdf-name'); if (nm) nm.textContent = '판결문 올리기';
    var sub = document.getElementById('hs-pdf-sub'); if (sub) sub.textContent = '클릭 또는 드래그하여 PDF 첨부';
    var dz = document.getElementById('hs-drop'); if (dz) dz.classList.remove('has-file');
    var btn = document.getElementById('hs-ai-btn'); if (btn) btn.disabled = true;
    var h = document.getElementById('hs-ai-hint'); if (h) h.textContent = '';
  }
  function segOn(groupId, v) { var g = document.getElementById(groupId); if (g) g.querySelectorAll('[data-v]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === v); }); }

  function fillFormFromState() {
    setVal('hs-defendant', state.defendant);
    setVal('hs-case', [state.casenum, state.casename].filter(Boolean).join(' '));
    setVal('hs-court', [state.court, state.courtDiv].filter(Boolean).join(' '));
    setVal('hs-sentdate', state.sentDate);
    setVal('hs-servedate', state.serveDate); setVal('hs-result', state.result || '항소기각');
    setVal('hs-plaintiff', state.plaintiff); setVal('hs-defendant2', state.defendant2);
    setVal('hs-verdict', state.verdict); setVal('hs-purpose', state.purpose);
    hsResetPdfUI(); // 판결문 업로드/AI 초안 상태 초기화
    setVal('hs-writedate', state.writeDate || todayISO()); setVal('hs-att-new', '');
    var gk = document.getElementById('hs-gukseon'); if (gk) gk.checked = !!state.gukseon;
    var st = document.getElementById('hs-stamp'); if (st) st.checked = !!state.stamp;
    document.querySelectorAll('#hs-reasons .fs-chip').forEach(function (c) { c.classList.toggle('on', state.reasons.indexOf(c.getAttribute('data-v')) >= 0); });
    segOn('hs-cat', state.cat); segOn('hs-type', state.type); segOn('hs-side', state.side);
    if (typeof renderAttChips === 'function') renderAttChips('hs', (state.attorneys && state.attorneys.length) ? state.attorneys : ['서고은']);
    hsApplyPairUI();
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
    // 주소(addr1/addr2)는 화면 칸 없이 AI(hsRunAi)만 채우므로 여기서 건드리지 않음
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
    if (typeof initAutofillFor === 'function') initAutofillFor('hs-case', {
      caseCombine: 'hs-case', courtDept: 'hs-court', courtDeptAppend: true, sentDate: 'hs-sentdate',
      onFill: function (row) { window.hsApplyCode(row.l_code); hsApplyPosition(row.client_position); hsFillClientName(row.l_client); }
    });
    // 사건번호 직접입력 후에도 부호로 분야·심급 칩 자동선택(창고 미검색 시에도 동작)
    var caseEl = document.getElementById('hs-case');
    if (caseEl && caseEl.dataset.hsCls !== '1') { caseEl.dataset.hsCls = '1'; caseEl.addEventListener('change', function () { window.hsApplyCode(caseEl.value); }); }
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
    module.exports = { fillHangso: fillHangso, fillSanggo: fillSanggo, fillMingaHangso: fillMingaHangso, fillMingaSanggo: fillMingaSanggo, toCfg: toCfg, downloadName: downloadName, setLines: setLines, classifyCase: classifyCase, jiwiPair: jiwiPair };
  }
})();
