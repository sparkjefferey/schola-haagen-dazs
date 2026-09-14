import { Metadata } from "next";
import RegisterForm from "./register-form";
import { IonicColumn } from "@/components/decor";
import { createCaptcha } from "@/lib/captcha";

export const metadata: Metadata = { title: "入院注册" };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string; tab?: string }>;
}) {
  const { e, tab } = await searchParams;
  // 注册页每次渲染出一道算式验证码：机器人无法预取囤积（一次性、5 分钟过期）。
  const captcha = createCaptcha("register");
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
      {/* 退回码交给表单处理：由它把出错的那一栏描红 + 聚焦，顶部一并给出说明
          （错误文案与"该指向哪一栏"统一放在 lib/register-errors.ts）。 */}
      <RegisterForm
        initialTab={(tab === "admin" ? "admin" : "scholar") as "admin" | "scholar"}
        captcha={captcha}
        errorCode={e}
      />
    </div>
  );
}