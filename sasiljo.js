/* 법무법인 정서 PWA - 사실조회신청서(통신사) (sasiljo.js)
   ───────────────────────────────────────────────────────────────
   독립 모듈. index.html 에는 <script src="sasiljo.js"> 만 둔다.
   화면(입력폼)·전용 CSS 는 이 파일이 <body>에 1회 주입한다.

   흐름(합의서·참고자료와 동일한 단일 단계):
     goSasiljo() → [데이터 입력 폼(자동입력·통신사 선택)] → [한글 다운로드]
     · 한글 다운로드 = templates/sasiljo.hwpx 를 JSZip 으로 채워 다운로드

   핵심 기능(요구사항):
     · 촉탁기관 = 이동통신 3사 우선 + 알뜰폰(이용자 많은 순) 선택
     · 선택한 통신사마다 표의 2행(법인명·대표이사 / 주소)이 가·나·다… 로 자동 증식
     · 대표이사·법인명·주소는 화면에서 편집 가능(변호사 최종확인 전제, 신뢰도 낮으면 '검증 필요')
     · '조회의 목적'·'조회할 사항' 본문은 수정 입력 가능
     · 상단 사건 자동완성(사건번호·당사자 자동 채움)

   의존: initAutofillFor(autofill.js) · JU(util.js) · FSDoc(fsdoc.js) · JSZip(CDN)
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var TPL = './templates/sasiljo.hwpx';
  // 템플릿(업로드 샘플)의 법원 문구 — 다운로드 시 사용자 입력 법원으로 치환
  var TPL_COURT = '인천지방법원 제14형사부(나)';

  /* ══════════ 통신사 데이터 ══════════
     conf: high | medium | low  (low·medium 은 '검증 필요' 배지)
     주의: 대표이사·주소는 시점에 따라 변동 → 화면에서 편집 가능, 제출 전 변호사 확인.
     3사(major)는 항상 상단·기본선택, 알뜰폰은 rank(이용자 많은 순) 오름차순. */
  var CARRIERS = [
    { brand: 'SK텔레콤', corp: '에스케이텔레콤 주식회사', ceo: '정재헌', addr: '서울특별시 중구 을지로 65 (을지로2가)', net: ['SKT'], major: true, conf: 'high' },
    { brand: 'KT', corp: '주식회사 케이티', ceo: '박윤영', addr: '경기도 성남시 분당구 불정로 90 (정자동)', net: ['KT'], major: true, conf: 'high' },
    { brand: 'LG유플러스', corp: '주식회사 엘지유플러스', ceo: '홍범식', addr: '서울특별시 용산구 한강대로 32 (한강로3가)', net: ['LGU+'], major: true, conf: 'high' },

    // ── 알뜰폰(이용자 많은 순, 과기정통부 2026-03 목록 기준) ──
    { brand: 'KT M모바일', corp: '주식회사 케이티엠모바일', ceo: '김의현', addr: '서울특별시 강남구 테헤란로 422 (대치동)', net: ['KT'], conf: 'high' },
    { brand: 'U+유모바일', corp: '주식회사 미디어로그', ceo: '송대원', addr: '서울특별시 마포구 월드컵북로56길 19 (상암동, 드림타워)', net: ['LGU+'], conf: 'high' },
    { brand: 'SK세븐모바일', corp: '에스케이텔링크 주식회사', ceo: '최영찬', addr: '서울특별시 마포구 마포대로 144 (공덕동, 마포T타운)', net: ['SKT'], conf: 'high' },
    { brand: '헬로모바일', corp: '주식회사 엘지헬로비전', ceo: '송구영', addr: '경기도 고양시 덕양구 동송로 30, 17층 (동산동, MBN미디어센터)', net: ['KT', 'LGU+', 'SKT'], conf: 'high' },
    { brand: '프리티', corp: '주식회사 프리텔레콤', ceo: '이석환', addr: '서울특별시 성동구 성수이로22길 37, 7층 (성수동2가)', net: ['KT', 'LGU+'], conf: 'medium' },
    { brand: '모빙', corp: '주식회사 유니컴즈', ceo: '한송희', addr: '경기도 군포시 엘에스로166번길 8', net: ['SKT', 'KT', 'LGU+'], conf: 'medium' },
    { brand: 'KB리브모바일', corp: '주식회사 케이비국민은행', ceo: '이환주', addr: '서울특별시 영등포구 국제금융로8길 26 (여의도동)', net: ['LGU+', 'KT'], conf: 'high' },
    { brand: '아이즈모바일', corp: '주식회사 아이즈비전', ceo: '안필성', addr: '서울특별시 강남구 강남대로 556, 17층', net: ['SKT', 'KT', 'LGU+'], conf: 'high' },
    { brand: '이야기모바일', corp: '주식회사 큰사람커넥트', ceo: '김병노', addr: '서울특별시 구로구 디지털로26길 61, 1303호 (구로동, 에이스하이엔드타워2차)', net: ['SKT', 'KT', 'LGU+'], conf: 'medium' },
    { brand: 'A모바일', corp: '주식회사 에넥스텔레콤', ceo: '문성광', addr: '서울특별시 강남구 학동로 122 (논현동, 백석빌딩)', net: ['SKT', 'KT'], conf: 'medium' },
    { brand: '토스모바일', corp: '토스모바일 주식회사', ceo: '이승훈', addr: '서울특별시 금천구 가산디지털1로 145, 에이스하이엔드타워 3차 19층 1904호', net: ['SKT'], conf: 'high' },
    { brand: '스노우맨', corp: '세종텔레콤 주식회사', ceo: '이상철', addr: '경기도 과천시 과천대로7길 12 (갈현동)', net: ['KT', 'SKT'], conf: 'high' },
    { brand: '티플러스', corp: '주식회사 한국케이블텔레콤', ceo: '이재석', addr: '서울특별시 중구 세종대로 50, 7층 (남대문로4가, 흥국생명빌딩)', net: ['KT', 'LGU+'], conf: 'high' },
    { brand: '스마텔', corp: '주식회사 스마텔', ceo: '고명수', addr: '경기도 하남시 미사강변중앙로7번안길 25, D동 1009호 (풍산동)', net: ['SKT', 'KT', 'LGU+'], conf: 'medium' },
    { brand: '핀다이렉트', corp: '주식회사 스테이지파이브', ceo: '서상원', addr: '서울특별시 송파구 올림픽로35길 123, 6층 (신천동, 향군타워)', net: ['KT'], conf: 'medium' },
    { brand: 'WELL(위너스텔)', corp: '주식회사 위너스텔', ceo: '서준', addr: '서울특별시 금천구 디지털로 121, 1303호 (가산동, 에이스가산타워)', net: ['KT'], conf: 'high' },
    { brand: '스카이라이프모바일', corp: '주식회사 케이티스카이라이프', ceo: '최영범', addr: '서울특별시 마포구 매봉산로 75 (상암동, DDMC빌딩) 8,9층', net: ['KT'], conf: 'high' },
    { brand: '밸류컴(valuecomm)', corp: '한국피엠오 주식회사', ceo: '어수균', addr: '서울특별시 송파구 법원로 128, A1109,A1110호', net: ['KT', 'LGU+'], conf: 'high' },
    { brand: '이지모바일', corp: '주식회사 코드모바일', ceo: '김성환', addr: '서울특별시 성동구 성수이로 51, 5층 504호', net: ['KT', 'LGU+'], conf: 'medium' },
    { brand: '아시아모바일', corp: '주식회사 에이프러스', ceo: '신광섭', addr: '경기도 고양시 덕양구 충장로 2, 409-1호 (행신동, 센트럴빌딩)', net: ['KT', 'LGU+'], conf: 'high' },
    { brand: '앤텔레콤', corp: '주식회사 앤알커뮤니케이션', ceo: '성호종', addr: '서울특별시 강남구 테헤란로7길 8 (역삼동, 비와이씨생명보험빌딩)', net: ['KT', 'LGU+'], conf: 'high' },
    { brand: '인스코비', corp: '주식회사 인스코비', ceo: '유인수', addr: '서울특별시 성동구 성수이로22길 37, 7층 (성수동2가, 아크밸리)', net: ['SKT', 'KT', 'LGU+'], conf: 'medium' },
    { brand: '도시락모바일', corp: '주식회사 와이드모바일', ceo: '김만중', addr: '서울특별시 서대문구 통일로 135, 6층 (충정로2가, 충정빌딩)', net: ['LGU+'], conf: 'high' },
    { brand: '마블링', corp: '주식회사 마블프로듀스', ceo: '전현준', addr: '서울특별시 금천구 가산디지털2로 143, 어반워크Ⅱ 2001~2004호 (가산동)', net: ['LGU+'], conf: 'medium' },
    { brand: 'KG모바일', corp: '주식회사 케이지모빌리언스', ceo: '유승용', addr: '서울특별시 중구 통일로 92, 16층 (순화동, 케이지타워)', net: ['LGU+'], conf: 'high' },
    { brand: '코나모바일', corp: '코나아이 주식회사', ceo: '조정일', addr: '서울특별시 영등포구 은행로 3, 8층 (여의도동, 익스콘벤처타워)', net: ['LGU+'], conf: 'high' },
    { brand: '여유텔레콤/여유알뜰폰', corp: '주식회사 와이엘랜드', ceo: '김병주', addr: '경기도 성남시 분당구 판교역로 230, B동 903호 (삼평동, 삼환하이펙스)', net: ['KT', 'LGU+'], conf: 'high' },
    { brand: '원텔레콤', corp: '주식회사 원텔레콤', ceo: '박성규', addr: '서울특별시 영등포구 시흥대로 589-8', net: ['LGU+'], conf: 'high' },
    { brand: '파워텔(PTT)', corp: '아이디스파워텔 주식회사', ceo: '김영달', addr: '서울특별시 영등포구 국제금융로2길 36, 18~19층 (여의도동)', net: ['KT'], conf: 'high' },
    { brand: '안심모바일', corp: '에스원 주식회사', ceo: '정해린', addr: '서울특별시 중구 세종대로7길 25 (순화동, 삼성생명에스원빌딩)', net: ['SKT', 'KT', 'LGU+'], conf: 'high' },
    { brand: '서경모바일', corp: '주식회사 서경방송', ceo: '윤철지', addr: '경상남도 진주시 진양호로 532 (동성동, 삼광빌딩)', net: ['SKT', 'LGU+'], conf: 'medium' },
    { brand: '드림모바일', corp: '드림라인 주식회사', ceo: '한윤재', addr: '서울특별시 송파구 중대로 135 (가락동, 아이티벤처타워) 동관 9층', net: ['KT'], conf: 'medium' },
    { brand: 'M2모바일', corp: '주식회사 미니게이트', ceo: '정훈', addr: '서울특별시 강남구 학동로33길 27-1 (논현동)', net: ['KT'], conf: 'medium' },
    { brand: '아이플러스유(iplusu)', corp: '주식회사 더원플랫폼', ceo: '이도현', addr: '경기도 하남시 미사대로 540, B동 6층 620호 (덕풍동, 한강미사2차)', net: ['KT'], conf: 'high' },
    { brand: '니즈모바일', corp: '주식회사 니즈페이', ceo: '이남식', addr: '서울특별시 성동구 아차산로 17, 501호 (성수동1가, 서울숲엘타워)', net: ['KT'], conf: 'high' },
    { brand: '고고모바일', corp: '주식회사 고고팩토리', ceo: '이응준', addr: '서울특별시 강남구 학동로 137-7, 4층 (논현동)', net: ['KT'], conf: 'high' },
    { brand: '에르엘(RL)', corp: '주식회사 에르엘', ceo: '박대석', addr: '서울특별시 강남구 삼성로108길 8 (삼성동)', net: ['KT', 'LGU+'], conf: 'high' },
    { brand: '온국민폰', corp: '주식회사 레그원', ceo: '김미자', addr: '부산광역시 동구 조방로 39 (범일동, 썬오피스텔)', net: ['LGU+'], conf: 'medium' },
    { brand: '슈가모바일', corp: '주식회사 씨케이커뮤스트리', ceo: '최영태', addr: '서울특별시 송파구 올림픽로35가길 10, A동 411호 (신천동, 잠실더샵스타파크)', net: ['LGU+'], conf: 'high' },
    { brand: '핀샷', corp: '주식회사 핀샷', ceo: '박노현', addr: '서울특별시 마포구 성암로 330, C동 8층 811호 (상암동, DMC첨단산업센터)', net: ['KT', 'LGU+'], conf: 'medium' },
    { brand: '한패스모바일', corp: '주식회사 한패스인터내셔널', ceo: '오근희', addr: '서울특별시 성동구 아차산로 92, 4층 (성수동2가)', net: ['LGU+'], conf: 'high' },
    { brand: '인스코리아', corp: '주식회사 인스코리아', ceo: '안한식', addr: '경기도 안산시 단원구 광덕4로 234 (고잔동, 천혜로데오프라자)', net: ['LGU+'], conf: 'high' },
    { brand: '조이텔', corp: '주식회사 조이텔', ceo: '정민기', addr: '경기도 부천시 원미구 중동로254번길 78, 702호 (중동, 필타운)', net: ['SKT'], conf: 'high' },
    { brand: 'GME모바일', corp: '주식회사 글로벌머니익스프레스', ceo: '성종화', addr: '서울특별시 영등포구 영등포로 150, B동 9층 905~911호', net: ['LGU+'], conf: 'high' },
    { brand: '플래시모바일(FLASH)', corp: '니오라코리아 유한회사', ceo: '스티븐코비브라이트', addr: '서울특별시 송파구 백제고분로7길 53, 2층 (잠실동, AW TOWER)', net: ['LGU+'], conf: 'medium' },
    { brand: 'KCTV모바일', corp: '주식회사 케이씨티브이제주방송', ceo: '공성용,공대인', addr: '제주특별자치도 제주시 아연로 2 (연동)', net: ['SKT', 'LGU+'], conf: 'medium' },
    { brand: '우리WON모바일', corp: '주식회사 우리은행', ceo: '정진완', addr: '서울특별시 중구 소공로 51 (회현동1가)', net: [], conf: 'medium' },
    { brand: '시월모바일', corp: '주식회사 시월텔레콤', ceo: '안동현', addr: '서울특별시 강남구 테헤란로84길 14, 지어로빌딩 11층 (대치동)', net: ['LGU+'], conf: 'medium' },
    { brand: '스피츠모바일', corp: '스피츠모바일 주식회사', ceo: '박기산', addr: '서울특별시 종로구 경희궁1길 4 (신문로2가, 스피츠사옥)', net: ['KT'], conf: 'medium' },
    { brand: '친구모바일', corp: '주식회사 친구아이앤씨', ceo: '김광일', addr: '서울특별시 광진구 아차산로30길 31', net: ['KT', 'LGU+'], conf: 'high' },
    { brand: '찬스모바일', corp: '주식회사 찬스모바일', ceo: '박상준', addr: '서울특별시 중구 퇴계로 298, 2층 (쌍림동, 모리스빌딩)', net: ['LGU+'], conf: 'high' },
    { brand: '장성모바일', corp: '장성모바일한국 유한회사', ceo: 'ZHANG MENG(장맹)', addr: '서울특별시 금천구 서부샛길 606', net: [], conf: 'medium' },
    { brand: '토리모바일', corp: '주식회사 영진텔레콤', ceo: '정성훈', addr: '경기도 의왕시 오봉산단3로 25, 1동 623호 (삼동, 의왕테크노파크 더리브 비즈원)', net: [], conf: 'medium' },
    { brand: '퍼스트모바일', corp: '주식회사 더피엔엘', ceo: '김성용', addr: '서울특별시 성북구 장위로40다길 19, 3층', net: ['KT'], conf: 'high' }
  ];
  CARRIERS.forEach(function (c, i) { c.id = i; });

  /* ── 가·나·다… 라벨(항목 열거) 자동 생성 (한글 초성 14 × 중성 ㅏㅓㅗㅜㅡㅣ …) ── */
  var GANADA = (function () {
    var cho = [0, 2, 3, 5, 6, 7, 9, 11, 12, 14, 15, 16, 17, 18]; // ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ
    var jung = [0, 4, 8, 13, 18, 20];                            // ㅏㅓㅗㅜㅡㅣ
    var arr = [];
    for (var j = 0; j < jung.length; j++)
      for (var i = 0; i < cho.length; i++)
        arr.push(String.fromCharCode(0xAC00 + cho[i] * 588 + jung[j] * 28));
    return arr; // 84개 — 충분
  })();

  /* ══════════ 순수 유틸 ══════════ */
  function todayISO() { return (typeof JU !== 'undefined' && JU.todayISO) ? JU.todayISO() : new Date().toISOString().slice(0, 10); }
  function xmlEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function cleanCaseName(name) { return String(name || '').replace(/\[전자\]\s*/g, '').trim(); }
  function spaced(name) { return String(name || '').trim().split('').filter(function (ch) { return ch.trim(); }).join(' '); }
  function fmtDate(iso) {
    var m = String(iso || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    if (!m) return String(iso || '');
    return m[1] + '. ' + parseInt(m[2], 10) + '. ' + parseInt(m[3], 10) + '.';
  }
  function ymd(dateStr) {
    var m = String(dateStr || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    return m ? m[1] + ('0' + m[2]).slice(-2) + ('0' + m[3]).slice(-2) : '';
  }
  // 전화번호 자동 하이픈: 01012345678 → 010-1234-5678 (휴대폰·서울02·일반 지역번호 대응)
  function fmtPhone(v) {
    var d = String(v == null ? '' : v).replace(/[^0-9]/g, '');
    if (!d) return '';
    if (d[0] === '1' && d.length === 4) return d;                              // 대표번호(1588 등)
    if (d[0] === '1' && d.length === 8) return d.slice(0, 4) + '-' + d.slice(4);
    if (d.indexOf('02') === 0) {                                                // 서울
      if (d.length <= 2) return d;
      if (d.length <= 5) return d.slice(0, 2) + '-' + d.slice(2);
      if (d.length <= 9) return d.slice(0, 2) + '-' + d.slice(2, d.length - 4) + '-' + d.slice(d.length - 4);
      return d.slice(0, 2) + '-' + d.slice(2, 6) + '-' + d.slice(6, 10);
    }
    // 010 등 휴대폰 / 그 외 지역번호(3자리 국번)
    if (d.length <= 3) return d;
    if (d.length <= 7) return d.slice(0, 3) + '-' + d.slice(3);
    if (d.length <= 10) return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);      // 10자리
    return d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7, 11);                       // 11자리
  }
  // 생년월일 자동 포맷: 19891123 → 1989. 11. 23. (문서 표기와 동일)
  function fmtBirth(v) {
    var d = String(v == null ? '' : v).replace(/[^0-9]/g, '').slice(0, 8);
    if (d.length <= 4) return d;
    if (d.length <= 6) return d.slice(0, 4) + '. ' + d.slice(4);
    return d.slice(0, 4) + '. ' + d.slice(4, 6) + '. ' + d.slice(6, 8) + '.';
  }
  // 대리인 표시: 형사(피고인·피의자)→변호인, 그 외(민사 등)→소송대리인
  function deriveAgent(jiwi) { return (jiwi === '피고인' || jiwi === '피의자') ? '변호인' : '소송대리인'; }
  function lastHangul(str) {
    str = String(str || '');
    for (var i = str.length - 1; i >= 0; i--) { var c = str.charCodeAt(i); if (c >= 0xAC00 && c <= 0xD7A3) return c; }
    return 0;
  }
  function hasBatchim(str) { var c = lastHangul(str); return c ? ((c - 0xAC00) % 28) !== 0 : false; }
  function eunNeun(str) { return hasBatchim(str) ? '은' : '는'; }

  /* ══════════ HWPX 문단 헬퍼 ══════════ */
  var PARA_RE = /<hp:p\b[\s\S]*?<\/hp:p>/g;
  function splitParas(sec) { return sec.match(PARA_RE) || []; }
  function plainText(p) {
    var t = '', re = /<hp:t>([\s\S]*?)<\/hp:t>/g, m;
    while ((m = re.exec(p))) t += m[1].replace(/<[^>]+>/g, '');
    return t;
  }
  function flat(p) { return plainText(p).replace(/\s+/g, ''); }
  // <hp:t> 안의 실제 텍스트(탭 등 태그 제거)
  function tInner(seg) { return seg.replace(/<\/?hp:t>/g, '').replace(/<[^>]+>/g, ''); }
  // 텍스트가 있는 '첫' <hp:t> 만 교체하고, 뒤따르는 텍스트 <hp:t> 는 비움(중복 방지).
  //  · 정렬용 탭만 든 빈 <hp:t>(예: 날짜·담당변호사 문단의 선행 탭 런)는 그대로 보존해 위치 유지.
  function setFirstT(p, txt) {
    if (!/<hp:t>[\s\S]*?<\/hp:t>/.test(p)) {
      return p.replace(/(<hp:run\b[^>]*)\/>/, '$1><hp:t>' + xmlEsc(txt) + '</hp:t></hp:run>')
              .replace(/(<hp:run\b[^>]*>)(?!<hp:t)/, '$1<hp:t>' + xmlEsc(txt) + '</hp:t>');
    }
    var done = false, hitText = false;
    var res = p.replace(/<hp:t>([\s\S]*?)<\/hp:t>/g, function (seg, inner) {
      if (tInner(seg).trim()) {
        hitText = true;
        if (!done) {
          done = true;
          // 텍스트 앞의 정렬용 탭(<hp:tab/>)은 그대로 살려 위치 보존
          var lead = (inner.match(/^(?:<hp:tab\b[^>]*\/>)*/) || [''])[0];
          return '<hp:t>' + lead + xmlEsc(txt) + '</hp:t>';
        }
        return '<hp:t></hp:t>';
      }
      return seg; // 빈/탭 <hp:t> 유지
    });
    if (hitText) return res;
    // 텍스트 런이 하나도 없으면 첫 <hp:t> 교체
    return p.replace(/<hp:t>[\s\S]*?<\/hp:t>/, '<hp:t>' + xmlEsc(txt) + '</hp:t>');
  }
  // n번째 <hp:t> 교체(0-base)
  function setNthT(p, n, txt) {
    var i = -1;
    return p.replace(/<hp:t>[\s\S]*?<\/hp:t>/g, function (mm) { i++; return i === n ? '<hp:t>' + xmlEsc(txt) + '</hp:t>' : mm; });
  }
  function isBlankPara(p) { return !plainText(p).trim(); }

  /* ══════════ 촉탁기관 표 생성 ══════════
     템플릿 표: 통신사당 2행(라벨/법인명 · 빈칸/주소). rowAddr 0.. 순차, rowCnt = 2×N.
     선택 통신사 수만큼 tr 쌍을 복제해 텍스트·rowAddr 치환. */
  function buildTable(tblXml, items) {
    var head = tblXml.slice(0, tblXml.indexOf('<hp:tr>'));
    var trs = tblXml.match(/<hp:tr>[\s\S]*?<\/hp:tr>/g) || [];
    var nameShell = trs[0], addrShell = trs[1];
    if (!nameShell || !addrShell) return tblXml; // 방어
    var rows = '';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var corpLine = it.corp + ' 대표이사' + (it.ceo ? ' ' + it.ceo : '');
      var nr = nameShell;
      nr = setNthT(nr, 0, (GANADA[i] || (i + 1)) + '.');
      nr = setNthT(nr, 1, corpLine);
      nr = nr.replace(/rowAddr="\d+"/g, 'rowAddr="' + (2 * i) + '"');
      var ar = addrShell;
      ar = setNthT(ar, 0, it.addr || '');      // 주소행엔 <hp:t> 가 주소셀 하나뿐(라벨셀은 빈 run)
      ar = ar.replace(/rowAddr="\d+"/g, 'rowAddr="' + (2 * i + 1) + '"');
      rows += nr + ar;
    }
    var rowCnt = 2 * items.length;
    var newHead = head
      .replace(/rowCnt="\d+"/, 'rowCnt="' + rowCnt + '"')
      .replace(/(<hp:sz\b[^>]*\bheight=")\d+(")/, '$1' + (2254 * rowCnt) + '$2');
    return newHead + rows + '</hp:tbl>';
  }

  /* ── 본문 텍스트(여러 줄) → 문단들. 앞뒤·문단 사이 빈 문단으로 여백 ── */
  function parasFromText(textShell, blankShell, text, indent) {
    var lines = String(text == null ? '' : text).replace(/\r/g, '').split('\n');
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    var out = blankShell;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].trim()) {
        out += setFirstT(textShell, (indent ? ' ' : '') + lines[i].trim());
        if (i < lines.length - 1 && lines[i + 1].trim()) out += blankShell;
      } else {
        out += blankShell;
      }
    }
    out += blankShell;
    return out;
  }

  /* ── 한 영역(표 밖 최상위 문단들)을 재구성. head + 본문 + tail 보존.
     handler(p,f,raw,ctx) 반환: undefined=원문유지 · 문자열/배열=치환 · [] =삭제.
     ctx.skip(f) 를 세팅하면 그 술어가 참인 문단을 만날 때까지 이후 문단을 건너뜀(그 문단부터 다시 처리). ── */
  function rebuildParas(region, handler) {
    var P = splitParas(region);
    if (!P.length) return region;
    var head = region.slice(0, region.indexOf(P[0]));
    var lastEnd = region.lastIndexOf('</hp:p>') + 7;
    var tail = region.slice(lastEnd);
    var out = [], ctx = { skip: null };
    for (var i = 0; i < P.length; i++) {
      var p = P[i], f = flat(p), raw = plainText(p);
      if (ctx.skip) { if (ctx.skip(f)) { ctx.skip = null; } else { continue; } }
      var r = handler(p, f, raw, ctx);
      if (r === undefined || r === null) out.push(p);
      else if (Array.isArray(r)) { for (var k = 0; k < r.length; k++) out.push(r[k]); }
      else out.push(r);
    }
    return head + out.join('') + tail;
  }

  /* ══════════ 문서 채우기 ══════════ */
  function fillDoc(sec, c) {
    // 0) 법원 이름을 감싼 필드(주석 '서면 제출 전 반드시 확인') 제거 → 평문화(중첩 <hp:p> 로 인한 파싱 오류 방지)
    sec = sec.replace(/<hp:ctrl><hp:fieldBegin[\s\S]*?<\/hp:fieldBegin><\/hp:ctrl>/g, '')
             .replace(/<hp:ctrl><hp:fieldEnd[\s\S]*?<\/hp:ctrl>/g, '');

    // 1) 표 분리
    var tblMatch = sec.match(/<hp:tbl[\s\S]*?<\/hp:tbl>/);
    var pre = sec, tbl = '', post = '';
    if (tblMatch) {
      var idx = sec.indexOf(tblMatch[0]);
      pre = sec.slice(0, idx); tbl = tblMatch[0]; post = sec.slice(idx + tbl.length);
    }

    var jiwiSp = spaced(c.jiwi), agent = c.agent || '변호인';
    var partyWords = ['피고인', '피의자', '원고', '피고', '신청인', '채권자', '채무자', '항고인', '피항고인'];
    function isPartyLabel(f) { for (var i = 0; i < partyWords.length; i++) if (f.indexOf(partyWords[i]) === 0) return true; return false; }
    function isPurposeHdr(f) { return f.indexOf('3.조회의목적') === 0 || f === '조회의목적'; }
    function isQueryHdr(f) { return f.indexOf('4.조회할사항') === 0 || f === '조회할사항'; }
    function isDate(f) { return /^\d{4}\.\d{1,2}\.\d{1,2}\.?$/.test(f); }

    // 2) 표 앞부분: 사건 · 당사자 · 도입문  (여긴 목적/사항 본문이 없어 '신청인' 오인 없음)
    pre = rebuildParas(pre, function (p, f, raw) {
      if (f.indexOf('사건') === 0 && f.indexOf('사실') !== 0) {
        var m = raw.match(/^([\s\S]*?건)\s*/); var label = m ? m[1] : '사    건';
        return setFirstT(p, label + '    ' + c.caseLine);
      }
      if (isPartyLabel(f)) return setFirstT(p, jiwiSp + '    ' + spaced(c.party));
      if (f.indexOf('위사건에관하여') === 0) return setFirstT(p, '위 사건에 관하여 ' + c.jiwi + '의 ' + agent + eunNeun(agent) + ' 다음과 같이 사실조회촉탁을 신청합니다.');
      return undefined;
    });

    // 3) 표 본체 재생성
    if (tbl) tbl = buildTable(tbl, c.items);

    // 4) 표 뒷부분: 인적사항 · 목적 · 사항 · 날짜 · 변호인 · 담당변호사 · 법원
    var phoneLabel = c.pastPhone ? '(과거) 연락처' : '연락처';
    // 본문/빈 문단 껍데기(목적·사항 생성용)
    var bodyShell = null, blankShell = null;
    splitParas(post).forEach(function (p) {
      var f = flat(p);
      if (!bodyShell && (f.indexOf('신청인') === 0 || f.indexOf('위조회할') === 0)) bodyShell = p;
      if (!blankShell && !plainText(p).trim()) blankShell = p;
    });
    if (!bodyShell) bodyShell = blankShell;
    if (!blankShell) blankShell = bodyShell;

    post = rebuildParas(post, function (p, f, raw, ctx) {
      if (f.indexOf('성명:') === 0) return setFirstT(p, '성 명 : ' + c.name);
      if (f.indexOf('생년월일:') === 0) return setFirstT(p, '생년월일 : ' + c.birth);
      if (f.indexOf('연락처') >= 0 && f.indexOf(':') >= 0 && f.indexOf('위조회할') !== 0) return setFirstT(p, phoneLabel + ' : ' + c.phone);
      if (isPurposeHdr(f)) { ctx.skip = isQueryHdr; return [p, parasFromText(bodyShell, blankShell, c.purpose, true)]; }
      if (isQueryHdr(f)) { ctx.skip = isDate; return [p, parasFromText(bodyShell, blankShell, c.query, true) + blankShell + blankShell + blankShell + blankShell]; }
      if (isDate(f)) { var lead = (raw.match(/^\s*/) || [''])[0]; return setFirstT(p, lead + fmtDate(c.dateISO)); }
      if (f.indexOf('법무법인정서') === 0) return undefined;
      if (f.indexOf('담당변호사') === 0) return setFirstT(p, '담당변호사  ' + spaced(c.lawyer));
      if (f.indexOf('위') === 0 && (f.indexOf('변호인') >= 0 || f.indexOf('소송대리인') >= 0) && f.length < 14) return setFirstT(p, '위 ' + c.jiwi + '의 ' + agent);
      return undefined;
    });

    // 5) 법원 치환
    var out = (tbl ? pre + tbl + post : pre + post);
    if (out.indexOf(TPL_COURT) >= 0) out = out.split(TPL_COURT).join(xmlEsc(c.court || ''));
    return out;
  }

  /* ══════════ JSZip 로드 + hwpx 빌드 ══════════ */
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
  function buildHwpx(cfg) {
    var Zip;
    return loadJSZip()
      .then(function (JSZip) { Zip = JSZip; return fetch(TPL); })
      .then(function (r) { if (!r.ok) throw new Error('템플릿 로드 실패: ' + TPL); return r.arrayBuffer(); })
      .then(function (buf) { return Zip.loadAsync(buf); })
      .then(function (zip) {
        return zip.file('Contents/section0.xml').async('string').then(function (origSec) {
          var sec = fillDoc(origSec, cfg);
          // 줄 레이아웃 캐시 제거 — 원문 좌표가 남으면 한글이 '손상/변조'로 차단(열 때 재계산)
          sec = sec.replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g, '').replace(/<hp:linesegarray\s*\/>/g, '');
          var zo = new Zip();
          return zip.file('mimetype').async('uint8array').then(function (mime) {
            zo.file('mimetype', mime, { compression: 'STORE' });
            var names = Object.keys(zip.files).filter(function (n) { return n !== 'mimetype' && !zip.files[n].dir; });
            return Promise.all(names.map(function (n) {
              if (n === 'Contents/section0.xml') return Promise.resolve([n, sec]);
              return zip.file(n).async('uint8array').then(function (d) { return [n, d]; });
            })).then(function (entries) {
              entries.forEach(function (e) { zo.file(e[0], e[1]); });
              return zo.generateAsync({ type: 'blob', mimeType: 'application/hwp+zip' });
            });
          });
        });
      });
  }

  /* ══════════ 상태 ══════════ */
  var state = null;
  function defaultState() {
    return {
      jiwi: '피고인', agent: '변호인', party: '', caseLine: '',
      lawyer: '', court: '',
      name: '', birthISO: '', phone: '', pastPhone: true,
      selected: [0, 1, 2],                 // 기본: 이통 3사
      edit: {},                            // id → {corp,ceo,addr} 편집본
      purpose: '', query: '', purposeTouched: false, queryTouched: false,
      dateISO: todayISO()
    };
  }
  function carrierView(id) {
    var base = CARRIERS[id], e = state.edit[id] || {};
    return {
      corp: e.corp != null ? e.corp : base.corp,
      ceo: e.ceo != null ? e.ceo : base.ceo,
      addr: e.addr != null ? e.addr : base.addr
    };
  }
  function selectedItems() {
    return state.selected.map(function (id) { var v = carrierView(id); return { corp: v.corp, ceo: v.ceo, addr: v.addr }; });
  }
  function defaultPurpose(s) {
    var who = s.party || '위 사람';
    return '신청인(' + s.jiwi + ')은 위 사건의 실체적 진실 발견을 위하여 아래 조회할 사람의 인적사항을 확인하고자 합니다.\n' +
      '그러나 신청인은 조회할 사람의 현재 주소 및 연락처를 알지 못하여 소환장 등의 송달이 불가능한 상황이므로, 주소 등 인적사항을 파악하고자 본 사실조회를 신청합니다.';
  }
  function defaultQuery(s) {
    var nm = s.name || '위 사람';
    var bd = s.birthISO ? ', 생년월일: ' + fmtDate(s.birthISO) : '';
    var ph = s.phone || '위 연락처';
    return '위 조회할 사람(' + nm + bd + ')이 위 연락처(' + ph + ')를 사용한 사실이 있다면, 가입 당시 및 현재의 인적사항(성명, 주민등록번호, 주소, 연락처)';
  }
  function toCfg(s) {
    return {
      jiwi: s.jiwi || '피고인', agent: s.agent || '변호인', party: s.party, caseLine: s.caseLine,
      lawyer: s.lawyer, court: s.court,
      name: s.name, birth: fmtDate(s.birthISO), phone: s.phone, pastPhone: s.pastPhone,
      items: selectedItems(),
      purpose: (s.purposeTouched && s.purpose) ? s.purpose : defaultPurpose(s),
      query: (s.queryTouched && s.query) ? s.query : defaultQuery(s),
      dateISO: s.dateISO || todayISO()
    };
  }
  function baseName(s) {
    var parts = ['사실조회신청서', s.party, s.caseLine, ymd(s.dateISO)].filter(Boolean);
    return parts.join('_').replace(/[\/\\:*?"<>|\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function downloadName(s) { return baseName(s) + '.hwpx'; }

  /* ══════════ CSS ══════════ */
  var STYLE_ID = 'sasiljo-style';
  var SJ_CSS =
    '#sasiljoForm{display:none;position:fixed;inset:0;z-index:1100;background:#fff;flex-direction:column;}' +
    '#sasiljoForm.active{display:flex;}' +
    '#sasiljoForm .sj-row2{display:flex;gap:10px;}' +
    '#sasiljoForm .sj-row2>.fs-field{flex:1;min-width:0;}' +
    '#sasiljoForm .fs-label .sj-req{color:#c0392b;margin-left:2px;}' +
    '#sasiljoForm textarea.fs-input{min-height:88px;resize:vertical;line-height:1.55;font-family:inherit;}' +
    // 3사 · 알뜰폰 선택
    '#sasiljoForm .sj-majors{display:flex;gap:8px;flex-wrap:wrap;margin:2px 0 4px;}' +
    '#sasiljoForm .sj-chk{display:flex;align-items:center;gap:7px;border:1.5px solid var(--border,#e3e3e3);border-radius:10px;padding:8px 12px;cursor:pointer;font-size:13px;background:#fff;user-select:none;}' +
    '#sasiljoForm .sj-chk.on{border-color:#1a1a1a;background:#1a1a1a;color:#fff;}' +
    '#sasiljoForm .sj-chk .sj-box{width:15px;height:15px;border:1.6px solid #bbb;border-radius:4px;flex:none;display:flex;align-items:center;justify-content:center;}' +
    '#sasiljoForm .sj-chk.on .sj-box{border-color:#fff;}' +
    '#sasiljoForm .sj-chk .sj-box svg{width:11px;height:11px;display:none;}' +
    '#sasiljoForm .sj-chk.on .sj-box svg{display:block;}' +
    '#sasiljoForm .sj-mvno-bar{display:flex;gap:6px;align-items:center;margin:4px 0 6px;flex-wrap:wrap;}' +
    '#sasiljoForm .sj-search{flex:1;min-width:120px;}' +
    '#sasiljoForm .sj-quick{font-size:12px;padding:6px 10px;border:1px solid var(--border,#e3e3e3);border-radius:8px;background:#fafafa;cursor:pointer;white-space:nowrap;}' +
    '#sasiljoForm .sj-quick:active{background:#eee;}' +
    '#sasiljoForm .sj-mvno-list{max-height:210px;overflow-y:auto;border:1px solid var(--border,#eee);border-radius:10px;padding:5px;}' +
    '#sasiljoForm .sj-mv{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:8px;cursor:pointer;font-size:13px;}' +
    '#sasiljoForm .sj-mv:hover{background:#f6f6f6;}' +
    '#sasiljoForm .sj-mv .sj-box{width:15px;height:15px;border:1.6px solid #bbb;border-radius:4px;flex:none;display:flex;align-items:center;justify-content:center;}' +
    '#sasiljoForm .sj-mv.on .sj-box{border-color:#1a1a1a;background:#1a1a1a;}' +
    '#sasiljoForm .sj-mv .sj-box svg{width:11px;height:11px;color:#fff;display:none;}' +
    '#sasiljoForm .sj-mv.on .sj-box svg{display:block;}' +
    '#sasiljoForm .sj-mv-brand{font-weight:600;color:#222;}' +
    '#sasiljoForm .sj-mv-corp{color:#999;font-size:11.5px;}' +
    '#sasiljoForm .sj-net{font-size:10.5px;color:#888;border:1px solid #e5e5e5;border-radius:5px;padding:1px 5px;margin-left:auto;flex:none;}' +
    // 선택된 촉탁기관 편집
    '#sasiljoForm .sj-sel-head{display:flex;align-items:center;justify-content:space-between;margin:2px 0 6px;}' +
    '#sasiljoForm .sj-sel-count{font-size:12.5px;color:#666;}' +
    '#sasiljoForm .sj-sel-empty{font-size:12.5px;color:#bbb;padding:10px 2px;}' +
    '#sasiljoForm .sj-card{border:1px solid var(--border,#eee);border-radius:11px;padding:9px 11px 11px;margin-bottom:8px;position:relative;}' +
    '#sasiljoForm .sj-card-top{display:flex;align-items:center;gap:7px;margin-bottom:7px;}' +
    '#sasiljoForm .sj-idx{font-weight:700;color:#1a1a1a;font-size:13px;min-width:16px;}' +
    '#sasiljoForm .sj-card-brand{font-size:12.5px;color:#666;}' +
    '#sasiljoForm .sj-badge{font-size:10.5px;color:#b8860b;background:#fff7e0;border:1px solid #f0d98a;border-radius:6px;padding:1px 7px;margin-left:6px;}' +
    '#sasiljoForm .sj-rm{margin-left:auto;color:#c0392b;background:none;border:none;cursor:pointer;font-size:12px;padding:2px 6px;}' +
    '#sasiljoForm .sj-mini{display:block;font-size:11px;color:#888;margin:6px 0 2px;}' +
    '#sasiljoForm .sj-mini-in{width:100%;box-sizing:border-box;border:1px solid var(--border,#e3e3e3);border-radius:8px;padding:8px 10px;font-size:13px;font-family:inherit;}' +
    '#sasiljoForm .sj-hint{font-size:11.5px;color:#999;margin:-2px 0 8px;line-height:1.5;}';
  function injectStyle() { if (typeof FSDoc !== 'undefined' && FSDoc.injectOnce) FSDoc.injectOnce(STYLE_ID, SJ_CSS); }

  var CHK = '<span class="sj-box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2"><path d="M4 12l5 5L20 6"/></svg></span>';

  /* ══════════ 화면 껍데기 ══════════ */
  var SHELL_ID = 'sasiljo-shell';
  function injectShell() {
    if (document.getElementById(SHELL_ID)) return;
    var wrap = document.createElement('div');
    wrap.id = SHELL_ID;
    wrap.innerHTML =
      '<div id="sasiljoForm">' +
        '<div class="fs-card">' +
          '<div class="fs-head">' +
            '<button class="fs-close" onclick="closeSasiljoForm()" aria-label="닫기"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
            '<div class="fs-title">사실조회신청서 (통신사)</div>' +
          '</div>' +
          '<div class="fs-body">' +

            '<div class="fs-section">사건 정보</div>' +
            '<div class="sj-row2">' +
              '<div class="fs-field"><label class="fs-label">지위</label><input type="text" class="fs-input" id="sj-jiwi" placeholder="피고인" list="sj-jiwi-list" onchange="sjJiwiChange(this)"></div>' +
              '<div class="fs-field"><label class="fs-label">당사자 성명</label><input type="text" class="fs-input" id="sj-party" placeholder="홍길동"></div>' +
            '</div>' +
            '<datalist id="sj-jiwi-list"><option value="피고인"><option value="피의자"><option value="원고"><option value="피고"><option value="신청인"><option value="채권자"></datalist>' +
            '<div class="fs-field"><label class="fs-label">사건</label><input type="text" class="fs-input" id="sj-caseline" placeholder="2025고합1772 마약류관리에관한법률위반(향정)"></div>' +
            '<div class="sj-row2">' +
              '<div class="fs-field"><label class="fs-label">대리인 표시</label><input type="text" class="fs-input" id="sj-agent" placeholder="변호인" list="sj-agent-list"></div>' +
              '<div class="fs-field"><label class="fs-label">담당변호사</label><input type="text" class="fs-input" id="sj-lawyer" placeholder="서고은"></div>' +
            '</div>' +
            '<datalist id="sj-agent-list"><option value="변호인"><option value="소송대리인"></datalist>' +

            '<div class="fs-section">조회할 사람의 인적사항</div>' +
            '<div class="sj-row2">' +
              '<div class="fs-field"><label class="fs-label">성명</label><input type="text" class="fs-input" id="sj-name" placeholder="신나리"></div>' +
              '<div class="fs-field"><label class="fs-label">생년월일</label><input type="text" class="fs-input" id="sj-birth" inputmode="numeric" placeholder="19891123 → 1989. 11. 23." oninput="sjBirthInput(this)"></div>' +
            '</div>' +
            '<div class="fs-field"><label class="fs-label">연락처</label><input type="text" class="fs-input" id="sj-phone" placeholder="010-0000-0000" inputmode="numeric" oninput="sjPhoneInput(this)"></div>' +
            '<label class="sj-chk" id="sj-pastwrap" onclick="sjTogglePast()" style="margin-top:2px;"><span class="sj-box"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.2"><path d="M4 12l5 5L20 6"/></svg></span>과거(해지) 연락처로 표기</label>' +

            '<div class="fs-section">사실조회촉탁기관 (통신사 선택)</div>' +
            '<div class="sj-hint">보통 이동통신 3사를 먼저 조회하고, 확인되지 않으면 이용자 많은 순으로 알뜰폰을 추가합니다. 선택한 통신사마다 표에 가·나·다… 로 들어갑니다.</div>' +
            '<div class="sj-majors" id="sj-majors"></div>' +
            '<div class="sj-mvno-bar">' +
              '<input type="text" class="fs-input sj-search" id="sj-search" placeholder="알뜰폰 검색 (브랜드·법인명)" oninput="sjRenderMvno()">' +
              '<button type="button" class="sj-quick" onclick="sjPickTop(5)">상위 5개</button>' +
              '<button type="button" class="sj-quick" onclick="sjPickTop(10)">상위 10개</button>' +
              '<button type="button" class="sj-quick" onclick="sjClearMvno()">알뜰폰 해제</button>' +
            '</div>' +
            '<div class="sj-mvno-list" id="sj-mvno-list"></div>' +

            '<div class="sj-sel-head" style="margin-top:12px;">' +
              '<div class="fs-section" style="margin:0;">선택한 촉탁기관 <span class="sj-sel-count" id="sj-sel-count"></span></div>' +
            '</div>' +
            '<div class="sj-hint">법인명·대표이사·주소는 각 칸에서 바로 수정할 수 있습니다.</div>' +
            '<div id="sj-selected"></div>' +

            '<div class="fs-section">조회의 목적</div>' +
            '<div class="fs-field"><textarea class="fs-input" id="sj-purpose" placeholder="조회의 목적" oninput="sjTouch(\'purpose\')"></textarea></div>' +
            '<div class="fs-section">조회할 사항</div>' +
            '<div class="fs-field"><textarea class="fs-input" id="sj-query" placeholder="조회할 사항" oninput="sjTouch(\'query\')"></textarea></div>' +
            '<div style="margin:-2px 0 4px;"><button type="button" class="sj-quick" onclick="sjResetText()">인적사항 기준 기본문구 다시 생성</button></div>' +

            '<div class="fs-section">제출 정보</div>' +
            '<div class="fs-field"><label class="fs-label">법원(수신)</label><input type="text" class="fs-input" id="sj-court" placeholder="인천지방법원 제14형사부(나)"></div>' +
            '<div class="fs-field"><label class="fs-label">작성일</label><input type="date" class="fs-input" id="sj-date"></div>' +
          '</div>' +
          '<div class="fs-foot">' +
            '<button class="fs-btn ghost" onclick="closeSasiljoForm()">취소</button>' +
            '<button class="fs-btn primary" onclick="sjDownload()">한글 다운로드</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
  }

  /* ══════════ DOM 유틸 ══════════ */
  function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v == null ? '' : v; }
  function getVal(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
  function htmlEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function netLabel(net) { return (net || []).join('·'); }

  /* ── 3사 렌더 ── */
  function sjRenderMajors() {
    var box = document.getElementById('sj-majors'); if (!box) return;
    var html = '';
    CARRIERS.forEach(function (c) {
      if (!c.major) return;
      var on = state.selected.indexOf(c.id) >= 0;
      html += '<span class="sj-chk' + (on ? ' on' : '') + '" onclick="sjToggle(' + c.id + ')">' + CHK + c.brand + '</span>';
    });
    box.innerHTML = html;
  }
  /* ── 알뜰폰 렌더(검색 필터) ── */
  function sjRenderMvno() {
    var box = document.getElementById('sj-mvno-list'); if (!box) return;
    var q = (getVal('sj-search') || '').replace(/\s+/g, '');
    var html = '';
    CARRIERS.forEach(function (c) {
      if (c.major) return;
      if (q) { var hay = (c.brand + c.corp).replace(/\s+/g, ''); if (hay.indexOf(q) < 0) return; }
      var on = state.selected.indexOf(c.id) >= 0;
      html += '<div class="sj-mv' + (on ? ' on' : '') + '" onclick="sjToggle(' + c.id + ')">' + CHK +
        '<span><span class="sj-mv-brand">' + htmlEsc(c.brand) + '</span> <span class="sj-mv-corp">' + htmlEsc(c.corp) + '</span></span>' +
        '<span class="sj-net">' + htmlEsc(netLabel(c.net)) + '</span></div>';
    });
    box.innerHTML = html || '<div class="sj-sel-empty">검색 결과가 없습니다.</div>';
  }
  /* ── 선택 촉탁기관(편집) 렌더 ── */
  function sjRenderSelected() {
    var box = document.getElementById('sj-selected'); if (!box) return;
    var cnt = document.getElementById('sj-sel-count'); if (cnt) cnt.textContent = '(' + state.selected.length + ')';
    if (!state.selected.length) { box.innerHTML = '<div class="sj-sel-empty">선택된 통신사가 없습니다. 위에서 통신사를 선택하세요.</div>'; return; }
    var html = '';
    state.selected.forEach(function (id, i) {
      var base = CARRIERS[id], v = carrierView(id);
      html += '<div class="sj-card">' +
        '<div class="sj-card-top"><span class="sj-idx">' + (GANADA[i] || (i + 1)) + '.</span>' +
          '<span class="sj-card-brand">' + htmlEsc(base.brand) + '</span>' +
          '<button type="button" class="sj-rm" onclick="sjToggle(' + id + ')">삭제</button></div>' +
        '<label class="sj-mini">법인명 · 대표이사</label>' +
        '<div class="sj-row2">' +
          '<input class="sj-mini-in" style="flex:2;" value="' + htmlEsc(v.corp) + '" oninput="sjEdit(' + id + ',\'corp\',this.value)">' +
          '<input class="sj-mini-in" style="flex:1;" value="' + htmlEsc(v.ceo) + '" placeholder="대표이사" oninput="sjEdit(' + id + ',\'ceo\',this.value)">' +
        '</div>' +
        '<label class="sj-mini">본점 주소</label>' +
        '<input class="sj-mini-in" value="' + htmlEsc(v.addr) + '" placeholder="본점 도로명주소" oninput="sjEdit(' + id + ',\'addr\',this.value)">' +
      '</div>';
    });
    box.innerHTML = html;
  }
  function sjRenderPickers() { sjRenderMajors(); sjRenderMvno(); sjRenderSelected(); }

  /* ══════════ 이벤트 핸들러(전역) ══════════ */
  window.sjToggle = function (id) {
    var i = state.selected.indexOf(id);
    if (i >= 0) state.selected.splice(i, 1);
    else { state.selected.push(id); state.selected.sort(function (a, b) { return a - b; }); } // 배열 순서 = 3사→이용자순
    sjRenderPickers();
  };
  window.sjPickTop = function (n) {
    var added = 0;
    for (var k = 0; k < CARRIERS.length && added < n; k++) {
      var c = CARRIERS[k]; if (c.major) continue;
      if (state.selected.indexOf(c.id) < 0) { state.selected.push(c.id); }
      added++;
    }
    state.selected.sort(function (a, b) { return a - b; });
    sjRenderPickers();
  };
  window.sjClearMvno = function () {
    state.selected = state.selected.filter(function (id) { return CARRIERS[id].major; });
    sjRenderPickers();
  };
  window.sjEdit = function (id, field, val) {
    if (!state.edit[id]) state.edit[id] = {};
    state.edit[id][field] = val;
  };
  window.sjPhoneInput = function (el) {
    var fromEnd = el.value.length - (el.selectionStart == null ? el.value.length : el.selectionStart);
    el.value = fmtPhone(el.value);
    try { var pos = Math.max(0, el.value.length - fromEnd); el.setSelectionRange(pos, pos); } catch (e) {}
  };
  window.sjBirthInput = function (el) {
    var fromEnd = el.value.length - (el.selectionStart == null ? el.value.length : el.selectionStart);
    el.value = fmtBirth(el.value);
    try { var pos = Math.max(0, el.value.length - fromEnd); el.setSelectionRange(pos, pos); } catch (e) {}
  };
  // 지위 변경 시 대리인 표시(변호인/소송대리인) 자동 전환
  window.sjJiwiChange = function (el) { setVal('sj-agent', deriveAgent((el.value || '').trim())); };
  window.sjTogglePast = function () {
    state.pastPhone = !state.pastPhone;
    var w = document.getElementById('sj-pastwrap'); if (w) w.classList.toggle('on', state.pastPhone);
  };
  window.sjTouch = function (which) {
    if (which === 'purpose') { state.purposeTouched = true; state.purpose = getVal('sj-purpose'); }
    else { state.queryTouched = true; state.query = getVal('sj-query'); }
  };
  window.sjResetText = function () {
    collect();
    state.purposeTouched = false; state.queryTouched = false;
    setVal('sj-purpose', defaultPurpose(state));
    setVal('sj-query', defaultQuery(state));
  };
  window.sjRenderMvno = sjRenderMvno;

  /* ── 자동입력(사건DB): 지위·당사자·사건 자동 채움 ── */
  function sjOnFill(row) {
    if (!state) return;
    var pos = String(row.client_position || '');
    // '피고인'은 '피고'를 포함하므로 반드시 '피고인'을 먼저 검사
    var jiwi = pos.indexOf('피의자') >= 0 ? '피의자'
      : pos.indexOf('피고인') >= 0 ? '피고인'
      : pos.indexOf('원고') >= 0 ? '원고'
      : pos.indexOf('피고') >= 0 ? '피고'
      : pos.indexOf('신청인') >= 0 ? '신청인'
      : pos.indexOf('채권자') >= 0 ? '채권자'
      : pos.indexOf('채무자') >= 0 ? '채무자'
      : '피고인';
    setVal('sj-jiwi', jiwi);
    setVal('sj-agent', deriveAgent(jiwi));           // 지위에 맞춰 변호인/소송대리인 자동
    setVal('sj-party', row.l_client || '');
    setVal('sj-caseline', [row.l_code, cleanCaseName(row.l_name)].filter(Boolean).join(' '));
    setVal('sj-court', row.court || '');             // 법원(재판부는 court-lookup으로 뒤에 덧붙음)
  }

  /* ══════════ 상태 ↔ 폼 ══════════ */
  function fillFormFromState() {
    setVal('sj-jiwi', state.jiwi); setVal('sj-agent', state.agent);
    setVal('sj-party', state.party); setVal('sj-caseline', state.caseLine);
    setVal('sj-lawyer', state.lawyer); setVal('sj-court', state.court);
    setVal('sj-name', state.name); setVal('sj-birth', state.birthISO); setVal('sj-phone', state.phone);
    var w = document.getElementById('sj-pastwrap'); if (w) w.classList.toggle('on', state.pastPhone);
    setVal('sj-date', state.dateISO || todayISO());
    setVal('sj-purpose', state.purposeTouched ? state.purpose : defaultPurpose(state));
    setVal('sj-query', state.queryTouched ? state.query : defaultQuery(state));
    sjRenderPickers();
  }
  function collect() {
    state.jiwi = getVal('sj-jiwi') || '피고인'; state.agent = getVal('sj-agent') || '변호인';
    state.party = getVal('sj-party'); state.caseLine = getVal('sj-caseline');
    state.lawyer = getVal('sj-lawyer'); state.court = getVal('sj-court');
    state.name = getVal('sj-name'); state.birthISO = fmtBirth(getVal('sj-birth')); state.phone = fmtPhone(getVal('sj-phone'));
    state.dateISO = getVal('sj-date') || todayISO();
    state.purpose = getVal('sj-purpose'); state.query = getVal('sj-query');
  }

  function ensureUI() { injectStyle(); injectShell(); }
  function openForm() {
    ensureUI();
    fillFormFromState();
    document.getElementById('sasiljoForm').classList.add('active');
    if (typeof initAutofillFor === 'function') initAutofillFor('sj-party', { onFill: sjOnFill, courtDept: 'sj-court', courtDeptAppend: true });
  }
  window.goSasiljo = function () { ensureUI(); state = defaultState(); openForm(); };
  window.closeSasiljoForm = function () { var f = document.getElementById('sasiljoForm'); if (f) f.classList.remove('active'); };

  window.sjDownload = function () {
    collect();
    if (!state.name) { alert('조회할 사람의 성명을 입력해 주세요.'); return; }
    if (!state.phone) { alert('조회할 연락처(전화번호)를 입력해 주세요.'); return; }
    if (!state.selected.length) { alert('촉탁기관(통신사)을 1개 이상 선택해 주세요.'); return; }
    var s = state, cfg = toCfg(s);
    buildHwpx(cfg).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = downloadName(s);
      document.body.appendChild(a); a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
    }).catch(function (e) {
      console.error('[sasiljo] 다운로드 실패:', e);
      alert('한글 파일 생성에 실패했습니다: ' + (e && e.message ? e.message : e));
    });
  };

  /* node 검증용(브라우저에선 무시됨) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      fillDoc: fillDoc, buildTable: buildTable, parasFromText: parasFromText,
      spaced: spaced, fmtDate: fmtDate, fmtPhone: fmtPhone, fmtBirth: fmtBirth, eunNeun: eunNeun, GANADA: GANADA, CARRIERS: CARRIERS,
      downloadName: downloadName, defaultPurpose: defaultPurpose, defaultQuery: defaultQuery,
      _setState: function (s) { state = s; }, toCfg: toCfg
    };
  }
})();
