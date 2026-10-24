// Headless Chromium (Playwright): serve web/ statically, open the page, run a scenario in a Web Worker, record
// output, timings and bytes transferred. Usage: node node/10_browser.mjs <scenario> <tag> [pandas] [--gzip] [--warm]
import http from "node:http";
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { ROOT } from "./boot.mjs";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const [scenario = "ch07.txt", tag = "ch07", pandas] = args.filter((a) => !a.startsWith("--"));
const web = path.join(ROOT, "web");
const types = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".json": "application/json",
  ".wasm": "application/wasm", ".zip": "application/zip", ".whl": "application/zip" };
let bytesSent = 0;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const file = path.join(web, decodeURIComponent(u.pathname === "/" ? "/index.html" : u.pathname));
  if (!file.startsWith(web) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  let body = fs.readFileSync(file);
  const headers = { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" };
  if (flags.has("--gzip") && /gzip/.test(req.headers["accept-encoding"] || "")) {
    body = zlib.gzipSync(body, { level: 9 }); headers["Content-Encoding"] = "gzip";
  }
  headers["Content-Length"] = body.length;
  bytesSent += body.length;
  res.writeHead(200, headers); res.end(body);
}).listen(0, "127.0.0.1");
await new Promise((r) => server.on("listening", r));
const url = `http://127.0.0.1:${server.address().port}/?scenario=${scenario}&tag=${tag}${pandas === "pandas" ? "&pandas=1" : ""}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const T0 = Date.now();
await page.goto(url);
await page.waitForFunction(() => window.spike && window.spike.done, null, { timeout: 600000, polling: 500 });
const wall = Date.now() - T0;
const spike = await page.evaluate(() => window.spike);
const ua = await page.evaluate(() => navigator.userAgent);
await browser.close();
server.close();
const log = path.join(ROOT, "logs", `10_browser_${scenario.replace(".txt", "")}${flags.has("--gzip") ? "_gzip" : ""}.log`);
fs.writeFileSync(log, spike.lines.join("\n") + "\n");
console.log(JSON.stringify({ ua, url, wallMs: wall, bytesSentMB: +(bytesSent / 1048576).toFixed(2), type: spike.type,
  timings: spike.timings, results: spike.results, error: spike.text, pageErrors: errors }, null, 1));
console.log("log written:", log);
