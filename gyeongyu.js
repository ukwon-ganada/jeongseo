/* 법무법인 정서 PWA - 경유(인천변호사회 경유증 작성 도우미) 기능
   index.html에서 분리 (3단계 JS 분리, 첫 대상).
   의존성: sjState() 를 참조 → 선임계 코드가 index.html 전역에 있어야 동작.
   진입점: "경유작성" 버튼 onclick="openGyeongyu()" */

/* ══════ 인천변호사회 경유증 작성 도우미 ══════ */
function gyExtractBirth(ssn){
  if(!ssn) return '';
  var d=(''+ssn).replace(/[^0-9]/g,'');
  return d.length>=6 ? d.slice(0,6) : d;
}
function gyToday(){
  var t=new Date();
  return t.getFullYear()+'-'+('0'+(t.getMonth()+1)).slice(-2)+'-'+('0'+t.getDate()).slice(-2);
}
function gyEsc(v){
  return (''+(v==null?'':v)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function openGyeongyu(){
  var s=sjState();
  var clients=(s.clients||[]).filter(function(c){return c.name&&c.name.trim();});
  var first=clients[0]||{name:'',ssn:''};
  var wijminName=clients.length>=2?(first.name+' 외 '+(clients.length-1)):(first.name||'');
  var birth=gyExtractBirth(first.ssn);
  var caseType=(seonimMode==='민가사')?'민사·가사':'형사';

  var vals={
    agency:s.agency||'', casenum:s.casenum||'', casename:s.casename||'',
    role:s.role||'', wijmin:wijminName, birth:birth, opp:s.opp||''
  };

  var W=screen.availWidth||window.innerWidth;
  var H=screen.availHeight||window.innerHeight;
  var half=Math.max(420, Math.floor(W/2));
  var leftFeat='left=0,top=0,width='+half+',height='+H;
  var rightFeat='left='+half+',top=0,width='+(W-half)+',height='+H;

  /* 1) 좌측 복사 패널 (핵심) 먼저 */
  var panel=window.open('', 'gyeongyu_panel', leftFeat);
  if(!panel){ alert('팝업이 차단되었습니다.\n브라우저 주소창 우측의 팝업 차단 아이콘을 눌러 이 사이트의 팝업을 허용해 주세요.'); return; }
  panel.document.open();
  panel.document.write(gyPanelHTML(vals, caseType, half, W, H));
  panel.document.close();

  /* 2) 우측 인천변호사회 창 */
  try{ window.open('https://via.incheonbar.or.kr/pageManageView.php?pageIndex=sheet_input', 'incheonbar_via', rightFeat); }catch(e){}
  try{ panel.focus(); }catch(e){}
}
function gyField(val, opt){
  opt=opt||{};
  var has=val&&(''+val).trim();
  var cls='gy-input'+(has?' filled':' empty')+(opt.wide?' wide':'');
  if(has){
    return '<div class="'+cls+'" data-v="'+gyEsc(val)+'" title="클릭하면 복사됩니다">'
         +'<span class="gy-txt">'+gyEsc(val)+'</span>'
         +'<span class="gy-badge">복사됨 ✓</span></div>';
  }
  return '<div class="'+cls+'">'+gyEsc(opt.emptyText||'값 없음')+'</div>';
}
function gyPanelHTML(v, caseType, half, W, H){
  var reopenFeat="left="+half+",top=0,width="+(W-half)+",height="+H;

  /* 사건유형 라디오: 선임계 기준으로 골라야 할 값 강조 */
  var pick=(caseType==='민사·가사')?['민사','가사']:['형사'];
  var radios='';
  ['민사','형사','가사','행정','특허'].forEach(function(t){
    var on=pick.indexOf(t)>=0;
    radios+='<span class="gy-radio'+(on?' pick':'')+'"><span class="gy-dot">'+(on?'◉':'○')+'</span>'+gyEsc(t)+'</span>';
  });

  var rowsHTML=''
   +'<tr>'
     +'<td class="gy-lbl">증표번호</td>'
     +'<td class="gy-field"><div class="gy-input note">좌측 목록에서 증표 선택</div></td>'
     +'<td class="gy-lbl">증표 구입일</td>'
     +'<td class="gy-field"><div class="gy-input note">증표 선택 시 자동</div></td>'
   +'</tr>'
   +'<tr>'
     +'<td class="gy-lbl">사건유형<span class="gy-req">(*)</span></td>'
     +'<td class="gy-field" colspan="3"><div class="gy-radios">'+radios+'</div>'
       +'<div class="gy-hint">선임계 기준 <b>'+gyEsc(caseType)+'</b> — 위에서 골라 선택하세요</div></td>'
   +'</tr>'
   +'<tr><td class="gy-lbl">관할기관<span class="gy-req">(*)</span></td>'
     +'<td class="gy-field" colspan="3">'+gyField(v.agency)+'</td></tr>'
   +'<tr><td class="gy-lbl">사건번호</td>'
     +'<td class="gy-field" colspan="3">'+gyField(v.casenum)+'</td></tr>'
   +'<tr><td class="gy-lbl">사건명<span class="gy-req">(*)</span></td>'
     +'<td class="gy-field" colspan="3">'+gyField(v.casename,{wide:true})
       +'<div class="gy-check"><span class="gy-box">☐</span> 사건명 미정</div></td></tr>'
   +'<tr><td class="gy-lbl">위임인<span class="gy-req">(*)</span></td>'
     +'<td class="gy-field" colspan="3">'
       +'<div class="gy-wijmin"><div class="gy-select">'+gyEsc(v.role||'선택')+' <span class="gy-caret">▾</span></div>'+gyField(v.wijmin)+'</div>'
       +'<div class="gy-hint">노란 칸(<b>'+gyEsc(v.role||'지위')+'</b>)을 실제 창 드롭다운에서 그대로 선택하세요</div>'
       +'<div class="gy-orange">위임인은 2회 수정이 가능하니 정확히 입력해 주세요.<br>'
       +"위임인이 다수이거나 글자수를 초과한 경우, 위임인 란에 '외'로 표시하여 입력이 가능합니다. (예: 홍길동 외 28)"
       +'</div></td></tr>'
   +'<tr><td class="gy-lbl">위임인 생년월일<br><span class="gy-sub">(사업자번호)</span></td>'
     +'<td class="gy-field" colspan="3">'+gyField(v.birth)+'</td></tr>'
   +'<tr><td class="gy-lbl">상대방</td>'
     +'<td class="gy-field" colspan="3">'+gyField(v.opp)+'</td></tr>';

  return '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">'
   +'<meta name="viewport" content="width=device-width, initial-scale=1.0">'
   +'<title>경유증 작성 도우미</title><style>'
   +'*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}'
   +'body{margin:0;font-family:"Malgun Gothic","Apple SD Gothic Neo",-apple-system,sans-serif;background:#e9ebef;color:#222;font-size:14px}'
   +'.gy-topbar{position:sticky;top:0;z-index:10;background:#2b3a67;color:#fff;padding:11px 14px;display:flex;align-items:center;gap:8px}'
   +'.gy-topbar .t{font-size:14px;font-weight:700}'
   +'.gy-topbar .d{font-size:11px;color:#cdd6f0;margin-left:auto;text-align:right;line-height:1.4}'
   +'.gy-ic{width:15px;height:15px;vertical-align:-2px;margin-right:5px}'
   +'.gy-reopen{display:block;margin:10px 12px 2px;width:calc(100% - 24px);padding:12px;border:0;background:#3858d6;color:#fff;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 1px 3px rgba(56,88,214,.3)}'
   +'.gy-reopen:active{background:#2c46b0}'
   +'.gy-site{margin:12px;background:#fff;border:1px solid #d0d3d9;border-radius:4px;overflow:hidden}'
   +'table.gy-form{width:100%;border-collapse:collapse;table-layout:fixed}'
   +'.gy-form td{border:1px solid #d5d7dd;padding:9px 10px;vertical-align:middle;word-break:break-all}'
   +'.gy-lbl{width:92px;background:#f3f4f6;font-weight:700;color:#333;text-align:center;font-size:13px;line-height:1.3}'
   +'.gy-req{color:#e23b3b;font-weight:700}'
   +'.gy-sub{font-size:11px;color:#666;font-weight:400}'
   +'.gy-input{border:1px dashed #b9bcc4;background:#f7f8fa;border-radius:3px;padding:9px 11px;min-height:38px;display:flex;align-items:center;position:relative;transition:.12s;font-size:14px}'
   +'.gy-input.filled{cursor:pointer;color:#111;font-weight:600;background:#fff;border-color:#9aa0ac}'
   +'.gy-input.filled:hover{border-color:#3858d6;background:#eef2ff}'
   +'.gy-input.filled:active{background:#dfe6ff}'
   +'.gy-input.empty{color:#b0b4bd;font-weight:400}'
   +'.gy-input.note{color:#9aa0ac;font-size:13px}'
   +'.gy-input.wide{min-height:44px}'
   +'.gy-txt{flex:1}'
   +'.gy-badge{position:absolute;right:9px;background:#1ba672;color:#fff;font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px;opacity:0;transform:scale(.8);transition:.15s;pointer-events:none}'
   +'.gy-input.copied .gy-badge{opacity:1;transform:scale(1)}'
   +'.gy-input.copied{background:#e7f8f1 !important;border-color:#1ba672 !important}'
   +'.gy-radios{display:flex;flex-wrap:wrap;gap:6px}'
   +'.gy-radio{display:inline-flex;align-items:center;gap:4px;padding:5px 11px;border-radius:20px;font-size:13.5px;color:#555;border:1px solid transparent}'
   +'.gy-radio .gy-dot{font-size:13px}'
   +'.gy-radio.pick{background:#fff6df;border-color:#f0c14b;color:#8a5a00;font-weight:700}'
   +'.gy-radio.pick .gy-dot{color:#e6a417}'
   +'.gy-wijmin{display:flex;gap:8px;align-items:stretch}'
   +'.gy-select{flex:0 0 96px;border:1px solid #f0c14b;background:#fff6df;border-radius:3px;padding:9px 10px;display:flex;align-items:center;justify-content:space-between;color:#8a5a00;font-weight:700;font-size:13px}'
   +'.gy-wijmin .gy-input{flex:1}'
   +'.gy-caret{font-size:12px}'
   +'.gy-check{margin-top:7px;font-size:13px;color:#555}'
   +'.gy-box{font-size:15px}'
   +'.gy-hint{margin-top:6px;font-size:12px;color:#8a93a6;line-height:1.5}'
   +'.gy-hint b{color:#3858d6}'
   +'.gy-orange{margin-top:9px;background:#fff9ef;border:1px solid #f0d9a8;border-radius:4px;padding:10px 12px;font-size:12px;color:#8a6d3b;line-height:1.6}'
   +'.gy-foot{padding:2px 16px 22px;font-size:11.5px;color:#9aa3b5;line-height:1.6}'
   +'</style></head><body>'
   +'<div class="gy-topbar"><span class="t"><svg class="gy-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="3" width="8" height="4" rx="1"/><path d="M9 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-3"/></svg>복사 전용 미리보기</span>'
   +'<span class="d">채워진 칸을 <b>클릭</b>하면 복사됩니다<br>우측 실제 창의 같은 위치에 붙여넣기(Ctrl+V)</span></div>'
   +'<button class="gy-reopen" onclick="gyReopen()">우측에 경유증표 창 열기</button>'
   +'<div class="gy-site">'
   +'<table class="gy-form"><tbody>'+rowsHTML+'</tbody></table>'
   +'</div>'
   +'<div class="gy-foot">· 회색 점선 칸은 실제 창에서 선택/자동 입력되는 항목입니다.<br>'
   +'· 위임인이 여러 명이면 "○○○ 외 N" 형식으로 자동 표시됩니다.</div>'
   +'<script>'
   +'function gyOk(el){el.classList.add("copied");setTimeout(function(){el.classList.remove("copied");},1100);}'
   +'function gyFallback(val,el){var t=document.createElement("textarea");t.value=val;t.style.position="fixed";t.style.opacity="0";document.body.appendChild(t);t.focus();t.select();try{document.execCommand("copy");gyOk(el);}catch(e){prompt("아래 값을 직접 복사하세요(Ctrl+C):",val);}document.body.removeChild(t);}'
   +'function gyCopy(el){var val=el.getAttribute("data-v")||"";if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(val).then(function(){gyOk(el);},function(){gyFallback(val,el);});}else{gyFallback(val,el);}}'
   +'document.addEventListener("click",function(e){var b=e.target.closest&&e.target.closest(".gy-input.filled");if(b)gyCopy(b);});'
   +'function gyReopen(){window.open("https://via.incheonbar.or.kr/pageManageView.php?pageIndex=sheet_input","incheonbar_via","'+reopenFeat+'");}'
   +'<\/script></body></html>';
}
