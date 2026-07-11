/* 법무법인 정서 PWA - 판결등본교부청구 (pankyul.js)
   ───────────────────────────────────────────────────────────────
   독립 모듈. 표준 HWPX(templates/pankyul.hwpx)를 채워 한글파일로 다운로드.
   흐름(참고자료·기일연기와 동일): goPankyul() → [입력폼] → [한글 다운로드] (확인창 없음)

   자동채우기(data-af + court-lookup): 사건번호로 재판부·선고일 조회
   도장(선택) = 담당변호사가 '서고은'일 때 청구인 서명란 이름 위에 직인 겹침

   의존: HWPXFill(hwpxfill.js) · JU(util.js) · FSDoc(fsdoc.js)
        · renderAttChips/addAttorney/attChipClick(index.html) · initAutofillFor(autofill.js)
        · window.SEAL_SEOGOEUN(전역 도장, 선택)
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var TPL = './templates/pankyul.hwpx';

  function esc(v) { return JU.esc(v); }
  function todayISO() { return JU.todayISO(); }
  // 'YYYY-MM-DD' → 'YYYY. M. D.'
  function fmtKDate(iso) {
    var m = ('' + (iso || '')).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    return m ? m[1] + '. ' + parseInt(m[2], 10) + '. ' + parseInt(m[3], 10) + '.' : '';
  }
  // 'YYYY-MM-DD' → 'YYYY.MM.DD.' (선고일 — 양식 표기)
  function fmtDotDate(iso) {
    var m = ('' + (iso || '')).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    return m ? m[1] + '.' + ('0' + m[2]).slice(-2) + '.' + ('0' + m[3]).slice(-2) + '.' : '';
  }
  function ymd(s) {
    var m = String(s || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    return m ? m[1] + ('0' + m[2]).slice(-2) + ('0' + m[3]).slice(-2) : '';
  }
  function spaced(name) { return String(name || '').trim().split('').join(' '); }

  /* ══════════ HWPX 채우기 — 템플릿 샘플값을 사용자 값으로 앵커 치환 ══════════
     templates/pankyul.hwpx 샘플: 재판부 형사7단독 / 사건번호 2026고단850 /
       사건명 도박장소개설방조 / 피고인 강세희 / 선고일 2026.06.25. /
       작성일 2026. 7. 11. / 법원 인천지방법원 / 변호사 서 고 은 / (국선변호인)  */
  function fillPankyul(ctx, c) {
    ctx.replace('형사7단독', c.courtDiv || '')
       .replace('2026고단485', c.casenum || '')
       .replace('마약류관리에관한법률위반(향정)', c.casename || '')
       .replace('채윤휘빈센트 (국선 채윤휘빈센트)', c.defendant || '')
       .replace('2026.06.26.', c.sentDate || '')
       .replace('2026. 7. 12.', c.writeDate || '')
       // 마무리줄: 법원과 재판부 사이 한 칸(예: 인천지방법원 제7형사부 귀중)
       .replace('인천지방법원 귀중', (c.court || '') + (c.courtDiv ? ' ' + c.courtDiv : '') + ' 귀중');
    // 국선: 국선이면 '(국선변호인)' 유지, 아니면 제거(현행 템플릿엔 없으므로 무영향)
    if (!c.gukseon) ctx.replace('(국선변호인)', '');
    // 변호사 이름(공백형 '서 고 은' + 영수란 '서고은') 치환
    if (c.attorney && c.attorney !== '서고은') {
      ctx.replace('서 고 은', spaced(c.attorney)).replace('서고은', c.attorney);
    }
    // 도장: 서고은+날인 선택이면 템플릿 도장 유지, 아니면 제거
    if (!c.keepSeal) ctx.stripSeal();
  }

  /* ══════════ 상태 ══════════ */
  var state = null;
  function defaultState() {
    return {
      defendant: '', casenum: '', casename: '', court: '', courtDiv: '',
      sentDate: '', gukseon: false, attorneys: ['서고은'],
      writeDate: todayISO(), stamp: true
    };
  }
  function toCfg(s) {
    var att = (s.attorneys && s.attorneys.length) ? s.attorneys[0] : '서고은';
    return {
      defendant: HWPXFill.cleanName(s.defendant), casenum: s.casenum, casename: s.casename,
      court: s.court, courtDiv: s.courtDiv,
      sentDate: fmtDotDate(s.sentDate), writeDate: fmtKDate(s.writeDate) || fmtKDate(todayISO()),
      gukseon: !!s.gukseon, attorney: att, stamp: !!s.stamp,
      keepSeal: !!s.stamp && att === '서고은'
    };
  }
  function downloadName(s) {
    return HWPXFill.safeName(['판결등본교부청구', s.defendant, s.casenum, ymd(s.writeDate)]);
  }

  /* ══════════ CSS ══════════ */
  var STYLE_ID = 'pankyul-style';
  var PK_CSS =
    '#pankyulForm{display:none;position:fixed;inset:0;z-index:1100;background:#fff;flex-direction:column;}' +
    '#pankyulForm.active{display:flex;}';
  function injectStyle() { FSDoc.injectOnce(STYLE_ID, PK_CSS); }

  /* ══════════ 화면(입력폼) ══════════ */
  var SHELL_ID = 'pankyul-shell';
  function injectShell() {
    if (document.getElementById(SHELL_ID)) return;
    var wrap = document.createElement('div');
    wrap.id = SHELL_ID;
    wrap.innerHTML =
      '<div id="pankyulForm">' +
        '<div class="fs-card">' +
          '<div class="fs-head">' +
            '<button class="fs-close" onclick="closePankyulForm()" aria-label="닫기"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
            '<div class="fs-title">판결등본교부청구</div>' +
          '</div>' +
          '<div class="fs-body">' +
            '<div class="fs-section">사건 정보</div>' +
            '<div class="fs-field"><label class="fs-label">피고인</label><input type="text" class="fs-input" id="pk-defendant" data-af="l_client" placeholder="홍길동"></div>' +
            '<div class="fs-field"><label class="fs-label">사건번호</label><input type="text" class="fs-input" id="pk-casenum" data-af="l_code" placeholder="2026고단1234"></div>' +
            '<div class="fs-field"><label class="fs-label">사건명</label><input type="text" class="fs-input" id="pk-casename" data-af="l_name" placeholder="사기"></div>' +
            '<div class="fs-field"><label class="fs-label">법원</label><input type="text" class="fs-input" id="pk-court" data-af="court" placeholder="인천지방법원"></div>' +
            '<div class="fs-field"><label class="fs-label">재판부 <span class="fs-hint">(사건번호로 자동 조회)</span></label><input type="text" class="fs-input" id="pk-courtdiv" placeholder="형사7단독"></div>' +
            '<div class="fs-field"><label class="fs-label">선고일 <span class="fs-hint">(사건번호로 자동 조회)</span></label><input type="date" class="fs-input" id="pk-sentdate"></div>' +

            '<div class="fs-section">청구인 · 서명</div>' +
            '<div class="fs-field"><label class="fs-label"><input type="checkbox" id="pk-gukseon"> 국선사건 <span class="fs-hint">(선택 시 "국선변호인" 표기)</span></label></div>' +
            '<div class="fs-field"><label class="fs-label">담당변호사</label>' +
              '<div class="fs-chips att-chips" id="pk-att" onclick="attChipClick(event,\'pk\')"></div>' +
              '<div class="att-add-row"><input type="text" class="att-add-input" id="pk-att-new" placeholder="추가할 변호사 이름"><button type="button" class="att-add-btn" onclick="addAttorney(\'pk\')">＋ 추가</button></div></div>' +
            '<div class="fs-field"><label class="fs-label">작성일 (오늘 자동)</label><input type="date" class="fs-input" id="pk-writedate"></div>' +
            '<div class="fs-field"><label class="fs-label"><input type="checkbox" id="pk-stamp"> 서고은 도장 날인 <span class="fs-hint">(담당변호사 첫 번째가 서고은일 때)</span></label></div>' +
          '</div>' +
          '<div class="fs-foot">' +
            '<button class="fs-btn ghost" onclick="closePankyulForm()">취소</button>' +
            '<button class="fs-btn primary" onclick="pkDownload()">한글 다운로드</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
  }

  /* ══════════ DOM 유틸 ══════════ */
  function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v == null ? '' : v; }
  function getVal(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }

  function fillFormFromState() {
    setVal('pk-defendant', state.defendant); setVal('pk-casenum', state.casenum);
    setVal('pk-casename', state.casename); setVal('pk-court', state.court);
    setVal('pk-courtdiv', state.courtDiv); setVal('pk-sentdate', state.sentDate);
    setVal('pk-writedate', state.writeDate || todayISO());
    setVal('pk-att-new', '');
    var gk = document.getElementById('pk-gukseon'); if (gk) gk.checked = !!state.gukseon;
    var st = document.getElementById('pk-stamp'); if (st) st.checked = !!state.stamp;
    if (typeof renderAttChips === 'function') renderAttChips('pk', (state.attorneys && state.attorneys.length) ? state.attorneys : ['서고은']);
  }
  function collect() {
    state.defendant = getVal('pk-defendant'); state.casenum = getVal('pk-casenum');
    state.casename = getVal('pk-casename'); state.court = getVal('pk-court');
    state.courtDiv = getVal('pk-courtdiv'); state.sentDate = getVal('pk-sentdate');
    state.writeDate = getVal('pk-writedate') || todayISO();
    var atts = [];
    document.querySelectorAll('#pk-att .fs-chip.on').forEach(function (c) { atts.push(c.dataset.att); });
    state.attorneys = atts.length ? atts : ['서고은'];
    var gk = document.getElementById('pk-gukseon'); state.gukseon = !!(gk && gk.checked);
    var st = document.getElementById('pk-stamp'); state.stamp = !!(st && st.checked);
  }

  /* ══════════ 진입점 ══════════ */
  function ensureUI() { injectStyle(); injectShell(); }
  window.goPankyul = function () {
    ensureUI(); state = defaultState(); fillFormFromState();
    document.getElementById('pankyulForm').classList.add('active');
    if (typeof initAutofillFor === 'function') {
      initAutofillFor('pk-casenum', { courtDept: 'pk-courtdiv', sentDate: 'pk-sentdate' });
    }
  };
  window.closePankyulForm = function () { var f = document.getElementById('pankyulForm'); if (f) f.classList.remove('active'); };

  window.pkDownload = function () {
    if (!state) state = defaultState();
    collect();
    var cfg = toCfg(state);
    if (!cfg.casenum && !cfg.defendant) { alert('사건번호 또는 피고인을 먼저 입력해주세요.'); return; }
    HWPXFill.build({
      url: TPL,
      fill: function (ctx) { fillPankyul(ctx, cfg); }
    }).then(function (blob) {
      HWPXFill.saveBlob(blob, downloadName(state));
    }).catch(function (e) { alert('HWPX 생성 실패: ' + e.message); });
  };

  /* node 검증용 */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { fillPankyul: fillPankyul, toCfg: toCfg, downloadName: downloadName };
  }
})();
