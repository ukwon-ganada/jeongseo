/* 법무법인 정서 PWA - 민·가사 소송위임장 HWPX 생성 (mingasahwpx.js)
   ───────────────────────────────────────────────────────────────
   templates/mingasa_wiimjang.hwpx 의 표(section0.xml)를 상태값으로 재구성한다.
   정부/표준 양식은 텍스트가 여러 <hp:run> 으로 쪼개져 있어 단순 문자열 치환이
   취약하므로, 표를 '행/셀' 단위로 파싱해 대상 셀의 문단을 통째로 재생성한다.

   특징:
     · 당사자(원고/피고 등)·제3자: 한 셀에 여러 줄(문단) → 한글이 셀 높이를 자동 확장
     · 제3채무자/제3채권자: 당사자 라벨 아래 행을 삽입(rowSpan·rowAddr·rowCnt 갱신)
     · 위임인: 날짜 + 각 위임인 이름/(인)/주소 문단 생성 → 이름줄은 막도장 앵커
     · 막도장: HWPXFill 의 nameSeals(image2,3,…)로 위임인마다 자동 도장

   구조:
     buildMingasaData(state, def)  → 브라우저: window 헬퍼로 표시용 문자열 데이터 구성
     transform(section, data)      → 순수 함수: section0.xml 문자열 변환(+ 막도장 앵커)
     download(state)               → 브라우저: 데이터→도장 생성→HWPXFill.build→저장
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  function xmlEsc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
  function firstParaPattern(tc) {
    var m = tc.match(/<hp:p\b[\s\S]*?<\/hp:p>/);
    return m ? m[0] : null;
  }
  // 문단 패턴(원본 셀의 첫 문단)에 text 를 넣어 새 문단 생성. text 가 빈값이면 빈 run.
  function paraWith(patt, text) {
    var open = (patt.match(/<hp:p\b[^>]*>/) || ['<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'])[0];
    var charPr = (patt && patt.match(/charPrIDRef="(\d+)"/) || [])[1] || '0';
    var lineseg = (patt && patt.match(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/) || [''])[0];
    var run = (text === '' || text == null)
      ? '<hp:run charPrIDRef="' + charPr + '"/>'
      : '<hp:run charPrIDRef="' + charPr + '"><hp:t>' + xmlEsc(text) + '</hp:t></hp:run>';
    return open + run + lineseg + '</hp:p>';
  }
  // 셀의 subList 내부(문단들)를 lines(문자열 배열)로 재생성. 최소 1개 문단 보장.
  function fillCell(tc, lines) {
    var patt = firstParaPattern(tc);
    var arr = (lines && lines.length) ? lines : [''];
    var paras = arr.map(function (t) { return paraWith(patt, t); }).join('');
    return tc.replace(/(<hp:subList\b[^>]*>)[\s\S]*?(<\/hp:subList>)/, '$1' + paras + '$2');
  }
  // 특정 charPrIDRef 를 가진 run 의 텍스트만 교체(행 내부에서). 첫 출현만.
  function replaceRunText(scope, charPr, text) {
    var re = new RegExp('(<hp:run charPrIDRef="' + charPr + '"><hp:t>)[\\s\\S]*?(<\\/hp:t><\\/hp:run>)');
    return scope.replace(re, '$1' + xmlEsc(text) + '$2');
  }

  /* ── 핵심: section0.xml 변환 ──
     data = {
       caseText, frontLabel, backLabel, frontNames:[], backNames:[],
       thirds:[{label,name}], wiiminLines:[], sealAnchors:[{anchor,name}],
       role, attorneysText, agencyText
     }
     반환: { section, sealAnchors:[{anchor,name}] }  (sealAnchors 는 그대로 전달) */
  function transform(section, data) {
    var tblFull = (section.match(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/) || [null])[0];
    if (!tblFull) return { section: section, sealAnchors: [] };
    var tblOpen = tblFull.match(/<hp:tbl\b[^>]*>/)[0];
    var firstTrAt = tblFull.indexOf('<hp:tr>');
    var pre = tblFull.slice(tblOpen.length, firstTrAt);   // 여는 태그와 첫 행 사이 보존
    var rows = trList(tblFull);

    // 행 인덱스(원본 12행 기준):
    //  0 제목 / 1 사건 / 2 당사자+앞라벨+값 / 3 뒤라벨+값 / 4 안내 /
    //  5 수임인 / 6 수권사항 / 7 위임인 / 8 지정서제목 / 9 역할문 / 10 담당변호사 / 11 귀중

    // (1) 사건
    (function () {
      var cells = tcList(rows[1]);
      cells[1] = fillCell(cells[1], [data.caseText || '']);
      rows[1] = '<hp:tr>' + cells.join('') + '</hp:tr>';
    })();

    // (2) 당사자 앞/뒤 라벨·값 + 제3자 행 삽입
    var thirds = data.thirds || [];
    var row2, row3, thirdRows = [];
    (function () {
      var c2 = tcList(rows[2]);   // [당사자, 앞라벨, 앞값]
      c2[0] = setRowSpan(c2[0], 2 + thirds.length);          // 당사자 병합 행수
      c2[1] = fillCell(c2[1], [data.frontLabel || '']);
      c2[2] = fillCell(c2[2], data.frontNames && data.frontNames.length ? data.frontNames : ['']);
      row2 = '<hp:tr>' + c2.join('') + '</hp:tr>';

      var c3 = tcList(rows[3]);   // [뒤라벨, 뒤값]
      c3[0] = fillCell(c3[0], [data.backLabel || '']);
      c3[1] = fillCell(c3[1], data.backNames && data.backNames.length ? data.backNames : ['']);
      row3 = '<hp:tr>' + c3.join('') + '</hp:tr>';

      // 제3자: row3(라벨+값 구조)를 복제해 라벨/이름 교체
      thirds.forEach(function (t) {
        var cc = tcList(rows[3]);
        cc[0] = fillCell(cc[0], [t.label || '']);
        cc[1] = fillCell(cc[1], [t.name || '']);
        thirdRows.push('<hp:tr>' + cc.join('') + '</hp:tr>');
      });
    })();

    // (7) 위임인: 날짜 + 이름/(인)/주소 문단
    (function () {
      var cells = tcList(rows[7]);
      cells[1] = fillCell(cells[1], data.wiiminLines && data.wiiminLines.length ? data.wiiminLines : ['']);
      rows[7] = '<hp:tr>' + cells.join('') + '</hp:tr>';
    })();

    // (9) 역할문 안의 역할(charPr7 단독 run "원고")
    rows[9] = replaceRunText(rows[9], '7', data.role || '');
    // (10) 담당변호사(charPr21 단독 run)
    rows[10] = replaceRunText(rows[10], '21', data.attorneysText || '');
    // (11) 제출처 "귀중"(charPr22 단독 run)
    rows[11] = replaceRunText(rows[11], '22', (data.agencyText || '') + ' 귀중');

    // 최종 행 순서: 0,1,[row2,row3,...제3자], 4..11
    var finalRows = [rows[0], rows[1], row2, row3].concat(thirdRows, rows.slice(4));
    // rowAddr 를 위치 기준으로 재번호
    finalRows = finalRows.map(function (tr, i) { return setRowAddrAll(tr, i); });

    var newOpen = tblOpen.replace(/rowCnt="\d+"/, 'rowCnt="' + finalRows.length + '"');
    var newTbl = newOpen + pre + finalRows.join('') + '</hp:tbl>';
    section = section.replace(tblFull, newTbl);
    return { section: section, sealAnchors: data.sealAnchors || [] };
  }

  /* ── 브라우저: 상태 → 표시용 데이터 ── */
  function clean(s) {
    return (window.HWPXFill && window.HWPXFill.cleanName) ? window.HWPXFill.cleanName(s) : String(s == null ? '' : s).trim();
  }
  function disp(s) { return (typeof window.displayNameOf === 'function') ? window.displayNameOf(s) : clean(s); }
  function sealName(s) { return (typeof window.sealNameOf === 'function') ? window.sealNameOf(s) : clean(s); }
  function fmtDate(s) { return (typeof window.sjFmtDate === 'function') ? window.sjFmtDate(s) : String(s || ''); }

  var SEAL_PAD = '        '; // 이름과 (인) 사이 간격

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
    var frontNames = oursFront ? clientNames : oppNames;
    var backNames = oursFront ? oppNames : clientNames;

    // 위임인 문단 + 막도장 앵커
    var wiiminLines = [fmtDate(s.date)];
    var sealAnchors = [];
    clients.forEach(function (c) {
      if (c.kind === 'corp') {
        if (c.corpName) wiiminLines.push(clean(c.corpName));
        var reps = (c.reps && c.reps.length) ? c.reps : [{ name: '' }];
        var title = clean(c.title || '대표이사');
        reps.forEach(function (r) {
          if (!(r.name && r.name.trim())) return;
          var line = title + ' ' + clean(disp(r.name)) + SEAL_PAD + '(인)';
          wiiminLines.push(line);
          sealAnchors.push({ anchor: line, name: sealName(r.name) });
        });
        if (c.addr) wiiminLines.push('(' + clean(c.addr) + ')');
      } else {
        var hasAddr = c.addr && !c.noAddr;
        var nm = clean(disp(c.name)) + ((!hasAddr && c.ssn) ? '(' + c.ssn + ')' : '');
        var line = nm + SEAL_PAD + '(인)';
        wiiminLines.push(line);
        sealAnchors.push({ anchor: line, name: sealName(c.name) });
        if (hasAddr) wiiminLines.push('(' + clean(c.addr) + ')');
      }
      wiiminLines.push(''); // 위임인 사이 여백
    });

    var atts = (s.attorneys && s.attorneys.length) ? s.attorneys : ['서고은'];

    return {
      caseText: [clean(s.casenum), clean(s.casename)].filter(Boolean).join(' '),
      frontLabel: def.front,
      backLabel: def.back,
      frontNames: frontNames,
      backNames: backNames,
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
    var def = (typeof window.mgDef === 'function') ? window.mgDef(state)
      : { front: '원고', back: '피고', hasThird: false };
    var data = buildMingasaData(state, def);

    var nameSeals = data.sealAnchors.map(function (a) {
      var url = (typeof window.makeOvalSeal === 'function') ? window.makeOvalSeal(a.name) : null;
      return url ? { dataUrl: url, anchor: a.anchor, off: { h: 30000, v: -1700 } } : null;
    }).filter(Boolean);

    var fname = window.HWPXFill.safeName(['소송위임장', data.caseText || data.frontNames[0] || '']);
    return window.HWPXFill.build({
      url: './templates/mingasa_wiimjang.hwpx',
      fill: function (ctx) { ctx.section = transform(ctx.section, data).section; },
      nameSeals: nameSeals
    }).then(function (blob) { window.HWPXFill.saveBlob(blob, fname); })
      .catch(function (e) { console.log('민가사 HWPX 오류:', e); alert('한글 파일 생성 중 오류가 발생했습니다.'); });
  }

  if (typeof window !== 'undefined') {
    window.MingasaHwpx = { transform: transform, buildMingasaData: buildMingasaData, download: download };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { transform: transform };
  }
})();
