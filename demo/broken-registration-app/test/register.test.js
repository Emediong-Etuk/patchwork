"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { startServer } = require("./helpers");

test("POST /api/register creates an account and returns 201", async () => {
  const app = await startServer();
  try {
    const res = await app.request("POST", "/api/register", { email: "ada@example.com", password: "correct-horse", name: "Ada Lovelace" });
    assert.equal(res.status, 201);
    assert.equal(res.body.email, "ada@example.com");
    assert.equal(res.body.displayName, "Ada Lovelace");
    assert.ok(res.body.id);
    assert.ok(res.body.createdAt);
    assert.equal(res.body.passwordHash, undefined, "password hash must never be returned");
  } finally {
    await app.close();
  }
});

test("displayName falls back to the email local part when no name is given", async () => {
  const app = await startServer();
  try {
    const res = await app.request("POST", "/api/register", { email: "grace@example.com", password: "hopper-1906" });
    assert.equal(res.status, 201);
    assert.equal(res.body.displayName, "grace");
  } finally {
    await app.close();
  }
});

test("a new user's profile is available right after registration", async () => {
  const app = await startServer();
  try {
    const created = await app.request("POST", "/api/register", { email: "linus@example.com", password: "penguins!", name: "Linus" });
    assert.equal(created.status, 201);
    const profile = await app.request("GET", `/api/users/${created.body.id}/profile`);
    assert.equal(profile.status, 200);
    assert.deepEqual(profile.body, { displayName: "Linus", bio: "", avatarUrl: null });
  } finally {
    await app.close();
  }
});

test("rejects invalid input with 400", async () => {
  const app = await startServer();
  try {
    const res = await app.request("POST", "/api/register", { email: "not-an-email", password: "short" });
    assert.equal(res.status, 400);
    assert.equal(res.body.details.length, 2);
  } finally {
    await app.close();
  }
});

test("rejects a duplicate email with 409", async () => {
  const app = await startServer();
  try {
    const first = await app.request("POST", "/api/register", { email: "dup@example.com", password: "password123" });
    assert.equal(first.status, 201);
    const second = await app.request("POST", "/api/register", { email: "DUP@example.com", password: "password123" });
    assert.equal(second.status, 409);
  } finally {
    await app.close();
  }
});
