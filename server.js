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

const SUPABASE_URL = process.env.SUPABASE_URL || "https://cflyhuqfybsecoulvmjs.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";

// ====== 员工账号配置（每个员工一个独立DID号码） ======
// 这里的账号密码是"应用登录账号"，跟VoIP.ms账号本身无关
// 也可以在Render环境变量里设置 EMPLOYEES_JSON（JSON数组字符串），优先级更高
const DEFAULT_EMPLOYEES = [
  // { username: "zhang@company.com", password: "123456", did: "6266621315", name: "张三" },
  // { username: "li@company.com",   password: "abcdef", did: "2135551234", name: "李四" },
];
let EMPLOYEES = DEFAULT_EMPLOYEES.slice();
try {
  if (process.env.EMPLOYEES_JSON) EMPLOYEES = JSON.parse(process.env.EMPLOYEES_JSON);
} catch (e) { console.log("EMPLOYEES_JSON 解析失败，使用代码内默认配置"); }

// 支持逐行添加：环境变量 EMPLOYEE_1, EMPLOYEE_2, EMPLOYEE_3 ...
// 每个值格式为: 登录账号,登录密码,DID号码,姓名(可选)
// 例如: zhang@company.com,abc123456,6266621315,Jack
// 这些会附加到 EMPLOYEES_JSON 已有的员工列表后面
for (let i = 1; i <= 200; i++) {
  const line = process.env["EMPLOYEE_" + i];
  if (!line) continue;
  const parts = line.split(",").map(s => s.trim());
  if (parts.length >= 3 && parts[0] && parts[1] && parts[2]) {
    EMPLOYEES.push({ username: parts[0], password: parts[1], did: parts[2], name: parts[3] || parts[0] });
  } else {
    console.log("EMPLOYEE_" + i + " 格式不正确，应为: 账号,密码,号码[,姓名]");
  }
}

// VoIP.ms 主账号 API 凭证（仅服务端调用VoIP.ms时使用，永远不会发给前端）
const MAIN_API_USER = process.env.VOIPMS_API_USER || "";
const MAIN_API_PASS = process.env.VOIPMS_API_PASS || "";

function normDID(d) {
  const digits = String(d || "").replace(/\D/g, "");
  return digits.length === 11 && digits[0] === "1" ? digits.slice(1) : digits;
}
function findEmployee(username, password) {
  return EMPLOYEES.find(e => e.username === username && e.password === password) || null;
}
function employeeOwnsDID(emp, did) {
  const dids = Array.isArray(emp.did) ? emp.did : [emp.did];
  return dids.some(d => normDID(d) === normDID(did));
}

function supabaseRequest(path, method, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(SUPABASE_URL + "/rest/v1/" + path);
    const postData = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: method,
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": "Bearer " + SUPABASE_KEY,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal"
      }
    };
    if (postData) options.headers["Content-Length"] = Buffer.byteLength(postData);
    const r = https.request(options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try { resolve(data ? JSON.parse(data) : []); }
        catch (e) { resolve([]); }
      });
    });
    r.on("error", reject);
    if (postData) r.write(postData);
    r.end();
  });
}

async function saveMessagesToSupabase(msgs, did) {
  if (!msgs || msgs.length === 0) return;
  const rows = msgs.map(m => ({
    id: String(m.id),
    date: m.date || "",
    did: did,
    contact: m.contact || "",
    type: String(m.type || ""),
    message: m.message || "",
    col_media1: m.col_media1 || "",
    carrier_status: m.carrier_status || ""
  }));
  try {
    await supabaseRequest("messages", "POST", rows);
  } catch (e) { console.log("supabase save error:", e.message); }
}

async function getMessagesFromSupabase(did, contact) {
  try {
    let path = "messages?did=eq." + encodeURIComponent(did);
    if (contact) path += "&contact=eq." + encodeURIComponent(contact);
    path += "&order=date.asc&limit=1000";
    const result = await supabaseRequest(path, "GET");
    return Array.isArray(result) ? result : [];
  } catch (e) { return []; }
}

function toE164(did){
  const d=(did||'').replace(/\D/g,'');
  if(d.length===10)return '+1'+d;
  if(d.length===11&&d[0]==='1')return '+'+d;
  return did;
}

function dateRange(days) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  const fmt = d => d.toISOString().slice(0, 10);
  return { date_from: fmt(from), date_to: fmt(to) };
}

