// 公共工具：北京时区、四舍五入、东财抓取
// China 无夏令时，固定 UTC+8

export function beijingNow() {
  return new Date(Date.now() + 8 * 3600 * 1000);
}

export function bjStamp(d = beijingNow()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export function bjDate(d = beijingNow()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

export function dayOfYear(d = beijingNow()) {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const cur = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.floor((cur - start) / 86400000);
}

export function round(v, d = 2) {
  const p = Math.pow(10, d);
  return Math.round((Number(v) + Number.EPSILON) * p) / p;
}

export function num(v) {
  const n = parseFloat(v);
  return isFinite(n) ? n : 0;
}

// 把 JSON 安全地嵌入 JS 字符串字面量（转义 U+2028/U+2029 行分隔符，防语法错误）
export function toDataJs(raw) {
  const safe = raw.replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return "window.WB_DATA = " + safe + ";";
}

// 东方财富接口（返回 UTF-8 JSON，规避腾讯接口的 GBK 编码问题）
const EM_HOSTS = [
  "https://push2.eastmoney.com",
  "https://push2delay.eastmoney.com",
  "https://82.push2.eastmoney.com",
  "https://60.push2.eastmoney.com",
  "https://71.push2.eastmoney.com",
];
const EM_REF = "https://quote.eastmoney.com/";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export async function emGet(path, params, { retry = 4, timeout = 15000 } = {}) {
  let lastErr;
  for (let i = 0; i < retry; i++) {
    const host = EM_HOSTS[i % EM_HOSTS.length];
    const url = host + path + "?" + new URLSearchParams(params).toString();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Referer: EM_REF },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      await new Promise((r) => setTimeout(r, 700 + i * 300));
    }
  }
  throw lastErr || new Error("emGet failed: " + path);
}

// 股票代码 -> 东财 secid（1=上交所含基金/科创板，0=深交所含北交所）
export function secidFor(code) {
  const c = String(code).replace(/^(sh|sz|bj)/i, "");
  if (/^[69]/.test(c) || /^5/.test(c)) return "1." + c; // 沪市 / 沪市基金
  return "0." + c; // 深市 / 北交所
}
