/* 법무법인 정서 PWA - HWPX 채움 공용 엔진 (hwpxfill.js)
   ───────────────────────────────────────────────────────────────
   표준 HWPX 템플릿(templates/*.hwpx)을 JSZip 으로 열어 Contents/section0.xml
   의 텍스트를 사용자 값으로 치환한 뒤 다시 .hwpx(zip)로 묶어 Blob 으로 돌려준다.
   항소·상고장 / 열람복사(법원·검찰) / 판결등본교부 가 공통으로 사용.

   설계:
     · 정부 양식은 표 셀·중첩 푸터가 많아 '문단 인덱스'가 취약하므로,
       템플릿에 든 '샘플값'을 '고유 텍스트 앵커'로 문자열 치환한다.
     · 도장(직인)은 서명줄 문단(sealAnchor 로 특정)에 떠 있는 그림 run 을 넣어
       '변호사 ○○○' 이름 위에 실제 도장처럼 겹친다. (chamgo/yeongi 와 동일 규칙)

   API: HWPXFill.build({
          url:'./templates/pankyul.hwpx',
          fill:function(ctx){ ctx.replace('샘플값','사용자값'); ... },
          sealDataUrl: window.SEAL_SEOGOEUN,   // 있으면 도장 삽입(없으면 생략)
          sealAnchor:  '변호사 홍 길 동',        // 도장 찍을 문단을 특정하는 텍스트
          sealOffset:  { h:700, v:-1150 }        // (선택) 미세 위치 조정
        }) → Promise<Blob>

   ctx 헬퍼:
     ctx.section          현재 section0.xml 문자열(직접 수정 가능)
     ctx.replace(a,b)     a(모든 출현)를 b 로 치환(문자열). 체이닝 가능.
     ctx.replaceOnce(a,b) 첫 출현만 치환
     ctx.esc(s)           XML 이스케이프(치환 값은 자동 이스케이프되지 않으므로 필요 시)

   의존: JSZip(CDN 지연 로드) · window.SEAL_SEOGOEUN(base64 PNG, 선택)
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  function xmlEsc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function normalize(s) { return String(s == null ? '' : s).replace(/<[^>]+>/g, '').replace(/\s+/g, ''); }

  function loadJSZip() {
    return new Promise(function (res, rej) {
      if (window.JSZip) return res(window.JSZip);
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
      s.onload = function () { res(window.JSZip); };
      s.onerror = function () { rej(new Error('JSZip 로드 실패')); };
      document.head.appendChild(s);
    });
  }

  /* ── 도장(직인) 이미지 삽입 — chamgo/yeongi 와 동일 규칙(1.5cm, 이름 위 겹침) ── */
  var SEAL_MM = 15;
  var SEAL_HU = Math.round(SEAL_MM / 10 * 7200 / 2.54);   // ≈4252 HWPUNIT
  var PARA_RE = /<hp:p\b[\s\S]*?<\/hp:p>/g;

  function dataUrlToU8(u) {
    var b64 = String(u || '').split(',')[1] || '';
    var bin = atob(b64), a = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }
  function pngSize(u8) {
    if (!u8 || u8.length < 24) return [504, 480];
    var w = ((u8[16] << 24) | (u8[17] << 16) | (u8[18] << 8) | u8[19]) >>> 0;
    var h = ((u8[20] << 24) | (u8[21] << 16) | (u8[22] << 8) | u8[23]) >>> 0;
    return [w || 504, h || 480];
  }
  function buildPic(pxW, pxH, hoff, voff) {
    var oW = pxW * 75, oH = pxH * 75, half = Math.round(SEAL_HU / 2);
    // 도장 실제 크기 = orgSz × scaMatrix. 원본 해상도와 무관하게 1.5cm(curSz)로 찍히도록 배율을 curSz/orgSz 로 준다.
    var cW = SEAL_HU, cH = Math.round(SEAL_HU * pxH / pxW);   // 너비 1.5cm, 높이는 원본 비율 유지
    var sx = (cW / oW).toFixed(6), sy = (cH / oH).toFixed(6); // 배율 = 표시/원본
    return '<hp:run charPrIDRef="0">' +
      '<hp:pic reverse="0" isBWModeOnly="0" id="1932510121" zOrder="20" numberingType="PICTURE" textWrap="IN_FRONT_OF_TEXT" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="1932510121">' +
      '<hp:offset x="0" y="0"/>' +
      '<hp:orgSz width="' + oW + '" height="' + oH + '"/>' +
      '<hp:curSz width="' + cW + '" height="' + cH + '"/>' +
      '<hp:flip horizontal="0" vertical="0"/>' +
      '<hp:rotationInfo angle="0"/>' +
      '<hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="' + sx + '" e2="0" e3="0" e4="0" e5="' + sy + '" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>' +
      '<hc:img binaryItemIDRef="image1" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>' +
      '<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="' + oW + '" y="0"/><hc:pt2 x="' + oW + '" y="' + oH + '"/><hc:pt3 x="0" y="' + oH + '"/></hp:imgRect>' +
      '<hp:imgClip left="0" right="' + oW + '" top="0" bottom="' + oH + '"/>' +
      '<hp:inMargin left="0" right="0" top="0" bottom="0"/>' +
      '<hp:sz width="' + cW + '" widthRelTo="ABSOLUTE" height="' + cH + '" heightRelTo="ABSOLUTE" protect="0"/>' +
      '<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="0" allowOverlap="1" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="RIGHT" vertOffset="' + voff + '" horzOffset="' + hoff + '"/>' +
      '<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:shapeComment/></hp:pic></hp:run>';
  }
  // sealAnchor(정규화)가 든 첫 문단에 그림 run 을 삽입
  function injectSealPic(sec, pic, anchor) {
    var paras = sec.match(PARA_RE) || [];
    var want = normalize(anchor);
    for (var i = 0; i < paras.length; i++) {
      if (normalize(paras[i]).indexOf(want) >= 0) {
        return sec.replace(paras[i], paras[i].replace(/^(<hp:p\b[^>]*>)/, '$1' + pic));
      }
    }
    return sec;
  }
  /* ── 템플릿에 이미 박힌 도장(image1) 제어 ── */
  var _sealId = 1932510200;
  // image1 을 참조하는 도장 그림(pic)들을 모두 제거(도장 끄기/다른 변호사)
  function stripBakedSeals(sec) {
    return sec.replace(/<hp:pic\b(?:(?!<\/hp:pic>)[\s\S])*?binaryItemIDRef="image1"(?:(?!<\/hp:pic>)[\s\S])*?<\/hp:pic>/g, '');
  }
  // 템플릿에 든 image1 을 참조하는 도장 그림 run(정위치 스타일과 동일, offset 만 지정)
  function bakedSealRun(hoff, voff) {
    var id = ++_sealId;
    return '<hp:run charPrIDRef="0"><hp:pic id="' + id + '" zOrder="20" numberingType="PICTURE" textWrap="IN_FRONT_OF_TEXT" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="' + id + '" reverse="0">' +
      '<hp:offset x="0" y="0"/><hp:orgSz width="37800" height="36000"/><hp:curSz width="4252" height="4050"/>' +
      '<hp:flip horizontal="0" vertical="0"/><hp:rotationInfo angle="0"/>' +
      '<hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="0.112487" e2="0" e3="0" e4="0" e5="0.1125" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>' +
      '<hc:img binaryItemIDRef="image1" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>' +
      '<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="37800" y="0"/><hc:pt2 x="37800" y="36000"/><hc:pt3 x="0" y="36000"/></hp:imgRect>' +
      '<hp:imgClip left="0" right="37800" top="0" bottom="36000"/><hp:inMargin left="0" right="0" top="0" bottom="0"/>' +
      '<hp:sz width="4252" widthRelTo="ABSOLUTE" height="4050" heightRelTo="ABSOLUTE" protect="0"/>' +
      '<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="0" allowOverlap="1" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="RIGHT" vertOffset="' + voff + '" horzOffset="' + hoff + '"/>' +
      '<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:shapeComment/></hp:pic></hp:run>';
  }
  function addBakedSeal(sec, anchor, hoff, voff) {
    var paras = sec.match(PARA_RE) || [], want = normalize(anchor), run = bakedSealRun(hoff, voff);
    for (var i = 0; i < paras.length; i++) {
      if (normalize(paras[i]).indexOf(want) >= 0) {
        return sec.replace(paras[i], paras[i].replace(/^(<hp:p\b[^>]*>)/, '$1' + run));
      }
    }
    return sec;
  }

  function injectBinData(hdr) {
    if (hdr.indexOf('<hh:binDataList') >= 0) return hdr;
    return hdr.replace('<hh:refList>', '<hh:refList><hh:binDataList itemCnt="1"><hh:binData id="1" type="EMBEDDING"/></hh:binDataList>');
  }

  /* ── 막도장(사무원 이름 도장) = 두 번째 임베드 이미지(image2) ──
     타원 10×15mm, 템플릿 image1(서고은 직인) 옆에 image2 로 추가한다. */
  function nameSealRun(pxW, pxH, hoff, voff) {
    var oW = pxW * 75, oH = pxH * 75, W = 2835, H = 4252, id = ++_sealId;   // 10mm×15mm
    // 실제 크기 = orgSz × scaMatrix. 원본 해상도와 무관하게 10×15mm(curSz)로 찍히도록 배율을 curSz/orgSz 로 준다.
    var sx = (W / oW).toFixed(6), sy = (H / oH).toFixed(6);
    return '<hp:run charPrIDRef="0"><hp:pic id="' + id + '" zOrder="21" numberingType="PICTURE" textWrap="IN_FRONT_OF_TEXT" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="' + id + '" reverse="0">' +
      '<hp:offset x="0" y="0"/><hp:orgSz width="' + oW + '" height="' + oH + '"/><hp:curSz width="' + W + '" height="' + H + '"/>' +
      '<hp:flip horizontal="0" vertical="0"/><hp:rotationInfo angle="0"/>' +
      '<hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="' + sx + '" e2="0" e3="0" e4="0" e5="' + sy + '" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>' +
      '<hc:img binaryItemIDRef="image2" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>' +
      '<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="' + oW + '" y="0"/><hc:pt2 x="' + oW + '" y="' + oH + '"/><hc:pt3 x="0" y="' + oH + '"/></hp:imgRect>' +
      '<hp:imgClip left="0" right="' + oW + '" top="0" bottom="' + oH + '"/><hp:inMargin left="0" right="0" top="0" bottom="0"/>' +
      '<hp:sz width="' + W + '" widthRelTo="ABSOLUTE" height="' + H + '" heightRelTo="ABSOLUTE" protect="0"/>' +
      '<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="0" allowOverlap="1" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="RIGHT" vertOffset="' + voff + '" horzOffset="' + hoff + '"/>' +
      '<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:shapeComment/></hp:pic></hp:run>';
  }
  function addNameSeal(sec, anchor, hoff, voff, wh) {
    var paras = sec.match(PARA_RE) || [], want = normalize(anchor), run = nameSealRun(wh[0], wh[1], hoff, voff);
    for (var i = 0; i < paras.length; i++) {
      if (normalize(paras[i]).indexOf(want) >= 0) return sec.replace(paras[i], paras[i].replace(/^(<hp:p\b[^>]*>)/, '$1' + run));
    }
    return sec;
  }
  // header binDataList 에 image2(id=2) 추가(기존 itemCnt 증가). 없으면 새로 만든다.
  function injectBinData2(hdr) {
    if (/<hh:binData\b[^>]*id="2"/.test(hdr)) return hdr;
    if (hdr.indexOf('<hh:binDataList') >= 0) {
      return hdr.replace(/<hh:binDataList itemCnt="(\d+)">([\s\S]*?)<\/hh:binDataList>/, function (m, cnt, inner) {
        return '<hh:binDataList itemCnt="' + (parseInt(cnt, 10) + 1) + '">' + inner + '<hh:binData id="2" type="EMBEDDING"/></hh:binDataList>';
      });
    }
    return hdr.replace('<hh:refList>', '<hh:refList><hh:binDataList itemCnt="1"><hh:binData id="2" type="EMBEDDING"/></hh:binDataList>');
  }
  function injectHpfManifest2(hpf) {
    if (hpf.indexOf('BinData/image2.png') >= 0) return hpf;
    return hpf.replace('<opf:manifest>', '<opf:manifest><opf:item id="image2" href="BinData/image2.png" media-type="image/png" isEmbeded="1"/>');
  }
  function injectOdfManifest2(s) {
    if (s.indexOf('BinData/image2.png') >= 0) return s;
    var entry = '<odf:file-entry odf:full-path="BinData/image2.png" odf:media-type="image/png"/>';
    if (s.indexOf('</odf:manifest>') >= 0) return s.replace('</odf:manifest>', entry + '</odf:manifest>');
    return s.replace(/<odf:manifest([^>]*)\/>/, '<odf:manifest$1>' + entry + '</odf:manifest>');
  }

  /* ── 다중 막도장(image2, image3, …) — 위임인마다 각자 이름 도장(민가사 소송위임장) ──
     imgRef 를 파라미터화한 것 외에는 nameSealRun/addNameSeal/injectBinData2 와 동일 규칙 */
  function nameSealRunId(imgRef, pxW, pxH, hoff, voff) {
    var oW = pxW * 75, oH = pxH * 75, W = 2835, H = 4252, id = ++_sealId;   // 10mm×15mm
    var sx = (W / oW).toFixed(6), sy = (H / oH).toFixed(6);
    return '<hp:run charPrIDRef="0"><hp:pic id="' + id + '" zOrder="21" numberingType="PICTURE" textWrap="IN_FRONT_OF_TEXT" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="' + id + '" reverse="0">' +
      '<hp:offset x="0" y="0"/><hp:orgSz width="' + oW + '" height="' + oH + '"/><hp:curSz width="' + W + '" height="' + H + '"/>' +
      '<hp:flip horizontal="0" vertical="0"/><hp:rotationInfo angle="0"/>' +
      '<hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="' + sx + '" e2="0" e3="0" e4="0" e5="' + sy + '" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>' +
      '<hc:img binaryItemIDRef="' + imgRef + '" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>' +
      '<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="' + oW + '" y="0"/><hc:pt2 x="' + oW + '" y="' + oH + '"/><hc:pt3 x="0" y="' + oH + '"/></hp:imgRect>' +
      '<hp:imgClip left="0" right="' + oW + '" top="0" bottom="' + oH + '"/><hp:inMargin left="0" right="0" top="0" bottom="0"/>' +
      '<hp:sz width="' + W + '" widthRelTo="ABSOLUTE" height="' + H + '" heightRelTo="ABSOLUTE" protect="0"/>' +
      '<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="0" allowOverlap="1" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="' + voff + '" horzOffset="' + hoff + '"/>' +
      '<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:shapeComment/></hp:pic></hp:run>';
  }
  function addNameSealId(sec, imgRef, anchor, hoff, voff, wh) {
    var paras = sec.match(PARA_RE) || [], want = normalize(anchor), run = nameSealRunId(imgRef, wh[0], wh[1], hoff, voff);
    for (var i = 0; i < paras.length; i++) {
      if (want && normalize(paras[i]).indexOf(want) >= 0) return sec.replace(paras[i], paras[i].replace(/^(<hp:p\b[^>]*>)/, '$1' + run));
    }
    return sec;
  }
  function injectBinDataId(hdr, id) {
    if (new RegExp('<hh:binData\\b[^>]*id="' + id + '"').test(hdr)) return hdr;
    if (hdr.indexOf('<hh:binDataList') >= 0) {
      return hdr.replace(/<hh:binDataList itemCnt="(\d+)">([\s\S]*?)<\/hh:binDataList>/, function (m, cnt, inner) {
        return '<hh:binDataList itemCnt="' + (parseInt(cnt, 10) + 1) + '">' + inner + '<hh:binData id="' + id + '" type="EMBEDDING"/></hh:binDataList>';
      });
    }
    return hdr.replace('<hh:refList>', '<hh:refList><hh:binDataList itemCnt="1"><hh:binData id="' + id + '" type="EMBEDDING"/></hh:binDataList>');
  }
  function injectHpfManifestId(hpf, id) {
    if (hpf.indexOf('BinData/image' + id + '.png') >= 0) return hpf;
    return hpf.replace('<opf:manifest>', '<opf:manifest><opf:item id="image' + id + '" href="BinData/image' + id + '.png" media-type="image/png" isEmbeded="1"/>');
  }
  function injectOdfManifestId(s, id) {
    if (s.indexOf('BinData/image' + id + '.png') >= 0) return s;
    var entry = '<odf:file-entry odf:full-path="BinData/image' + id + '.png" odf:media-type="image/png"/>';
    if (s.indexOf('</odf:manifest>') >= 0) return s.replace('</odf:manifest>', entry + '</odf:manifest>');
    return s.replace(/<odf:manifest([^>]*)\/>/, '<odf:manifest$1>' + entry + '</odf:manifest>');
  }

  function injectHpfManifest(hpf) {
    if (hpf.indexOf('BinData/image1.png') >= 0) return hpf;
    return hpf.replace('<opf:manifest>', '<opf:manifest><opf:item id="image1" href="BinData/image1.png" media-type="image/png" isEmbeded="1"/>');
  }
  function injectOdfManifest(s) {
    if (s.indexOf('BinData/image1.png') >= 0) return s;
    var entry = '<odf:file-entry odf:full-path="BinData/image1.png" odf:media-type="image/png"/>';
    if (s.indexOf('</odf:manifest>') >= 0) return s.replace('</odf:manifest>', entry + '</odf:manifest>');
    return s.replace(/<odf:manifest([^>]*)\/>/, '<odf:manifest$1>' + entry + '</odf:manifest>');
  }

  function build(opts) {
    var wantSeal = !!opts.sealDataUrl && !!opts.sealAnchor;
    var off = opts.sealOffset || {};
    var hoff = off.h == null ? 700 : off.h, voff = off.v == null ? -1150 : off.v;
    var Zip;
    return loadJSZip()
      .then(function (JSZip) { Zip = JSZip; return fetch(opts.url); })
      .then(function (r) { if (!r.ok) throw new Error('템플릿 로드 실패: ' + opts.url); return r.arrayBuffer(); })
      .then(function (buf) { return Zip.loadAsync(buf); })
      .then(function (zip) {
        return Promise.all([
          zip.file('Contents/section0.xml').async('string'),
          zip.file('Contents/header.xml').async('string'),
          zip.file('mimetype').async('uint8array'),
          (wantSeal || (opts.nameSeal && opts.nameSeal.dataUrl) || (opts.nameSeals && opts.nameSeals.length)) ? zip.file('Contents/content.hpf').async('string') : Promise.resolve(null),
          zip
        ]);
      })
      .then(function (arr) {
        var ctx = {
          section: arr[0],
          esc: xmlEsc,
          replace: function (a, b) { if (a != null) ctx.section = ctx.section.split(a).join(b == null ? '' : b); return ctx; },
          replaceOnce: function (a, b) { if (a != null) { var i = ctx.section.indexOf(a); if (i >= 0) ctx.section = ctx.section.slice(0, i) + (b == null ? '' : b) + ctx.section.slice(i + a.length); } return ctx; },
          // 템플릿에 이미 박힌 도장(image1) 제거 — 도장 끄기/서고은 외 변호사
          stripSeal: function () { ctx.section = stripBakedSeals(ctx.section); return ctx; },
          // 도장 추가(템플릿 image1 재사용) — anchor 문단 위에 겹침. off={h,v}
          addSeal: function (anchor, off) { off = off || {}; ctx.section = addBakedSeal(ctx.section, anchor, off.h == null ? 5650 : off.h, off.v == null ? -1150 : off.v); return ctx; }
        };
        opts.fill(ctx);

        var sec = ctx.section, hdr = arr[1], mime = arr[2], hpf = arr[3], zip = arr[4], sealBin = null, nameBin = null;
        // header.xml 후처리(문단모양 등 주입) — 민가사가 좌측정렬 컴팩트 paraPr 추가에 사용
        if (typeof opts.onHeader === 'function') { var h2 = opts.onHeader(hdr); if (h2) hdr = h2; }
        // ① 서고은 직인(image1) 코드 삽입 경로(sealDataUrl 넘긴 경우 — 항소/상고 등)
        if (wantSeal) {
          var u8 = dataUrlToU8(opts.sealDataUrl), wh = pngSize(u8);
          var sec2 = injectSealPic(sec, buildPic(wh[0], wh[1], hoff, voff), opts.sealAnchor);
          if (sec2 !== sec) { sec = sec2; hdr = injectBinData(hdr); hpf = injectHpfManifest(hpf); sealBin = u8; }
        }
        // ② 막도장(사무원 이름 도장, image2) — 검찰 위임장/서약서
        if (opts.nameSeal && opts.nameSeal.dataUrl) {
          var ns = opts.nameSeal, nsu8 = dataUrlToU8(ns.dataUrl), nswh = pngSize(nsu8), nso = ns.off || {};
          var sec3 = addNameSeal(sec, ns.anchor, nso.h == null ? 2835 : nso.h, nso.v == null ? -2200 : nso.v, nswh);
          if (sec3 !== sec) { sec = sec3; hdr = injectBinData2(hdr); hpf = injectHpfManifest2(hpf); nameBin = nsu8; }
        }
        // ③ 다중 막도장(image2, image3, …) — 민가사 소송위임장 위임인별 도장
        var nameBins = [];
        if (opts.nameSeals && opts.nameSeals.length) {
          opts.nameSeals.forEach(function (nsi, idx) {
            if (!nsi || !nsi.dataUrl) return;
            var id = 2 + idx, ref = 'image' + id;
            var u8 = dataUrlToU8(nsi.dataUrl), wh = nsi.wh || pngSize(u8), o = nsi.off || {};
            var secN = addNameSealId(sec, ref, nsi.anchor, o.h == null ? 1000 : o.h, o.v == null ? -1100 : o.v, wh);
            if (secN !== sec) { sec = secN; hdr = injectBinDataId(hdr, id); hpf = injectHpfManifestId(hpf, id); nameBins.push({ id: id, u8: u8 }); }
          });
        }
        var zo = new Zip();
        zo.file('mimetype', mime, { compression: 'STORE' });
        var names = Object.keys(zip.files).filter(function (n) { return n !== 'mimetype' && !zip.files[n].dir; });
        return Promise.all(names.map(function (n) {
          if (n === 'Contents/section0.xml') return Promise.resolve([n, sec]);
          if (n === 'Contents/header.xml') return Promise.resolve([n, hdr]);
          if (n === 'Contents/content.hpf' && (sealBin || nameBin || nameBins.length)) return Promise.resolve([n, hpf]);
          if (n === 'META-INF/manifest.xml' && (sealBin || nameBin || nameBins.length)) return zip.file(n).async('string').then(function (s) {
            if (sealBin) s = injectOdfManifest(s);
            if (nameBin) s = injectOdfManifest2(s);
            nameBins.forEach(function (nb) { s = injectOdfManifestId(s, nb.id); });
            return [n, s];
          });
          return zip.file(n).async('uint8array').then(function (d) { return [n, d]; });
        })).then(function (entries) {
          entries.forEach(function (e) { zo.file(e[0], e[1]); });
          if (sealBin) zo.file('BinData/image1.png', sealBin);
          if (nameBin) zo.file('BinData/image2.png', nameBin);
          nameBins.forEach(function (nb) { zo.file('BinData/image' + nb.id + '.png', nb.u8); });
          return zo.generateAsync({ type: 'blob', mimeType: 'application/hwp+zip' });
        });
      });
  }

  // 파일명 정리(공용)
  function safeName(parts) {
    return parts.filter(Boolean).join('_').replace(/[\/\\:*?"<>|\n\r]+/g, ' ').replace(/\s+/g, ' ').trim() + '.hwpx';
  }
  // Blob 즉시 다운로드(공용)
  function saveBlob(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // 의뢰인 이름에서 '(국선 …)' 주석 제거 — 서면엔 이름만
  function cleanName(s) { return String(s == null ? '' : s).replace(/\s*\(국선[^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim(); }

  window.HWPXFill = { build: build, esc: xmlEsc, safeName: safeName, saveBlob: saveBlob, cleanName: cleanName, loadJSZip: loadJSZip };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { xmlEsc: xmlEsc, normalize: normalize, safeName: safeName };
  }
})();
