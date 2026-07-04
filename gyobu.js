/* ============================================================
 *  gyobu.js  —  판결등본교부청구 (독립 모듈)
 *  yeollam.js / gyeongyu.js 와 같은 형제 모듈
 *
 *  진입점 : window.openGyobu()
 *  의존   : - autofill.js 의 initAutofillFor(id)  (사건 자동완성)
 *           - 전역 도장 상수 SEAL_SEOGOEUN (index.html 에 이미 존재)
 *           - html2canvas, jsPDF (index.html 에 이미 로드됨)
 *
 *  ※ 서면 격자는 원본 양식(판결등본교부청구)을 그대로 재현함.
 *  ※ 성역 미접촉: 도장 base64/폰트/PWA 등록 코드 안 건드림
 * ============================================================ */
(function () {
  'use strict';

  var LAWYERS = ['서고은', '정필성', '김홍일', '양선화', '우숭민', '이예나', '손영우'];
  var SEAL_MAP = { '서고은': 'SEAL_SEOGOEUN' }; // 직인 보유 변호사 → 전역 상수명

  function todayKorean() {
    var d = new Date();
    return d.getFullYear() + '. ' + (d.getMonth() + 1) + '. ' + d.getDate() + '.';
  }
  function normDate(raw) {
    if (!raw) return '';
    var m = String(raw).match(/(\d{4})\D*(\d{1,2})\D*(\d{1,2})/);
    if (!m) return String(raw);
    return m[1] + '. ' + parseInt(m[2], 10) + '. ' + parseInt(m[3], 10) + '.';
  }

  // ─────────────────────────────────────────────
  //  화면 렌더
  // ─────────────────────────────────────────────
  function render() {
    var wrap = document.createElement('div');
    wrap.id = 'gyobu-screen';
    wrap.innerHTML = ''
      + styleBlock()
      + '<div class="gb-topbar">'
      +   '<button class="gb-back" onclick="closeGyobu()" aria-label="뒤로">'
      +     '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>'
      +   '</button>'
      +   '<div class="gb-title">판결등본교부청구</div>'
      +   '<button class="gb-print" onclick="gyobuPrint()">PDF 저장</button>'
      + '</div>'

      // ── 조작 패널 ──
      + '<div class="gb-panel">'
      +   '<div class="gb-field">'
      +     '<label>청구인</label>'
      +     '<div class="gb-seg" id="gb-reqseg">'
      +       '<button data-t="official" class="on" onclick="gyobuSetType(this)">국선변호인</button>'
      +       '<button data-t="private" onclick="gyobuSetType(this)">변호인(사선)</button>'
      +       '<button data-t="self" onclick="gyobuSetType(this)">피고인 본인</button>'
      +     '</div>'
      +   '</div>'
      +   '<div class="gb-field" id="gb-lawyer-wrap">'
      +     '<label>변호사</label>'
      +     '<select id="gb-lawyer" onchange="gyobuSync()">' + lawyerOptions() + '</select>'
      +   '</div>'
      + '</div>'

      // ── 서면 본체 (원본 격자 재현) ──
      + '<div class="gb-paper-scroll"><div class="gb-paper" id="gb-paper">'
      +   '<table class="gb-doc"><colgroup>'
      +     '<col class="c1"><col class="c2"><col class="c3"><col class="c4"></colgroup>'

      +     '<tr><td colspan="4" class="gb-title-cell">판 결 등 본 교 부 청 구</td></tr>'

      +     '<tr>'
      +       '<th class="gb-lbl">재 판 부</th>'
      +       '<td colspan="2" class="gb-val"><input id="gb-court-dept" data-af="l_justice_dept" placeholder="형사7단독"></td>'
      +       '<td rowspan="4" class="gb-stampcell"><div class="gb-inji">인지<br>1,000원</div><div class="gb-attach">첨부</div></td>'
      +     '</tr>'
      +     '<tr><th class="gb-lbl">사건번호</th><td colspan="2" class="gb-val"><input id="gb-code" data-af="l_code" placeholder="2026고정154"></td></tr>'
      +     '<tr><th class="gb-lbl">사 건 명</th><td colspan="2" class="gb-val"><input id="gb-name" data-af="l_name" placeholder="컴퓨터등사용사기"></td></tr>'
      +     '<tr><th class="gb-lbl">피 고 인</th><td colspan="2" class="gb-val"><input id="gb-client" data-af="l_client" placeholder="홍길동"></td></tr>'

      +     '<tr><td colspan="4" class="gb-bodycell">'
      +       '<p class="gb-body">위 사람에 대한 <span id="gb-body-name" class="u">○○○</span> 사건에 '
      +         '관하여 귀원이 <input id="gb-judgment" class="gb-date-in" placeholder="선고일"> 선고한 '
      +         '판결문등본 1통을 교부하여 주시기 바랍니다.</p>'
      +       '<div class="gb-filedate" id="gb-date">' + todayKorean() + '</div>'
      +     '</td></tr>'

      +     '<tr>'
      +       '<th class="gb-lbl" rowspan="2">청 구 인</th>'
      +       '<td class="gb-reqc2">위 피고인</td>'
      +       '<td colspan="2" class="gb-reqc3"><span id="gb-req-client">○○○</span></td>'
      +     '</tr>'
      +     '<tr>'
      +       '<td class="gb-reqc2">위 피고인의 변호인</td>'
      +       '<td colspan="2" class="gb-reqc3">'
      +         '<span id="gb-req-role">국선변호인</span> 변호사 <span id="gb-req-lawyer">서고은</span></td>'
      +     '</tr>'

      +     '<tr><th class="gb-lbl">청구사유<br>소 명</th>'
      +       '<td colspan="3" class="gb-val"><input id="gb-reason" value="선고결과를 확인하기 위하여"></td></tr>'

      +     '<tr><td colspan="4" class="gb-courtcell">'
      +       '<input id="gb-court" data-af="court" value="인천지방법원"> 귀중</td></tr>'

      +     '<tr><td colspan="4" class="gb-recvcell">위 서류 1 통을 영수함  변호사 '
      +       '<span id="gb-recv-name">서고은</span><span id="gb-seal" class="gb-seal"></span></td></tr>'
      +   '</table>'
      +   '</div></div>'
      + '</div>';

    document.body.appendChild(wrap);
    document.documentElement.style.overflow = 'hidden';

    try {
      var afFn = (typeof window.initAutofillFor === 'function') ? window.initAutofillFor
               : (typeof initAutofillFor === 'function' ? initAutofillFor : null);
      if (afFn) afFn('gb-code');
    } catch (e) { console.warn('[gyobu] autofill init skip:', e); }

    ['gb-code', 'gb-name', 'gb-client', 'gb-court-dept', 'gb-court', 'gb-judgment', 'gb-reason']
      .forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('input', gyobuSync);
      });
    var codeEl = document.getElementById('gb-code');
    if (codeEl) codeEl.addEventListener('change', tryCourtLookup);

    gyobuSync();
  }

  function lawyerOptions() {
    return LAWYERS.map(function (n) {
      return '<option value="' + n + '"' + (n === '서고은' ? ' selected' : '') + '>' + n + '</option>';
    }).join('');
  }

  // ── 선고일·재판부 서버 조회 (court-lookup 재활용 지점) ──
  //  ⚠️ 여기 한 곳만 autofill.js 의 실제 함수명에 맞추면 됨.
  function tryCourtLookup() {
    var code = (document.getElementById('gb-code') || {}).value || '';
    if (!code.trim()) return;
    if (typeof window.lookupCourtInfo === 'function') {
      window.lookupCourtInfo(code).then(function (info) {
        if (!info) return;
        if (info.l_judgment_date) setVal('gb-judgment', normDate(info.l_judgment_date));
        if (info.l_justice_dept) setVal('gb-court-dept', info.l_justice_dept);
        gyobuSync();
      }).catch(function (e) { console.warn('[gyobu] court-lookup 실패:', e); });
    }
    // 함수 없으면 선고일·재판부 칸에 직접 입력 (폼은 그대로 동작)
  }

  // ── 동기화: 조작 UI ↔ 서면 표시 ──
  function gyobuSync() {
    var type = currentType();
    var lawyer = (document.getElementById('gb-lawyer') || {}).value || '서고은';
    var defendant = (document.getElementById('gb-client') || {}).value || '';
    var name = (document.getElementById('gb-name') || {}).value || '';

    setText('gb-body-name', name || '○○○');
    setText('gb-req-client', defendant || '○○○');

    var roleEl = document.getElementById('gb-req-role');
    var reqLawyerEl = document.getElementById('gb-req-lawyer');
    var recv = document.getElementById('gb-recv-name');
    var sealSlot = document.getElementById('gb-seal');
    var lw = document.getElementById('gb-lawyer-wrap');

    if (type === 'self') {
      // 피고인 본인 청구: 변호인 줄 비우고, 영수도 피고인 본인
      if (roleEl) roleEl.textContent = '';
      if (reqLawyerEl) reqLawyerEl.textContent = '';
      if (recv) recv.textContent = defendant || '○○○';
      if (sealSlot) sealSlot.innerHTML = '<span class="gb-seal-txt">(인)</span>';
      if (lw) lw.style.display = 'none';
    } else {
      if (roleEl) roleEl.textContent = (type === 'private') ? '' : '국선변호인';
      if (reqLawyerEl) reqLawyerEl.textContent = lawyer;
      if (recv) recv.textContent = lawyer;
      if (sealSlot) sealSlot.innerHTML = sealImg(lawyer);
      if (lw) lw.style.display = '';
    }
  }

  function currentType() {
    var on = document.querySelector('#gb-reqseg button.on');
    return on ? on.getAttribute('data-t') : 'official';
  }

  function sealImg(lawyer) {
    var varName = SEAL_MAP[lawyer];
    if (varName && typeof window[varName] === 'string' && window[varName]) {
      return '<img src="' + window[varName] + '" alt="인" class="gb-seal-img">';
    }
    return '<span class="gb-seal-txt">(인)</span>';
  }

  function setText(id, t) { var e = document.getElementById(id); if (e) e.textContent = t; }
  function setVal(id, v) { var e = document.getElementById(id); if (e) e.value = v; }

  // ── 인쇄/PDF — html2canvas 주의점(input→span 교체) 적용 ──
  function gyobuPrint() {
    var paper = document.getElementById('gb-paper');
    if (!paper) return;
    var swapped = [];
    paper.querySelectorAll('input, select').forEach(function (el) {
      var span = document.createElement('span');
      span.className = 'gb-capture-text';
      span.textContent = (el.value || el.getAttribute('placeholder') || '').trim();
      el.style.display = 'none';
      el.parentNode.insertBefore(span, el);
      swapped.push({ el: el, span: span });
    });
    var restore = function () {
      swapped.forEach(function (s) {
        s.el.style.display = '';
        if (s.span && s.span.parentNode) s.span.parentNode.removeChild(s.span);
      });
    };
    if (typeof html2canvas !== 'function') { restore(); alert('인쇄 모듈을 불러오지 못했습니다.'); return; }
    html2canvas(paper, { scale: 2, backgroundColor: '#ffffff', useCORS: true })
      .then(function (canvas) {
        restore();
        var img = canvas.toDataURL('image/png');
        var jsPDFCtor = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
        if (!jsPDFCtor) { alert('PDF 모듈을 불러오지 못했습니다.'); return; }
        var pdf = new jsPDFCtor('p', 'mm', 'a4');
        var pw = 210, ph = 297;
        var iw = pw, ih = canvas.height * pw / canvas.width, y = 0, left = ih;
        if (ih <= ph) { pdf.addImage(img, 'PNG', 0, 0, iw, ih); }
        else {
          while (left > 0) { pdf.addImage(img, 'PNG', 0, y, iw, ih); left -= ph; y -= ph; if (left > 0) pdf.addPage(); }
        }
        pdf.save('판결등본교부청구.pdf');
      })
      .catch(function (e) { restore(); console.error(e); alert('PDF 생성 중 오류가 발생했습니다.'); });
  }

  // ── 전역 진입점/핸들러 ──
  window.openGyobu = function () { if (document.getElementById('gyobu-screen')) return; render(); };
  window.closeGyobu = function () {
    var s = document.getElementById('gyobu-screen');
    if (s) s.parentNode.removeChild(s);
    document.documentElement.style.overflow = '';
  };
  window.gyobuSetType = function (btn) {
    var seg = document.getElementById('gb-reqseg');
    if (seg) seg.querySelectorAll('button').forEach(function (b) { b.classList.remove('on'); });
    btn.classList.add('on');
    gyobuSync();
  };
  window.gyobuSync = gyobuSync;
  window.gyobuPrint = gyobuPrint;

  // ── 스타일 (모듈 스코프) ──
  function styleBlock() {
    return '<style>'
      + '#gyobu-screen{position:fixed;inset:0;z-index:9000;background:#f2f3f5;display:flex;flex-direction:column;font-family:"Malgun Gothic","맑은 고딕",-apple-system,sans-serif;}'
      + '#gyobu-screen .gb-topbar{display:flex;align-items:center;gap:10px;padding:12px 14px;background:#fff;border-bottom:1px solid #e8e8e8;flex:0 0 auto;}'
      + '#gyobu-screen .gb-back{border:none;background:transparent;color:#1a1a1a;padding:4px;cursor:pointer;display:flex;}'
      + '#gyobu-screen .gb-title{font-size:17px;font-weight:700;color:#1a1a1a;flex:1;}'
      + '#gyobu-screen .gb-print{border:none;background:#1a2740;color:#fff;font-size:14px;font-weight:600;padding:8px 14px;border-radius:9px;cursor:pointer;}'
      + '#gyobu-screen .gb-panel{background:#fff;padding:12px 14px;border-bottom:1px solid #e8e8e8;display:flex;flex-direction:column;gap:10px;flex:0 0 auto;}'
      + '#gyobu-screen .gb-field{display:flex;align-items:center;gap:12px;}'
      + '#gyobu-screen .gb-field>label{width:52px;font-size:13px;color:#666;font-weight:600;flex:0 0 auto;}'
      + '#gyobu-screen .gb-seg{display:flex;border:1px solid #e0e0e0;border-radius:9px;overflow:hidden;}'
      + '#gyobu-screen .gb-seg button{border:none;background:#fff;color:#555;font-size:13px;padding:8px 12px;cursor:pointer;border-right:1px solid #eee;}'
      + '#gyobu-screen .gb-seg button:last-child{border-right:none;}'
      + '#gyobu-screen .gb-seg button.on{background:#1a2740;color:#fff;font-weight:600;}'
      + '#gyobu-screen #gb-lawyer{font-size:14px;padding:7px 10px;border:1px solid #e0e0e0;border-radius:8px;background:#fff;}'
      + '#gyobu-screen .gb-paper-scroll{flex:1;overflow:auto;padding:18px 12px 40px;}'
      // 서면 (법률 문서 폰트)
      + '#gyobu-screen .gb-paper{width:600px;max-width:100%;margin:0 auto;background:#fff;padding:34px 30px;'
      +   'box-shadow:0 2px 14px rgba(0,0,0,.08);font-family:"함초롬바탕","HCR Batang","Batang","바탕",serif;color:#000;}'
      + '#gyobu-screen .gb-doc{width:100%;border-collapse:collapse;table-layout:fixed;border:2px solid #000;}'
      + '#gyobu-screen .gb-doc .c1{width:24%;}#gyobu-screen .gb-doc .c2{width:36%;}'
      + '#gyobu-screen .gb-doc .c3{width:20%;}#gyobu-screen .gb-doc .c4{width:20%;}'
      + '#gyobu-screen .gb-doc td,#gyobu-screen .gb-doc th{border:1px solid #000;padding:7px 8px;font-size:15px;font-weight:400;vertical-align:middle;line-height:1.7;color:#000;}'
      + '#gyobu-screen .gb-title-cell{text-align:center;font-size:22px;letter-spacing:3px;padding:16px 0;font-weight:400;}'
      + '#gyobu-screen .gb-lbl{text-align:center;background:#fff;white-space:nowrap;font-weight:400;}'
      + '#gyobu-screen .gb-val input,#gyobu-screen .gb-reqc3 span,#gyobu-screen .gb-courtcell input{color:#000;}'
      + '#gyobu-screen .gb-val input{width:100%;border:none;font:inherit;background:transparent;padding:0;outline:none;color:#000;}'
      + '#gyobu-screen .gb-stampcell{text-align:center;font-size:13px;line-height:1.5;vertical-align:top;padding-top:12px;}'
      + '#gyobu-screen .gb-inji{margin-bottom:26px;}'
      + '#gyobu-screen .gb-attach{}'
      + '#gyobu-screen .gb-bodycell{padding:20px 18px 26px;height:150px;vertical-align:top;}'
      + '#gyobu-screen .gb-body{font-size:15px;line-height:2.1;margin:0;}'
      + '#gyobu-screen .gb-body .u{font-weight:400;}'
      + '#gyobu-screen .gb-date-in{border:none;border-bottom:1px solid #999;font:inherit;text-align:center;width:105px;background:transparent;outline:none;color:#000;}'
      + '#gyobu-screen .gb-filedate{text-align:center;font-size:15px;margin-top:34px;letter-spacing:1px;}'
      + '#gyobu-screen .gb-reqc2{padding-left:14px;}'
      + '#gyobu-screen .gb-reqc3{}'
      + '#gyobu-screen .gb-reqc3 span{color:#000;}'
      + '#gyobu-screen .gb-val #gb-reason{width:100%;}'
      + '#gyobu-screen .gb-courtcell{text-align:center;font-size:17px;padding:14px 0;}'
      + '#gyobu-screen .gb-courtcell input{border:none;border-bottom:1px solid #999;font:inherit;text-align:center;width:150px;background:transparent;outline:none;color:#000;}'
      + '#gyobu-screen .gb-recvcell{text-align:right;font-size:15px;padding:12px 16px;position:relative;}'
      + '#gyobu-screen .gb-seal{display:inline-block;position:relative;width:40px;height:40px;vertical-align:middle;margin-left:2px;}'
      + '#gyobu-screen .gb-seal-img{position:absolute;left:0;top:-7px;width:40px;height:40px;object-fit:contain;}'
      + '#gyobu-screen .gb-seal-txt{color:#c0392b;}'
      + '#gyobu-screen .gb-capture-text{font:inherit;color:#000;}'
      + '@media (max-width:640px){#gyobu-screen .gb-paper{width:100%;padding:20px 14px;}#gyobu-screen .gb-doc td,#gyobu-screen .gb-doc th{font-size:13px;padding:5px 5px;}#gyobu-screen .gb-title-cell{font-size:18px;}}'
      + '</style>';
  }
})();
