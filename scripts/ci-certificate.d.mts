/** W-370: the declarations `packages/cli` imports through; the certificate's check-run shape lives in ci-certificate.mjs. */
export const CERTIFICATE_CHECK: string;
export function readCertificate(
  reply: unknown,
  at: { sha: string; runId: number },
): { id: number; receipt: Buffer; certify: string[]; tail: string[] } | { why: string };
