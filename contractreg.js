/* 법무법인 정서 — 계약 대장(Contract Register) 콘솔 (contractreg.js)
   ───────────────────────────────────────────────────────────────
   PC(≥768px) 전용. 저장된 계약서를 '대장형 데이터 테이블'로 관리한다.
   · 데이터 출처: window.listCache (index.html 이 Supabase 'contracts'에서 로드)
       각 레코드.form_data 에 scope(업무범위)·fee/success(계약조건)가 들어 있음
   · 표 컬럼: 의뢰인(+서명상태) · 사건 · 업무범위 · 계약조건(착수금+성공배지) · 작성일
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

  var _q = '', _type = '', _sort = 'new', _built = false;

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
  function statusChip(it) { var s = statusOf(it); return '<span class="creg-st creg-st-' + s.k + '"><span class="creg-st-dot"></span>' + s.t + '</span>'; }

  /* 필터·정렬 적용된 목록 */
  function view() {
    var items = records();
    if (_type) items = items.filter(function (it) { return (it.doc_type || '형사') === _type; });
    if (_q) {
      var q = _q.toLowerCase();
      items = items.filter(function (it) {
        return ((it.client_name || '') + (it.case_num || '') + (it.case_name || '')).toLowerCase().indexOf(q) > -1;
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
            '<input id="creg-search" type="text" placeholder="의뢰인·사건번호·사건명 검색" oninput="ContractReg.search(this.value)" autocomplete="off"></div>' +
          '<div class="creg-types" id="creg-types">' +
            '<button class="creg-tchip on" data-t="" onclick="ContractReg.type(\'\')">전체</button>' +
            '<button class="creg-tchip" data-t="형사" onclick="ContractReg.type(\'형사\')">형사</button>' +
            '<button class="creg-tchip" data-t="민사" onclick="ContractReg.type(\'민사\')">민사</button>' +
            '<button class="creg-tchip" data-t="가사" onclick="ContractReg.type(\'가사\')">가사</button>' +
          '</div>' +
          '<select class="creg-sort" id="creg-sort" onchange="ContractReg.sort(this.value)">' +
            '<option value="new">최신순</option><option value="name">의뢰인순</option><option value="fee">착수금순</option>' +
          '</select>' +
        '</div>' +
        '<div class="creg-tablewrap">' +
          '<table class="creg-table">' +
            '<thead><tr><th style="width:20%">의뢰인</th><th style="width:24%">사건</th><th style="width:24%">업무범위</th><th style="width:20%">계약조건</th><th style="width:12%">작성일</th></tr></thead>' +
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
      if (!has) empty.textContent = (_q || _type) ? '조건에 맞는 계약이 없습니다.' : '저장된 계약서가 없습니다. 계약서를 작성·저장하면 여기 표시됩니다.';
    }
  }

  function render() {
    if (!ensureUI()) return;
    // 컨트롤 상태 반영
    var s = $('creg-search'); if (s && s.value !== _q) s.value = _q;
    renderKPI();
    renderRows();
  }

  /* ── 요약 드로어 ── */
  function findRec(id) { var l = records(); for (var i = 0; i < l.length; i++) { if (l[i].id === id) return l[i]; } return null; }
  function drawerRow(label, val) { return '<div class="creg-drow"><div class="creg-dlabel">' + label + '</div><div class="creg-dval">' + (val || '<span class="creg-dash">—</span>') + '</div></div>'; }

  window.ContractReg = {
    render: render,
    search: function (v) { _q = (v || '').trim(); renderRows(); },
    type: function (t) {
      _type = t || '';
      var box = $('creg-types');
      if (box) box.querySelectorAll('.creg-tchip').forEach(function (b) { b.classList.toggle('on', (b.getAttribute('data-t') || '') === _type); });
      renderRows();
    },
    sort: function (s) { _sort = s || 'new'; renderRows(); },
    open: function (id) {
      var it = findRec(id); if (!it) return;
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
