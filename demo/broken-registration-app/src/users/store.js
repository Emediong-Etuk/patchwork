"use strict";
const crypto = require("node:crypto");

/**
 * In-memory user store. Each user record is
 *   { id, email, passwordHash, createdAt, profile: { displayName, bio, avatarUrl } }
 */
class UserStore {
  constructor() {
    this.users = new Map();
  }

  findByEmail(email) {
    for (const user of this.users.values()) if (user.email === email) return user;
    return null;
  }

  findById(id) {
    return this.users.get(id) || null;
  }

  createUser({ email, passwordHash, name }) {
    const user = {
      id: crypto.randomUUID(),
      email,
      passwordHash,
      createdAt: new Date().toISOString(),
    };
    this.users.set(user.id, user);
    return user;
  }

  updateProfile(id, changes) {
    const user = this.findById(id);
    if (!user) return null;
    user.profile = { ...user.profile, ...changes };
    return user.profile;
  }
}

function defaultDisplayName(email, name) {
  if (typeof name === "string" && name.trim()) return name.trim();
  return email.split("@")[0];
}

module.exports = { UserStore, defaultDisplayName };
