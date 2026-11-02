import { useEffect, useRef, type JSX } from "react";
import type { InboxResponse } from "../api.js";
import type { AttentionRow, CardRow } from "../lib/board.js";
import { askBlocks, canSubmit, datePresentation, evidenceLinks, type Verb } from "./inboxLogic.js";

export interface InboxViewProps {
  items: AttentionRow[];
  focusIndex: number;
  /** The item opened as the narrow full-screen detail; wide layouts always show the focused item. */
  expandedId?: string | null;
  /** Incremented when keyboard movement, back, or reconciliation must reveal the selected row. */
  focusRequest?: number;
  reason: string;
  error?: string | null;
  confirmation?: string;
  notice?: string;
  noticeIsFailure?: boolean;
  busy?: boolean;
  readPetitionIds?: ReadonlySet<string>;
  /** A selected decision removed by an ordinary refresh, retained until the Patron chooses another row. */
  detachedPetition?: InboxResponse["petitiones"][number] | null;
  decisionUnavailable?: boolean;
  onReasonChange: (value: string) => void;
  onFocusChange: (index: number) => void;
  onExpandChange?: (id: string | null) => void;
  onRead?: (id: string) => void;
  onOpenBoard?: (opusId: string) => void;
  onReturnToList?: () => void;
  onSubmit: (petitioId: string, verb: Verb) => void;
}

const VERBS: { verb: Verb; key?: string }[] = [
  { verb: "approve", key: "1" },
  { verb: "defer", key: "2" },
  { verb: "decline", key: "3" },
  { verb: "delegate" },
];

function askKindLabel(ask: NonNullable<CardRow["asks"]>[number]): string {
  return ask.kind === "greenlight"
    ? "Greenlight"
    : ask.kind === "inbox"
      ? ask.count === 1 ? "Inbox decision" : `${ask.count} Inbox decisions`
      : "Human gate";
}

function askKindText(item: AttentionRow): string {
  return item.asks?.map(askKindLabel).join(", ") ?? "Waiting on you";
}

function attentionAsker(item: AttentionRow): string {
  return item.petitio?.from ?? "Board";
}

function attentionDate(item: AttentionRow): string {
  if (item.petitio !== undefined) return datePresentation(item.petitio.opened);
  return item.waitingSince === undefined ? "–" : datePresentation(item.waitingSince);
}

/** A withdrawn detail owns the selection until the Patron chooses a live row. */
export function liveSelectedAttentionItem(
  selectedItem: AttentionRow | undefined,
  detachedPetition: InboxResponse["petitiones"][number] | null,
): AttentionRow | undefined {
  return detachedPetition === null ? selectedItem : undefined;
}

