/* ═══════════════════════════════════════════════════════════════
   home.js — 홈 메뉴 데이터 기반 렌더링 (C 리팩터링 1단계)

   [개념]
   - 메뉴 항목을 MENU 한 곳에 정의(창고)하고,
     PC 그리드 / 폰 리스트 / 전체 기능 화면이 각자 순서를 참조해 그린다.
   - 새 서면 추가 = MENU에 한 줄 + 아래 순서 배열에 id 하나.
   - 겉모습은 기존(v97)과 100% 동일하게 재현하는 것이 목표.

   [범위] 메인 카드 영역만 (사이드바 sb-nav 는 이번 대상 아님, HTML 그대로 유지)
   ═══════════════════════════════════════════════════════════════ */

/* ── 아이콘 SVG 조각 (기존 홈에서 쓰던 것 그대로) ── */
var HOME_ICON = {
  file:    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/>',
  printer: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  copy:    '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  doc:     '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/>',
  list:    '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  check:   '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  users:   '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>',
  grid:    '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>'
};
function homeIcon(key, sw) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || '1.8') + '">' + HOME_ICON[key] + '</svg>';
}

/* ── ① 창고: 메뉴 항목 기본 정의 (이름·설명·아이콘·동작) ── */
var MENU = {
  seonim:        { name: '선임계 작성',   desc: '변호인 선임신고서',       icon: 'file',    action: 'openSeonimType()' },
  dojang:        { name: '형사서면 출력', desc: '증거·참고자료 서면 출력', icon: 'printer', action: 'openDojang()' },
  yeollam:       { name: '열람·복사',     desc: '재판기록 열람·복사 신청서', icon: 'copy',  action: 'goYeollam()' },
  gukseon:       { name: '국선보수증액',   desc: '국선변호보수증액등신청서', icon: 'file',   action: 'goGukseon()' },
  pankyul:       { name: '판결등본교부',   desc: '판결등본교부청구',       icon: 'check',   action: 'goPankyul()' },
  contractWrite: { name: '계약서 작성',   desc: '송무위임계약서',         icon: 'doc',     action: 'openTypeSheet()' },
  contractList:  { name: '계약서 목록',   desc: '저장된 계약서 관리',     icon: 'list',    action: 'openContractList()' },
  appeal:        { name: '항소장',        desc: '항소이유서',             icon: 'check',   action: 'goAppeal()' },
  agreement:     { name: '합의서 작성',   desc: '',                       icon: 'users',   soon: true }
};

/* ── ② 화면별 진열 순서 (+ 화면마다 다른 크기/글자는 여기서 지정) ──
   name·desc 를 적어주면 그 화면에서만 기본값을 덮어씀 (미세한 표기 차이 재현용) */

/* PC 홈: 4열 벤토 그리드 (지금 우선순위 그대로) */
var PC_ORDER = [
  { id: 'seonim',        size: 'hero' },
  { id: 'dojang',        size: 'wide' },
  { id: 'yeollam',       size: 'wide' },
  { id: 'gukseon',       size: 'small' },
  { id: 'pankyul',       size: 'small' },
  { id: 'contractWrite', size: 'small' },
  { id: 'contractList',  size: 'small' },
  { id: 'appeal',        size: 'small' },
  { id: 'agreement',     size: 'small' }
];

/* 폰 홈: 계약서 종류 풀스크린 스와이프 카드 (민사–형사–가사, 형사가 가운데서 시작) */
var CONTRACT_CARDS = [
  { type: '민사', img: './civil.jpg',    sub: '민사사건 송무위임계약서' },
  { type: '형사', img: './criminal.jpg', sub: '형사사건 송무위임계약서' },
  { type: '가사', img: './family.jpg',   sub: '가사사건 송무위임계약서' }
];

/* 전체 기능 화면: 폰 홈에 안 올린 나머지 (표기가 조금 다른 것은 name/desc 덮어씀) */
var MORE_ORDER = [
  { id: 'seonim' },
  { id: 'appeal',  name: '항소장 작성' },
  { id: 'yeollam', name: '열람·복사 신청서', desc: '재판기록 열람·복사' },
  { id: 'gukseon', name: '국선보수증액 신청서', desc: '국선변호보수증액등' },
  { id: 'pankyul', name: '판결등본교부청구', desc: '판결등본 교부 청구' },
  { id: 'dojang' }
];

/* ── 공통: 항목의 최종 이름/설명 계산 (덮어쓰기 반영) ── */
function homeName(item, m) { return item.name !== undefined ? item.name : m.name; }
function homeDesc(item, m) { return item.desc !== undefined ? item.desc : m.desc; }

