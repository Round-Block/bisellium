/**
 * apps/web/tests-serve/states-policy.ts — W-341 (D-090 C). The served states suite's one exception list. The axe scan
 * disables no rule: colour contrast included, every rule axe-core runs by default is a test row, and any violation
 * fails the task (the Patron, 2026-10-22). A clean scan is not claimed as full conformance.
 */
/** Cells the phone layout cannot reach today, each with its reason; every served cell currently runs at both widths. */
export const PHONE_UNREACHABLE: Readonly<Record<string, string>> = {};