// VoIP.ms单条短信API限制约160字符，超长消息按句子/逗号边界拆分（不强行切断完整句子），
// 不添加任何序号标记，依次发送
function splitMessage(msg, limit) {
  const text = msg.trim();
  if (text.length <= limit) return [text];
  const parts = [];
  let remaining = text;
  const breakPunct = ".!?。！？，,;；";
  while (remaining.length > limit) {
    const window = remaining.slice(0, limit + 1);
    let cut = -1;
    for (let i = window.length - 1; i >= 0; i--) {
      if (breakPunct.includes(window[i])) { cut = i + 1; break; }
    }
    if (cut <= 0) {
      const sp = remaining.lastIndexOf(" ", limit);
      cut = sp > 0 ? sp : limit;
    }
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

async function handleLogin(req, res) {
  const { username, password } = await readBody(req);
  if (!username || !password) return sendJSON(res, 400, { error: "缺少用户名或密码" });
  const emp = findEmployee(username, password);
  if (!emp) return sendJSON(res, 401, { success: false, error: "用户名或密码错误" });
  const dids = Array.isArray(emp.did) ? emp.did : [emp.did];
  sendJSON(res, 200, { success: true, dids: dids.map(d => ({ did: d })), name: emp.name || username });
}

async function handleSMSSend(req, res) {
  const body = await readBody(req);
  const { did, dst, message } = body;
  const emp = findEmployee(body.username, body.password);
  if (!emp) return sendJSON(res, 401, { error: "认证失败，请重新登录" });
  if (!did || !dst || !message) return sendJSON(res, 400, { error: "缺少必要参数" });
  if (!employeeOwnsDID(emp, did)) return sendJSON(res, 403, { error: "无权使用该号码" });
  try {
    const SMS_LIMIT = 155;
    const parts = message.length <= 160 ? [message] : splitMessage(message, SMS_LIMIT);
    let result = null;
    for (let i = 0; i < parts.length; i++) {
      result = await voipmsRequest({ api_username: MAIN_API_USER, api_password: MAIN_API_PASS, method: "sendSMS", did, dst, message: parts[i] });
      if (result.status !== "success") break;
    }
    sendJSON(res, 200, result);
  } catch (e) { sendJSON(res, 500, { error: e.message }); }
}

async function handleMMSSend(req, res) {
  const body = await readBody(req);
  const { did, dst, message, mediaUrl } = body;
  const emp = findEmployee(body.username, body.password);
  if (!emp) return sendJSON(res, 401, { error: "认证失败，请重新登录" });
  if (!did || !dst || !mediaUrl) return sendJSON(res, 400, { error: "缺少必要参数" });
  if (!employeeOwnsDID(emp, did)) return sendJSON(res, 403, { error: "无权使用该号码" });
  try {
    const params = { api_username: MAIN_API_USER, api_password: MAIN_API_PASS, method: "sendMMS", did, dst, message: message || "", media1: mediaUrl };
    const result = await voipmsRequest(params);
    sendJSON(res, 200, result);
  } catch (e) { sendJSON(res, 500, { error: e.message }); }
}

async function handleImageUpload(req, res) {
  const { imageBase64 } = await readBody(req);
  if (!imageBase64) return sendJSON(res, 400, { error: "缺少图片数据" });
  try {
    const IMGBB_KEY = "5f2f425513298915fbd4fae8cd2e8986";
    const postData = new URLSearchParams({ key: IMGBB_KEY, image: imageBase64 }).toString();
    const result = await new Promise((resolve, reject) => {
      const reqOptions = {
        hostname: "api.imgbb.com",
        path: "/1/upload",
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(postData) }
      };
      const r2 = https.request(reqOptions, (res2) => {
        let data = "";
        res2.on("data", chunk => data += chunk);
        res2.on("end", () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error("imgbb返回数据格式错误")); }
        });
      });
      r2.on("error", reject);
      r2.write(postData);
      r2.end();
    });
    if (result.success) sendJSON(res, 200, { success: true, url: result.data.url });
    else sendJSON(res, 500, { error: "图片上传失败" });
  } catch (e) { sendJSON(res, 500, { error: e.message }); }
}

async function handleMMSList(req, res) {
  const body = await readBody(req);
  const { did, contact } = body;
  const emp = findEmployee(body.username, body.password);
  if (!emp) return sendJSON(res, 401, { error: "认证失败，请重新登录" });
  if (!did) return sendJSON(res, 400, { error: "缺少必要参数" });
  if (!employeeOwnsDID(emp, did)) return sendJSON(res, 403, { error: "无权使用该号码" });
  let liveMsgs = [];
  try {
    const params = { api_username: MAIN_API_USER, api_password: MAIN_API_PASS, method: "getMMS", did };
    if (contact) params.contact = contact;
    const result = await voipmsRequest(params);
    if (result.status === "success" && Array.isArray(result.sms)) {
      liveMsgs = result.sms;
      saveMessagesToSupabase(liveMsgs, did);
    }
  } catch (e) { console.log("getMMS error:", e.message); }
  const cached = await getMessagesFromSupabase(did, contact);
  const merged = [...cached, ...liveMsgs];
  const seen = new Set();
  const dedup = merged.filter(m => { if (seen.has(String(m.id))) return false; seen.add(String(m.id)); return true; });
  dedup.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  sendJSON(res, 200, { status: "success", sms: dedup });
}

