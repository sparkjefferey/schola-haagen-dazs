import { Metadata } from "next";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { Medallion } from "@/components/emblem";
import { IonicColumn, Scroll, Amphora } from "@/components/decor";
import { schoolYear } from "@/lib/format";
import { getContentMap } from "@/lib/content";

/** 轻量富文本：仅支持 **加粗**，安全无 HTML 注入（不 dangerouslySetInnerHTML）。 */
function renderRich(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <b key={i} style={{ color: "var(--maroon-deep)" }}>{part.slice(2, -2)}</b>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

export const metadata: Metadata = { title: "学派志" };

export default async function AboutPage() {
  const year = schoolYear();
  const c = await getContentMap();
  return (
    <div>
      <section className="hero" style={{ padding: "30px 0 10px" }}>
        <Medallion size={84} />
        <h1 className="big-title" style={{ marginTop: 10 }}>学 派 志</h1>
      </section>

      {/* 立学缘由 */}
      <section className="section">
        <h2 className="section-title">{c.about_why_title}</h2>
        <div className="grid2">
          <div className="card">
            <h3>名从天降，物有其名</h3>
            <p>{renderRich(c.about_why_p1)}</p>
            <p>{renderRich(c.about_why_p2.replace("{year}", String(year - 2)))}</p>
          </div>
          <div className="card" style={{ textAlign: "center" }}>
            <Amphora size={70} color="var(--maroon)" />
            <h3>校训</h3>
            <p className="latin-motto">{c.about_motto_la}</p>
            <p className="lead" style={{ fontSize: 15 }}>{c.about_motto_cn}</p>
            <p style={{ fontSize: 14, color: "var(--ink-soft)" }}>
              {c.about_submotto}
            </p>
          </div>
        </div>
      </section>

      {/* 章程 */}
      <section className="section">
        <h2 className="section-title">{c.about_charter_title}</h2>
        <div className="grid3">
          <div className="card">
            <h3>壹 · 论学</h3>
            <ul style={{ paddingLeft: 22, color: "var(--ink-soft)" }}>
              <li>凡发表于论文库之文，皆以学派创作者署名，作者自担其诚。</li>
              <li>引他人文句，必注明出处；大题必附提要。</li>
              <li>论文一经刊出，可随时修订，学派存「修订之荣誉」。</li>
            </ul>
          </div>
          <div className="card">
            <h3>贰 · 议事</h3>
            <ul style={{ paddingLeft: 22, color: "var(--ink-soft)" }}>
              <li>论坛所议，务须就事论理，不作人身毁誉。</li>
              <li>论辩激烈可，失礼不可；学派永远欢迎反对意见。</li>
              <li>管理者（院长）与学者（馆员）同为学派主人，分工不同，礼序相同。</li>
            </ul>
          </div>
          <div className="card">
            <h3>叁 · 立言</h3>
            <ul style={{ paddingLeft: 22, color: "var(--ink-soft)" }}>
              <li>作者学榜按论著数与阅读量记功，供同侪瞻仰，亦当自勉。</li>
              <li>学派鼓励长文深耕，亦认可一句之悟：凡有证者，皆可立说。</li>
              <li>学派出游，以冰淇淋为牺牲之礼（蒙祭）。</li>
            </ul>
          </div>
        </div>
      </section>

      {/* 两阶之分 */}
      <section className="section">
        <h2 className="section-title">{c.about_two_ranks_title}</h2>
        <p style={{ maxWidth: 760, color: "var(--ink-soft)" }}>
          {renderRich(c.about_two_ranks_p)}
        </p>
        <div className="grid2">
          <div className="card">
            <h3>管理者 · Curator</h3>
            <p style={{ color: "var(--ink-soft)", fontSize: 15 }}>
              {renderRich(c.about_curator_desc)}
            </p>
          </div>
          <div className="card">
            <h3>学者 · Scholar</h3>
            <p style={{ color: "var(--ink-soft)", fontSize: 15 }}>
              {renderRich(c.about_scholar_desc)}
            </p>
          </div>
        </div>
      </section>

      {/* 学科门类 */}
      <section className="section">
        <h2 className="section-title">{c.about_disciplines_title}</h2>
        <div className="grid3">
          {c.about_disciplines
            .split("\n")
            .map((line) => {
              const i = line.indexOf("|");
              return i === -1 ? null : [line.slice(0, i).trim(), line.slice(i + 1).trim()];
            })
            .filter((x): x is [string, string] => Array.isArray(x))
            .map(([name, desc]) => (
            <div className="card" key={name} style={{ padding: 18 }}>
              <Scroll size={34} color="var(--gold-deep)" />
              <h3 style={{ margin: "8px 0 6px", fontSize: 17 }}>{name}</h3>
              <p style={{ fontSize: 14.5, color: "var(--ink-soft)" }}>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 页脚倡议 */}
      <section className="section" style={{ textAlign: "center" }}>
        <div className="ornament-divider">✻</div>
        <div style={{ display: "flex", justifyContent: "center", gap: 12, color: "var(--ink-soft)" }}>
          <IonicColumn height={64} />
          <Scroll size={40} />
          <Amphora size={40} />
        </div>
        <p className="lead" style={{ marginTop: 18 }}>
          {c.about_footer_appeal}
        </p>
        <Link className="btn btn-gold" href="/register">入院注册</Link>
      </section>
    </div>
  );
}