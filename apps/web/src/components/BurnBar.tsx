/**
 * apps/web/src/components/BurnBar.tsx — two right-aligned mono numerals
 * and a 4px rule filled to the spent fraction. Fraction/colour math lives
 * in ../lib/burn.ts so it's testable without a DOM.
 */
import { burnColor, burnFraction } from "../lib/burn.js";
import "./w025.css";

export interface BurnBarProps {
  spent: number;
  allowance: number;
}

export function BurnBar({ spent, allowance }: BurnBarProps) {
  const fraction = burnFraction(spent, allowance);
  const color = burnColor(spent, allowance);
  return (
    <div className="burn-bar">
      <span className="burn-bar__numerals">
        {spent} / {allowance}
      </span>
      <div className="burn-bar__rail">
        <div className={`burn-bar__fill burn-bar__fill--${color}`} style={{ width: `${fraction * 100}%` }} />
      </div>
    </div>
  );
}
