/* 법무법인 정서 PWA - 민·가사 소송위임장 HWPX 생성 (mingasahwpx.js)
   ───────────────────────────────────────────────────────────────
   templates/mingasa_wiimjang.hwpx 의 표를 상태값으로 채운다.

   ▷ 외곽 표 크기는 '절대' 변하지 않는다.
     · 어떤 셀의 높이도 새로 키우지 않는다.
     · 여러 줄이 들어갈 칸은 '고정 줄간격 = 칸안쪽높이 ÷ 줄수' 로 넣어
       내용이 칸을 넘치지도(→표가 커짐) 남기지도 않게 정확히 채운다.
       (줄수가 많으면 글자만 작아지고, 칸/표 크기는 그대로)
     · 제3자 행은 '당사자(원고+피고)' 칸 높이를 그 안에서 나눠 만든다
       → 당사자 블록 합계 = 템플릿 그대로 → 외곽 표 총높이 불변.

   ▷ 막도장: 이름 뒤에 '글자처럼(인라인)' 삽입 → 좌표 계산 없이 정확한 위치.
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  function xmlEsc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  var MV = 282;                 // 셀 상·하 여백 합(141+141)
  var PICID = 3000;             // 인라인 그림 instId 시드

  /* ── 문단모양(paraPr)·글자모양(charPr) 동적 등록 ──
     transform 이 필요한 스펙을 모아두면 injectHeader 가 header.xml 에 주입한다. */
  var regP = {}, regC = {};     // key -> id
  var specP = [], specC = [];   // {id, pitch, align} / {id, height}
  function resetReg() { regP = {}; regC = {}; specP = []; specC = []; }
  function paraId(pitch, align) {
    var k = pitch + '/' + align;
    if (regP[k] != null) return regP[k];
    var id = 60 + specP.length; regP[k] = id; specP.push({ id: id, pitch: pitch, align: align }); return id;
  }
  function charId(height) {
    var k = '' + height;
    if (regC[k] != null) return regC[k];
    var id = 120 + specC.length; regC[k] = id; specC.push({ id: id, height: height }); return id;
  }

  /* ── 표/행/셀 헬퍼 ── */
  function trList(tbl) { return tbl.match(/<hp:tr>[\s\S]*?<\/hp:tr>/g) || []; }
  function tcList(tr) { return tr.match(/<hp:tc\b[\s\S]*?<\/hp:tc>/g) || []; }
  function cellH(tc) { var m = tc.match(/<hp:cellSz width="\d+" height="(\d+)"/); return m ? parseInt(m[1], 10) : 0; }
  function setCellH(tc, h) { return tc.replace(/(<hp:cellSz width="\d+" height=")\d+(")/, '$1' + h + '$2'); }
  function setRowSpan(tc, n) { return tc.replace(/(<hp:cellSpan colSpan="\d+" rowSpan=")\d+(")/, '$1' + n + '$2'); }
  function setRowAddrAll(tr, r) { return tr.replace(/(<hp:cellAddr colAddr="\d+" rowAddr=")\d+(")/g, '$1' + r + '$2'); }

  // 인라인 도장(그림) run — 이름 뒤에 글자처럼 배치(treatAsChar=1)
  function inlineSeal(imgRef, side) {
    var id = ++PICID, o = side;
    return '<hp:run charPrIDRef="0"><hp:pic reverse="0" isBWModeOnly="0" id="' + id + '" zOrder="10" numberingType="PICTURE" textWrap="SQUARE" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="' + id + '">' +
      '<hp:offset x="0" y="0"/><hp:orgSz width="' + o + '" height="' + o + '"/><hp:curSz width="' + o + '" height="' + o + '"/>' +
      '<hp:flip horizontal="0" vertical="0"/><hp:rotationInfo angle="0"/>' +
      '<hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>' +
      '<hc:img binaryItemIDRef="' + imgRef + '" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>' +
      '<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="' + o + '" y="0"/><hc:pt2 x="' + o + '" y="' + o + '"/><hc:pt3 x="0" y="' + o + '"/></hp:imgRect>' +
      '<hp:imgClip left="0" right="' + o + '" top="0" bottom="' + o + '"/><hp:inMargin left="0" right="0" top="0" bottom="0"/>' +
      '<hp:sz width="' + o + '" widthRelTo="ABSOLUTE" height="' + o + '" heightRelTo="ABSOLUTE" protect="0"/>' +
      '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="LINE" horzRelTo="PARA" vertAlign="CENTER" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>' +
      '<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:shapeComment/></hp:pic></hp:run>';
  }
  // 문단 하나 생성. item={text, sealRef?}. pPr/cPr 지정, 도장은 인라인으로 텍스트 뒤에.
  function mkPara(pPr, cPr, item, sealSide) {
    var t = (item && item.text != null) ? item.text : '';
    var run = t === '' ? '<hp:run charPrIDRef="' + cPr + '"/>'
      : '<hp:run charPrIDRef="' + cPr + '"><hp:t>' + xmlEsc(t) + '</hp:t></hp:run>';
    if (item && item.sealRef) run += inlineSeal(item.sealRef, sealSide);
    return '<hp:p id="0" paraPrIDRef="' + pPr + '" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">' + run
      + '<hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="1000" textheight="1000" baseline="850" spacing="0" horzpos="0" horzsize="40000" flags="393216"/></hp:linesegarray></hp:p>';
  }
  // 셀 높이는 '그대로' 두고, 안쪽 높이에 items(줄들)를 고정 줄간격으로 딱 맞게 채운다.
  // items: [{text, sealRef?}], align: 'LEFT'|'CENTER'
  function fitCell(tc, items, align) {
    var h = cellH(tc);
    var n = Math.max(1, items.length);
    var pitch = Math.floor((h - MV) / n);
    if (pitch < 400) pitch = 400;
    var font = Math.min(1200, pitch - 150); if (font < 600) font = 600;
    var seal = Math.min(font + 200, pitch - 30);   // 도장 크기(글자보다 약간 크게, 줄피치 이내)
    if (seal < 400) seal = 400;
    var pP = paraId(pitch, align || 'LEFT'), cP = charId(font);
    var paras = items.map(function (it) { return mkPara(pP, cP, it, seal); }).join('');
    return tc.replace(/(<hp:subList\b[^>]*>)[\s\S]*?(<\/hp:subList>)/, '$1' + paras + '$2');
  }
  function replaceRunText(scope, cpr, text) {
    var re = new RegExp('(<hp:run charPrIDRef="' + cpr + '"><hp:t>)[\\s\\S]*?(<\\/hp:t><\\/hp:run>)');
    return scope.replace(re, '$1' + xmlEsc(text) + '$2');
  }
  function txt(a) { return a.map(function (t) { return { text: t }; }); }

  /* ── 핵심 변환 ── */
  function transform(section, data) {
    resetReg();
    var tblFull = (section.match(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/) || [null])[0];
    if (!tblFull) return { section: section };
    var tblOpen = tblFull.match(/<hp:tbl\b[^>]*>/)[0];
    var pre = tblFull.slice(tblOpen.length, tblFull.indexOf('<hp:tr>'));
    var rows = trList(tblFull);
    var thirds = data.thirds || [];

    // (1) 사건
    (function () { var c = tcList(rows[1]); c[1] = fitCell(c[1], txt([data.caseText || '']), 'LEFT'); rows[1] = '<hp:tr>' + c.join('') + '</hp:tr>'; })();

    // (2)(3) 당사자: 블록 높이(원고+피고)를 그대로 유지하며 내부에서 나눔
    var frontN = Math.max(1, (data.frontNames || []).length);
    var backN = Math.max(1, (data.backNames || []).length);
    var row2, row3, thirdRows = [];
    (function () {
      var c2 = tcList(rows[2]);   // [당사자, 앞라벨, 앞값]
      var c3 = tcList(rows[3]);   // [뒤라벨, 뒤값]
      var blockH = cellH(c2[2]) + cellH(c3[1]);          // 템플릿 원고+피고 높이 = 불변 총량
      var units = frontN + backN + thirds.length;         // 줄/행 가중치
      var frontH = Math.round(blockH * frontN / units);
      var backH = Math.round(blockH * backN / units);
      var thirdHs = thirds.map(function () { return Math.round(blockH * 1 / units); });
      // 반올림 오차를 앞칸에 흡수(합계 정확히 유지)
      var diff = blockH - (frontH + backH + thirdHs.reduce(function (a, b) { return a + b; }, 0));
      frontH += diff;

      c2[0] = setCellH(setRowSpan(c2[0], 2 + thirds.length), blockH);   // 당사자 라벨: 블록 전체 병합
      c2[1] = setCellH(c2[1], frontH); c2[1] = fitCell(c2[1], txt([data.frontLabel || '']), 'LEFT');
      c2[2] = setCellH(c2[2], frontH); c2[2] = fitCell(c2[2], txt(data.frontNames && data.frontNames.length ? data.frontNames : ['']), 'LEFT');
      row2 = '<hp:tr>' + c2.join('') + '</hp:tr>';

      c3[0] = setCellH(c3[0], backH); c3[0] = fitCell(c3[0], txt([data.backLabel || '']), 'LEFT');
      c3[1] = setCellH(c3[1], backH); c3[1] = fitCell(c3[1], txt(data.backNames && data.backNames.length ? data.backNames : ['']), 'LEFT');
      row3 = '<hp:tr>' + c3.join('') + '</hp:tr>';

      thirds.forEach(function (t, ti) {
        var cc = tcList(rows[3]);
        cc[0] = setCellH(cc[0], thirdHs[ti]); cc[0] = fitCell(cc[0], txt([t.label || '']), 'LEFT');
        cc[1] = setCellH(cc[1], thirdHs[ti]); cc[1] = fitCell(cc[1], txt([t.name || '']), 'LEFT');
        thirdRows.push('<hp:tr>' + cc.join('') + '</hp:tr>');
      });
    })();

    // (7) 위임인: 날짜 + 이름/(인)+도장 + 주소  (셀 높이 그대로, 안에서 맞춤)
    (function () {
      var c = tcList(rows[7]);
      c[1] = fitCell(c[1], (data.wiimin && data.wiimin.length) ? data.wiimin : [{ text: '' }], 'LEFT');
      rows[7] = '<hp:tr>' + c.join('') + '</hp:tr>';
    })();

    // (9) 역할 / (10) 담당변호사 / (11) 제출처 — 텍스트만 교체(양식 유지)
    rows[9] = replaceRunText(rows[9], '7', data.role || '');
    rows[10] = replaceRunText(rows[10], '21', data.attorneysText || '');
    rows[11] = replaceRunText(rows[11], '22', (data.agencyText || '') + ' 귀중');

    var finalRows = [rows[0], rows[1], row2, row3].concat(thirdRows, rows.slice(4));
    finalRows = finalRows.map(function (tr, i) { return setRowAddrAll(tr, i); });
    var newOpen = tblOpen.replace(/rowCnt="\d+"/, 'rowCnt="' + finalRows.length + '"');
    section = section.replace(tblFull, newOpen + pre + finalRows.join('') + '</hp:tbl>');
    return { section: section };
  }

  /* ── header.xml 에 등록된 paraPr/charPr 주입 ── */
  function injectHeader(hdr) {
    // paraPr: 고정 줄간격 + 정렬
    if (specP.length) {
      var pxml = specP.map(function (p) {
        return '<hh:paraPr id="' + p.id + '" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="0" suppressLineNumbers="0" checked="0">'
          + '<hh:align horizontal="' + p.align + '" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/>'
          + '<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="BREAK_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>'
          + '<hh:autoSpacing eAsianEng="0" eAsianNum="0"/>'
          + '<hh:margin><hc:intent value="0" unit="HWPUNIT"/><hc:left value="0" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/><hc:prev value="0" unit="HWPUNIT"/><hc:next value="0" unit="HWPUNIT"/></hh:margin>'
          + '<hh:lineSpacing type="FIXED" value="' + p.pitch + '" unit="HWPUNIT"/>'
          + '<hh:border borderFillIDRef="3" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/></hh:paraPr>';
      }).join('');
      hdr = hdr.replace(/(<hh:paraProperties itemCnt=")(\d+)(">)/, function (m, a, c, b) { return a + (parseInt(c, 10) + specP.length) + b; });
      hdr = hdr.replace('</hh:paraProperties>', pxml + '</hh:paraProperties>');
    }
    // charPr: 글자 크기(템플릿 charPr20 복제)
    if (specC.length) {
      var cxml = specC.map(function (c) {
        return '<hh:charPr id="' + c.id + '" height="' + c.height + '" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="11">'
          + '<hh:fontRef hangul="6" latin="6" hanja="6" japanese="6" other="6" symbol="6" user="6"/>'
          + '<hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>'
          + '<hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>'
          + '<hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>'
          + '<hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/></hh:charPr>';
      }).join('');
      hdr = hdr.replace(/(<hh:charProperties itemCnt=")(\d+)(">)/, function (m, a, c, b) { return a + (parseInt(c, 10) + specC.length) + b; });
      hdr = hdr.replace('</hh:charProperties>', cxml + '</hh:charProperties>');
    }
    return hdr;
  }

  /* ── 브라우저: 상태 → 데이터 ── */
  function clean(s) { return (window.HWPXFill && window.HWPXFill.cleanName) ? window.HWPXFill.cleanName(s) : String(s == null ? '' : s).trim(); }
  function disp(s) { return (typeof window.displayNameOf === 'function') ? window.displayNameOf(s) : clean(s); }
  function sealName(s) { return (typeof window.sealNameOf === 'function') ? window.sealNameOf(s) : clean(s); }
  function fmtDate(s) { return (typeof window.sjFmtDate === 'function') ? window.sjFmtDate(s) : String(s || ''); }

  function buildMingasaData(s, def) {
    var clients = (s.clients || []).map(function (c) {
      return (typeof window.normalizeMgClient === 'function') ? window.normalizeMgClient(c) : c;
    }).filter(function (c) {
      return (c.kind === 'corp') ? (c.corpName || (c.reps && c.reps.some(function (r) { return r.name && r.name.trim(); }))) : (c.name && c.name.trim());
    });
    var clientNames = clients.map(function (c) { return (c.kind === 'corp') ? clean(disp(c.corpName)) : clean(disp(c.name)); });
    var oppList = (typeof window.mgOppList === 'function') ? window.mgOppList(s) : (s.opps || []);
    var oppNames = oppList.map(function (n) { return clean(disp(n)); });
    var role = s.role || def.front, oursFront = (role === def.front);

    // 위임인 줄 + 인라인 도장(imageN)
    var wiimin = [{ text: fmtDate(s.date) }];
    var sealImages = [];
    var nextId = 2;   // image1 은 법인 직인(템플릿), 막도장은 image2 부터
    function addSeal(nm) { var id = nextId++; sealImages.push({ id: id, name: sealName(nm) }); return 'image' + id; }
    clients.forEach(function (c) {
      if (c.kind === 'corp') {
        if (c.corpName) wiimin.push({ text: clean(c.corpName) });
        var reps = (c.reps && c.reps.length) ? c.reps : [{ name: '' }];
        var title = clean(c.title || '대표이사');
        reps.forEach(function (r) {
          if (!(r.name && r.name.trim())) return;
          wiimin.push({ text: title + ' ' + clean(disp(r.name)) + '   (인) ', sealRef: addSeal(r.name) });
        });
        if (c.addr) wiimin.push({ text: '(' + clean(c.addr) + ')' });
      } else {
        var hasAddr = c.addr && !c.noAddr;
        var nm = clean(disp(c.name)) + ((!hasAddr && c.ssn) ? '(' + c.ssn + ')' : '');
        wiimin.push({ text: nm + '   (인) ', sealRef: addSeal(c.name) });
        if (hasAddr) wiimin.push({ text: '(' + clean(c.addr) + ')' });
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
      wiimin: wiimin, sealImages: sealImages,
      role: role, attorneysText: atts.join(', '), agencyText: clean(s.agency)
    };
  }

  function download(state) {
    if (!window.HWPXFill) { alert('HWPX 엔진을 불러오지 못했습니다.'); return Promise.reject(); }
    var def = (typeof window.mgDef === 'function') ? window.mgDef(state) : { front: '원고', back: '피고', hasThird: false };
    var data = buildMingasaData(state, def);
    var embedImages = data.sealImages.map(function (si) {
      var url = (typeof window.makeOvalSeal === 'function') ? window.makeOvalSeal(si.name) : null;
      return url ? { id: si.id, dataUrl: url } : null;
    }).filter(Boolean);
    // 도장 생성 실패한 이름은 인라인 참조 제거(빈칸 방지)
    var okIds = {}; embedImages.forEach(function (e) { okIds[e.id] = 1; });
    data.wiimin.forEach(function (w) { if (w.sealRef && !okIds[parseInt(w.sealRef.replace('image', ''), 10)]) delete w.sealRef; });

    var fname = window.HWPXFill.safeName(['소송위임장', data.caseText || (data.frontNames[0] || '')]);
    return window.HWPXFill.build({
      url: './templates/mingasa_wiimjang.hwpx',
      fill: function (ctx) { ctx.section = transform(ctx.section, data).section; },
      onHeader: injectHeader,
      embedImages: embedImages
    }).then(function (blob) { window.HWPXFill.saveBlob(blob, fname); })
      .catch(function (e) { console.log('민가사 HWPX 오류:', e); alert('한글 파일 생성 중 오류가 발생했습니다.'); });
  }

  if (typeof window !== 'undefined') {
    window.MingasaHwpx = { transform: transform, buildMingasaData: buildMingasaData, download: download, injectHeader: injectHeader, _reg: function () { return { specP: specP, specC: specC }; } };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { transform: transform, injectHeader: injectHeader, _reg: function () { return { specP: specP, specC: specC }; } };
  }
})();
