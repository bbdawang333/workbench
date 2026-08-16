// 编排器：KV 读写 + 按模式跑各子模块（任一失败不阻断其余，成功模块的结果照常保存）
import seed from "./seed.js";
import { updateStock } from "./stock.js";
import { scanResearch } from "./research.js";
import { updateDaily } from "./daily.js";
import { updateWeather } from "./weather.js";

export const KV_KEY = "wb_data";

export async function loadData(env) {
  let raw = await env.WB_DATA.get(KV_KEY);
  if (!raw) {
    raw = JSON.stringify(seed);
    await env.WB_DATA.put(KV_KEY, raw);
  }
  return JSON.parse(raw);
}

export async function saveData(env, data) {
  await env.WB_DATA.put(KV_KEY, JSON.stringify(data));
}

// mode='full' 全量更新（股票大盘+机会 / 课题 / 精进 / 天气）
// mode='intraday' 仅刷股价（持仓/自选/指数）
export async function runPipeline(env, mode = "full") {
  const data = await loadData(env);
  const results = {};
  const steps =
    mode === "full"
      ? [
          ["stock", () => updateStock(data, "full")],
          ["research", () => scanResearch(data)],
          ["daily", () => updateDaily(data)],
          ["weather", () => updateWeather(data)],
        ]
      : [["stock", () => updateStock(data, "intraday")]];

  for (const [name, fn] of steps) {
    try {
      await fn();
      results[name] = "ok";
    } catch (e) {
      results[name] = "fail: " + (e && e.message ? e.message : String(e));
      console.error("step fail:", name, e);
    }
  }

  try {
    await saveData(env, data);
  } catch (e) {
    console.error("save fail:", e);
    return { ok: false, mode, results, error: String(e) };
  }
  return { ok: true, mode, results };
}
