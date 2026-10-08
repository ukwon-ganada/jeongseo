/* 법무법인 정서 — 계약 대장(Contract Register) 콘솔 (contractreg.js)
   ───────────────────────────────────────────────────────────────
   PC(≥768px) 전용. 저장된 계약서를 '대장형 데이터 테이블'로 관리한다.
   · 데이터 출처: window.listCache (index.html 이 Supabase 'contracts'에서 로드)
       각 레코드.form_data 에 scope(업무범위)·fee/success(계약조건)가 들어 있음
   · 표 컬럼: 의뢰인(+서명상태) · 사건 · 업무범위 · 계약조건(착수금+성공배지) · 담당자 · 작성일
   · 담당자: form_data.managers(이름 배열)에 저장 → DB 구조 변경 없이 모든 PC에 공유.
       명단 = 기본 5명 + 계약에 이미 지정된 이름(누군가 추가한 담당자도 자동 포함)
   · 상단 KPI(총 계약·서명완료/대기·이번 달 신규), 유형 필터, 정렬
   · 행 클릭 → 우측 요약 드로어(업무범위·계약조건·서명이력) + '계약서 열기'
   · 전역 연동: openContractDetail(id) / deleteContract(id) / loadContractList() / goHome()
   진입: renderContractList() 안에서 window.ContractReg.render() 호출(모바일 뷰와 병행)
   모바일 카드 뷰는 전혀 건드리지 않는다(CSS 미디어쿼리로 PC에서만 노출).
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function num(v) { return parseInt(String(v == null ? '' : v).replace(/[^0-9]/g, ''), 10) || 0; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtDate(iso) { var d = new Date(iso); if (isNaN(d)) return '—'; return d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate()); }
  function fmtDateTime(iso) { var d = new Date(iso); if (isNaN(d)) return '기록 없음'; return d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  var _q = '', _type = '', _sort = 'new', _mgr = '', _built = false;
  var DEFAULT_MANAGERS = ['서고은', '김희진', '김미영', '송영범', '임정빈'];
  var _extraManagers = []; // 이번 세션에서 새로 추가했지만 아직 어느 계약에도 지정 안 된 이름

  /* 담당자 UI 스타일 — JS와 함께 배포되도록 주입(예전 styles.css 캐시가 남아도 깨지지 않음) */
  var MGR_STYLE_ID = 'creg-mgr-style';
  var MGR_CSS = [
    '.creg-mgrsel{margin-left:auto;min-width:118px;}',
    '.creg-mgrsel + .creg-sort{margin-left:8px;}',
    /* 표 셀 태그 */
    '.creg-mgrs{display:flex;flex-wrap:wrap;gap:4px;}',
    '.creg-mgr{font-size:11.5px;font-weight:600;padding:2px 8px;border-radius:999px;background:#eef3fe;color:#2f5fb0;white-space:nowrap;}',
    /* 드로어 편집 카드 */
    '.creg-mgrbox{border:1px solid var(--border,#e7e9ee);border-radius:12px;background:var(--gray-50,#fafbfc);padding:12px;}',
    '.creg-mgrpick{display:flex;flex-wrap:wrap;gap:6px;}',
    '.creg-mgrchip{display:inline-flex;align-items:center;gap:0;height:32px;padding:0 12px;border-radius:999px;border:1px solid var(--border,#e7e9ee);background:#fff;color:var(--gray-700,#555);font-size:13px;font-weight:600;font-family:var(--font);cursor:pointer;transition:background .14s,border-color .14s,color .14s;-webkit-appearance:none;appearance:none;line-height:1;}',
    '.creg-mgrchip:hover{border-color:#c9d5f3;background:#f7f9ff;}',
    '.creg-mgrchip .creg-mgrhash{color:var(--gray-400,#9096a1);font-weight:500;margin-right:1px;}',
    '.creg-mgrchip svg{width:13px;height:13px;display:none;margin-right:5px;}',
    '.creg-mgrchip.on{background:#eef3fe;border-color:#9fb6ec;color:#2f5fb0;}',
    '.creg-mgrchip.on .creg-mgrhash{color:#7d9be0;}',
    '.creg-mgrchip.on svg{display:block;}',
    '.creg-mgrchip:disabled{opacity:.55;cursor:default;}',
    '.creg-mgradd{display:flex;gap:6px;margin-top:10px;padding-top:10px;border-top:1px dashed var(--border,#e7e9ee);}',
    '.creg-mgrin{position:relative;flex:1;min-width:0;}',
    '.creg-mgrin svg{position:absolute;left:11px;top:50%;width:14px;height:14px;transform:translateY(-50%);color:var(--gray-400,#9096a1);pointer-events:none;}',
    '.creg-mgrin input{width:100%;height:36px;border:1px solid var(--border,#e7e9ee);border-radius:10px;padding:0 12px 0 32px;font-size:13.5px;font-family:var(--font);background:#fff;outline:none;transition:border-color .14s;box-sizing:border-box;}',
    '.creg-mgrin input:focus{border-color:var(--hero,#3a6df0);}',
    '.creg-mgrbtn{flex:none;height:36px;padding:0 14px;border:0;border-radius:10px;background:var(--black,#15181d);color:#fff;font-size:13px;font-weight:600;font-family:var(--font);cursor:pointer;-webkit-appearance:none;appearance:none;}',
    '.creg-mgrbtn:hover{opacity:.88;}',
    /* 모바일 계약 목록 카드의 담당자 태그 */
    '.lc-mgrs{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;}',
    '.lc-mgr{font-size:12px;font-weight:600;line-height:1;padding:4px 8px;border-radius:999px;background:#eef3fe;color:#2f5fb0;white-space:nowrap;}'
  ].join('');
  function injectStyle() {
    if (document.getElementById(MGR_STYLE_ID)) return;
    var st = document.createElement('style'); st.id = MGR_STYLE_ID; st.textContent = MGR_CSS;
    document.head.appendChild(st);
  }

  function records() { return (window.listCache || []).slice(); }

  /* form_data.scope → 사람이 읽는 항목 배열 */
  function scopeItems(fd) {
    if (!fd || !fd.scope) return [];
    var s = fd.scope, t = fd.docType || '형사', o = [];
    if (t === '형사') {
      if (s.police) o.push('수사(경찰)');
      if (s.prosecution) o.push('수사(검찰)');
      if (s.warrant) o.push('영장심사');
      if (s.trial) o.push('재판' + (s.trialNum ? s.trialNum + '심' : ''));
      if (s.other) o.push(s.otherTxt || '기타');
    } else if (t === '민사') {
      if (s.trial) o.push((s.trialNum ? s.trialNum : '') + '심 본소');
      if (s.mediation) o.push('조정');
      if (s.preserve) o.push('보전처분');
      if (s.other) o.push(s.otherTxt || '기타');
    } else if (t === '가사') {
      if (s.trial) o.push((s.trialNum ? s.trialNum : '') + '심 본소');
      if (s.mediation) o.push('조정');
      if (s.presolve) o.push('사전처분');
      if (s.preserve) o.push('보전처분');
      if (s.other) o.push(s.otherTxt || '기타');
    }
    return o;
  }
  /* 착수금(만원) 숫자 */
  function retainer(fd) { return (fd && fd.fee) ? num(fd.fee.fee1) : 0; }
  /* 계약조건 셀 HTML — 착수금 중심 + 성공보수/2차보수 배지 */
  function feeCell(fd) {
    if (!fd || !fd.fee) return '<span class="creg-dash">—</span>';
    var r = retainer(fd);
    var main = r ? ('<span class="creg-fee-main">착수금 ' + r.toLocaleString() + '<span class="creg-fee-unit">만원</span></span>') : '<span class="creg-dash">착수금 미정</span>';
    var badge = '';
    if (fd.success) badge = '<span class="creg-fee-badge">성공 ' + esc(String(fd.success)) + '</span>';
    else if (fd.fee.fee2 && num(fd.fee.fee2)) badge = '<span class="creg-fee-badge alt">2차 ' + num(fd.fee.fee2).toLocaleString() + '만</span>';
    return main + badge;
  }
  function docBadge(t) {
    t = t || '형사';
    var cls = t === '민사' ? 'civil' : (t === '가사' ? 'family' : 'crim');
    return '<span class="creg-doc creg-doc-' + cls + '">' + esc(t) + '</span>';
  }
  function statusOf(it) {
    if (it.sign_status === 'signed') return { k: 'signed', t: '서명완료' };
    if (it.sign_status === 'requested') return { k: 'wait', t: '서명대기' };
    if (it.sent_at) return { k: 'sent', t: '발송' };
    return { k: 'draft', t: '작성' };
  }
  /* ── 담당자 ── */
  function managersOf(it) {
    var m = it && it.form_data && it.form_data.managers;
    return Array.isArray(m) ? m.filter(Boolean) : [];
  }
  function allManagers() {
    var seen = {}, out = [];
    function add(n) { n = String(n || '').trim(); if (n && !seen[n]) { seen[n] = 1; out.push(n); } }
    DEFAULT_MANAGERS.forEach(add);
    records().forEach(function (it) { managersOf(it).forEach(add); });
    _extraManagers.forEach(add);
    return out;
  }
  function mgrTags(list) {
    return list.length
      ? '<div class="creg-mgrs">' + list.map(function (n) { return '<span class="creg-mgr">#' + esc(n) + '</span>'; }).join('') + '</div>'
      : '<span class="creg-dash">미지정</span>';
  }
  /* 담당자 필터 드롭다운 옵션 갱신(새 이름이 생기면 반영) */
  function renderMgrFilter() {
    var sel = $('creg-mgrsel'); if (!sel) return;
    var names = allManagers();
    if (_mgr && _mgr !== '__none' && names.indexOf(_mgr) < 0) _mgr = '';
    sel.innerHTML = '<option value="">전체 담당자</option><option value="__none">미지정</option>' +
      names.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('');
    sel.value = _mgr;
  }

  function statusChip(it) { var s = statusOf(it); return '<span class="creg-st creg-st-' + s.k + '"><span class="creg-st-dot"></span>' + s.t + '</span>'; }

  /* 필터·정렬 적용된 목록 */
  function view() {
    var items = records();
    if (_type) items = items.filter(function (it) { return (it.doc_type || '형사') === _type; });
    if (_mgr === '__none') items = items.filter(function (it) { return managersOf(it).length === 0; });
    else if (_mgr) items = items.filter(function (it) { return managersOf(it).indexOf(_mgr) > -1; });
    if (_q) {
      var q = _q.toLowerCase();
      items = items.filter(function (it) {
        return ((it.client_name || '') + (it.case_num || '') + (it.case_name || '') + managersOf(it).join(' ')).toLowerCase().indexOf(q) > -1;
      });
    }
    if (_sort === 'name') items.sort(function (a, b) { return (a.client_name || '').localeCompare(b.client_name || '', 'ko'); });
    else if (_sort === 'fee') items.sort(function (a, b) { return retainer(b.form_data) - retainer(a.form_data); });
    else items.sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    return items;
  }

  /* ── 셸(1회 주입) ── */
  function ensureUI() {
    var host = $('listPC'); if (!host) return false;
    injectStyle();
    if (_built && $('creg-tbody')) return true;
    host.innerHTML =
      '<div class="creg">' +
        '<div class="creg-head">' +
          '<button class="creg-back" onclick="goHome()" aria-label="홈"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1"><polyline points="15 18 9 12 15 6"/></svg></button>' +
          '<div class="creg-title">계약 대장</div>' +
          '<button class="creg-refresh" onclick="loadContractList()" aria-label="새로고침"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg></button>' +
        '</div>' +
        '<div class="creg-kpi" id="creg-kpi"></div>' +
        '<div class="creg-toolbar">' +
          '<div class="creg-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
            '<input id="creg-search" type="text" placeholder="의뢰인·사건번호·사건명·담당자 검색" oninput="ContractReg.search(this.value)" autocomplete="off"></div>' +
          '<div class="creg-types" id="creg-types">' +
            '<button class="creg-tchip on" data-t="" onclick="ContractReg.type(\'\')">전체</button>' +
            '<button class="creg-tchip" data-t="형사" onclick="ContractReg.type(\'형사\')">형사</button>' +
            '<button class="creg-tchip" data-t="민사" onclick="ContractReg.type(\'민사\')">민사</button>' +
            '<button class="creg-tchip" data-t="가사" onclick="ContractReg.type(\'가사\')">가사</button>' +
          '</div>' +
          '<select class="creg-sort creg-mgrsel" id="creg-mgrsel" onchange="ContractReg.mgr(this.value)" aria-label="담당자 필터"></select>' +
          '<select class="creg-sort" id="creg-sort" onchange="ContractReg.sort(this.value)">' +
            '<option value="new">최신순</option><option value="name">의뢰인순</option><option value="fee">착수금순</option>' +
          '</select>' +
        '</div>' +
        '<div class="creg-tablewrap">' +
          '<table class="creg-table">' +
            '<thead><tr><th style="width:17%">의뢰인</th><th style="width:21%">사건</th><th style="width:20%">업무범위</th><th style="width:17%">계약조건</th><th style="width:15%">담당자</th><th style="width:10%">작성일</th></tr></thead>' +
            '<tbody id="creg-tbody"></tbody>' +
          '</table>' +
          '<div class="creg-empty" id="creg-empty" style="display:none;"></div>' +
        '</div>' +
        '<div class="creg-scrim" id="creg-scrim" onclick="ContractReg.closeDrawer()"></div>' +
        '<div class="creg-drawer" id="creg-drawer" role="dialog" aria-label="계약 요약"><div class="creg-dwrap" id="creg-drawer-body"></div></div>' +
      '</div>';
    _built = true;
    return true;
  }

  function renderKPI() {
    var el = $('creg-kpi'); if (!el) return;
    var all = records();
    var signed = 0, wait = 0, month = 0;
    var now = new Date(), y = now.getFullYear(), m = now.getMonth();
    all.forEach(function (it) {
      if (it.sign_status === 'signed') signed++;
      else if (it.sign_status === 'requested') wait++;
      var d = new Date(it.created_at);
      if (!isNaN(d) && d.getFullYear() === y && d.getMonth() === m) month++;
    });
    function tile(label, val, sub) {
      return '<div class="creg-tile"><div class="creg-tile-v">' + val + (sub ? '<span class="creg-tile-sub">' + sub + '</span>' : '') + '</div><div class="creg-tile-l">' + label + '</div></div>';
    }
    el.innerHTML =
      tile('총 계약', all.length + '<span class="creg-tile-unit">건</span>', '') +
      tile('서명 완료 / 대기', signed + '<span class="creg-tile-unit"> / ' + wait + '</span>', '') +
      tile('이번 달 신규', month + '<span class="creg-tile-unit">건</span>', '');
  }

  function rowHTML(it) {
    var fd = it.form_data || {};
    var name = it.client_name || '(의뢰인명 미입력)';
    var meta = [it.case_num, it.case_name].filter(Boolean).join(' · ') || '<span class="creg-dash">사건정보 없음</span>';
    var chips = scopeItems(fd);
    var scopeHtml = chips.length
      ? '<div class="creg-scope">' + chips.map(function (c) { return '<span class="creg-schip">' + esc(c) + '</span>'; }).join('') + '</div>'
      : '<span class="creg-dash">—</span>';
    return '<tr onclick="ContractReg.open(\'' + esc(it.id) + '\')">' +
      '<td><div class="creg-name">' + esc(name) + '</div>' + statusChip(it) + '</td>' +
      '<td><div class="creg-case">' + esc(it.case_num || '') + (it.case_name ? ' · ' + esc(it.case_name) : (it.case_num ? '' : '<span class="creg-dash">사건정보 없음</span>')) + '</div>' + docBadge(it.doc_type) + '</td>' +
      '<td>' + scopeHtml + '</td>' +
      '<td><div class="creg-fee">' + feeCell(fd) + '</div></td>' +
      '<td>' + mgrTags(managersOf(it)) + '</td>' +
      '<td class="creg-date">' + fmtDate(it.created_at) + '</td>' +
    '</tr>';
  }

  function renderRows() {
    if (!ensureUI()) return;
    var tb = $('creg-tbody'); if (!tb) return;
    var items = view();
    tb.innerHTML = items.map(rowHTML).join('');
    var empty = $('creg-empty');
    if (empty) {
      var has = items.length > 0;
      empty.style.display = has ? 'none' : 'block';
      if (!has) empty.textContent = (_q || _type || _mgr) ? '조건에 맞는 계약이 없습니다.' : '저장된 계약서가 없습니다. 계약서를 작성·저장하면 여기 표시됩니다.';
    }
  }

  function render() {
    if (!ensureUI()) return;
    // 컨트롤 상태 반영
    var s = $('creg-search'); if (s && s.value !== _q) s.value = _q;
    renderKPI();
    renderMgrFilter();
    renderRows();
    // 드로어가 열려 있으면(목록 새로고침 등) 담당자 영역도 최신으로
    if (_openId && $('creg-drawer') && $('creg-drawer').classList.contains('open')) renderMgrEditor();
  }

  /* ── 드로어 안 담당자 지정 영역 ── */
  var _openId = null, _saving = false;
  function renderMgrEditor() {
    var box = $('creg-mgredit'); if (!box) return;
    var it = findRec(_openId); if (!it) return;
    var mine = managersOf(it);
    var check = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><polyline points="20 6 9 17 4 12"/></svg>';
    box.innerHTML =
      '<div class="creg-mgrbox">' +
        '<div class="creg-mgrpick">' +
          allManagers().map(function (n) {
            var on = mine.indexOf(n) > -1;
            return '<button type="button" class="creg-mgrchip' + (on ? ' on' : '') + '" aria-pressed="' + on + '"' + (_saving ? ' disabled' : '') +
              ' data-n="' + esc(n) + '" onclick="ContractReg.toggleMgr(this.getAttribute(\'data-n\'))">' +
              check + '<span class="creg-mgrhash">#</span>' + esc(n) + '</button>';
          }).join('') +
        '</div>' +
        '<div class="creg-mgradd">' +
          '<div class="creg-mgrin"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' +
            '<input id="creg-mgrinput" type="text" maxlength="20" placeholder="새 담당자 이름" autocomplete="off" onkeydown="if(event.key===\'Enter\'&&!event.isComposing){event.preventDefault();ContractReg.addMgr();}"></div>' +
          '<button type="button" class="creg-mgrbtn" onclick="ContractReg.addMgr()">추가</button>' +
        '</div>' +
      '</div>';
  }
  /* 담당자 목록을 Supabase에 저장 (form_data.managers만 갱신, 나머지 내용은 DB의 최신값 유지) */
  async function saveManagers(id, list) {
    var client = (typeof window.getSB === 'function') ? window.getSB() : null;
    if (!client) throw new Error('연결을 확인해 주세요');
    var r = await client.from('contracts').select('form_data').eq('id', id).limit(1);
    if (r.error) throw r.error;
    if (!r.data || !r.data[0]) throw new Error('계약을 찾을 수 없습니다');
    var fd = r.data[0].form_data || {};
    fd.managers = list;
    var u = await client.from('contracts').update({ form_data: fd }).eq('id', id);
    if (u.error) throw u.error;
    return fd;
  }
  function toast(m) { if (typeof window.showToast === 'function') window.showToast(m); }
  async function setManagers(list) {
    if (_saving) return;
    var it = findRec(_openId); if (!it) return;
    var prev = managersOf(it);
    _saving = true;
    if (!it.form_data) it.form_data = {};
    it.form_data.managers = list; // 화면 먼저 반영
    renderMgrEditor(); renderMgrFilter(); renderRows();
    try {
      var fd = await saveManagers(it.id, list);
      it.form_data = fd;
    } catch (e) {
      it.form_data.managers = prev; // 실패하면 되돌리기
      toast('담당자 저장 실패: ' + ((e && e.message) || '다시 시도해 주세요'));
    }
    _saving = false;
    renderMgrEditor(); renderMgrFilter(); renderRows();
  }

  /* ── 요약 드로어 ── */
  function findRec(id) { var l = records(); for (var i = 0; i < l.length; i++) { if (l[i].id === id) return l[i]; } return null; }
  function drawerRow(label, val) { return '<div class="creg-drow"><div class="creg-dlabel">' + label + '</div><div class="creg-dval">' + (val || '<span class="creg-dash">—</span>') + '</div></div>'; }

  injectStyle(); // 모바일 목록도 담당자 태그를 쓰므로 로드 즉시 주입

  window.ContractReg = {
    render: render,
    /* 모바일 카드용: 담당자 태그 HTML(없으면 빈 문자열) */
    mgrTagsMobile: function (it) {
      var l = managersOf(it);
      return l.length ? '<div class="lc-mgrs">' + l.map(function (n) { return '<span class="lc-mgr">#' + esc(n) + '</span>'; }).join('') + '</div>' : '';
    },
    managersOf: managersOf,
    search: function (v) { _q = (v || '').trim(); renderRows(); },
    type: function (t) {
      _type = t || '';
      var box = $('creg-types');
      if (box) box.querySelectorAll('.creg-tchip').forEach(function (b) { b.classList.toggle('on', (b.getAttribute('data-t') || '') === _type); });
      renderRows();
    },
    sort: function (s) { _sort = s || 'new'; renderRows(); },
    mgr: function (m) { _mgr = m || ''; renderRows(); },
    toggleMgr: function (n) {
      var it = findRec(_openId); if (!it || !n) return;
      var list = managersOf(it).slice(), i = list.indexOf(n);
      if (i > -1) list.splice(i, 1); else list.push(n);
      setManagers(list);
    },
    addMgr: function () {
      var inp = $('creg-mgrinput'); if (!inp) return;
      var n = inp.value.replace(/^#+/, '').replace(/\s+/g, ' ').trim();
      if (!n) { inp.focus(); return; }
      var it = findRec(_openId); if (!it) return;
      if (allManagers().indexOf(n) < 0) _extraManagers.push(n);
      var list = managersOf(it).slice();
      if (list.indexOf(n) < 0) list.push(n);
      inp.value = '';
      setManagers(list);
    },
    open: function (id) {
      var it = findRec(id); if (!it) return;
      _openId = id;
      var fd = it.form_data || {};
      var st = statusOf(it);
      var chips = scopeItems(fd);
      var scopeHtml = chips.length ? '<div class="creg-scope">' + chips.map(function (c) { return '<span class="creg-schip">' + esc(c) + '</span>'; }).join('') + '</div>' : '<span class="creg-dash">지정 안 됨</span>';
      // 계약조건 상세
      var feeRows = '';
      var r = retainer(fd);
      feeRows += drawerRow('착수금', r ? (r.toLocaleString() + ' 만원' + (fd.fee && fd.fee.vat1 ? ' <span class="creg-vat">(VAT ' + esc(fd.fee.vat1) + ')</span>' : '')) : '');
      if (fd.fee && num(fd.fee.fee2)) feeRows += drawerRow('2차 보수', num(fd.fee.fee2).toLocaleString() + ' 만원' + (fd.fee.vat2 ? ' <span class="creg-vat">(VAT ' + esc(fd.fee.vat2) + ')</span>' : ''));
      if (fd.success) feeRows += drawerRow('성공보수', esc(String(fd.success)));
      // 서명 이력 타임라인
      var tl = '';
      function step(on, label, val) { return '<div class="creg-tl' + (on ? ' on' : '') + '"><span class="creg-tl-dot"></span><div><div class="creg-tl-l">' + label + '</div>' + (val ? '<div class="creg-tl-v">' + val + '</div>' : '') + '</div></div>'; }
      tl += step(true, '작성', fmtDateTime(it.created_at));
      tl += step(!!it.sent_at, '발송', it.sent_at ? fmtDateTime(it.sent_at) : '');
      tl += step(!!it.accessed_at, '열람', it.accessed_at ? fmtDateTime(it.accessed_at) : '');
      tl += step(it.sign_status === 'signed', '서명완료', it.signed_at ? fmtDateTime(it.signed_at) : '');

      $('creg-drawer-body').innerHTML =
        '<div class="creg-dhead">' +
          '<div class="creg-dtitle">' + esc(it.client_name || '(의뢰인명 미입력)') + '</div>' +
          '<button class="creg-dclose" onclick="ContractReg.closeDrawer()" aria-label="닫기"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
        '</div>' +
        '<div class="creg-dtags">' + docBadge(it.doc_type) + '<span class="creg-st creg-st-' + st.k + '"><span class="creg-st-dot"></span>' + st.t + '</span></div>' +
        '<div class="creg-dbody">' +
          '<div class="creg-dsec">담당자</div><div id="creg-mgredit"></div>' +
          '<div class="creg-dsec">사건 정보</div>' +
          drawerRow('사건번호', esc(it.case_num || '')) +
          drawerRow('사건명', esc(it.case_name || '')) +
          drawerRow('관할', esc(it.court || '')) +
          '<div class="creg-dsec">업무범위</div>' + scopeHtml +
          '<div class="creg-dsec">계약조건</div>' + feeRows +
          '<div class="creg-dsec">서명 이력</div><div class="creg-tlwrap">' + tl + '</div>' +
          '<div class="creg-dsec">작성일</div>' + drawerRow('작성', fmtDateTime(it.created_at)) +
        '</div>' +
        '<div class="creg-dfoot">' +
          '<button class="creg-del" onclick="ContractReg.del(\'' + esc(it.id) + '\')">삭제</button>' +
          '<span style="margin-left:auto"></span>' +
          '<button class="fs-btn ghost creg-btn" onclick="ContractReg.closeDrawer()">닫기</button>' +
          '<button class="fs-btn primary creg-btn" onclick="ContractReg.openDoc(\'' + esc(it.id) + '\')">계약서 열기</button>' +
        '</div>';
      renderMgrEditor();
      $('creg-scrim').classList.add('show');
      $('creg-drawer').classList.add('open');
    },
    closeDrawer: function () {
      var d = $('creg-drawer'), s = $('creg-scrim');
      if (d) d.classList.remove('open'); if (s) s.classList.remove('show');
    },
    openDoc: function (id) { this.closeDrawer(); if (typeof window.openContractDetail === 'function') window.openContractDetail(id); },
    del: function (id) {
      this.closeDrawer();
      if (typeof window.deleteContract === 'function') window.deleteContract(id);
    }
  };
})();