/* ── ③-A PC 그리드 렌더 ── */
function renderPcGrid() {
  var box = document.getElementById('doc-grid');
  if (!box) return;
  var html = '';
  for (var i = 0; i < PC_ORDER.length; i++) {
    var item = PC_ORDER[i], m = MENU[item.id];
    var name = homeName(item, m), desc = homeDesc(item, m);
    var click = m.soon ? '' : ' onclick="' + m.action + '"';
    if (item.size === 'hero') {
      html +=
        '<div class="doc-card dc-hero"' + click + '>' +
          '<div class="dc-watermark">' + homeIcon(m.icon, '1.5') + '</div>' +
          '<div class="dc-main-tag">MAIN</div>' +
          '<div class="dc-name">' + name + '</div>' +
          '<div class="dc-desc">' + desc + '</div>' +
          '<div class="dc-cta">시작하기 →</div>' +
        '</div>';
    } else if (item.size === 'wide') {
      html +=
        '<div class="doc-card dc-wide dc-accent"' + click + '>' +
          '<div class="dc-ico">' + homeIcon(m.icon) + '</div>' +
          '<div class="dc-body"><div class="dc-name">' + name + '</div><div class="dc-desc">' + desc + '</div></div>' +
        '</div>';
    } else {
      var dis = m.soon ? ' disabled' : '';
      var badge = m.soon ? '<div class="dc-badge">준비중</div>' : '';
      html +=
        '<div class="doc-card dc-small' + dis + '"' + click + '>' +
          badge +
          '<div class="dc-ico">' + homeIcon(m.icon) + '</div>' +
          '<div class="dc-name">' + name + '</div>' +
        '</div>';
    }
  }
  box.innerHTML = html;
}

/* ── ③-B 폰 스와이프 카드 렌더 (계약서 종류 선택) ── */
function renderContractSwipe() {
  var box = document.getElementById('sw-swipe');
  if (!box) return;
  var chevron = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9,6 15,12 9,18"/></svg>';
  var html = '';
  for (var i = 0; i < CONTRACT_CARDS.length; i++) {
    var c = CONTRACT_CARDS[i];
    html +=
      '<div class="sw-card" style="background-image:url(\'' + c.img + '\')" onclick="goContract(\'' + c.type + '\')">' +
        '<div class="sw-card-inner">' +
          '<div class="sw-pill">#' + c.type + ' ' + chevron + '</div>' +
          '<div><div class="sw-ctitle">' + c.type + '<br>계약서</div><div class="sw-csub">' + c.sub + '</div></div>' +
        '</div>' +
      '</div>';
  }
  box.innerHTML = html;
  // 형사(가운데 카드)가 처음 보이도록 초기 스크롤
  var mid = box.children[1];
  if (mid) { box.scrollLeft = mid.offsetLeft - (box.clientWidth - mid.offsetWidth) / 2; }
}

/* ── 폰 홈 테마(화이트/블랙) — 선택을 기억 ── */
function paintHomeKnob() {
  var knob = document.getElementById('sw-knob');
  if (!knob) return;
  var m = document.querySelector('.hm-mobile');
  var dark = m && m.getAttribute('data-theme') === 'dark';
  var SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 3v1.5M12 19.5V21M5.2 5.2l1 1M17.8 17.8l1 1M3 12h1.5M19.5 12H21M5.2 18.8l1-1M17.8 6.2l1-1"/>';
  var MOON = '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>';
  knob.innerHTML = '<svg viewBox="0 0 24 24" stroke-width="1.8">' + (dark ? SUN : MOON) + '</svg>';
}
function initHomeTheme() {
  var m = document.querySelector('.hm-mobile');
  if (!m) return;
  var saved = 'light';
  try { saved = localStorage.getItem('homeTheme') || 'light'; } catch (e) {}
  m.setAttribute('data-theme', saved);
  paintHomeKnob();
}
window.toggleHomeTheme = function () {
  var m = document.querySelector('.hm-mobile');
  if (!m) return;
  var dark = m.getAttribute('data-theme') !== 'dark';
  m.setAttribute('data-theme', dark ? 'dark' : 'light');
  try { localStorage.setItem('homeTheme', dark ? 'dark' : 'light'); } catch (e) {}
  paintHomeKnob();
};

/* ── 합의서(준비중) 안내 토스트 ── */
var _homeToastTimer;
window.homeDevToast = function () {
  var t = document.getElementById('sw-toast');
  if (!t) return;
  t.classList.add('show');
  clearTimeout(_homeToastTimer);
  _homeToastTimer = setTimeout(function () { t.classList.remove('show'); }, 1600);
};

/* ── ③-C 전체 기능 화면 렌더 ── */
function renderMoreScreen() {
  var box = document.getElementById('more-list');
  if (!box) return;
  var html = '';
  for (var i = 0; i < MORE_ORDER.length; i++) {
    var item = MORE_ORDER[i], m = MENU[item.id];
    var name = homeName(item, m), desc = homeDesc(item, m);
    html +=
      '<div class="more-item" onclick="' + m.action + '">' +
        '<div class="more-ico">' + homeIcon(m.icon) + '</div>' +
        '<div class="more-body-txt"><div class="more-name">' + name + '</div><div class="more-desc">' + desc + '</div></div>' +
        '<div class="more-arrow">›</div>' +
      '</div>';
  }
  box.innerHTML = html;
}

/* ── 실행: 홈 컨테이너가 있으면 그려 넣는다 ── */
function renderHome() {
  renderPcGrid();
  renderContractSwipe();
  renderMoreScreen();
  initHomeTheme();
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderHome);
  } else {
    renderHome();
  }
}

/* node 검증용 (브라우저에선 무시됨) */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MENU: MENU, PC_ORDER: PC_ORDER, CONTRACT_CARDS: CONTRACT_CARDS, MORE_ORDER: MORE_ORDER, renderHome: renderHome, renderContractSwipe: renderContractSwipe };
}
