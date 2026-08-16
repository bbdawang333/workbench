// GitHub Actions 用：跑全量/盘中流水线，把最新数据写成根目录 data.js
// 复用 cloudflare/src/ 下的模块（数据源：东财、Open-Meteo、公开课题站）
import { writeFileSync } from "fs";
import { runPipeline, KV_KEY } from "./cloudflare/src/pipeline.js";
import { toDataJs } from "./cloudflare/src/lib.js";

class KVShim {
  constructor() { this.m = new Map(); }
  async get(k) { return this.m.has(k) ? this.m.get(k) : null; }
  async put(k, v) { this.m.set(k, v); return "ok"; }
}

const mode = process.argv.includes("--intraday") ? "intraday" : "full";
console.log(`▶ running pipeline mode=${mode}`);
const env = { WB_DATA: new KVShim() };
const res = await runPipeline(env, mode);
if (!res.ok) {
  console.error("pipeline failed:", res);
  process.exit(1);
}
const raw = await env.WB_DATA.get(KV_KEY);
writeFileSync("data.js", toDataJs(raw));
console.log("✓ data.js updated:", raw.length, "bytes");
