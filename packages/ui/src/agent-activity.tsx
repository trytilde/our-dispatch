import { CornerDownRightIcon, GripVerticalIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { motion, Reorder } from "motion/react";
import { useEffect, useRef, useState } from "react";

export interface ActivityQueueItem {
  id: string;
  text: string;
  queuePosition?: number;
  pending?: boolean;
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
  onReorder: (id: string, queuePosition: number) => void;
  onRunNow: (id: string) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}

export interface ActivityQueueProps {
  items: readonly ActivityQueueItem[];
  onReorder: (id: string, queuePosition: number) => void;
  onRunNow: (id: string) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}

export function queuePositionForIndex(
  items: readonly ActivityQueueItem[],
  destinationIndex: number,
): number {
  const previous = items[destinationIndex - 1]?.queuePosition;
  const next = items[destinationIndex + 1]?.queuePosition;
  if (typeof previous === "number" && typeof next === "number") {
    return Math.trunc((previous + next) / 2);
  }
  if (typeof next === "number") return next - 1;
  if (typeof previous === "number") return previous + 1;
  return destinationIndex;
}

export function AgentActivity({
  queue,
  events,
  onReorder,
  onRunNow,
  onEdit,
  onRemove,
}: AgentActivityProps) {
  return (
    <>
      <ActivityQueue
        items={queue}
        onEdit={onEdit}
        onReorder={onReorder}
        onRemove={onRemove}
        onRunNow={onRunNow}
      />
      {events.length === 0 ? <ActivityEmpty /> : <ActivityTimeline items={events} />}
    </>
  );
}

export function ActivityQueue({
  items,
  onReorder,
  onRunNow,
  onEdit,
  onRemove,
}: ActivityQueueProps) {
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [orderedItems, setOrderedItems] = useState([...items]);
  const orderedItemsRef = useRef(orderedItems);

  useEffect(() => {
    setOrderedItems([...items]);
  }, [items]);

  useEffect(() => {
    orderedItemsRef.current = orderedItems;
  }, [orderedItems]);

  if (!items.length) return null;

  const finishDrag = (item: ActivityQueueItem) => {
    setDraggedItemId(null);
    const sourceIndex = items.findIndex((candidate) => candidate.id === item.id);
    const destinationIndex = orderedItemsRef.current.findIndex(
      (candidate) => candidate.id === item.id,
    );
    if (sourceIndex < 0 || destinationIndex < 0 || sourceIndex === destinationIndex) return;
    onReorder(item.id, queuePositionForIndex(orderedItemsRef.current, destinationIndex));
  };

  return (
    <motion.section
      animate={{ opacity: 1, y: 0 }}
      aria-label="Queued messages"
      className="queue-panel"
      initial={{ opacity: 0, y: 18 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      <Reorder.Group
        axis="y"
        className="queue-list"
        onReorder={setOrderedItems}
        values={orderedItems}
      >
        {orderedItems.map((turn) => (
          <Reorder.Item
            aria-busy={turn.pending || undefined}
            as="li"
            className="queue-item"
            data-dragging={draggedItemId === turn.id || undefined}
            data-pending={turn.pending || undefined}
            drag={!turn.pending}
            key={turn.id}
            onDragEnd={() => finishDrag(turn)}
            onDragStart={() => setDraggedItemId(turn.id)}
            value={turn}
          >
            <span aria-label="Reorder queued message" className="queue-grip">
              <GripVerticalIcon aria-hidden="true" />
            </span>
            <span className="queue-message">{turn.text}</span>
            {turn.pending ? (
              <small className="queue-pending">Queuing…</small>
            ) : (
              <>
                <button
                  aria-label="Steer queued message"
                  className="queue-steer"
                  onClick={() => onRunNow(turn.id)}
                  onPointerDown={(event) => event.stopPropagation()}
                  type="button"
                >
                  <CornerDownRightIcon aria-hidden="true" />
                  <span>Steer</span>
                </button>
                <button
                  aria-label="Delete queued message"
                  className="queue-delete"
                  onClick={() => onRemove(turn.id)}
                  onPointerDown={(event) => event.stopPropagation()}
                  type="button"
                >
                  <Trash2Icon aria-hidden="true" />
                </button>
                <button
                  aria-label="Edit queued message"
                  className="queue-edit"
                  onClick={() => onEdit(turn.id)}
                  onPointerDown={(event) => event.stopPropagation()}
                  type="button"
                >
                  <PencilIcon aria-hidden="true" />
                </button>
              </>
            )}
          </Reorder.Item>
        ))}
      </Reorder.Group>
    </motion.section>
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
