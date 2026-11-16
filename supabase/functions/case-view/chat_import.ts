// ============================================================================
//  내보낸 사건방 대화(.txt) → 지난 업무 타임라인 줄 뽑기
//
//  2026-11-16 석원 결정: 봇이 들어오기 전 대화는 웍스가 주지 않으니, 직원이 방 대화를
//  '내보내기'한 텍스트 파일을 사건 화면에 올리면 AI가 "우리가 한 업무"만 골라
//  미리보기로 보여 주고, 직원이 고른 줄만 room_event 에 남긴다.
//    · 대화 원문은 저장하지 않는다(AI에 보낼 때만 쓰고 버림). 보내기 전에 전화번호·주민번호는 지운다.
//    · 저장 줄: channel_id 'export:<l_num>', source 'chat-export', state 완료/예정.
// ============================================================================

export const KINDS = ["사건접수", "고소장제출", "조사", "출석요구", "송치", "처분", "기소", "기일", "서면제출", "접견", "기타"] as const;
export type ImportEvent = { kind: string; date: string; time: string; msg_time: string; summary: string; state: "예정" | "완료" };

const MAX_CHARS = 60000;   // 한 번에 AI에 보낼 양
const MAX_TOTAL = 400000;  // 파일 전체 한도(약 몇 년치)

const PII = /\d{6}\s*-\s*[1-4]\d{6}|0\d{1,2}\s*-\s*\d{3,4}\s*-\s*\d{4}|01\d\s*\d{3,4}\s*\d{4}/g;

// 사진·파일 자리표시, 회수된 메시지, 빈 줄 정리 + 개인정보 지우기
export function tidyExport(text: string): string {
  const out: string[] = [];
  for (const raw of String(text || "").replace(/\r/g, "").split("\n")) {
    const l = raw.trimEnd();
    if (!l.trim()) continue;
    if (/^\((사진|파일|동영상|이모티콘)\)$/.test(l.trim())) continue;
    if (/메시지를 회수하였습니다/.test(l)) continue;
    out.push(l.replace(PII, "[번호]"));
  }
  return out.join("\n");
}

// 날짜 머리줄("2026년 10월 7일 수요일")을 기준으로 잘라 묶음 만들기(날짜 중간에서 자르지 않음)
export function chunkExport(text: string, max = MAX_CHARS): string[] {
  const days = text.split(/\n(?=\d{4}년 \d{1,2}월 \d{1,2}일)/);
  const chunks: string[] = [];
  let cur = "";
  for (const d of days) {
    if (cur && cur.length + d.length + 1 > max) { chunks.push(cur); cur = ""; }
    cur = cur ? cur + "\n" + d : d;
    while (cur.length > max) { chunks.push(cur.slice(0, max)); cur = cur.slice(max); }
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["events"],
  properties: {
    events: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["kind", "date", "time", "msg_time", "summary", "state"],
        properties: {
          kind: { type: "string", enum: [...KINDS] },
          date: { type: "string", description: "그 업무가 일어난(또는 일어날) 날 YYYY-MM-DD" },
          time: { type: "string", description: "조사·기일·접견처럼 약속 시각이 있으면 HH:MM, 없으면 빈 문자열" },
          msg_time: { type: "string", description: "근거가 된 메시지의 보낸 시각 HH:MM" },
          summary: { type: "string", description: "40자 이내. 의뢰인·상대방 이름, 전화번호, 주소는 넣지 않는다" },
          state: { type: "string", enum: ["예정", "완료"] },
        },
      },
    },
  },
};

const SYSTEM = [
  "너는 법무법인의 사건방 대화 기록(내보내기 파일)을 읽고, 이 사건에서 '우리 법인이 한 업무'를 날짜별 타임라인 줄로 정리하는 도우미다.",
  "골라낼 것: 선임(수임)·선임계(변호인선임신고서) 제출, 고소장·의견서·변호인의견서·서면 제출, 정보공개청구·열람복사 신청과 결과 수령, 경찰·검찰 조사 일정 확정·변경·참여, 출석 요구, 접견, 송치·불송치·기소·불기소 등 처분 통지, 재판 기일.",
  "골라내지 말 것: 잡담, 내부 업무 분담 대화, 변호사의 사건 내용 메모나 감상, 수사 내용·증거 내용, 수임료·비용, 상대방이나 다른 사건 소식, 연락처 전달, 확정되지 않은 계획.",
  "같은 일을 여러 메시지에서 말하면 한 줄로 합친다(예: '선임계 제출하겠습니다' → '우편제출완료' 는 '선임계 우편 제출' 한 줄, 완료된 날짜 기준).",
  "날짜는 대화의 날짜 머리줄과 보낸 시각을 기준으로 한다. '내일', '11/5' 같은 말은 실제 날짜로 바꾼다.",
  "이미 한 일은 state=완료, 기록 마지막 날 이후의 일정은 state=예정.",
  "summary는 짧은 업무 이름으로 쓴다. 예: '선임계 킥스 전자 제출', '피의자 조사 참여 (인천광역시경찰청)', '피의자신문조서 정보공개청구'. 변호사는 '서변호사'처럼 성+변호사만 써도 된다.",
  "확실하지 않으면 넣지 않는다.",
].join("\n");

