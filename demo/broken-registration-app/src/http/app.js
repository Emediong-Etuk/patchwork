"use strict";
const http = require("node:http");
const { handleRegister } = require("../auth/register");
const { handleGetProfile } = require("../users/profile");
const { UserStore } = require("../users/store");

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function createServer(store = new UserStore()) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "GET" && url.pathname === "/health") return sendJson(res, 200, { status: "ok" });

      if (req.method === "POST" && url.pathname === "/api/register") {
        let body;
        try {
          body = await readJson(req);
        } catch {
          return sendJson(res, 400, { error: "Request body must be valid JSON" });
        }
        const { status, body: out } = await handleRegister(store, body);
        return sendJson(res, status, out);
      }

      const profileMatch = url.pathname.match(/^\/api\/users\/([^/]+)\/profile$/);
      if (req.method === "GET" && profileMatch) {
        const { status, body: out } = handleGetProfile(store, profileMatch[1]);
        return sendJson(res, status, out);
      }

      return sendJson(res, 404, { error: "Not found" });
    } catch (err) {
      console.error("Unhandled error:", err);
      return sendJson(res, 500, { error: "Internal server error" });
    }
  });
}

module.exports = { createServer, sendJson };
