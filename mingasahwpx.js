/* 법무법인 정서 PWA - 민·가사 소송위임장 HWPX 생성 (mingasahwpx.js)
   ───────────────────────────────────────────────────────────────
   templates/mingasa_wiimjang.hwpx 의 표(section0.xml)를 상태값으로 재구성한다.
   정부/표준 양식은 텍스트가 여러 <hp:run> 으로 쪼개져 있어 단순 문자열 치환이
   취약하므로, 표를 '행/셀' 단위로 파싱해 대상 셀의 문단을 통째로 재생성한다.

   1페이지 고정(절대 넘기지 않음):
     · 당사자·위임인·제3자 문단은 좌측정렬 컴팩트 paraPr(id=50, 줄간격 130%)로 통일
     · 각 셀 높이를 (줄수×줄피치+여백)로 '명시'해 과잉 예약/과잉 확장을 막음
     · 위임인 사이 빈 줄 제거, 여백 큰 '귀중' 칸 축소로 예산 확보

   막도장:
     · 위임인마다 makeOvalSeal(이름)로 자동 생성한 도장을 (인) 위에 겹침
     · 도장 가로 위치는 이름 폭을 계산해 (인) 자리에 맞춤(좌측정렬 기준)
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  function xmlEsc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* 줄 배치 상수(HWPUNIT). paraPr 50 = 12pt × 130% ≈ 1560/줄 */
  var PARA = '50';           // 좌측정렬 컴팩트 문단모양 id
  var LP = 1560;             // 줄 피치
  var MV = 282;              // 셀 상·하 여백(141+141)
  var GAP = '   ';           // 이름과 (인) 사이 간격
  function cellH(n) { return Math.max(1, n) * LP + MV; }
  // 12pt 기준 글자 대략 폭: 한글/전각 1200, 그 외 600
  function widthOf(s) {
    var w = 0; s = String(s == null ? '' : s);
    for (var i = 0; i < s.length; i++) { w += (s.charCodeAt(i) > 0x2000 ? 1200 : 600); }
    return w;
  }

  /* ── 표/행/셀 저수준 헬퍼 ── */
  function trList(tbl) { return tbl.match(/<hp:tr>[\s\S]*?<\/hp:tr>/g) || []; }
  function tcList(tr) { return tr.match(/<hp:tc\b[\s\S]*?<\/hp:tc>/g) || []; }
  function setRowAddrAll(tr, r) {
    return tr.replace(/(<hp:cellAddr colAddr="\d+" rowAddr=")\d+(")/g, '$1' + r + '$2');
  }
  function setRowSpan(tc, n) {
    return tc.replace(/(<hp:cellSpan colSpan="\d+" rowSpan=")\d+(")/, '$1' + n + '$2');
  }
  function setCellH(tc, h) {
    return tc.replace(/(<hp:cellSz width="\d+" height=")\d+(")/, '$1' + h + '$2');
  }
  function firstParaPattern(tc) {
    var m = tc.match(/<hp:p\b[\s\S]*?<\/hp:p>/);
    return m ? m[0] : null;
  }
  // 문단 패턴에 text 를 넣어 새 문단 생성. paraPrId 지정 시 문단모양 교체.
  function paraWith(patt, text, paraPrId) {
    var open = (patt && patt.match(/<hp:p\b[^>]*>/) || ['<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'])[0];
    if (paraPrId) open = open.replace(/paraPrIDRef="\d+"/, 'paraPrIDRef="' + paraPrId + '"');
    var charPr = (patt && patt.match(/charPrIDRef="(\d+)"/) || [])[1] || '0';
    var lineseg = (patt && patt.match(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/) || [''])[0];
    var run = (text === '' || text == null)
      ? '<hp:run charPrIDRef="' + charPr + '"/>'
      : '<hp:run charPrIDRef="' + charPr + '"><hp:t>' + xmlEsc(text) + '</hp:t></hp:run>';
    return open + run + lineseg + '</hp:p>';
  }
  // 셀의 subList 를 lines 로 재생성(+ 문단모양·셀높이 지정). 최소 1문단 보장.
  function fillCell(tc, lines, paraPrId, height) {
    var patt = firstParaPattern(tc);
    var arr = (lines && lines.length) ? lines : [''];
    var paras = arr.map(function (t) { return paraWith(patt, t, paraPrId); }).join('');
    tc = tc.replace(/(<hp:subList\b[^>]*>)[\s\S]*?(<\/hp:subList>)/, '$1' + paras + '$2');
    if (height) tc = setCellH(tc, height);
    return tc;
  }
  // 행 내부에서 특정 charPrIDRef run 의 텍스트만 교체(첫 출현).
  function replaceRunText(scope, charPr, text) {
    var re = new RegExp('(<hp:run charPrIDRef="' + charPr + '"><hp:t>)[\\s\\S]*?(<\\/hp:t><\\/hp:run>)');
    return scope.replace(re, '$1' + xmlEsc(text) + '$2');
  }

  /* ── 핵심: section0.xml 변환 ──
     data = { caseText, frontLabel, backLabel, frontNames:[], backNames:[],
              thirds:[{label,name}], wiiminLines:[], sealAnchors:[{anchor,name,offH}],
              role, attorneysText, agencyText }
     반환: { section, sealAnchors } */
  function transform(section, data) {
    var tblFull = (section.match(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/) || [null])[0];
    if (!tblFull) return { section: section, sealAnchors: [] };
    var tblOpen = tblFull.match(/<hp:tbl\b[^>]*>/)[0];
    var pre = tblFull.slice(tblOpen.length, tblFull.indexOf('<hp:tr>'));
    var rows = trList(tblFull);
    var thirds = data.thirds || [];

    // (0) 제목 유지 / (11) '귀중' 칸은 여백이 커서 축소 → 1페이지 예산 확보
    // (1) 사건
    (function () {
      var c = tcList(rows[1]); c[1] = fillCell(c[1], [data.caseText || '']);
      rows[1] = '<hp:tr>' + c.join('') + '</hp:tr>';
    })();

    // (2)(3) 당사자 앞/뒤 + 제3자 행
    var frontH = cellH((data.frontNames || []).length);
    var backH = cellH((data.backNames || []).length);
    var thirdH = cellH(1);
    var blockH = frontH + backH + thirds.length * thirdH;
    var row2, row3, thirdRows = [];
    (function () {
      var c2 = tcList(rows[2]);   // [당사자, 앞라벨, 앞값]
      c2[0] = setCellH(setRowSpan(c2[0], 2 + thirds.length), blockH);
      c2[1] = fillCell(c2[1], [data.frontLabel || ''], PARA, frontH);
      c2[2] = fillCell(c2[2], data.frontNames, PARA, frontH);
      row2 = '<hp:tr>' + c2.join('') + '</hp:tr>';

      var c3 = tcList(rows[3]);   // [뒤라벨, 뒤값]
      c3[0] = fillCell(c3[0], [data.backLabel || ''], PARA, backH);
      c3[1] = fillCell(c3[1], data.backNames, PARA, backH);
      row3 = '<hp:tr>' + c3.join('') + '</hp:tr>';

      thirds.forEach(function (t) {
        var cc = tcList(rows[3]);
        cc[0] = fillCell(cc[0], [t.label || ''], PARA, thirdH);
        cc[1] = fillCell(cc[1], [t.name || ''], PARA, thirdH);
        thirdRows.push('<hp:tr>' + cc.join('') + '</hp:tr>');
      });
    })();

    // (7) 위임인: 날짜 + 이름/(인)/주소 (좌측정렬 컴팩트, 빈줄 없음)
    (function () {
      var wl = (data.wiiminLines && data.wiiminLines.length) ? data.wiiminLines : [''];
      var h = cellH(wl.length);
      var c = tcList(rows[7]);
      c[0] = setCellH(c[0], h);                 // '위 임 인' 라벨 칸도 같은 높이
      c[1] = fillCell(c[1], wl, PARA, h);
      rows[7] = '<hp:tr>' + c.join('') + '</hp:tr>';
    })();

    // (9) 역할(charPr7) / (10) 담당변호사(charPr21) / (11) 제출처(charPr22) + 칸 축소
    rows[9] = replaceRunText(rows[9], '7', data.role || '');
    rows[10] = replaceRunText(rows[10], '21', data.attorneysText || '');
    rows[11] = replaceRunText(rows[11], '22', (data.agencyText || '') + ' 귀중');
    (function () { var c = tcList(rows[11]); c[0] = setCellH(c[0], 2900); rows[11] = '<hp:tr>' + c.join('') + '</hp:tr>'; })();

    var finalRows = [rows[0], rows[1], row2, row3].concat(thirdRows, rows.slice(4));
    finalRows = finalRows.map(function (tr, i) { return setRowAddrAll(tr, i); });
    var newOpen = tblOpen.replace(/rowCnt="\d+"/, 'rowCnt="' + finalRows.length + '"');
    section = section.replace(tblFull, newOpen + pre + finalRows.join('') + '</hp:tbl>');
    return { section: section, sealAnchors: data.sealAnchors || [] };
  }

  /* ── header.xml 에 좌측정렬 컴팩트 문단모양(id=50, 줄간격 130%) 주입 ── */
  function injectParaPr(hdr) {
    if (/<hh:paraPr id="50"/.test(hdr)) return hdr;
    var p = '<hh:paraPr id="50" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="0" suppressLineNumbers="0" checked="0">'
      + '<hh:align horizontal="LEFT" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/>'
      + '<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="BREAK_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>'
      + '<hh:autoSpacing eAsianEng="0" eAsianNum="0"/>'
      + '<hh:margin><hc:intent value="0" unit="HWPUNIT"/><hc:left value="0" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/><hc:prev value="0" unit="HWPUNIT"/><hc:next value="0" unit="HWPUNIT"/></hh:margin>'
      + '<hh:lineSpacing type="PERCENT" value="130" unit="HWPUNIT"/>'
      + '<hh:border borderFillIDRef="3" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/></hh:paraPr>';
    hdr = hdr.replace(/(<hh:paraProperties itemCnt=")(\d+)(">)/, function (m, a, c, b) { return a + (parseInt(c, 10) + 1) + b; });
    hdr = hdr.replace('</hh:paraProperties>', p + '</hh:paraProperties>');
    return hdr;
  }

  /* ── 브라우저: 상태 → 표시용 데이터 ── */
  function clean(s) {
    return (window.HWPXFill && window.HWPXFill.cleanName) ? window.HWPXFill.cleanName(s) : String(s == null ? '' : s).trim();
  }
  function disp(s) { return (typeof window.displayNameOf === 'function') ? window.displayNameOf(s) : clean(s); }
  function sealName(s) { return (typeof window.sealNameOf === 'function') ? window.sealNameOf(s) : clean(s); }
  function fmtDate(s) { return (typeof window.sjFmtDate === 'function') ? window.sjFmtDate(s) : String(s || ''); }

  // 이름줄 + 도장 앵커 생성. namePart 뒤에 GAP+(인). 도장은 (인) 위치에 맞춤.
  function pushNameLine(lines, anchors, namePart, sealNm) {
    var line = namePart + GAP + '(인)';
    lines.push(line);
    // (인) 시작 x = 셀좌여백510 + namePart+GAP 폭. 도장 좌변을 살짝 왼쪽(-300)에 둠.
    var offH = 510 + widthOf(namePart + GAP) - 300;
    anchors.push({ anchor: line, name: sealNm, offH: offH });
  }

  function buildMingasaData(s, def) {
    var clients = (s.clients || []).map(function (c) {
      return (typeof window.normalizeMgClient === 'function') ? window.normalizeMgClient(c) : c;
    }).filter(function (c) {
      return (c.kind === 'corp')
        ? (c.corpName || (c.reps && c.reps.some(function (r) { return r.name && r.name.trim(); })))
        : (c.name && c.name.trim());
    });
    var clientNames = clients.map(function (c) {
      return (c.kind === 'corp') ? clean(disp(c.corpName)) : clean(disp(c.name));
    });
    var oppList = (typeof window.mgOppList === 'function') ? window.mgOppList(s) : (s.opps || []);
    var oppNames = oppList.map(function (n) { return clean(disp(n)); });

    var role = s.role || def.front;
    var oursFront = (role === def.front);

    var wiiminLines = [fmtDate(s.date)];
    var sealAnchors = [];
    clients.forEach(function (c) {
      if (c.kind === 'corp') {
        if (c.corpName) wiiminLines.push(clean(c.corpName));
        var reps = (c.reps && c.reps.length) ? c.reps : [{ name: '' }];
        var title = clean(c.title || '대표이사');
        reps.forEach(function (r) {
          if (!(r.name && r.name.trim())) return;
          pushNameLine(wiiminLines, sealAnchors, title + ' ' + clean(disp(r.name)), sealName(r.name));
        });
        if (c.addr) wiiminLines.push('(' + clean(c.addr) + ')');
      } else {
        var hasAddr = c.addr && !c.noAddr;
        var nm = clean(disp(c.name)) + ((!hasAddr && c.ssn) ? '(' + c.ssn + ')' : '');
        pushNameLine(wiiminLines, sealAnchors, nm, sealName(c.name));
        if (hasAddr) wiiminLines.push('(' + clean(c.addr) + ')');
      }
    });

    var atts = (s.attorneys && s.attorneys.length) ? s.attorneys : ['서고은'];
    return {
      caseText: [clean(s.casenum), clean(s.casename)].filter(Boolean).join(' '),
      frontLabel: def.front, backLabel: def.back,
      frontNames: oursFront ? clientNames : oppNames,
      backNames: oursFront ? oppNames : clientNames,
      thirds: (def.hasThird && s.thirds) ? s.thirds.filter(function (t) { return t && t.name && t.name.trim(); })
        .map(function (t) { return { label: t.label || '제3채무자', name: clean(t.name) }; }) : [],
      wiiminLines: wiiminLines,
      sealAnchors: sealAnchors,
      role: role,
      attorneysText: atts.join(', '),
      agencyText: clean(s.agency)
    };
  }

  /* ── 브라우저: 다운로드 ── */
  function download(state) {
    if (!window.HWPXFill) { alert('HWPX 엔진을 불러오지 못했습니다.'); return Promise.reject(); }
    var def = (typeof window.mgDef === 'function') ? window.mgDef(state) : { front: '원고', back: '피고', hasThird: false };
    var data = buildMingasaData(state, def);

    var nameSeals = data.sealAnchors.map(function (a) {
      var url = (typeof window.makeOvalSeal === 'function') ? window.makeOvalSeal(a.name) : null;
      return url ? { dataUrl: url, anchor: a.anchor, off: { h: a.offH, v: -1300 } } : null;
    }).filter(Boolean);

    var fname = window.HWPXFill.safeName(['소송위임장', data.caseText || (data.frontNames[0] || '')]);
    return window.HWPXFill.build({
      url: './templates/mingasa_wiimjang.hwpx',
      fill: function (ctx) { ctx.section = transform(ctx.section, data).section; },
      onHeader: injectParaPr,
      nameSeals: nameSeals
    }).then(function (blob) { window.HWPXFill.saveBlob(blob, fname); })
      .catch(function (e) { console.log('민가사 HWPX 오류:', e); alert('한글 파일 생성 중 오류가 발생했습니다.'); });
  }

  if (typeof window !== 'undefined') {
    window.MingasaHwpx = { transform: transform, buildMingasaData: buildMingasaData, download: download, injectParaPr: injectParaPr };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { transform: transform, injectParaPr: injectParaPr, widthOf: widthOf, cellH: cellH };
  }
})();
