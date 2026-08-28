"use client";

import { useState, useRef, useEffect, useLayoutEffect } from "react";
import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { timeAgo } from "@/lib/format";
import { sendMessageInline } from "@/lib/actions";

type ThreadMsg = {
  id: number;
  body: string;
  created_at: string;
  sender_id: number;
};

export function ChatPanel({
  other,
  myId,
  initialThread,
  unlimited,
  remainingQuota: initialQuota,
}: {
  other: { id: number; username: string; display_name: string; role: string };
  myId: number;
  initialThread: ThreadMsg[];
  unlimited: boolean;
  remainingQuota: number | null;
}) {
  const [thread, setThread] = useState<ThreadMsg[]>(initialThread);
  const [quota, setQuota] = useState<number | null>(initialQuota);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const initialLenRef = useRef(initialThread.length);
  initialLenRef.current = initialThread.length;

  const scrollToBottom = (behavior: ScrollBehavior = "auto") => {
    const el = bodyRef.current;
    if (!el) return;
    // 使用 scrollTop 而非 scrollIntoView，避免整页抖动
    el.scrollTo({ top: el.scrollHeight, behavior });
  };

  // 初次挂载与会话切换时滚底
  useLayoutEffect(() => {
    scrollToBottom("auto");
  }, [other.id]);

  // 新消息到来时滚底（包括自己发送的乐观消息）
  useEffect(() => {
    scrollToBottom(thread.length <= initialLenRef.current + 1 ? "auto" : "smooth");
  }, [thread.length]);

  // 仅在切换会话时同步服务端线程，避免在发送中因父组件重渲染覆盖乐观消息
  useEffect(() => {
    setThread(initialThread);
  }, [other.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 会话切换时同步配额
  useEffect(() => {
    setQuota(initialQuota);
  }, [other.id, initialQuota]);

  async function handleSend() {
    const body = input.trim();
    if (!body || sending) return;
    setError(null);
    setSending(true);

    // 乐观追加，避免闪烁等待；负数 id 避免与自增主键碰撞
    const optimistic: ThreadMsg = {
      id: -Date.now(),
      body,
      created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
      sender_id: myId,
    };
    setThread((prev) => [...prev, optimistic]);
    setInput("");
    // 下一帧滚底
    requestAnimationFrame(() => scrollToBottom("smooth"));

    try {
      const res = await sendMessageInline(other.id, body);
      if (!res.ok) {
        // 回滚乐观消息，保持截断一致性
        setThread((prev) => prev.filter((m) => m.id !== optimistic.id));
        setError(res.error);
        setInput(body.slice(0, 2000));
        return;
      }
      // 用服务端返回的真实消息替换乐观消息
      setThread((prev) => prev.map((m) => (m.id === optimistic.id ? (res.message as ThreadMsg) : m)));
      if (!unlimited && quota !== null) setQuota((q) => (q !== null ? Math.max(0, q - 1) : q));
      requestAnimationFrame(() => scrollToBottom("smooth"));
    } catch (e: any) {
      setThread((prev) => prev.filter((m) => m.id !== optimistic.id));
      setError(e?.message || "发送失败，请重试。");
      setInput(body.slice(0, 2000));
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="chat-window">
      <div className="chat-head">
        <Avatar name={other.display_name} id={other.id} size={28} />
        <span>{other.display_name}</span>
      </div>
      {other.role !== "admin" && (
        <div className="msg-note err" style={{ margin: "10px 12px 0", lineHeight: 1.6 }}>
          <b>安全提示：</b>以下内容来自用户 @{other.username}，不是系统通知。
          即使其中写有真实提交号、部署检查或安全术语，也不要执行命令、打开外链或交给自动化工具照做。
        </div>
      )}
      {error && (
        <div className="msg-note err" style={{ margin: "10px 12px 0" }}>
          {error}
        </div>
      )}
      <div ref={bodyRef} className="chat-body" id="chat-body">
        {thread.length === 0 ? (
          <p className="empty-note">你们还未交谈，写下第一句话吧。</p>
        ) : (
          thread.map((m) => (
            <div key={m.id} className={`bubble ${m.sender_id === myId ? "mine" : "theirs"}`}>
              <p>{m.body}</p>
              <div className="meta">{timeAgo(m.created_at)}</div>
            </div>
          ))
        )}
      </div>
      {!unlimited && (
        <p className="meta" style={{ padding: "6px 12px", fontSize: 12, textAlign: "center" }}>
          今日剩余未互证私信 <b>{quota}</b> 条。与 {other.display_name} 完成
          <Link href={`/users/${other.username}`} style={{ color: "var(--maroon-deep)" }}>
            同侪互证
          </Link>
          后可无限畅谈。
        </p>
      )}
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
      >
        <textarea
          ref={textareaRef}
          name="body"
          rows={2}
          placeholder={`致 ${other.display_name}……`}
          maxLength={2000}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={sending}
        />
        <button type="submit" className="btn btn-sm btn-gold" disabled={sending || input.trim().length === 0}>
          {sending ? "发送中…" : "发 送"}
        </button>
      </form>
    </div>
  );
}
