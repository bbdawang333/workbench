// 股票模块：抓取实时行情，回写 holdings / watchlist / 指数 / 大盘环境 / 短线机会
import { emGet, secidFor, round, num, bjStamp, bjDate, beijingNow } from "./lib.js";

const IDX_CODES = ["000001", "399001", "399006", "000688"];
const IDX_NAME = {
  "000001": "上证指数",
  "399001": "深证成指",
  "399006": "创业板指",
  "000688": "科创50",
};
// 指数有明确市场归属（上证指数/科创50 在沪市 1.，深证成指/创业板指 在深市 0.），
// 不能用股票代码前缀规则推断
const IDX_SECID = {
  "000001": "1.000001",
  "399001": "0.399001",
  "399006": "0.399006",
  "000688": "1.000688",
};
// 全市场（沪深A股+沪深B股+深市基金+沪市基金），与原始 pipeline 的 FS 一致
const FS = "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23";

// 批量抓取行情（指数/持仓/自选），返回 {code: {name,price,chgPct,...}}
export async function fetchQuotes(codes) {
  const secids = Array.from(new Set(codes)).map((c) => IDX_SECID[c] || secidFor(c));
  const out = {};
  for (let i = 0; i < secids.length; i += 60) {
    const batch = secids.slice(i, i + 60);
    const params = {
      fltt: "2",
      invt: "2",
      fields: "f1,f2,f3,f4,f6,f8,f12,f13,f14,f20,f62",
      secids: batch.join(","),
    };
    let obj;
    try {
      obj = await emGet("/api/qt/ulist.np/get", params);
    } catch (e) {
      console.error("fetchQuotes batch fail:", e.message);
      continue;
    }
    const diff = (obj && obj.data && obj.data.diff) || [];
    for (const x of diff) {
      const code = String(x.f12 || "");
      if (!code) continue;
      out[code] = {
        name: x.f14 || code,
        price: num(x.f2),
        chgPct: num(x.f3),
        lastClose: num(x.f4),
        amount: num(x.f6),
        turnover: num(x.f8),
        mcap: num(x.f20),
        main: num(x.f62),
      };
    }
  }
  return out;
}

// 单次大批量抓取全市场，统计涨跌家数 + 成交额（替代原 70 次翻页，省 CPU）
async function fetchBreadth() {
  try {
    const obj = await emGet("/api/qt/clist/get", {
      pn: "1",
      pz: "6000",
      po: "1",
      np: "1",
      fltt: "2",
      invt: "2",
      fid: "f3",
      fs: FS,
      fields: "f3,f6",
    });
    const diff = (obj && obj.data && obj.data.diff) || [];
    if (diff.length < 4000) return null; // 数据不完整则降级
    let up = 0,
      dn = 0,
      fl = 0,
      amt = 0;
    for (const x of diff) {
      const c = num(x.f3);
      amt += num(x.f6);
      if (c > 0) up++;
      else if (c < 0) dn++;
      else fl++;
    }
    return { up, dn, fl, amtYi: amt / 1e8 };
  } catch (e) {
    console.error("fetchBreadth fail:", e.message);
    return null;
  }
}

// 抓涨幅榜前 15，作为短线机会素材
async function fetchGainers() {
  try {
    const obj = await emGet("/api/qt/clist/get", {
      pn: "1",
      pz: "15",
      po: "1",
      np: "1",
      fltt: "2",
      invt: "2",
      fid: "f3",
      fs: FS,
      fields: "f12,f14,f2,f3,f8,f62,f20",
    });
    return (obj && obj.data && obj.data.diff) || [];
  } catch (e) {
    console.error("fetchGainers fail:", e.message);
    return [];
  }
}

function tagFor(c) {
  const tags = [];
  if (c.chg >= 9.5) tags.push("涨停");
  else tags.push("强势拉升");
  if (c.turnover >= 5) tags.push("高换手");
  if (c.mainYi > 0.5) tags.push("主力净流入");
  return tags;
}

function reasonFor(c) {
  const parts = [`今日放量大涨${c.chg.toFixed(2)}%`];
  if (c.turnover) parts.push(`换手${c.turnover.toFixed(1)}%`);
  if (c.mainYi) parts.push(`主力净流入${c.mainYi.toFixed(1)}亿`);
  if (c.mcapYi) parts.push(`总市值约${Math.round(c.mcapYi)}亿`);
  parts.push(
    "量价齐升、资金关注度高，符合「强势动量」选股条件；注意已处高位，宜回踩不破再介入，勿追涨。"
  );
  return parts.join("，");
}

