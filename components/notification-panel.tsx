import Link from "next/link";
import { timeAgo } from "@/lib/format";
import type { NoticeItem } from "@/lib/notifications";

/**
 * 论辩回应栏：我发的论题收到了哪些跟帖。
 * 每条点进去直达那一层楼（/forum/thread/:id#r:replyId）。
 */
export function NotificationPanel({ items }: { items: NoticeItem[] }) {
  return (
    <div className="chat-window">
      <div className="chat-head">论辩回应</div>
      <div className="chat-body">
        {items.length === 0 && (
          <p className="empty-note">
            尚无同侪回应你的论题。一旦有人应帖，此处即会记上一笔。
          </p>
        )}
        {items.map((n) => {
          const latest = n.actors[n.actors.length - 1] || "同侪";
          const head = n.count > 1 ? `${latest} 等 ${n.count} 条回应` : `${latest} 回应了你的论题`;
          const href = n.last_reply_id
            ? `/forum/thread/${n.thread_id}#r${n.last_reply_id}`
            : `/forum/thread/${n.thread_id}`;
          return (
            <Link
              key={n.id}
              href={href}
              className={`notice-item${n.read === 0 ? " is-unread" : ""}`}
            >
              <div className="notice-head">
                <b>{head}</b>
                <span className="meta">{timeAgo(n.updated_at)}</span>
              </div>
              <div className="notice-title">《{n.thread_title}》</div>
              {n.excerpt && <div className="notice-excerpt">“{n.excerpt}”</div>}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
