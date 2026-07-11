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
    return '<hp:run charPrIDRef="0">' +
      '<hp:pic reverse="0" isBWModeOnly="0" id="1932510121" zOrder="20" numberingType="PICTURE" textWrap="IN_FRONT_OF_TEXT" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="1932510121">' +
      '<hp:offset x="0" y="0"/>' +
      '<hp:orgSz width="' + oW + '" height="' + oH + '"/>' +
      '<hp:curSz width="' + SEAL_HU + '" height="' + SEAL_HU + '"/>' +
      '<hp:flip horizontal="0" vertical="0"/>' +
      '<hp:rotationInfo angle="0" centerX="' + half + '" centerY="' + half + '" rotateimage="1"/>' +
      '<hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>' +
      '<hc:img binaryItemIDRef="image1" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>' +
      '<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="' + SEAL_HU + '" y="0"/><hc:pt2 x="' + SEAL_HU + '" y="' + SEAL_HU + '"/><hc:pt3 x="0" y="' + SEAL_HU + '"/></hp:imgRect>' +
      '<hp:imgClip left="0" right="' + oW + '" top="0" bottom="' + oH + '"/>' +
      '<hp:inMargin left="0" right="0" top="0" bottom="0"/>' +
      '<hp:imgDim dimwidth="' + oW + '" dimheight="' + oH + '"/>' +
      '<hp:sz width="' + SEAL_HU + '" widthRelTo="ABSOLUTE" height="' + SEAL_HU + '" heightRelTo="ABSOLUTE" protect="0"/>' +
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
  function injectBinData(hdr) {
    if (hdr.indexOf('<hh:binDataList') >= 0) return hdr;
    return hdr.replace('<hh:refList>', '<hh:refList><hh:binDataList itemCnt="1"><hh:binData id="1" type="EMBEDDING"/></hh:binDataList>');
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
          wantSeal ? zip.file('Contents/content.hpf').async('string') : Promise.resolve(null),
          zip
        ]);
      })
      .then(function (arr) {
        var ctx = {
          section: arr[0],
          esc: xmlEsc,
          replace: function (a, b) { if (a != null) ctx.section = ctx.section.split(a).join(b == null ? '' : b); return ctx; },
          replaceOnce: function (a, b) { if (a != null) { var i = ctx.section.indexOf(a); if (i >= 0) ctx.section = ctx.section.slice(0, i) + (b == null ? '' : b) + ctx.section.slice(i + a.length); } return ctx; }
        };
        opts.fill(ctx);

        var sec = ctx.section, hdr = arr[1], mime = arr[2], hpf = arr[3], zip = arr[4], sealBin = null;
        if (wantSeal) {
          var u8 = dataUrlToU8(opts.sealDataUrl), wh = pngSize(u8);
          var sec2 = injectSealPic(sec, buildPic(wh[0], wh[1], hoff, voff), opts.sealAnchor);
          if (sec2 !== sec) { sec = sec2; hdr = injectBinData(hdr); hpf = injectHpfManifest(hpf); sealBin = u8; }
        }
        var zo = new Zip();
        zo.file('mimetype', mime, { compression: 'STORE' });
        var names = Object.keys(zip.files).filter(function (n) { return n !== 'mimetype' && !zip.files[n].dir; });
        return Promise.all(names.map(function (n) {
          if (n === 'Contents/section0.xml') return Promise.resolve([n, sec]);
          if (n === 'Contents/header.xml') return Promise.resolve([n, hdr]);
          if (n === 'Contents/content.hpf' && sealBin) return Promise.resolve([n, hpf]);
          if (n === 'META-INF/manifest.xml' && sealBin) return zip.file(n).async('string').then(function (s) { return [n, injectOdfManifest(s)]; });
          return zip.file(n).async('uint8array').then(function (d) { return [n, d]; });
        })).then(function (entries) {
          entries.forEach(function (e) { zo.file(e[0], e[1]); });
          if (sealBin) zo.file('BinData/image1.png', sealBin);
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

  window.HWPXFill = { build: build, esc: xmlEsc, safeName: safeName, saveBlob: saveBlob, loadJSZip: loadJSZip };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { xmlEsc: xmlEsc, normalize: normalize, safeName: safeName };
  }
})();
