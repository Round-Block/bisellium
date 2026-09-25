/**
 * apps/web/test/support/register-css-stub.mjs — preload target
 * (`node --import`) that registers css-stub-hook.mjs. See that file's header
 * for why.
 */
import { register } from "node:module";

register(new URL("./css-stub-hook.mjs", import.meta.url));
