import Link from "next/link";
import { timeAgo } from "@/lib/format";
import type { NoticeItem, NoticeKind } from "@/lib/notifications";

/**
 * 提醒栏。一套骨架、两种内容：
 *   kind='thread_reply' —— 「论辩回应」：我发的论题收到了哪些跟帖，点进去直达那一层楼
 *   kind='paper_tip'    —— 「论著得币」：我的论著收到了哪些墨银，点进去直达那篇稿
 *
 * 抽成一个组件而不是写两份：两者只差文案、链接与引文样式，骨架完全一致，
 * 分开写迟早会漂移成两种排版。
 */
export function NotificationPanel({ items, kind }: { items: NoticeItem[]; kind: NoticeKind }) {
  const isTip = kind === "paper_tip";

  return (
    <div className="chat-window">
      <div className="chat-head">{isTip ? "论著得币" : "论辩回应"}</div>
      <div className="chat-body">
        {items.length === 0 && (
          <p className="empty-note">
            {isTip
              ? "尚无同侪为你的论著投币。一旦有人投出墨银，此处即会记上一笔。"
              : "尚无同侪回应你的论题。一旦有人应帖，此处即会记上一笔。"}
          </p>
        )}
        {items.map((n) => {
          const latest = n.actors[n.actors.length - 1] || "同侪";
          // 论辩回应的 count 是「条数」，墨银的 count 是「枚数」——两者不能共用一句话。
          // 同一个人可以投 3 枚，若照抄「等 N 人」就是错的；人数得另看 actors（最多记 5 个）。
          const head = isTip
            ? n.actors.length > 1
              ? `${latest} 等 ${n.actors.length} 人投了 ${n.count} 枚墨银`
              : `${latest} 投了 ${n.count} 枚墨银`
            : n.count > 1
              ? `${latest} 等 ${n.count} 条回应`
              : `${latest} 回应了你的论题`;
          const href = isTip
            ? `/papers/${n.paper_id}`
            : n.last_reply_id
              ? `/forum/thread/${n.thread_id}#r${n.last_reply_id}`
              : `/forum/thread/${n.thread_id}`;
          const subject = isTip ? n.paper_title : n.thread_title;
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
              <div className="notice-title">《{subject}》</div>
              {n.excerpt && (
                <div className="notice-excerpt">{isTip ? n.excerpt : `“${n.excerpt}”`}</div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
