/* 법무법인 정서 — 국선 사건 관리 (casemgr.js)
   목적: 사이드바 "사건 관리" 클릭 시, 국선 사건관리 앱(gukseon-manager.html)을
         전체화면 오버레이 + iframe 으로 띄운다.
   구조: gukseon.js 와 동일한 방식의 독립 모듈(기존 화면/폼 구조 안 건드림).
   인증: gukseon-manager.html 은 정서와 같은 오리진(same-origin)에서 로드되고,
         같은 Supabase 프로젝트를 storageKey 'js_auth' 로 공유하므로,
         정서에 로그인돼 있으면 iframe 안에서도 자동으로 로그인 상태가 된다.
   진입점: window.goCaseManager() / window.closeCaseMgr()
*/
(function () {
  'use strict';

  var SHELL_ID = 'caseMgrScreen';
  var FRAME_ID = 'caseMgrFrame';
  var STYLE_ID = 'caseMgr-style';
  var SRC = './gukseon-manager.html';

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css =
      '#' + SHELL_ID + '{display:none;position:fixed;inset:0;z-index:1100;' +
        'background:#F0EEE6;flex-direction:column;}' +
      '#' + SHELL_ID + '.active{display:flex;}' +
      '#' + SHELL_ID + ' .cm-bar{flex:none;display:flex;align-items:center;gap:10px;' +
        'height:52px;padding:0 12px;background:#fff;border-bottom:1px solid #e8e8e8;}' +
      '#' + SHELL_ID + ' .cm-back{display:inline-flex;align-items:center;gap:6px;' +
        'border:none;background:transparent;cursor:pointer;font:inherit;font-size:15px;' +
        'font-weight:600;color:#1a1a1a;padding:8px 10px;border-radius:9px;}' +
      '#' + SHELL_ID + ' .cm-back:hover{background:#f4f2ee;}' +
      '#' + SHELL_ID + ' .cm-back svg{width:18px;height:18px;}' +
      '#' + SHELL_ID + ' .cm-title{font-size:15px;font-weight:700;color:#1a1a1a;letter-spacing:-0.2px;}' +
      '#' + SHELL_ID + ' .cm-frame{flex:1;border:none;width:100%;height:100%;background:#F0EEE6;}';
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = css;
    document.head.appendChild(s);
  }

  function injectShell() {
    if (document.getElementById(SHELL_ID)) return;
    var wrap = document.createElement('div');
    wrap.id = SHELL_ID;
    wrap.innerHTML =
      '<div class="cm-bar">' +
        '<button class="cm-back" onclick="closeCaseMgr()" aria-label="닫기">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
            'stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>' +
          '홈' +
        '</button>' +
        '<span class="cm-title">사건 관리</span>' +
      '</div>';
    var frame = document.createElement('iframe');
    frame.id = FRAME_ID;
    frame.className = 'cm-frame';
    frame.title = '국선 사건 관리';
    // 마이크/카메라 등은 필요 없음. 같은 오리진이라 세션 공유 목적상 sandbox 는 걸지 않는다.
    wrap.appendChild(frame);
    document.body.appendChild(wrap);
  }

  function ensureUI() {
    injectStyle();
    injectShell();
  }

  // 기존 iframe(React) 국선 관리 앱 열기 — 네이티브 화면(gsmgr.js)에서 편집용으로 호출.
  // 네이티브 전환 완료 전까지 추가/편집은 이 기존 앱에서 계속 가능.
  window.openCaseMgrLegacy = function () {
    ensureUI();
    var frame = document.getElementById(FRAME_ID);
    // 최초 진입 시에만 로드(이후에는 상태 유지)
    if (frame && !frame.getAttribute('src')) {
      frame.setAttribute('src', SRC);
    }
    document.getElementById(SHELL_ID).classList.add('active');
    document.body.style.overflow = 'hidden';
  };
  // gsmgr.js 가 없을 때(초기)만 대비한 폴백: 네이티브가 로드되면 gsmgr.js 가 goCaseManager 를 덮어씀.
  if (!window.goCaseManager) window.goCaseManager = window.openCaseMgrLegacy;

  window.closeCaseMgr = function () {
    var el = document.getElementById(SHELL_ID);
    if (el) el.classList.remove('active');
    document.body.style.overflow = '';
  };
})();
