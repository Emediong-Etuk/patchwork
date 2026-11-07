"use strict";
const { createServer } = require("../src/http/app");
const { UserStore } = require("../src/users/store");

async function startServer() {
  const store = new UserStore();
  const server = createServer(store);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const request = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  return { store, request, close: () => new Promise((r) => server.close(r)) };
}

module.exports = { startServer };
