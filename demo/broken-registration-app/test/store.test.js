"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { UserStore, defaultDisplayName } = require("../src/users/store");
const { hashPassword, verifyPassword } = require("../src/auth/password");

test("defaultDisplayName prefers the given name", () => {
  assert.equal(defaultDisplayName("a@b.co", "  Alan  "), "Alan");
  assert.equal(defaultDisplayName("alan@b.co"), "alan");
});

test("findByEmail returns null for unknown users", () => {
  const store = new UserStore();
  assert.equal(store.findByEmail("nobody@example.com"), null);
});

test("passwords are hashed and verifiable", () => {
  const stored = hashPassword("s3cret-pass");
  assert.notEqual(stored, "s3cret-pass");
  assert.ok(verifyPassword("s3cret-pass", stored));
  assert.ok(!verifyPassword("wrong", stored));
});
