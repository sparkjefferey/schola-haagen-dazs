import { timeAgo } from "@/lib/format";

export function SystemPanel({ messages }: { messages: any[] }) {
  return (
    <div className="chat-window">
      <div className="chat-head">系统通知</div>
      <div className="chat-body">
        {messages.length === 0 && <p className="empty-note">暂无系统通知。</p>}
        {messages.map((m: any) => (
          <div key={m.id} className="sys-msg">
            <p>{m.body}</p>
            <div className="meta">{timeAgo(m.created_at)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