export function cleanImport(raw: unknown): ImportEvent[] {
  const list = Array.isArray((raw as any)?.events) ? (raw as any).events : [];
  const out: ImportEvent[] = [];
  for (const e of list) {
    const date = String(e?.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) continue;
    const hm = (v: unknown) => (/^\d{2}:\d{2}$/.test(String(v || "")) ? String(v) : "");
    const kind = (KINDS as readonly string[]).includes(e?.kind) ? e.kind : "기타";
    const summary = String(e?.summary || "").replace(PII, "").trim().slice(0, 60);
    if (!summary) continue;
    out.push({ kind, date, time: hm(e?.time), msg_time: hm(e?.msg_time), summary, state: e?.state === "예정" ? "예정" : "완료" });
  }
  return out;
}

async function askAI(key: string, model: string, chunk: string, title: string, fetcher: typeof fetch): Promise<ImportEvent[]> {
  const res = await fetcher("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json",
      "anthropic-beta": "server-side-fallback-2026-07-01",
    },
    body: JSON.stringify({
      model, max_tokens: 8000, system: SYSTEM,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      fallbacks: "default",
      messages: [{ role: "user", content: `사건: ${title || "(모름)"}\n\n대화 기록:\n${chunk}` }],
    }),
  });
  if (!res.ok) throw new Error("anthropic " + res.status + " " + (await res.text().catch(() => "")).slice(0, 200));
  const data = await res.json();
  if (data?.stop_reason === "refusal") return [];
  const txt = (Array.isArray(data?.content) ? data.content : []).filter((b: any) => b?.type === "text").map((b: any) => b.text || "").join("").trim();
  return txt ? cleanImport(JSON.parse(txt)) : [];
}

export async function extractFromExport(
  a: { key?: string; model?: string; text: string; title: string },
  fetcher: typeof fetch = fetch,
): Promise<{ events: ImportEvent[]; chunks: number; truncated: boolean }> {
  if (!a.key) throw new Error("ANTHROPIC_API_KEY 없음");
  let text = tidyExport(a.text);
  const truncated = text.length > MAX_TOTAL;
  if (truncated) text = text.slice(-MAX_TOTAL); // 너무 길면 최근 쪽을 남김
  const chunks = chunkExport(text);
  // 묶음은 동시에 보낸다(함수 실행 시간 한도 때문)
  const parts = await Promise.all(chunks.map((c) => askAI(a.key!, a.model || "claude-opus-5-5", c, a.title, fetcher)));
  const all: ImportEvent[] = parts.flat();
  all.sort((x, y) => (x.date + x.time + x.msg_time).localeCompare(y.date + y.time + y.msg_time));
  return { events: all, chunks: chunks.length, truncated };
}

// 저장할 줄 만들기: room_event 고유키(channel_id, kind, ev_date, ev_time)가 겹치면 보낸 시각으로 구분
export function toRows(lNum: number, evs: ImportEvent[]) {
  const ch = "export:" + lNum;
  const used = new Set<string>();
  const rows: any[] = [];
  for (const e of cleanImport({ events: evs })) {
    let t = e.time;
    let key = `${e.kind}|${e.date}|${t}`;
    if (used.has(key) && e.msg_time) { t = e.msg_time; key = `${e.kind}|${e.date}|${t}`; }
    if (used.has(key)) continue;
    used.add(key);
    rows.push({ channel_id: ch, l_num: lNum, kind: e.kind, ev_date: e.date, ev_time: t, summary: e.summary, state: e.state, source: "chat-export" });
  }
  return rows;
}
