const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = process.env.PORT || 3000;
const VOIPMS_API = "https://voip.ms/api/v1/rest.php";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml"
};

const SELF_URL = process.env.RENDER_EXTERNAL_URL || ("http://localhost:" + PORT);
function keepAlive() {
  const pingUrl = SELF_URL + "/ping";
  const proto = pingUrl.startsWith("https") ? https : http;
  proto.get(pingUrl, (res) => {
    console.log("[KeepAlive] ping -> " + res.statusCode);
  }).on("error", (e) => {
    console.log("[KeepAlive] error: " + e.message);
  });
}
setTimeout(() => {
  keepAlive();
  setInterval(keepAlive, 10 * 60 * 1000);
}, 2 * 60 * 1000);

function voipmsRequest(params) {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams(params).toString();
    const reqUrl = VOIPMS_API + "?" + qs;
    https.get(reqUrl, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error("VoIP.ms返回数据格式错误")); }
      });
    }).on("error", reject);
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
  });
}

function sendJSON(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(data));
}

function dateRange(days) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  const fmt = d => d.toISOString().slice(0, 10);
  return { date_from: fmt(from), date_to: fmt(to) };
}

async function handleLogin(req, res) {
  const { username, password } = await readBody(req);
  if (!username || !password) return sendJSON(res, 400, { error: "缺少用户名或密码" });
  try {
    const result = await voipmsRequest({ api_username: username, api_password: password, method: "getDIDsInfo" });
    if (result.status === "success") {
      sendJSON(res, 200, { success: true, dids: result.dids || [] });
    } else {
      sendJSON(res, 401, { success: false, error: "用户名或密码错误" });
    }
  } catch (e) { sendJSON(res, 500, { error: e.message }); }
}

async function handleSMSSend(req, res) {
  const { username, password, did, dst, message } = await readBody(req);
  if (!username || !password || !did || !dst || !message) return sendJSON(res, 400, { error: "缺少必要参数" });
  try {
    const result = await voipmsRequest({ api_username: username, api_password: password, method: "sendSMS", did, dst, message });
    sendJSON(res, 200, result);
  } catch (e) { sendJSON(res, 500, { error: e.message }); }
}

async function handleSMSList(req, res) {
  const { username, password, did, contact } = await readBody(req);
  if (!username || !password || !did) return sendJSON(res, 400, { error: "缺少必要参数" });
  const { date_from, date_to } = dateRange(60);
  const params = { api_username: username, api_password: password, method: "getSMS", did, date_from, date_to, limit: "500", timezone: "-8" };
  if (contact) params.contact = contact;
  try {
    const result = await voipmsRequest(params);
    sendJSON(res, 200, result);
  } catch (e) { sendJSON(res, 500, { error: e.message }); }
}

async function handleCallLog(req, res) {
  const { username, password } = await readBody(req);
  if (!username || !password) return sendJSON(res, 400, { error: "缺少必要参数" });
  const { date_from, date_to } = dateRange(30);
  try {
    const result = await voipmsRequest({ api_username: username, api_password: password, method: "getCDR", date_from, date_to, timezone: "-8", answered: "1", noanswer: "1", busy: "1", failed: "1" });
    sendJSON(res, 200, result);
  } catch (e) { sendJSON(res, 500, { error: e.message }); }
}

async function handleDIDs(req, res) {
  const { username, password } = await readBody(req);
  if (!username || !password) return sendJSON(res, 400, { error: "缺少必要参数" });
  try {
    const result = await voipmsRequest({ api_username: username, api_password: password, method: "getDIDsInfo" });
    sendJSON(res, 200, result);
  } catch (e) { sendJSON(res, 500, { error: e.message }); }
}

function serveStatic(req, res) {
  let filePath = path.join(__dirname, "public", req.url === "/" ? "index.html" : req.url.split("?")[0]);
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(__dirname, "public", "index.html"), (e2, d2) => {
        if (e2) { res.writeHead(404); return res.end("Not found"); }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(d2);
      });
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[ext] || "text/plain" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url);
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
    return res.end();
  }
  if (req.method === "GET" && parsed.pathname === "/ping") return sendJSON(res, 200, { ok: true, time: new Date().toISOString() });
  if (req.method === "POST") {
    if (parsed.pathname === "/api/login") return handleLogin(req, res);
    if (parsed.pathname === "/api/sms/send") return handleSMSSend(req, res);
    if (parsed.pathname === "/api/sms/list") return handleSMSList(req, res);
    if (parsed.pathname === "/api/sms/conversations") return handleSMSList(req, res);
    if (parsed.pathname === "/api/calls/log") return handleCallLog(req, res);
    if (parsed.pathname === "/api/dids") return handleDIDs(req, res);
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log("");
  console.log("  VoIP Connect 服务器已启动");
  console.log("  本地访问: http://localhost:" + PORT);
  console.log("  防休眠: 每10分钟自动ping " + SELF_URL + "/ping");
  console.log("");
});
