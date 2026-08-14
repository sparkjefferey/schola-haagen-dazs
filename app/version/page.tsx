"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type VersionInfo = {
  commit?: string;
  ref?: string;
  deployedAt?: string;
};

export default function VersionPage() {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/version.json")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setInfo(d))
      .catch(() => setError(true));
  }, []);

  const commit = info?.commit;
  const short = commit && commit !== "unknown" ? commit.slice(0, 7) : null;

  return (
    <div className="parchment-card" style={{ maxWidth: 760, margin: "40px auto" }}>
      <h1 style={{ fontFamily: "var(--display)", letterSpacing: "0.15em" }}>
        版本 · VERSIO
      </h1>
      <p style={{ color: "var(--ink-soft)", lineHeight: 1.8 }}>
        此页显示<strong>线上正在运行</strong>的代码版本。将下方 commit 与 GitHub 仓库
        <code> main </code>分支最新提交对照，一致即代表本次部署已生效。
      </p>

      {error && (
        <p style={{ color: "var(--maroon)" }}>
          未能读取版本信息（public/version.json 缺失）。可能尚未部署本次更新，或部署脚本未写入版本文件。
        </p>
      )}

      {info && (
        <dl style={{ lineHeight: 2.1, marginTop: 16 }}>
          <dt style={{ color: "var(--maroon)", fontWeight: 600 }}>部署提交（commit）</dt>
          <dd>
            <code>{commit ?? "unknown"}</code>
            {short && (
              <a
                style={{ marginLeft: 12 }}
                href={`https://github.com/sparkjefferey/schola-haagen-dazs/commit/${commit}`}
                target="_blank"
                rel="noreferrer"
              >
                在 GitHub 查看 ↗
              </a>
            )}
          </dd>
          <dt style={{ color: "var(--maroon)", fontWeight: 600 }}>分支（ref）</dt>
          <dd>
            <code>{info.ref ?? "unknown"}</code>
          </dd>
          <dt style={{ color: "var(--maroon)", fontWeight: 600 }}>部署时间（UTC）</dt>
          <dd>
            <code>{info.deployedAt ?? "unknown"}</code>
          </dd>
        </dl>
      )}

      <p style={{ marginTop: 24 }}>
        <Link href="/" className="btn btn-sm">
          返回首府
        </Link>
      </p>
    </div>
  );
}
