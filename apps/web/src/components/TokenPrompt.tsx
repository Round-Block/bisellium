/**
 * apps/web/src/components/TokenPrompt.tsx — W-067. Screen-agnostic: mounted
 * once in App.tsx, above the routed screen, never a member of any screen.
 * Minimum viable: one field, one button. `postWrite` (api.ts) raises this
 * via `setUnauthorizedListener` on any write's 401 — an Inbox-local prompt
 * would satisfy this opus's own behaviours while leaving every later screen
 * (W-065's Seats, W-064's Board) with no working 401 path of its own.
 */
import { useState, type JSX } from "react";
import { setToken } from "../api.js";

export interface TokenPromptProps {
  onSubmit: () => void;
}

export function TokenPrompt({ onSubmit }: TokenPromptProps): JSX.Element {
  const [value, setValue] = useState("");

  function submit(): void {
    const trimmed = value.trim();
    if (!trimmed) return;
    setToken(trimmed);
    setValue("");
    onSubmit();
  }

  return (
    <div className="token-prompt">
      <label className="token-prompt__label" htmlFor="token-prompt-input">
        Paste the write-auth token <code>bisellium serve</code> printed
      </label>
      <input
        id="token-prompt-input"
        className="token-prompt__input"
        type="password"
        autoComplete="off"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
      />
      <button type="button" className="token-prompt__submit" onClick={submit}>
        Save token
      </button>
    </div>
  );
}
