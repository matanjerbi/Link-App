import { DurableObject } from "cloudflare:workers";
import PAGE from "./page.html";

const TTL = 24 * 60 * 60 * 1000; // room is wiped 24h after the last message
const MAX_MSGS = 300;

export class Room extends DurableObject {
  async fetch(req) {
    const msgs = (await this.ctx.storage.get("msgs")) || [];
    if (req.method === "POST") {
      let body;
      try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
      const text = String(body.text || "").trim().slice(0, 2000);
      const by = String(body.by || "").slice(0, 40);
      if (!text) return json({ error: "empty" }, 400);
      const lastAt = msgs.length ? msgs[msgs.length - 1].at : 0;
      const at = Math.max(Date.now(), lastAt + 1); // strictly increasing, used as cursor
      msgs.push({ text, by, at });
      while (msgs.length > MAX_MSGS) msgs.shift();
      await this.ctx.storage.put("msgs", msgs);
      await this.ctx.storage.setAlarm(Date.now() + TTL);
      return json({ ok: true, at });
    }
    const after = Number(new URL(req.url).searchParams.get("after")) || 0;
    return json({ msgs: msgs.filter(m => m.at > after) });
  }
  async alarm() { await this.ctx.storage.deleteAll(); }
}

function json(o, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    const m = u.pathname.match(/^\/api\/r\/([A-Za-z0-9]{3,8})$/);
    if (m) {
      if (req.method !== "GET" && req.method !== "POST") return json({ error: "method" }, 405);
      return env.ROOM.get(env.ROOM.idFromName(m[1].toUpperCase())).fetch(req);
    }
    if (u.pathname === "/" || u.pathname === "/index.html") {
      return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
    }
    return new Response("Not found", { status: 404 });
  }
};
