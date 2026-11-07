"use strict";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateRegistration(input) {
  const errors = [];
  if (!input || typeof input !== "object") return ["Body must be an object"];
  if (typeof input.email !== "string" || !EMAIL.test(input.email)) errors.push("A valid email is required");
  if (typeof input.password !== "string" || input.password.length < 8) errors.push("Password must be at least 8 characters");
  if (input.name !== undefined && (typeof input.name !== "string" || input.name.length > 80)) errors.push("Name must be a string of at most 80 characters");
  return errors;
}

module.exports = { validateRegistration };
