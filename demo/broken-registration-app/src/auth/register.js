"use strict";
const { validateRegistration } = require("./validation");
const { hashPassword } = require("./password");

function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.profile.displayName,
    createdAt: user.createdAt,
  };
}

async function handleRegister(store, input) {
  const errors = validateRegistration(input);
  if (errors.length) return { status: 400, body: { error: "Invalid registration", details: errors } };

  const email = input.email.trim().toLowerCase();
  if (store.findByEmail(email)) return { status: 409, body: { error: "An account with this email already exists" } };

  const user = store.createUser({
    email,
    passwordHash: hashPassword(input.password),
    name: input.name,
  });

  return { status: 201, body: toPublicUser(user) };
}

module.exports = { handleRegister, toPublicUser };
