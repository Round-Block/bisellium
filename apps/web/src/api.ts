/** apps/web/src/api.ts — co-owned with W-025, append-only (studio/briefs/
 * W-024.md "Files owned"). W-024 owns `fetchInbox` and `submitAnswer`;
 * a later opus only appends its own fetch functions here, never removes
 * or edits these two. */

export interface InboxResponse {
  opera: { id: string; title: string; collegium: string; sella: string; traditio: unknown }[];
  petitiones: { id: string; opus: string; from: string; subject: string }[];
}

export interface AnswerResponse {
  ok: boolean;
  exitCode: number;
  output: string;
}

// `import.meta.env` only exists under Vite; the `?.` keeps this module
// loadable under plain node (apps/web/test/*.test.ts run via tsx, not vite).
const TOKEN: string = import.meta.env?.VITE_BISELLIUM_TOKEN ?? "";

/** GET /api/inbox. A non-200 response rejects with the numeric status
 * (behaviour 2) rather than a parsed body — the caller decides what a
 * 401/500 means. */
export async function fetchInbox(): Promise<InboxResponse> {
  const res = await fetch("/api/inbox");
  if (!res.ok) throw res.status;
  return (await res.json()) as InboxResponse;
}

/** POST /api/answer. `reply` carries the Patron's free-text response;
 * `askBack`/`charterGap` are only sent when true (apps/server/src/http.ts
 * only checks `body["askBack"] === true`). */
export async function submitAnswer(
  petitio: string,
  reply: string,
  opts?: { askBack?: boolean; charterGap?: boolean },
): Promise<AnswerResponse> {
  const body: Record<string, unknown> = { petitio, reply };
  if (opts?.askBack) body["askBack"] = true;
  if (opts?.charterGap) body["charterGap"] = true;
  const res = await fetch("/api/answer", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bisellium-Token": TOKEN,
    },
    body: JSON.stringify(body),
  });
  return (await res.json()) as AnswerResponse;
}
