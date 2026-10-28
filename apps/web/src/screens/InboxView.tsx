import { useEffect, useRef, type JSX } from "react";
import type { InboxResponse } from "../api.js";
import { askBlocks, canSubmit, datePresentation, evidenceLinks, type Verb } from "./inboxLogic.js";

export interface InboxViewProps {
  petitiones: InboxResponse["petitiones"];
  opera: InboxResponse["opera"];
  focusIndex: number;
  /** The item opened as the narrow full-screen detail; wide layouts always show the focused item. */
  expandedId?: string | null;
  /** Incremented when keyboard movement, back, or reconciliation must reveal the selected row. */
  focusRequest?: number;
  reason: string;
  error?: string | null;
  confirmation?: string;
  notice?: string;
  busy?: boolean;
  readPetitionIds?: ReadonlySet<string>;
  /** A selected decision removed by an ordinary refresh, retained until the Patron chooses another row. */
  detachedPetition?: InboxResponse["petitiones"][number] | null;
  decisionUnavailable?: boolean;
  onReasonChange: (value: string) => void;
  onFocusChange: (index: number) => void;
  onExpandChange?: (id: string | null) => void;
  onRead?: (id: string) => void;
  onReturnToList?: () => void;
  onSubmit: (petitioId: string, verb: Verb) => void;
}

const VERBS: { verb: Verb; key?: string }[] = [
  { verb: "approve", key: "1" },
  { verb: "defer", key: "2" },
  { verb: "decline", key: "3" },
  { verb: "delegate" },
];

export function InboxView(props: InboxViewProps): JSX.Element {
  const {
    petitiones, focusIndex, expandedId = null, focusRequest = 0,
    reason, error, confirmation, notice, busy = false, readPetitionIds = new Set<string>(),
    detachedPetition = null, decisionUnavailable = false,
    onReasonChange, onFocusChange, onExpandChange = () => undefined, onReturnToList = () => undefined, onSubmit,
    onRead = () => undefined,
  } = props;
  const focusedPetition = petitiones[focusIndex];
  const selectedPetition = detachedPetition ?? petitiones.find((petitio) => petitio.id === expandedId) ?? focusedPetition;
  const focusedItemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (focusRequest === 0) return;
    focusedItemRef.current?.focus({ preventScroll: true });
    focusedItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [focusRequest, focusedPetition?.id]);

  if (petitiones.length === 0) {
    return (
      <div className="inbox inbox--empty">
        <h1 className="inbox__title">Inbox</h1>
        {confirmation && <p className="inbox__confirmation">{confirmation}</p>}
        <p className="inbox__empty">{notice ?? "Nothing waiting on you"}</p>
      </div>
    );
  }

  const selectedLinks = selectedPetition ? evidenceLinks(selectedPetition.body) : [];
  const delegateDescriptionId = selectedPetition ? `delegate-unavailable-${selectedPetition.id}` : undefined;

  return (
    <div className={["inbox", expandedId !== null && "inbox--detail-open"].filter(Boolean).join(" ")}>
      <h1 className="inbox__title">Inbox</h1>
      {confirmation && <p className="inbox__confirmation">{confirmation}</p>}
      <div className={["inbox__workspace", expandedId !== null && "inbox__workspace--detail"].filter(Boolean).join(" ")}>
        <div className="inbox__mobile-header">
          <button
            type="button"
            className="inbox__back"
            aria-label="Back to Inbox"
            onClick={() => { onExpandChange(null); onReturnToList(); }}
          >
            <span aria-hidden="true">←</span> Back
          </button>
          <h1 className="inbox__mobile-title">Inbox</h1>
        </div>
        <section className="inbox__list-pane" aria-label="Needs your decision">
          <div className="inbox__queue" role="listbox" aria-label="Needs your decision">
            {petitiones.map((petitio, index) => {
              const hasFocus = index === focusIndex;
              const unread = !readPetitionIds.has(petitio.id);
              const notified = datePresentation(petitio.opened);
              return (
                <button
                  key={petitio.id}
                  type="button"
                  className={["inbox__item", "inbox__row", hasFocus && !decisionUnavailable && "inbox__item--focused", unread && "inbox__item--unread"].filter(Boolean).join(" ")}
                  data-focused={hasFocus && !decisionUnavailable}
                  ref={hasFocus ? focusedItemRef : undefined}
                  role="option"
                  aria-selected={hasFocus && !decisionUnavailable}
                  tabIndex={hasFocus ? 0 : -1}
                  onFocus={() => onFocusChange(index)}
                  onClick={() => { onFocusChange(index); onRead(petitio.id); onExpandChange(petitio.id); }}
                >
                  <span className="inbox__row-meta">
                    <span className="inbox__sella">{petitio.from}</span>
                    <span className="inbox__date">{notified}</span>
                  </span>
                  <span className="inbox__subject">{petitio.subject}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="inbox__reading-pane" aria-label="Selected decision">
          {selectedPetition && (
            <div className="inbox__expansion">
              <div className="inbox__reading-scroll">
                <div className="inbox__reading">
                  <div className="inbox__meta"><span>{selectedPetition.opus}</span><span>from {selectedPetition.from}</span><span>{datePresentation(selectedPetition.opened)}</span></div>
                  <h2 className="inbox__expanded-subject">{selectedPetition.subject}</h2>
                  <div className="inbox__ask">
                    {selectedPetition.body ? askBlocks(selectedPetition.body).map((block, index) => {
                      if (block.kind === "unordered") return <ul key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>;
                      if (block.kind === "ordered") return <ol key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ol>;
                      return <p key={index}>{block.text}</p>;
                    }) : <p>No content provided.</p>}
                  </div>
                  {selectedLinks.length > 0 && (
                    <div className="inbox__evidence" aria-label="Evidence">
                      <span className="inbox__evidence-label">Evidence</span>
                      {selectedLinks.map((link) => link.actionable
                        ? <a key={link.href} href={link.href}>{link.label}</a>
                        : (
                          <span key={link.href} className="inbox__evidence-unavailable">
                            <span>{link.label}</span> <code>{link.href}</code> — Not available in this console
                          </span>
                        ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="inbox__action-bar">
                <div className="inbox__action-bar-inner">
                  <label className="inbox__ratio-label" htmlFor={`ratio-${selectedPetition.id}`}>Ratio decidendi</label>
                  <input
                    id={`ratio-${selectedPetition.id}`}
                    className="inbox__input-ratio"
                    value={reason}
                    onChange={(event) => onReasonChange(event.target.value)}
                    placeholder="Reason for this decision"
                  />
                  <div className="inbox__decision-panel" />
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
