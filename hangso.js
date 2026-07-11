/* 법무법인 정서 PWA - 항소·상고장 (hangso.js)
   ───────────────────────────────────────────────────────────────
   독립 모듈. 표준 HWPX(templates/hangso.hwpx · sanggo.hwpx)를 채워 한글파일로 다운로드.
   흐름(참고자료·기일연기와 동일): goHangso() → [입력폼] → [한글 다운로드] (확인창 없음)

   상단 칩으로 '항소 / 상고' 전환(템플릿·표시 필드 전환).
   · 항소: 항소이유(사실오인·법리오해·양형부당) 체크 → ■(선택) / □(미선택)
   · 상고: 원심 결과(기본 '항소기각')
   국선(체크): '변호인' 앞에 '국선' + 서명란 '법무법인 정서' 줄 생략
   도장(체크): 담당변호사 첫 번째가 '서고은'일 때 서명란 이름 위에 직인 겹침

   의존: HWPXFill(hwpxfill.js) · JU(util.js) · FSDoc(fsdoc.js)
        · renderAttChips/addAttorney/attChipClick(index.html) · initAutofillFor(autofill.js)
        · window.SEAL_SEOGOEUN(전역 도장, 선택)
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var TPL = { 항소: './templates/hangso.hwpx', 상고: './templates/sanggo.hwpx' };
  var REASONS = ['사실오인', '법리오해', '양형부당'];

  function todayISO() { return JU.todayISO(); }
  function fmtKDate(iso) { // 'YYYY. M. D.'
    var m = ('' + (iso || '')).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    return m ? m[1] + '. ' + parseInt(m[2], 10) + '. ' + parseInt(m[3], 10) + '.' : '';
  }
  function fmtDot(iso) { // 'YYYY.MM.DD' (상고장 선고일 표기)
    var m = ('' + (iso || '')).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    return m ? m[1] + '.' + ('0' + m[2]).slice(-2) + '.' + ('0' + m[3]).slice(-2) : '';
  }
  function ymd(s) { var m = String(s || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/); return m ? m[1] + ('0' + m[2]).slice(-2) + ('0' + m[3]).slice(-2) : ''; }
  function spaced(name) { return String(name || '').trim().split('').join(' '); }
  function reEsc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  // 특정 텍스트가 든 <hp:p> 문단 통째로 제거(국선 시 '법무법인 정서'·불필요한 2번째 변호사 줄)
  function dropPara(ctx, text) {
    var re = new RegExp('<hp:p\\b[^>]*>(?:(?!</hp:p>)[\\s\\S])*?' + reEsc(text) + '[\\s\\S]*?</hp:p>');
    ctx.section = ctx.section.replace(re, '');
  }
  // ■(선택표시)를 □ 로 — 대상 이름 바로 앞의 네모만 토글(사이에 다른 ■ 없음)
  function uncheckBox(ctx, name) {
    var re = new RegExp('■((?:(?!■)[\\s\\S])*?' + reEsc(name) + ')');
    ctx.section = ctx.section.replace(re, '□$1');
  }

  /* ══════════ 항소장 채우기 ══════════
     hangso.hwpx 샘플: 2025고단4209 / 사기 / 함 석 훈 / 선고일 2026. 7. 9. /
       작성일 2026. 7. 10. / 인천지방법원 · 형사7단독 / (국선)변호인 / 법무법인 정서 / 서 고 은 */
  function fillHangso(ctx, c) {
    ctx.replace('2025고단4209', c.casenum || '')
       .replace('사기', c.casename || '')
       .replace('함 석 훈', spaced(c.defendant))
       .replace('2026. 7. 9.', c.sentDate || '')
       .replace('2026. 7. 10.', c.writeDate || '')
       .replace('인천지방법원', c.court || '')
       .replace('형사7단독', c.courtDiv || '');
    // 항소이유: 미선택 항목의 ■ → □
    REASONS.forEach(function (r) { if (c.reasons.indexOf(r) < 0) uncheckBox(ctx, r); });
    // 국선/변호인
    ctx.replace('(국선)변호인', c.gukseon ? '국선변호인' : '변호인');
    if (c.gukseon) dropPara(ctx, '법무법인 정서');
    // 담당변호사(단독 서명)
    if (c.attorney !== '서고은') ctx.replace('서 고 은', spaced(c.attorney));
  }

  /* ══════════ 상고장 채우기 ══════════
     sanggo.hwpx 샘플: 2025노3460 / 전자금융거래법위반 / 조용순 / 원심선고일 2026.07.06 /
       항소기각 / 작성일 2026. 7. 11. / 수원지방법원 · 제8-1형사부(항소) / 위 피고인의 변호인 /
       법무법인 정서 / 서 고 은 / 우 숭 민 */
  function fillSanggo(ctx, c) {
    ctx.replace('2025노3460', c.casenum || '')
       .replace('전자금융거래법위반', c.casename || '')
       .replace('조용순', c.defendant || '')
       .replace('2026.07.06', c.sentDate || '')
       .replace('2026. 7. 11.', c.writeDate || '')
       .replace('수원지방법원', c.court || '')
       .replace('제8-1형사부(항소)', c.courtDiv || '');
    if (c.result && c.result !== '항소기각') ctx.replace('항소기각', c.result);
    if (c.gukseon) ctx.replace('위 피고인의 변호인', '위 피고인의 국선변호인');
    if (c.gukseon) dropPara(ctx, '법무법인 정서');
    // 담당변호사: 첫 번째 → '서 고 은' 자리, 두 번째 있으면 '우 숭 민' 자리, 없으면 그 줄 제거
    if (c.attorney !== '서고은') ctx.replace('서 고 은', spaced(c.attorney));
    if (c.attorney2) ctx.replace('우 숭 민', spaced(c.attorney2));
    else dropPara(ctx, '우 숭 민');
  }

  /* ══════════ 상태 ══════════ */
  var state = null;
  function defaultState() {
    return {
      type: '항소', defendant: '', casenum: '', casename: '', court: '', courtDiv: '',
      sentDate: '', reasons: REASONS.slice(), result: '항소기각',
      gukseon: false, attorneys: ['서고은'], writeDate: todayISO(), stamp: true
    };
  }
  function toCfg(s) {
    var atts = (s.attorneys && s.attorneys.length) ? s.attorneys.slice() : ['서고은'];
    var sent = s.type === '상고' ? fmtDot(s.sentDate) : fmtKDate(s.sentDate);
    return {
      type: s.type, defendant: s.defendant, casenum: s.casenum, casename: s.casename,
      court: s.court, courtDiv: s.courtDiv, sentDate: sent,
      writeDate: fmtKDate(s.writeDate) || fmtKDate(todayISO()),
      reasons: (s.reasons && s.reasons.length) ? s.reasons.slice() : [],
      result: s.result || '항소기각', gukseon: !!s.gukseon,
      attorney: atts[0], attorney2: atts[1] || '', stamp: !!s.stamp
    };
  }
  function downloadName(s) {
    return HWPXFill.safeName([s.type + '장', s.defendant, s.casenum, ymd(s.writeDate)]);
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
    '#hangsoForm .hs-sanggo{display:none;}' +
    '#hangsoForm.is-sanggo .hs-hangso{display:none;}' +
    '#hangsoForm.is-sanggo .hs-sanggo{display:block;}';
  function injectStyle() { FSDoc.injectOnce(STYLE_ID, HS_CSS); }

  /* ══════════ 화면(입력폼) ══════════ */
  var SHELL_ID = 'hangso-shell';
  function injectShell() {
    if (document.getElementById(SHELL_ID)) return;
    var reasonChips = REASONS.map(function (r) {
      return '<span class="fs-chip on" data-v="' + r + '" onclick="hsToggleReason(this)">' + r + '</span>';
    }).join('');
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
            '<div class="hs-pick"><span class="hs-pick-l">서면 종류</span><div class="fs-chips" id="hs-type">' +
              '<span class="fs-chip on" data-v="항소" onclick="hsType(\'항소\')">항소장</span>' +
              '<span class="fs-chip" data-v="상고" onclick="hsType(\'상고\')">상고장</span></div></div>' +

            '<div class="fs-section">사건 정보</div>' +
            '<div class="fs-field"><label class="fs-label">피고인</label><input type="text" class="fs-input" id="hs-defendant" data-af="l_client" placeholder="홍길동"></div>' +
            '<div class="fs-field"><label class="fs-label">사건번호</label><input type="text" class="fs-input" id="hs-casenum" data-af="l_code" placeholder="2025고단1234"></div>' +
            '<div class="fs-field"><label class="fs-label">죄명</label><input type="text" class="fs-input" id="hs-casename" data-af="l_name" placeholder="사기"></div>' +
            '<div class="fs-field"><label class="fs-label">원심 법원</label><input type="text" class="fs-input" id="hs-court" data-af="court" placeholder="인천지방법원"></div>' +
            '<div class="fs-field"><label class="fs-label">원심 재판부 <span class="fs-hint">(사건번호로 자동 조회)</span></label><input type="text" class="fs-input" id="hs-courtdiv" placeholder="형사7단독"></div>' +
            '<div class="fs-field"><label class="fs-label">원심 선고일 <span class="fs-hint">(사건번호로 자동 조회)</span></label><input type="date" class="fs-input" id="hs-sentdate"></div>' +

            '<div class="fs-section hs-hangso">항소이유 <span class="fs-hint">(선택 = ■ 표시)</span></div>' +
            '<div class="hs-pick hs-hangso"><div class="fs-chips" id="hs-reasons" style="flex:1">' + reasonChips + '</div></div>' +

            '<div class="fs-field hs-sanggo"><label class="fs-label">원심 결과</label><input type="text" class="fs-input" id="hs-result" value="항소기각" placeholder="항소기각"></div>' +

            '<div class="fs-section">서명 · 날인</div>' +
            '<div class="fs-field"><label class="fs-label"><input type="checkbox" id="hs-gukseon"> 국선사건 <span class="fs-hint">(변호인 앞 "국선" + "법무법인 정서" 줄 생략)</span></label></div>' +
            '<div class="fs-field"><label class="fs-label">담당변호사 <span class="fs-hint">(여러 명 선택 시 순서대로)</span></label>' +
              '<div class="fs-chips att-chips" id="hs-att" onclick="attChipClick(event,\'hs\')"></div>' +
              '<div class="att-add-row"><input type="text" class="att-add-input" id="hs-att-new" placeholder="추가할 변호사 이름"><button type="button" class="att-add-btn" onclick="addAttorney(\'hs\')">＋ 추가</button></div></div>' +
            '<div class="fs-field"><label class="fs-label">작성일 (오늘 자동)</label><input type="date" class="fs-input" id="hs-writedate"></div>' +
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

  window.hsType = function (v) {
    state.type = v;
    var g = document.getElementById('hs-type');
    if (g) g.querySelectorAll('[data-v]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === v); });
    var f = document.getElementById('hangsoForm'); if (f) f.classList.toggle('is-sanggo', v === '상고');
    var t = document.querySelector('#hangsoForm .fs-title'); if (t) t.textContent = v + '장';
  };
  window.hsToggleReason = function (el) { el.classList.toggle('on'); };

  function fillFormFromState() {
    setVal('hs-defendant', state.defendant); setVal('hs-casenum', state.casenum);
    setVal('hs-casename', state.casename); setVal('hs-court', state.court);
    setVal('hs-courtdiv', state.courtDiv); setVal('hs-sentdate', state.sentDate);
    setVal('hs-result', state.result || '항소기각');
    setVal('hs-writedate', state.writeDate || todayISO());
    setVal('hs-att-new', '');
    var gk = document.getElementById('hs-gukseon'); if (gk) gk.checked = !!state.gukseon;
    var st = document.getElementById('hs-stamp'); if (st) st.checked = !!state.stamp;
    document.querySelectorAll('#hs-reasons .fs-chip').forEach(function (c) {
      c.classList.toggle('on', state.reasons.indexOf(c.getAttribute('data-v')) >= 0);
    });
    if (typeof renderAttChips === 'function') renderAttChips('hs', (state.attorneys && state.attorneys.length) ? state.attorneys : ['서고은']);
    window.hsType(state.type);
  }
  function collect() {
    state.defendant = getVal('hs-defendant'); state.casenum = getVal('hs-casenum');
    state.casename = getVal('hs-casename'); state.court = getVal('hs-court');
    state.courtDiv = getVal('hs-courtdiv'); state.sentDate = getVal('hs-sentdate');
    state.result = getVal('hs-result') || '항소기각';
    state.writeDate = getVal('hs-writedate') || todayISO();
    var rs = [];
    document.querySelectorAll('#hs-reasons .fs-chip.on').forEach(function (c) { rs.push(c.getAttribute('data-v')); });
    state.reasons = rs;
    var atts = [];
    document.querySelectorAll('#hs-att .fs-chip.on').forEach(function (c) { atts.push(c.dataset.att); });
    state.attorneys = atts.length ? atts : ['서고은'];
    var gk = document.getElementById('hs-gukseon'); state.gukseon = !!(gk && gk.checked);
    var st = document.getElementById('hs-stamp'); state.stamp = !!(st && st.checked);
  }

  /* ══════════ 진입점 ══════════ */
  function ensureUI() { injectStyle(); injectShell(); }
  window.goHangso = function () {
    ensureUI(); state = defaultState(); fillFormFromState();
    document.getElementById('hangsoForm').classList.add('active');
    if (typeof initAutofillFor === 'function') {
      initAutofillFor('hs-casenum', { courtDept: 'hs-courtdiv', sentDate: 'hs-sentdate' });
    }
  };
  window.closeHangsoForm = function () {
    var f = document.getElementById('hangsoForm'); if (f) f.classList.remove('active');
    // 국선 사건관리에서 열었으면 취소 시 국선 화면으로 복귀
    if (window._gsmgrReturn) { window._gsmgrReturn = false; if (window.goCaseManager) window.goCaseManager(); }
  };

  window.hsDownload = function () {
    if (!state) state = defaultState();
    collect();
    var cfg = toCfg(state);
    if (!cfg.casenum && !cfg.defendant) { alert('사건번호 또는 피고인을 먼저 입력해주세요.'); return; }
    var wantSeal = cfg.stamp && cfg.attorney === '서고은' && (typeof window !== 'undefined') && window.SEAL_SEOGOEUN;
    HWPXFill.build({
      url: TPL[cfg.type],
      fill: function (ctx) { (cfg.type === '상고' ? fillSanggo : fillHangso)(ctx, cfg); },
      sealDataUrl: wantSeal ? window.SEAL_SEOGOEUN : null,
      sealAnchor: '담당변호사 ' + spaced(cfg.attorney)
    }).then(function (blob) {
      HWPXFill.saveBlob(blob, downloadName(state));
    }).catch(function (e) { alert('HWPX 생성 실패: ' + e.message); });
  };

  /* node 검증용 */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { fillHangso: fillHangso, fillSanggo: fillSanggo, toCfg: toCfg, downloadName: downloadName };
  }
})();
