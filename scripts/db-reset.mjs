import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");

if (fs.existsSync(dataDir)) {
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log("🗑️  数据库已清除（data/ 目录）。请重跑 npm run seed 播种。");
} else {
  console.log("尚无数据库文件，无需重置。");
}