async function handleSMSList(req, res) {
  const body = await readBody(req);
  const { did, contact } = body;
  const emp = findEmployee(body.username, body.password);
  if (!emp) return sendJSON(res, 401, { error: "认证失败，请重新登录" });
  if (!did) return sendJSON(res, 400, { error: "缺少必要参数" });
  if (!employeeOwnsDID(emp, did)) return sendJSON(res, 403, { error: "无权使用该号码" });
  const { date_from, date_to } = dateRange(60);
  const params = { api_username: MAIN_API_USER, api_password: MAIN_API_PASS, method: "getSMS", did: toE164(did), date_from, date_to, limit: "500", timezone: "-8" };
  if (contact) params.contact = contact;
  let liveMsgs = [];
  try {
    const result = await voipmsRequest(params);
    if (result.status === "success" && Array.isArray(result.sms)) {
      liveMsgs = result.sms;
      saveMessagesToSupabase(liveMsgs, did);
    }
  } catch (e) { console.log("getSMS error:", e.message); }
  const cached = await getMessagesFromSupabase(did, contact);
  const merged = [...cached, ...liveMsgs];
  const seen = new Set();
  const dedup = merged.filter(m => { if (seen.has(String(m.id))) return false; seen.add(String(m.id)); return true; });
  dedup.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  if (dedup.length === 0) {
    sendJSON(res, 200, { status: "no_sms", message: "There are no SMS messages" });
  } else {
    sendJSON(res, 200, { status: "success", sms: dedup });
  }
}

async function handleContactsList(req, res) {
  const body = await readBody(req);
  const emp = findEmployee(body.username, body.password);
  if (!emp) return sendJSON(res, 401, { error: "认证失败，请重新登录" });
  const did = normDID(Array.isArray(emp.did) ? emp.did[0] : emp.did);
  try {
    const result = await supabaseRequest("contacts?did=eq." + encodeURIComponent(did) + "&order=name.asc", "GET");
    sendJSON(res, 200, { success: true, contacts: Array.isArray(result) ? result : [] });
  } catch (e) { sendJSON(res, 500, { error: e.message }); }
}

async function handleContactsSave(req, res) {
  const body = await readBody(req);
  const { num, name, note } = body;
  const emp = findEmployee(body.username, body.password);
  if (!emp) return sendJSON(res, 401, { error: "认证失败，请重新登录" });
  if (!num || !name) return sendJSON(res, 400, { error: "缺少必要参数" });
  const did = normDID(Array.isArray(emp.did) ? emp.did[0] : emp.did);
  try {
    await supabaseRequest("contacts?on_conflict=num,did", "POST", [{ num, name, note: note || "", did }]);
    sendJSON(res, 200, { success: true });
  } catch (e) { sendJSON(res, 500, { error: e.message }); }
}

async function handleContactsDelete(req, res) {
  const body = await readBody(req);
  const { num } = body;
  const emp = findEmployee(body.username, body.password);
  if (!emp) return sendJSON(res, 401, { error: "认证失败，请重新登录" });
  if (!num) return sendJSON(res, 400, { error: "缺少必要参数" });
  const did = normDID(Array.isArray(emp.did) ? emp.did[0] : emp.did);
  try {
    await supabaseRequest("contacts?num=eq." + encodeURIComponent(num) + "&did=eq." + encodeURIComponent(did), "DELETE");
    sendJSON(res, 200, { success: true });
  } catch (e) { sendJSON(res, 500, { error: e.message }); }
}

async function handleCallLog(req, res) {
  const body = await readBody(req);
  const emp = findEmployee(body.username, body.password);
  if (!emp) return sendJSON(res, 401, { error: "认证失败，请重新登录" });
  const { date_from, date_to } = dateRange(30);
  try {
    const result = await voipmsRequest({ api_username: MAIN_API_USER, api_password: MAIN_API_PASS, method: "getCDR", date_from, date_to, timezone: "-8", answered: "1", noanswer: "1", busy: "1", failed: "1" });
    if (result.status === "success" && Array.isArray(result.cdr)) {
      const myDids = (Array.isArray(emp.did) ? emp.did : [emp.did]).map(normDID);
      result.cdr = result.cdr.filter(c => myDids.includes(normDID(c.did)));
    }
    sendJSON(res, 200, result);
  } catch (e) { sendJSON(res, 500, { error: e.message }); }
}

