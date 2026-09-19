import type { JSX } from "react";
import { Inbox } from "./screens/Inbox.js";

/** apps/web/src/App.tsx — co-owned with W-025 (routing and nav, per
 * studio/briefs/W-024.md "Files owned"). W-024's slice is the whole of
 * the app so far: the Inbox at the default route, no nav, no hash
 * switching. W-025 wraps this in `<Nav>` and adds `/#/officina` without
 * removing this route. */
export function App(): JSX.Element {
  return <Inbox />;
}
