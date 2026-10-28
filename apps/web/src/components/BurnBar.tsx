/** Budget pie plus visible mono text equivalent. Classification lives in
 * ../lib/burn.ts so malformed and over-allowance values fail consistently. */
import React from "react";
import { burnMeasure } from "../lib/burn.js";
import "./w025.css";

export interface BurnBarProps {
  spent: unknown;
  allowance: unknown;
}

export function BurnBar({ spent, allowance }: BurnBarProps) {
  const measure = burnMeasure(spent, allowance);
  if (measure === undefined) return <p className="budget-meter__unavailable">Budget unavailable.</p>;
  const stateLabel = measure.state === "over" ? "over allowance" : measure.state === "spent" ? "fully spent" : measure.state === "approaching" ? "approaching allowance" : "within allowance";
  return (
    <div className={`budget-meter budget-meter--${measure.state}`}>
      <span className="budget-meter__pie" style={{ "--budget-fraction": `${measure.fraction}turn` } as React.CSSProperties} aria-hidden="true" />
      <span className="budget-meter__reading">
        <span className="budget-meter__line">
          <span className={`severity-cue severity-cue--${measure.severity}`} data-budget-state={measure.state} aria-hidden="true" />
          <span className="budget-meter__numerals" aria-label={`${stateLabel}: ${measure.spent.toLocaleString()} tokens spent of ${measure.allowance.toLocaleString()} allowance`}>
            <span className="budget-meter__spent">{measure.spent.toLocaleString()}</span>
            <span className="budget-meter__separator">/</span>
            <span className="budget-meter__allowance">{measure.allowance.toLocaleString()}</span>
          </span>
        </span>
        {measure.over && <span className="budget-meter__over">+{measure.overBy.toLocaleString()} over</span>}
      </span>
    </div>
  );
}