async function handleDIDs(req, res) {
  const body = await readBody(req);
  const emp = findEmployee(body.username, body.password);
  if (!emp) return sendJSON(res, 401, { error: "认证失败，请重新登录" });
  try {
    const result = await voipmsRequest({ api_username: MAIN_API_USER, api_password: MAIN_API_PASS, method: "getDIDsInfo" });
    if (result.status === "success" && Array.isArray(result.dids)) {
      const myDids = (Array.isArray(emp.did) ? emp.did : [emp.did]).map(normDID);
      result.dids = result.dids.filter(d => myDids.includes(normDID(d.did)));
    }
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
    if (parsed.pathname === "/api/mms/send") return handleMMSSend(req, res);
    if (parsed.pathname === "/api/mms/list") return handleMMSList(req, res);
    if (parsed.pathname === "/api/upload") return handleImageUpload(req, res);
    if (parsed.pathname === "/api/calls/log") return handleCallLog(req, res);
    if (parsed.pathname === "/api/contacts/list") return handleContactsList(req, res);
    if (parsed.pathname === "/api/contacts/save") return handleContactsSave(req, res);
    if (parsed.pathname === "/api/contacts/delete") return handleContactsDelete(req, res);
    if (parsed.pathname === "/api/dids") return handleDIDs(req, res);
  }
  serveStatic(req, res);
});

// ===== SIP WebSocket 代理 (TLS隧道模式) =====
// 浏览器 → wss://render/sip-proxy → Render服务器 → TLS直连 sanjose2.voip.ms:443
// 使用tls模块建立真实TLS连接，完整透传WebSocket帧，解决国内无法直连问题
(function() {
  const tls = require("tls");
  const WebSocket = require("ws");
  const wss = new WebSocket.Server({ server, path: "/sip-proxy" });

  wss.on("connection", (clientWs, req) => {
    console.log("SIP代理: 新连接 from", req.socket.remoteAddress);

    // 建立到 VoIP.ms 的真实 TLS 连接
    const tlsSocket = tls.connect({ host: "sanjose2.voip.ms", port: 443, servername: "sanjose2.voip.ms" }, () => {
      console.log("SIP代理: TLS已连接到 sanjose2.voip.ms:443");
      // 发送 WebSocket 握手升级请求
      const key = Buffer.from(Math.random().toString(36)).toString("base64");
      const handshake = [
        "GET / HTTP/1.1",
        "Host: sanjose2.voip.ms",
        "Upgrade: websocket",
        "Connection: Upgrade",
        "Sec-WebSocket-Key: " + key,
        "Sec-WebSocket-Version: 13",
        "Sec-WebSocket-Protocol: sip",
        "User-Agent: JsSIP/3.13.8",
        "", ""
      ].join("\r\n");
      tlsSocket.write(handshake);
    });

    let handshakeDone = false;
    let buffer = Buffer.alloc(0);

    tlsSocket.on("data", (chunk) => {
      if (!handshakeDone) {
        buffer = Buffer.concat([buffer, chunk]);
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd !== -1) {
          handshakeDone = true;
          const headers = buffer.slice(0, headerEnd).toString();
          console.log("SIP代理: 握手响应:", headers.split("\r\n")[0]);
          // 握手后剩余数据直接转发给客户端
          const rest = buffer.slice(headerEnd + 4);
          if (rest.length > 0 && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(rest);
          }
          buffer = Buffer.alloc(0);
        }
      } else {
        // 握手完成后直接透传原始WebSocket帧
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(chunk);
        }
      }
    });

    tlsSocket.on("error", (err) => {
      console.log("SIP代理: TLS错误", err.message);
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close(1011, err.message);
    });

    tlsSocket.on("close", () => {
      console.log("SIP代理: TLS连接关闭");
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close(1000);
    });

    // 客户端发来的WebSocket帧直接透传给VoIP.ms
    clientWs.on("message", (data, isBinary) => {
      if (tlsSocket.writable) tlsSocket.write(data);
    });

    clientWs.on("close", (code, reason) => {
      console.log("SIP代理: 客户端断开", code);
      tlsSocket.destroy();
    });

    clientWs.on("error", (err) => {
      console.log("SIP代理: 客户端错误", err.message);
      tlsSocket.destroy();
    });
  });

  console.log("SIP WebSocket代理已启动(TLS隧道模式): /sip-proxy → sanjose2.voip.ms:443");
})();

server.listen(PORT, () => {
  console.log("");
  console.log("  VoIP Connect 服务器已启动");
  console.log("  本地访问: http://localhost:" + PORT);
  console.log("  防休眠: 每10分钟自动ping " + SELF_URL + "/ping");
  console.log("");
});