async function updateMarketAndOpps(data, quotes) {
  const stock = data.stock;
  const bkUp = stock.market.advance?.up ?? 0;
  const bkDn = stock.market.advance?.down ?? 0;
  const bkAmt = stock.market.amount || "待更新";

  // 涨幅榜 -> 候选（排除自身持仓/自选、排除 N/C 新股、涨幅>=4）
  const ownCodes = new Set([
    ...stock.holdings.map((h) => h.code),
    ...stock.watchlist.map((w) => w.code),
  ]);
  const glist = await fetchGainers();
  let cands = [];
  for (const x of glist) {
    const code = String(x.f12 || "");
    const name = x.f14 || "";
    const chg = num(x.f3);
    const price = num(x.f2);
    if (chg <= 0 || name.startsWith("N") || name.startsWith("C") || chg < 4) continue;
    if (ownCodes.has(code)) continue;
    cands.push({
      code,
      name,
      price,
      chg,
      turnover: num(x.f8),
      mainYi: num(x.f62) / 1e8,
      mcapYi: num(x.f20) / 1e8,
    });
  }
  cands.sort((a, b) => b.chg - a.chg);
  cands = cands.slice(0, 3);

  const newOps = cands.map((c) => ({
    name: c.name,
    code: c.code,
    reason: reasonFor(c),
    tags: tagFor(c),
    price: round(c.price, 2),
    changePct: round(c.chg, 2),
    score: {
      tech: Math.min(95, 60 + Math.round(c.chg)),
      fund: Math.min(95, 55 + (c.mainYi ? Math.round(c.mainYi * 10) : 30)),
      news: 72,
    },
    position: "0.5-1成（回踩5日线企稳再介入，忌追高）",
    stop: "跌破5日线或单日-7%",
  }));

  // 涨跌家数 + 成交额
  const breadth = await fetchBreadth();
  let up, dn, amtTxt;
  if (breadth && breadth.amtYi >= 1) {
    up = breadth.up;
    dn = breadth.dn;
    amtTxt =
      breadth.amtYi >= 10000
        ? `${(breadth.amtYi / 10000).toFixed(2)}万亿(截至15:00)`
        : `${Math.round(breadth.amtYi)}亿(截至15:00)`;
  } else {
    up = bkUp;
    dn = bkDn;
    amtTxt = bkAmt;
  }

  // 情绪研判（基于三大指数）
  const sh = quotes["000001"]?.chgPct ?? 0;
  const sz = quotes["399001"]?.chgPct ?? 0;
  const cyb = quotes["399006"]?.chgPct ?? 0;
  let mood;
  if (sh < 0 && cyb < 0)
    mood = `今日指数集体回调（上证${sh.toFixed(2)}%、创业板${cyb.toFixed(2)}%），个股跌多涨少，属「平步青云」策略下的缩量整理；建议控仓观望、保住前期利润，仅参与确定性强的回踩低吸，忌盘中追高。`;
  else if (sh > 0 && cyb > 0)
    mood = `今日指数共振反弹（上证${sh.toFixed(2)}%、创业板${cyb.toFixed(2)}%），赚钱效应回升；可半仓内积极参与强势主线，注意去弱留强。`;
  else
    mood = `今日沪${sh >= 0 ? "涨" : "跌"}深${sz >= 0 ? "涨" : "跌"}、指数分化震荡，资金防御倾向明显；建议半仓以下、聚焦业绩确定的核心标的，等待方向选择。`;

  const today = bjDate();
  stock.market = {
    indices: stock.market.indices.map((idx) => {
      const code = Object.keys(IDX_NAME).find((k) => IDX_NAME[k] === idx.name);
      const q = code ? quotes[code] : null;
      return q
        ? { ...idx, price: round(q.price, 2), chgPct: round(q.chgPct, 2) }
        : idx;
    }),
    advance: { up, down: dn },
    amount: amtTxt,
    north: "实时净买入已停披露；盘中参考以个股主力净流入为准",
    mood,
    hotSectors: stock.market.hotSectors || ["防御板块相对抗跌", "资源/有色", "算力硬件"],
    date: today,
  };
  if (newOps.length) stock.opportunities = newOps;
  return true;
}

// 主入口：mode='full' 含大盘+机会；mode='intraday' 仅刷价格
export async function updateStock(data, mode = "full") {
  const stock = data.stock;
  const codeList = [
    ...stock.holdings.map((h) => h.code),
    ...stock.watchlist.map((w) => w.code),
    ...IDX_CODES,
  ];
  const quotes = await fetchQuotes(codeList);

  // 指数
  for (const c of IDX_CODES) {
    const q = quotes[c];
    if (!q) continue;
    const idx = stock.market.indices.find((x) => x.name === IDX_NAME[c]);
    if (idx) {
      idx.price = round(q.price, 2);
      idx.chgPct = round(q.chgPct, 2);
    }
  }
  // 持仓
  for (const h of stock.holdings) {
    const q = quotes[h.code];
    if (!q) continue;
    h.price = round(q.price, 3);
    h.dayChg = round(q.chgPct, 2);
    if (h.cost) h.pnlPct = round(((q.price - h.cost) / h.cost) * 100, 2);
  }
  // 自选
  for (const w of stock.watchlist) {
    const q = quotes[w.code];
    if (!q) continue;
    w.price = round(q.price, 3);
    w.changePct = round(q.chgPct, 2);
  }

  if (mode === "full") {
    await updateMarketAndOpps(data, quotes);
  }
  if (data.updatedAt) data.updatedAt.stock = bjStamp();
  return true;
}
