// 前沿课题抓取：尽力抓取公开课题/申报网站，更新 research.grants
// 策略：种子保底 + best-effort 抓取 + 按标题去重 + 过滤已过期。任何失败都不清空。
import { bjDate } from "./lib.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36";

// 种子列表（保底，绝不因抓取失败而清空）
const SEED = [
  { title: "数智赋能职业教育教学改革创新孵化研究课题", org: "中国职业技术教育学会智能融媒体专业委员会", deadline: "2026-08-20", link: "https://www.chinazy.org/info/1044/21954.htm", field: "AI赋能职教课程改革，与在研课题直接对口" },
  { title: "高校毕业生就业协会2026年度规划课题", org: "高校毕业生就业协会", deadline: "2026-09-10", link: "https://www.chinaafse.cn/info/1023/2831.htm", field: "就业创业主线，设青年课题，中级职称可报" },
  { title: "2026年福建省教育科学规划课题", org: "福建省教育科学规划领导小组办公室", deadline: "2026-09-15", link: "https://jyt.fujian.gov.cn/ztzl/fjsjykxyjs/tzgg/202606/t20260629_7169198.htm", field: "本省省级课题，需校内限额推荐" },
  { title: "2026年度高等学校专业发展与就业育人研究专项课题", org: "高校毕业生就业协会专业发展与就业促进工作委员会", deadline: "2026-09-20", link: "https://www.chinaafse.cn/info/1023/2910.htm", field: "主打AI赋能就业育人，契合生成式AI选题" },
  { title: "中国教育发展战略学会人才发展专委会2027年度课题", org: "中国教育发展战略学会人才发展专业委员会", deadline: "2026-09-25", link: "https://hr.edu.cn/zwhzx/202606/t20260605_2741261.shtml", field: "需学会会员资格，可自拟生涯发展类选题" },
  { title: "教育部产学合作协同育人项目（创新创业教育改革类）", org: "教育部高等教育司", deadline: "以通知为准", link: "http://cxhz.hep.com.cn", field: "随时征集下半年批次，双创教改可直接申报" },
];

const SOURCES = [
  { name: "中国职业技术教育学会", url: "https://www.chinazy.org/ktzx.htm" },
  { name: "高校毕业生就业协会", url: "https://www.chinaafse.cn/xwzx/tzgg.htm" },
  { name: "全国哲学社会科学工作办公室", url: "https://www.nopss.gov.cn/GB/219469/index.html" },
  { name: "教育部产学合作协同育人", url: "https://cxhz.hep.com.cn/mhxt/declareProject" },
];

const DATE_RE = /(20\d{2}[-/年.]\d{1,2}[-/月.]\d{1,2}日?)/;

function normDate(s) {
  if (!s) return null;
  s = String(s).replace(/年/g, "-").replace(/月/g, "-").replace(/日/g, "").replace(/\//g, "-").replace(/\./g, "-");
  s = s.replace(/-+/g, "-").replace(/^-|-$/g, "");
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return isNaN(d.getTime()) ? null : d;
}

function extractItems(html, sourceName) {
  const items = [];
  if (!html) return items;
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const link = m[1];
    const title = m[2].replace(/<[^>]+>/g, "").trim();
    if (title.length < 6) continue;
    if (!/课题|申报|项目/.test(title)) continue;
    const ctx = html.slice(Math.max(0, m.index - 200), m.index + m[0].length + 200);
    const dm = DATE_RE.exec(ctx);
    const deadline = dm ? normDate(dm[1]) : null;
    const absLink = link.startsWith("http") ? link : "https://www.chinazy.org/" + link;
    const field = /教育|教学|职业|就业/.test(title) ? "教育类" : "创新创业类";
    items.push({
      title: title.slice(0, 80),
      org: sourceName,
      deadline: deadline ? toYMD(deadline) : "以通知为准",
      link: absLink,
      field,
    });
  }
  return items.slice(0, 8);
}

function toYMD(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

async function fetchHtml(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Referer: url } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.text();
  } catch (e) {
    console.error("fetch fail", url, e.message);
    return "";
  }
}

export async function scanResearch(data) {
  const [yy, mm, dd] = bjDate().split("-").map(Number);
  const today = new Date(Date.UTC(yy, mm - 1, dd));
  const found = [];
  for (const s of SOURCES) {
    const html = await fetchHtml(s.url);
    const items = extractItems(html, s.name);
    console.log("源", s.name, "-> 候选", items.length);
    found.push(...items);
  }

  // 合并去重（按标题）
  const seen = new Set();
  const merged = [];
  for (const it of [...found, ...SEED]) {
    const key = String(it.title).trim();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(it);
  }

  // 过滤已过期（仅对明确日期者）
  let kept = merged.filter((it) => {
    const dl = normDate(it.deadline);
    return !(dl && dl.getTime() < today.getTime());
  });

  // 至少保留种子
  if (!kept.length) {
    kept = SEED.filter((x) => {
      const dl = normDate(x.deadline);
      return !dl || dl.getTime() >= today.getTime();
    });
  }
  kept = kept.slice(0, 12);

  data.research.grants = kept;
  if (data.updatedAt) data.updatedAt.research = bjDate();
  return true;
}
