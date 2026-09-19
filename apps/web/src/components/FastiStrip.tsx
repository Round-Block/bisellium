/**
 * apps/web/src/components/FastiStrip.tsx — DIRECTION.md §4.2. 14 day
 * columns, 28px tall, directly under the nav. Day math lives in
 * ../lib/fasti.ts so it's testable without a DOM.
 */
import { buildFastiColumns, type ActaEntry } from "../lib/fasti.js";
import "./w025.css";

export interface FastiStripProps {
  acta: ActaEntry[];
  today: Date;
}

export function FastiStrip({ acta, today }: FastiStripProps) {
  const columns = buildFastiColumns(acta, today);
  return (
    <div className="fasti-strip">
      {columns.map((col) => (
        <div className="fasti-strip__column" key={col.date}>
          {col.isToday && <div className="fasti-strip__today-rule" />}
          <div className={`fasti-strip__tick fasti-strip__tick--${col.tick}`} />
          <div className="fasti-strip__weekday">{col.weekdayInitial}</div>
        </div>
      ))}
    </div>
  );
}