export function InboxView(props: InboxViewProps): JSX.Element {
  const {
    items, focusIndex, expandedId = null, focusRequest = 0,
    reason, error, confirmation, notice, busy = false, readPetitionIds = new Set<string>(),
    noticeIsFailure = false,
    detachedPetition = null, decisionUnavailable = false,
    onReasonChange, onFocusChange, onExpandChange = () => undefined, onReturnToList = () => undefined, onSubmit,
    onRead = () => undefined, onOpenBoard = () => undefined,
  } = props;
  const focusedItem = items[focusIndex];
  const selectedItem = items.find((item) => item.attentionKey === expandedId) ?? focusedItem;
  const liveSelectedItem = liveSelectedAttentionItem(selectedItem, detachedPetition);
  const item = liveSelectedItem;
  const focusedPetition = focusedItem?.petitio;
  const selectedPetition = detachedPetition ?? selectedItem?.petitio;
  const focusedItemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (focusRequest === 0) return;
    focusedItemRef.current?.focus({ preventScroll: true });
    focusedItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [focusRequest, focusedItem?.attentionKey]);

  if (items.length === 0 && detachedPetition === null) {
    return (
      <div className="inbox inbox--empty">
        <h1 className="inbox__title">Inbox</h1>
        {confirmation && <p className="inbox__confirmation">{confirmation}</p>}
        <p className={["inbox__empty", noticeIsFailure && "inbox__notice--failure"].filter(Boolean).join(" ")}>{notice ?? "Nothing waiting on you"}</p>
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
          {notice !== undefined && <p className={["screen-notice", noticeIsFailure && "inbox__notice--failure"].filter(Boolean).join(" ")}>{notice}</p>}
          <div className="inbox__queue" role="listbox" aria-label="Needs your decision">
            {items.length === 0 ? <p className="inbox__empty">Nothing waiting on you</p> : items.map((item, index) => {
              const hasFocus = index === focusIndex;
              const petitio = item.petitio;
              const unread = petitio !== undefined && !readPetitionIds.has(petitio.id);
              const notified = attentionDate(item);
              const asks = askKindText(item);
              return (
                <button
                  key={item.attentionKey}
                  type="button"
                  className={["inbox__item", "inbox__row", hasFocus && !decisionUnavailable && "inbox__item--focused", unread && "inbox__item--unread"].filter(Boolean).join(" ")}
                  data-focused={hasFocus && !decisionUnavailable}
                  ref={hasFocus ? focusedItemRef : undefined}
                  role="option"
                  aria-selected={hasFocus && !decisionUnavailable}
                  tabIndex={hasFocus ? 0 : -1}
                  onFocus={() => onFocusChange(index)}
                  onClick={() => {
                    onFocusChange(index);
                    if (item.destination === "board") {
                      onOpenBoard(item.id);
                      return;
                    }
                    if (petitio !== undefined) onRead(petitio.id);
                    onExpandChange(item.attentionKey);
                  }}
                >
                  <span className="inbox__row-meta">
                    <span className="inbox__sella">{attentionAsker(item)}</span>
                    <span className="inbox__date">{notified}</span>
                  </span>
                  <span className="inbox__subject">{petitio?.subject ?? item.title}</span>
                  <span className={["inbox__ask-kind", item.destination === "inbox" && "inbox__ask-kind--full"].filter(Boolean).join(" ")}>{asks}</span>
                  {item.destination === "board" && <span className="inbox__route">Opens Board drawer</span>}
                </button>
              );
            })}
          </div>
          <div className="inbox__secondary" aria-label="Other Inbox groups">
            <p>You asked <span>Not available yet</span></p>
            <p>For information <span>Not available yet</span></p>
          </div>
        </section>

        <section className="inbox__reading-pane" aria-label="Selected decision">
          {liveSelectedItem?.destination === "board" && (
            <div className="inbox__expansion inbox__expansion--board">
              <div className="inbox__reading-scroll">
                <div className="inbox__reading">
                  <div className="inbox__meta"><span>{liveSelectedItem.id}</span><span>from Board</span><span>{attentionDate(liveSelectedItem)}</span></div>
                  <h2 className="inbox__expanded-subject">{liveSelectedItem.title}</h2>
                  <p className="inbox__board-asks">{askKindText(liveSelectedItem)}</p>
                  <button type="button" className="inbox__board-route" onClick={() => onOpenBoard(liveSelectedItem.id)}>Open Board drawer</button>
                </div>
              </div>
            </div>
          )}
          {selectedPetition && (detachedPetition !== null || (item && item.destination === "inbox")) && (
            <div className="inbox__expansion">
              <div className="inbox__reading-scroll">
                <div className="inbox__reading">
                  <div className="inbox__meta"><span>{selectedPetition.opus}</span><span>from {selectedPetition.from}</span><span>{datePresentation(selectedPetition.opened)}</span></div>
                  <h2 className="inbox__expanded-subject">{selectedPetition.subject}</h2>
                  {liveSelectedItem?.boardEntry && liveSelectedItem.asks?.some((ask) => ask.kind !== "inbox") && (
                    <button type="button" className="inbox__board-route" onClick={() => onOpenBoard(liveSelectedItem.id)}>Open Board actions</button>
                  )}
                  <div className="inbox__ask">
                    {selectedPetition.body ? askBlocks(selectedPetition.body).map((block, index) => {
                      if (block.kind === "unordered") return <ul key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>;
                      if (block.kind === "ordered") return <ol key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ol>;
                      return <p key={index}>{block.text}</p>;
                    }) : <p>No content provided.</p>}
                  </div>
                  {liveSelectedItem?.evidenceBindings !== undefined && liveSelectedItem.evidenceBindings.length > 0 && (
                    <div className="inbox__decision-evidence" aria-label="Decision evidence">
                      <span className="inbox__evidence-label">Decision evidence</span>
                      {liveSelectedItem.evidenceStale && <p className="inbox__evidence-stale">Evidence changed since it was shown.</p>}
                      {liveSelectedItem.evidenceBindings.map((binding) => (
                        <div key={binding.gate} className="inbox__decision-evidence-row">
                          <strong>{binding.label}</strong>
                          <dl>
                            <div><dt>Reviewed revision</dt><dd><code title={binding.revision}>{binding.revision ?? "Not recorded."}</code></dd></div>
                            <div><dt>Gate result</dt><dd>{binding.gate} · {binding.status}</dd></div>
                            <div><dt>Decision record</dt><dd>{binding.record ? <a href={binding.record}>{binding.record}</a> : "Not recorded."}</dd></div>
                          </dl>
                        </div>
                      ))}
                    </div>
                  )}
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
                  <div className="inbox__decision-panel">
                    {notice !== undefined && <p className={["screen-notice", noticeIsFailure && "inbox__notice--failure"].filter(Boolean).join(" ")}>{notice}</p>}
                    {decisionUnavailable && <p className="inbox__withdrawn">This petitio no longer needs a decision.</p>}
                    {error && <p className="inbox__error">{error}</p>}
                    <div className="inbox__action-group">
                      {VERBS.map(({ verb, key }) => {
                        const unavailable = verb === "delegate";
                        return (
                          <button
                            key={verb}
                            type="button"
                            className="inbox__btn-action"
                            disabled={decisionUnavailable || unavailable || !canSubmit(reason, busy)}
                            aria-describedby={unavailable ? delegateDescriptionId : undefined}
                            onClick={() => onSubmit(selectedPetition.id, verb)}
                          >
                            {key && <span className="inbox__hotkey">{key}</span>}
                            {verb}
                          </button>
                        );
                      })}
                    </div>
                    <p id={delegateDescriptionId} className="inbox__delegate-note">Delegation is not available yet</p>
                    <p className="inbox__nav-hint">j/k move · Esc back</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
