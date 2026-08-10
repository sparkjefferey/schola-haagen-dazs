import { Metadata } from "next";
import Link from "next/link";
import { Medallion } from "@/components/emblem";
import { IonicColumn, Scroll, Amphora } from "@/components/decor";
import { schoolYear } from "@/lib/format";

export const metadata: Metadata = { title: "学派志" };

export default function AboutPage() {
  const year = schoolYear();
  return (
    <div>
      <section className="hero" style={{ padding: "30px 0 10px" }}>
        <Medallion size={84} />
        <h1 className="big-title" style={{ marginTop: 10 }}>学 派 志</h1>
      </section>

      {/* 立学缘由 */}
      <section className="section">
        <h2 className="section-title">立学缘由</h2>
        <div className="grid2">
          <div className="card">
            <h3>名从天降，物有其名</h3>
            <p>
              Schola Häagen-Dazs——沙藏学馆，一名兼收两意：其一，Häagen-Dazs 乃冷食至艺，
              我们愿学派如同它一般，<b>用料诚、搅制精、虽冷而甘</b>；其二，何期末一隅之
              甘甜，实足以象征求知——入口凉冽，回甘悠长，正如治学，先苦思而后洞明。
            </p>
            <p>
              学派由两位好友于 {year - 2} 年夏夜，在结伴啃下一罐共享品之后立誓而成：
              「既同席而食，必同席而学。」
            </p>
          </div>
          <div className="card" style={{ textAlign: "center" }}>
            <Amphora size={70} color="var(--maroon)" />
            <h3>校训</h3>
            <p className="latin-motto">In Lacte, Veritas.</p>
            <p className="lead" style={{ fontSize: 15 }}>真理存于乳膏之中</p>
            <p style={{ fontSize: 14, color: "var(--ink-soft)" }}>
              兼有副训：「无引不立论，无思不落笔；且尝且议，好友共席。」
            </p>
          </div>
        </div>
      </section>

      {/* 章程 */}
      <section className="section">
        <h2 className="section-title">学派章程（初定）</h2>
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
        <h2 className="section-title">两阶之制</h2>
        <p style={{ maxWidth: 760, color: "var(--ink-soft)" }}>
          学派不设诸多品位，仅两阶：<b style={{ color: "var(--maroon-deep)" }}>管理者</b>与
          <b style={{ color: "var(--maroon-deep)" }}>学者</b>。注册时自择身份；管理者另有
          「燕京阁」调度学务，二者皆可发论文、论辩、入榜。
        </p>
        <div className="grid2">
          <div className="card">
            <h3>管理者 · Curator</h3>
            <p style={{ color: "var(--ink-soft)", fontSize: 15 }}>
              执掌学馆秩序：任免身份、删定过激之语、整理论文库、执掌学榜档案。
              管理者须经邀请函入学，且学派不可一日无主（至少保留一位管理者）。
            </p>
          </div>
          <div className="card">
            <h3>学者 · Scholar</h3>
            <p style={{ color: "var(--ink-soft)", fontSize: 15 }}>
              馆中自由人：著书立说、议坛纵横、评点他人篇章。学者之荣，全在文本之
              上；学问之誉，尽在榜中。注册即入学，无任何门费。
            </p>
          </div>
        </div>
      </section>

      {/* 学科门类 */}
      <section className="section">
        <h2 className="section-title">分科之制</h2>
        <div className="grid3">
          {[
            ["乳脂哲学", "以奶昔、奶油、酸奶之品性，喻形而上学诸命题。"],
            ["感官美学", "甜、冷、脆、绵——味道如何塑造记忆与情感。"],
            ["美食人类学", "一勺一勺的社会史：冰淇淋与文明。"],
            ["冷藏物理学", "晶相、成核、冰点与过冷——冷冻的科学。"],
            ["古文钞本", "旧时食单、谱牒、笔记的校勘与考释。"],
            ["学派史", "本学派自建学以来的档案与传说。"],
          ].map(([name, desc]) => (
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
          学派初立，章程可改，门墙常开。若你同好冷食与真理，欢迎入学同食同论。
        </p>
        <Link className="btn btn-gold" href="/register">入院注册</Link>
      </section>
    </div>
  );
}