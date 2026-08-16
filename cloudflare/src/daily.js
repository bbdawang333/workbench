// 每日精进轮播：按一年第几天确定性挑选 3 条写入 daily.news
import { DAILY_POOL } from "./pool.js";
import { dayOfYear, bjDate, bjStamp } from "./lib.js";

const N_PER_DAY = 3;

export async function updateDaily(data) {
  const doy = dayOfYear();
  const n = DAILY_POOL.length;
  const start = doy % n;
  const chosen = [];
  for (let i = 0; i < N_PER_DAY; i++) chosen.push(DAILY_POOL[(start + i) % n]);

  // 清洗：确保字段为字符串，换行转空格，避免破坏 JS
  data.daily.news = chosen.map((it) => ({
    title: String(it.title || ""),
    source: String(it.source || ""),
    field: String(it.field || ""),
    digest: String(it.digest || "").replace(/\s*\n\s*/g, " "),
    link: String(it.link || ""),
  }));
  data.daily.date = bjDate();
  if (data.updatedAt) data.updatedAt.daily = bjStamp();
  return true;
}
