/**
 * apps/web/src/components/GateLadder.tsx — DIRECTION.md §4.1. Reusable
 * across the Inbox and Officina screens. Mapping/width math lives in
 * ../lib/gateLadder.ts so it's testable without a DOM.
 */
import { gateLadderWidth, gateTitle, markKind, type Gate } from "../lib/gateLadder.js";
import "./w025.css";

export interface GateLadderProps {
  gates: Gate[];
}

export function GateLadder({ gates }: GateLadderProps) {
  const width = gateLadderWidth(gates.length);
  return (
    <div className="gate-ladder" style={{ width }}>
      {gates.map((gate, i) => (
        <div
          key={gate.id}
          className={`gate-ladder__mark gate-ladder__mark--${markKind(gate.status)}`}
          style={{ left: i * 9 }}
          title={gateTitle(gate)}
        />
      ))}
    </div>
  );
}
