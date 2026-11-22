const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3000);
const root = __dirname;
const dataDir = path.join(root, "data");
const dbPath = path.join(dataDir, "portafolio.sqlite");

fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    service TEXT,
    message TEXT NOT NULL,
    ip_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_contacts_created_at ON contacts(created_at);
`);

const insertContact = db.prepare(`
  INSERT INTO contacts (name, email, phone, service, message, ip_hash)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

const rateBuckets = new Map();

function clean(value, max) {
  return String(value || "").trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").slice(0, max);
}

function json(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let tooLarge = false;
    request.on("data", chunk => {
      body += chunk;
      if (body.length > 10000) tooLarge = true;
    });
    request.on("end", () => {
      if (tooLarge) return reject(Object.assign(new Error("Contenido demasiado grande"), { status: 413 }));
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(Object.assign(new Error("JSON no valido"), { status: 400 }));
      }
    });
  });
}

function isRateLimited(ip) {
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + 10 * 60 * 1000 };
    rateBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  return bucket.count > 8;
}

function setSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; img-src 'self' data:; connect-src 'self'");
}

async function handleApi(request, response, pathname) {
  if (pathname === "/api/health" && request.method === "GET") {
    return json(response, 200, { status: "ok" });
  }

  if (pathname === "/api/contact" && request.method === "POST") {
    try {
      const forwarded = (request.headers["x-forwarded-for"] || "").split(",")[0].trim();
      const ip = forwarded || request.socket.remoteAddress || "unknown";
      if (isRateLimited(ip)) return json(response, 429, { ok: false, message: "Demasiados intentos. Espera unos minutos." });

      const body = await readJson(request);
      if (clean(body.website, 200)) return json(response, 400, { ok: false, message: "Solicitud no valida." });

      const name = clean(body.name, 80);
      const email = clean(body.email, 160).toLowerCase();
      const phone = clean(body.phone, 40);
      const service = clean(body.service, 60);
      const message = clean(body.message, 2000);

      if (name.length < 2) return json(response, 422, { ok: false, message: "Ingresa tu nombre." });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email)) return json(response, 422, { ok: false, message: "Ingresa un correo valido." });
      if (message.length < 20) return json(response, 422, { ok: false, message: "Cuéntame un poco más sobre tu proyecto (mínimo 20 caracteres)." });

      const ipHash = crypto.createHash("sha256").update(ip).digest("hex");
      const result = insertContact.run(name, email, phone || null, service || null, message, ipHash);
      return json(response, 201, { ok: true, id: Number(result.lastInsertRowid), message: "Mensaje recibido. Te contactaré pronto." });
    } catch (error) {
      console.error(error);
      return json(response, error.status || 500, { ok: false, message: error.status ? error.message : "No fue posible guardar el mensaje." });
    }
  }

  if (pathname === "/api/admin/messages" && request.method === "GET") {
    const token = process.env.ADMIN_TOKEN;
    const provided = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token || provided !== token) return json(response, 401, { ok: false, message: "No autorizado." });
    const rows = db.prepare("SELECT id, name, email, phone, service, message, created_at FROM contacts ORDER BY id DESC LIMIT 200").all();
    return json(response, 200, { ok: true, messages: rows });
  }

  return json(response, 404, { ok: false, message: "Recurso no encontrado." });
}

const server = http.createServer(async (request, response) => {
  setSecurityHeaders(response);
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (url.pathname.startsWith("/api/")) {
    await handleApi(request, response, url.pathname);
    return;
  }

  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(root, requested));
  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(error.code === "ENOENT" ? "No encontrado" : "Error interno");
      return;
    }
    response.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
    response.end(content);
  });
});

server.listen(port, host, () => {
  console.log(`Portafolio disponible en http://${host}:${port}`);
  console.log(`Base de datos: ${dbPath}`);
});
