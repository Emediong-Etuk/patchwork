"use strict";

function handleGetProfile(store, id) {
  const user = store.findById(id);
  if (!user) return { status: 404, body: { error: "User not found" } };
  if (!user.profile) return { status: 404, body: { error: "Profile not found" } };
  const { displayName, bio, avatarUrl } = user.profile;
  return { status: 200, body: { displayName, bio, avatarUrl } };
}

module.exports = { handleGetProfile };
