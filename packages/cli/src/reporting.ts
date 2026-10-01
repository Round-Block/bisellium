/** Filesystem names are untrusted at plaintext reporting boundaries. Keep
 * labels single-line and bounded so an enumerated entry cannot inject a
 * diagnostic or make one unreasonably large. */
export const DIAGNOSTIC_LABEL_MAX_LENGTH = 120;

export function diagnosticLabel(value: string): string {
  const printable = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu, "");
  const characters = Array.from(printable);
  if (characters.length <= DIAGNOSTIC_LABEL_MAX_LENGTH) return printable;
  return `${characters.slice(0, DIAGNOSTIC_LABEL_MAX_LENGTH - 3).join("")}...`;
}
