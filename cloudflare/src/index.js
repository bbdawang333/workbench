// Cloudflare Worker 入口：
//  - fetch: /data.js 从 KV 返回最新数据；静态资源走 ASSETS；/api/refresh 手动触发
//  - scheduled: 每天 08:00（UTC 0:00）全量更新；盘中每 30 分钟刷股价
import { runPipeline, KV_KEY } from "./pipeline.js";
import seed from "./seed.js";
import { toDataJs } from "./lib.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 拦截 /data.js：优先 KV，无则用种子（并回写 KV）
    if (path.endsWith("/data.js")) {
      let raw = await env.WB_DATA.get(KV_KEY);
      if (!raw) {
        raw = JSON.stringify(seed);
        ctx.waitUntil(env.WB_DATA.put(KV_KEY, raw));
      }
      return new Response(toDataJs(raw), {
        headers: {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "no-cache",
        },
      });
    }

    // 手动刷新：/api/refresh（盘中刷价）/api/refresh-full（全量）
    if (path === "/api/refresh" || path === "/api/refresh-full") {
      if (env.ADMIN_KEY) {
        const k = url.searchParams.get("key") || request.headers.get("x-admin-key");
        if (k !== env.ADMIN_KEY) return new Response("forbidden", { status: 403 });
      }
      const mode = path.endsWith("full") ? "full" : "intraday";
      ctx.waitUntil(
        runPipeline(env, mode).then((r) => console.log("refresh", mode, JSON.stringify(r.results)))
      );
      return new Response("refresh scheduled (mode=" + mode + ")", { status: 202 });
    }

    // 其余一律静态资源
    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    const mode = event.cron === "0 0 * * *" ? "full" : "intraday";
    ctx.waitUntil(
      runPipeline(env, mode).then((r) =>
        console.log("scheduled", event.cron, mode, JSON.stringify(r.results))
      )
    );
  },
};
