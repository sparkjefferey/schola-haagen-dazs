import { Metadata } from "next";
import RegisterForm from "./register-form";
import { IonicColumn } from "@/components/decor";

export const metadata: Metadata = { title: "入院注册" };

const REGISTER_ERRORS: Record<string, string> = {
  user: "用户名须为 2–20 位字母、数字、下划线或汉字。",
  pass: "密码至少 6 位。",
  taken: "该雅号已被他人先行注册，请另起一名。",
  invite: "管理者的邀请函无效、已用或已作废。",
  regrate: "注册过于频繁，已触发防刷限制。请稍候十分钟再试，或联系管理者。",
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string; tab?: string }>;
}) {
  const { e, tab } = await searchParams;
  return (
    <div style={{ maxWidth: 520, margin: "0 auto" }}>
      <section style={{ textAlign: "center", marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "center", gap: 12, color: "var(--maroon)" }}>
          <IonicColumn height={58} />
          <IonicColumn height={58} />
        </div>
        <h1 className="big-title" style={{ marginTop: 6 }}>入 院 注 册</h1>
        <p className="lead" style={{ fontSize: 15 }}>
          学者自由入学；管理者须执邀请函宣誓就任。
        </p>
      </section>
      {e && REGISTER_ERRORS[e] && (
        <p className="notice" style={{ color: "var(--maroon-deep)" }}>
          ✗ {REGISTER_ERRORS[e]}
        </p>
      )}
      <RegisterForm initialTab={(tab === "admin" ? "admin" : "scholar") as "admin" | "scholar"} />
    </div>
  );
}