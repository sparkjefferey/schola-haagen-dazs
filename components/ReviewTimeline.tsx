import { PAPER_STATUS } from "@/lib/paper";
import { formatDate } from "@/lib/format";
import type { ReviewEvent } from "@/lib/db";

export function ReviewTimeline({
  events,
}: {
  events: (ReviewEvent & { actor_name: string | null })[];
}) {
  if (events.length === 0)
    return <p className="empty-note" style={{ padding: 16 }}>尚无审稿记录。</p>;
  return (
    <ol className="timeline">
      {events.map((e) => {
        const meta = e.to_status ? PAPER_STATUS[e.to_status as keyof typeof PAPER_STATUS] : null;
        return (
          <li className="timeline-item" key={e.id}>
            <span className="timeline-dot" style={{ background: meta?.dot ?? "#999" }} />
            <div className="timeline-body">
              <div className="timeline-title">
                {meta ? `${meta.label}（${meta.sub}）` : "状态变更"}
                <span className="timeline-time">{formatDate(e.created_at)}</span>
              </div>
              {e.note ? <p className="timeline-note">{e.note}</p> : null}
              {e.actor_name ? <div className="timeline-actor">— {e.actor_name}</div> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
