// Test helper only: prints a file's contents to stdout, argv-driven so the
// providers.test.ts fixture test can exercise quotaAxiSource's real spawn →
// stdout → JSON.parse path (not just the pure mapping function) without
// depending on a shell or on quota-axi actually being installed.
import { readFileSync } from "node:fs";

process.stdout.write(readFileSync(process.argv[2], "utf8"));
