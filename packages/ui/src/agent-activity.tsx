export interface ActivityQueueItem {
  id: string;
  text: string;
}

export interface ActivityTimelineItem {
  id: string;
  name: string;
  timestamp: string;
  summary?: string;
}

export interface AgentActivityProps {
  queue: readonly ActivityQueueItem[];
  events: readonly ActivityTimelineItem[];
  onMoveEarlier: (id: string) => void;
  onMoveLater: (id: string) => void;
  onRunNow: (id: string) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}

export interface ActivityQueueProps {
  items: readonly ActivityQueueItem[];
  onMoveEarlier: (id: string) => void;
  onMoveLater: (id: string) => void;
  onRunNow: (id: string) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}

export function AgentActivity({
  queue,
  events,
  onMoveEarlier,
  onMoveLater,
  onRunNow,
  onEdit,
  onRemove,
}: AgentActivityProps) {
  return (
    <>
      <ActivityQueue
        items={queue}
        onEdit={onEdit}
        onMoveEarlier={onMoveEarlier}
        onMoveLater={onMoveLater}
        onRemove={onRemove}
        onRunNow={onRunNow}
      />
      {events.length === 0 ? <ActivityEmpty /> : <ActivityTimeline items={events} />}
    </>
  );
}

export function ActivityQueue({
  items,
  onMoveEarlier,
  onMoveLater,
  onRunNow,
  onEdit,
  onRemove,
}: ActivityQueueProps) {
  if (!items.length) return null;
  return (
    <section className="queue-panel">
      <header>
        <strong>Queued turns</strong>
        <span>{items.length}</span>
      </header>
      {items.map((turn, index) => (
        <article key={turn.id}>
          <span>{index + 1}</span>
          <p>{turn.text}</p>
          <div>
            <button
              disabled={index === 0}
              onClick={() => onMoveEarlier(turn.id)}
              title="Move earlier"
              type="button"
            >
              ↑
            </button>
            <button
              disabled={index === items.length - 1}
              onClick={() => onMoveLater(turn.id)}
              title="Move later"
              type="button"
            >
              ↓
            </button>
            <button onClick={() => onRunNow(turn.id)} type="button">
              Run now
            </button>
            <button onClick={() => onEdit(turn.id)} type="button">
              Edit
            </button>
            <button onClick={() => onRemove(turn.id)} type="button">
              Remove
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}

export function ActivityEmpty() {
  return (
    <div className="activity-empty">
      <span>⌁</span>
      <h3>Agent activity</h3>
      <p>Tool calls, turn status, child agents, and streaming events appear here.</p>
    </div>
  );
}

export function ActivityTimeline({ items }: { items: readonly ActivityTimelineItem[] }) {
  return (
    <ol className="event-list">
      {items.map((event) => (
        <li key={event.id}>
          <span className="event-dot" />
          <div>
            <strong>{event.name}</strong>
            <time>{event.timestamp}</time>
            {event.summary ? <p>{event.summary}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
