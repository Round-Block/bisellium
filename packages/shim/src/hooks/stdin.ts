/**
 * @bisellium/shim/hooks — reads a Claude Code hook's JSON payload off
 * stdin (W-015). Every hook command must exit fast and never hang the
 * harness: `timeoutMs` (default 2000, the documented hard self-timeout)
 * bounds the wait for EOF, so a broken pipe or a stdin nobody ever closes
 * resolves to a timeout error rather than blocking the caller forever.
 */
export type ReadPayloadResult = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };

/** Never throws and never hangs past `timeoutMs`. A resolved `{ok:false}`
 *  covers every failure mode a caller needs to turn into "print one stderr
 *  line, exit 0": no data before EOF, unparseable JSON, a non-object JSON
 *  value, a stream error, or the timeout itself. */
export function readJsonFromStream(stream: NodeJS.ReadableStream, timeoutMs = 2000): Promise<ReadPayloadResult> {
  return new Promise((resolvePromise) => {
    let data = "";
    let settled = false;
    const finish = (result: ReadPayloadResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(result);
    };
    const timer = setTimeout(() => finish({ ok: false, error: `timed out after ${timeoutMs}ms reading hook payload from stdin` }), timeoutMs);
    // A real hook invocation must never be kept alive by this timer alone;
    // a test double that doesn't emulate Node's Timeout (rare) just skips this.
    if (typeof (timer as { unref?: () => void }).unref === "function") (timer as unknown as { unref: () => void }).unref();

    try {
      stream.setEncoding("utf8");
    } catch {
      // Not every injectable stream implements setEncoding; chunks below
      // are coerced to a string either way.
    }
    stream.on("data", (chunk: string | Buffer) => {
      data += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });
    stream.on("end", () => {
      if (data.trim() === "") {
        finish({ ok: false, error: "empty hook payload on stdin" });
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch (e) {
        finish({ ok: false, error: `invalid JSON on stdin: ${(e as Error).message}` });
        return;
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        finish({ ok: false, error: "hook payload must be a JSON object" });
        return;
      }
      finish({ ok: true, data: parsed as Record<string, unknown> });
    });
    stream.on("error", (e: Error) => finish({ ok: false, error: e.message }));
  });
}
