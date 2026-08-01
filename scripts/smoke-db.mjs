#!/usr/bin/env node
// Exercises every repository function against the configured MongoDB.
//
//   node --env-file=.env.local scripts/smoke-db.mjs
//
// Creates a throwaway user, drives it through the whole surface, then deletes
// it and asserts the cascade left nothing behind. Safe to run against a
// database with real data in it — it only touches what it creates.

import { MongoClient } from "mongodb";

const u = await import("../src/lib/db/users.ts");
const p = await import("../src/lib/db/projects.ts");
const r = await import("../src/lib/db/reminders.ts");
const t = await import("../src/lib/db/telegram.ts");
const rl = await import("../src/lib/db/ratelimit.ts");
const cb = await import("../src/lib/db/collaboration.ts");
const un = await import("../src/lib/username.ts");

let failed = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`  ${ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${label}${ok ? "" : `  got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`);
};
const ok = (label, cond) => eq(label, !!cond, true);

const email = `smoke-${Date.now()}@example.test`;

console.log("\n\x1b[1musers + sessions\x1b[0m");
const user = await u.createUser(email, "salt:hash", "Smoke Test");
eq("createUser returns the user", user.email, email);
eq("starts unverified", user.emailVerified, false);
ok("getUserByEmail finds it", (await u.getUserByEmail(email))?.id === user.id);
ok("passwordHash comes back", (await u.getUserByEmail(email))?.passwordHash === "salt:hash");
await u.markEmailVerified(user.id);
eq("markEmailVerified sticks", (await u.getUserById(user.id))?.emailVerified, true);
await u.updateUserLocale(user.id, "hi");
eq("locale persists", (await u.getUserById(user.id))?.locale, "hi");

const { token: sess } = await u.createSession(user.id);
ok("session resolves to user", (await u.getUserForSession(sess))?.id === user.id);
await u.updateUserPassword(user.id, "new:hash");
eq("password change kills sessions", await u.getUserForSession(sess), null);

console.log("\n\x1b[1mtokens\x1b[0m");
const { token: vt } = await u.createVerificationToken(user.id);
eq("verification token consumes once", await u.consumeVerificationToken(vt), user.id);
eq("…and not twice", await u.consumeVerificationToken(vt), null);
const { token: rt } = await u.createPasswordResetToken(user.id);
eq("reset token peeks without consuming", await u.peekPasswordResetToken(rt), user.id);
eq("…then consumes", await u.consumePasswordResetToken(rt), user.id);
eq("…and not twice", await u.peekPasswordResetToken(rt), null);

console.log("\n\x1b[1mprojects\x1b[0m");
const plan = { title: "P", pitch: "x", milestones: [{ title: "m1" }, { title: "m2" }, { title: "m3" }] };
const proj = await p.createProject({
  userId: user.id,
  title: "Smoke project",
  idea: "an idea",
  validationMarkdown: "# hi",
  research: { queries: ["q"], citations: [] },
  plan,
});
eq("createProject round-trips plan", proj.plan?.milestones?.length, 3);
eq("research survives as a document", proj.research?.queries?.[0], "q");
ok("getProject scoped to owner", (await p.getProject(proj.id, user.id))?.id === proj.id);
eq("…and refuses a stranger", await p.getProject(proj.id, "not-the-owner"), null);

const summaries = await p.listProjects(user.id);
const s = summaries.find((x) => x.id === proj.id);
eq("summary: hasValidation", s.hasValidation, true);
eq("summary: hasResearch", s.hasResearch, true);
eq("summary: hasPlan", s.hasPlan, true);
eq("summary: totalMilestones", s.totalMilestones, 3);
eq("summary: not shared", s.shared, false);

console.log("\n\x1b[1mmilestones (embedded)\x1b[0m");
await p.setMilestoneDone(proj.id, 0, true);
await p.setMilestoneDone(proj.id, 2, true);
eq("two marked done", (await p.getMilestoneProgress(proj.id)).sort(), [0, 2]);
await p.setMilestoneDone(proj.id, 0, false); // upsert path: update in place
eq("toggling off updates in place", await p.getMilestoneProgress(proj.id), [2]);
eq("milestoneCounts aggregates", (await p.milestoneCounts(user.id))[proj.id], 1);

console.log("\n\x1b[1mworkspace items (embedded)\x1b[0m");
const item = await p.addWorkspaceItem({ projectId: proj.id, kind: "note", title: "n1", body: "b" });
await p.addWorkspaceItem({ projectId: proj.id, kind: "source", title: "n2", url: "http://x" });
eq("two items listed", (await p.listWorkspaceItems(proj.id)).length, 2);
eq("newest first", (await p.listWorkspaceItems(proj.id))[0].title, "n2");
await p.deleteWorkspaceItem(item.id, "not-the-owner");
eq("stranger cannot delete", (await p.listWorkspaceItems(proj.id)).length, 2);
await p.deleteWorkspaceItem(item.id, user.id);
eq("owner can delete", (await p.listWorkspaceItems(proj.id)).length, 1);

console.log("\n\x1b[1msharing (sparse unique index)\x1b[0m");
const tok = await p.enableShare(proj.id, user.id);
ok("enableShare returns a token", !!tok);
eq("idempotent", await p.enableShare(proj.id, user.id), tok);
ok("resolves by token", (await p.getProjectByShareToken(tok))?.id === proj.id);
await p.disableShare(proj.id, user.id);
eq("disableShare revokes", await p.getProjectByShareToken(tok), null);
// The real test: two unshared projects must not collide on a null shareToken.
const proj2 = await p.createProject({ userId: user.id, title: "second", idea: "b" });
ok("a second unshared project inserts fine", !!proj2.id);

console.log("\n\x1b[1mtelegram\x1b[0m");
const { code } = await t.createTelegramLinkCode(user.id);
const chatId = 987654321;
ok("link code redeems", (await t.linkTelegramChat(code, chatId))?.id === user.id);
eq("code is single-use", await t.linkTelegramChat(code, chatId), null);
ok("chat resolves to user", (await t.getUserByChatId(chatId))?.id === user.id);
eq("chat id found for user", await t.getChatIdForUser(user.id), chatId);
eq("linked", await t.isTelegramLinked(user.id), true);
await t.setActiveProject(chatId, proj.id);
eq("active project remembered", await t.getActiveProjectId(chatId), proj.id);

console.log("\n\x1b[1mreminders + notifications ($lookup)\x1b[0m");
const rem = await r.createReminder({
  userId: user.id, projectId: proj.id, label: "daily",
  intervalMs: 86400000, firstDueAt: Date.now() - 1000,
});
eq("listed for project", (await r.listRemindersForProject(proj.id, user.id)).length, 1);
ok("appears in dueReminders", (await r.dueReminders(Date.now())).some((x) => x.id === rem.id));
await r.advanceReminder(rem.id, rem.intervalMs, Date.now());
ok("recurring reschedules", !(await r.dueReminders(Date.now())).some((x) => x.id === rem.id));
await r.logReminderSent({ userId: user.id, projectId: proj.id, nextStep: "do a thing", delivered: true });
const notes = await r.listAllReminderLogs(user.id);
eq("notification joins the project title", notes[0]?.projectTitle, "Smoke project");
eq("unread count", await r.unreadNotificationCount(user.id, 0), 1);
eq("per-project log", (await r.listReminderLogs(proj.id, user.id)).length, 1);

console.log("\n\x1b[1mrate limiting\x1b[0m");
for (let i = 0; i < 3; i++) await rl.checkRateLimit(user.id, "smoke", 3, 60_000);
eq("blocks past the limit", (await rl.checkRateLimit(user.id, "smoke", 3, 60_000)).ok, false);
eq("usage reports 3 used", (await rl.getUsage(user.id, "smoke", 3, 60_000)).used, 3);
eq("a different bucket is independent", (await rl.checkRateLimit(user.id, "other", 3, 60_000)).ok, true);

console.log("\n\x1b[1musernames\x1b[0m");
{
  eq("rejects too short", !!un.validateUsername("ab"), true);
  eq("rejects spaces", !!un.validateUsername("two words"), true);
  eq("rejects leading digit", !!un.validateUsername("1cool"), true);
  eq("rejects reserved", !!un.validateUsername("admin"), true);
  eq("accepts a normal handle", un.validateUsername("ada_lovelace"), null);
  eq("normalises case and @", un.normalizeUsername("  @AdaLovelace "), "adalovelace");

  const u1 = await u.createUser(`h1-${Date.now()}@example.test`, "s:h", "Ada Lovelace");
  ok("signup assigns a handle", !!u1.username);
  eq("handle is valid", un.validateUsername(u1.username), null);
  const u2 = await u.createUser(`h2-${Date.now()}@example.test`, "s:h", "Ada Lovelace");
  ok("a clashing name gets a distinct handle", u1.username !== u2.username);

  ok("lookup by handle works", (await u.getUserByUsername(u1.username))?.id === u1.id);
  ok("lookup is case-insensitive", (await u.getUserByUsername(u1.username.toUpperCase()))?.id === u1.id);
  eq("taken handles are refused", await u.updateUsername(u2.id, u1.username), false);
  ok("a free handle is accepted", await u.updateUsername(u2.id, `free${Date.now().toString(36).slice(-5)}`));

  const hits = await u.searchUsers(u1.username.slice(0, 3), u2.id, 5);
  ok("search finds by prefix", hits.some((x) => x.id === u1.id));
  eq("search never returns the searcher", (await u.searchUsers(u1.username.slice(0,3), u1.id, 5)).some(x => x.id === u1.id), false);
  eq("regex characters are escaped, not executed", (await u.searchUsers(".*", u2.id, 5)).length, 0);

  await u.deleteUser(u1.id);
  await u.deleteUser(u2.id);
}

console.log("\n\x1b[1mcollaboration: access control\x1b[0m");
{
  const owner = user;
  const mate = await u.createUser(`mate-${Date.now()}@example.test`, "salt:hash", "Team Mate");
  const stranger = await u.createUser(`stranger-${Date.now()}@example.test`, "salt:hash", "Nobody");
  const shared = await p.createProject({ userId: owner.id, title: "Shared project", idea: "collab" });

  eq("stranger cannot read before invite", await p.getProject(shared.id, mate.id), null);
  eq("not in their dashboard either",
     (await p.listProjects(mate.id)).some((x) => x.id === shared.id), false);

  await p.addMember(shared.id, { userId: mate.id, email: mate.email, username: mate.username, name: mate.name, joinedAt: Date.now() });
  ok("member can read after invite", (await p.getProject(shared.id, mate.id))?.id === shared.id);
  ok("appears in their dashboard", (await p.listProjects(mate.id)).some((x) => x.id === shared.id));
  eq("marked as not-owner for them",
     (await p.listProjects(mate.id)).find((x) => x.id === shared.id)?.isOwner, false);
  eq("marked as owner for the owner",
     (await p.listProjects(owner.id)).find((x) => x.id === shared.id)?.isOwner, true);
  eq("owner sees the member count",
     (await p.listProjects(owner.id)).find((x) => x.id === shared.id)?.memberCount, 1);
  eq("an uninvited stranger still cannot read", await p.getProject(shared.id, stranger.id), null);

  eq("adding the same member twice is a no-op", await (async () => {
    await p.addMember(shared.id, { userId: mate.id, email: mate.email, username: mate.username, name: null, joinedAt: Date.now() });
    return (await p.listMembers(shared.id, owner.id)).members.length;
  })(), 1);
  eq("the owner is never also a member", await (async () => {
    await p.addMember(shared.id, { userId: owner.id, email: owner.email, username: owner.username, name: null, joinedAt: Date.now() });
    return (await p.listMembers(shared.id, owner.id)).members.length;
  })(), 1);

  eq("only the owner is owner", await p.isProjectOwner(shared.id, mate.id), false);
  eq("owner is owner", await p.isProjectOwner(shared.id, owner.id), true);

  console.log("\n\x1b[1mcollaboration: in-app invitations\x1b[0m");
  const mk = (to) => cb.createInvite({
    projectId: shared.id, projectTitle: "Shared project",
    toUserId: to.id, toUsername: to.username,
    invitedByUserId: owner.id, invitedByName: "Owner", invitedByUsername: owner.username,
  });
  const inv = await mk(stranger);
  eq("appears in the recipient's inbox", (await cb.listInvitesForUser(stranger.id)).length, 1);
  eq("not in anyone else's", (await cb.listInvitesForUser(mate.id)).length, 0);
  eq("listed as pending on the project", (await cb.listInvites(shared.id)).length, 1);
  eq("a stranger cannot consume it", await cb.consumeInviteFor(inv.id, mate.id), null);
  eq("the recipient can, once", (await cb.consumeInviteFor(inv.id, stranger.id))?.projectId, shared.id);
  eq("…and not twice", await cb.consumeInviteFor(inv.id, stranger.id), null);

  const dup1 = await mk(stranger);
  const dup2 = await mk(stranger);
  eq("re-inviting replaces the old one", await cb.consumeInviteFor(dup1.id, stranger.id), null);
  ok("the newest one works", !!(await cb.consumeInviteFor(dup2.id, stranger.id)));
  const rev = await mk(stranger);
  await cb.revokeInvite(shared.id, stranger.id);
  eq("revoke kills it", await cb.consumeInviteFor(rev.id, stranger.id), null);

  console.log("\n\x1b[1mcollaboration: comments\x1b[0m");
  const c1 = await cb.addComment({ projectId: shared.id, userId: owner.id, authorName: "Owner", anchor: "plan", body: "Ship milestone 2 first" });
  await cb.addComment({ projectId: shared.id, userId: mate.id, authorName: "Mate", anchor: "general", body: "Agreed" });
  eq("both comments listed", (await cb.listComments(shared.id)).length, 2);
  eq("oldest first", (await cb.listComments(shared.id))[0].body, "Ship milestone 2 first");
  eq("a non-author cannot delete", await cb.deleteComment(c1.id, mate.id), false);
  eq("the author can", await cb.deleteComment(c1.id, owner.id), true);

  console.log("\n\x1b[1mcollaboration: leaving and removal\x1b[0m");
  eq("a stranger cannot remove anyone", await p.removeMember(shared.id, stranger.id, mate.id), false);
  ok("a member can remove themselves", await p.removeMember(shared.id, mate.id, mate.id));
  eq("and loses access", await p.getProject(shared.id, mate.id), null);

  await p.addMember(shared.id, { userId: mate.id, email: mate.email, username: mate.username, name: mate.name, joinedAt: Date.now() });
  ok("the owner can remove a member", await p.removeMember(shared.id, owner.id, mate.id));
  eq("access revoked again", await p.getProject(shared.id, mate.id), null);

  console.log("\n\x1b[1mcollaboration: deleting an account\x1b[0m");
  await p.addMember(shared.id, { userId: mate.id, email: mate.email, username: mate.username, name: mate.name, joinedAt: Date.now() });
  await u.deleteUser(mate.id);
  eq("membership on other people's projects is cleaned up",
     (await p.listMembers(shared.id, owner.id)).members.length, 0);

  await p.deleteProject(shared.id, owner.id);
  eq("deleting a project removes its comments", (await cb.listComments(shared.id)).length, 0);
  await u.deleteUser(stranger.id);
}

console.log("\n\x1b[1mgoogle sign-in linking\x1b[0m");
{
  const gEmail = `g-${Date.now()}@example.test`;
  const gUser = await u.upsertGoogleUser({ uid: "uid-1", email: gEmail, name: "G User", emailVerified: true });
  eq("creates a verified account", gUser.emailVerified, true);
  ok("account has no password", !(await u.hasPassword(gUser.id)));
  const again = await u.upsertGoogleUser({ uid: "uid-1", email: gEmail, name: "G User", emailVerified: true });
  eq("signing in twice reuses the account", again.id, gUser.id);

  // Linking onto an existing password account (Google proved the address).
  const pwEmail = `pw-${Date.now()}@example.test`;
  const pwUser = await u.createUser(pwEmail, "salt:hash", "Password User");
  eq("password account starts unverified", pwUser.emailVerified, false);
  const linked = await u.upsertGoogleUser({ uid: "uid-2", email: pwEmail, name: "Ignored", emailVerified: true });
  eq("links to the same account, not a duplicate", linked.id, pwUser.id);
  eq("linking verifies the address", linked.emailVerified, true);
  eq("does not clobber the chosen name", linked.name, "Password User");
  ok("password still works after linking", await u.hasPassword(pwUser.id));

  // The account-takeover guard.
  let refused = false;
  try {
    await u.upsertGoogleUser({ uid: "uid-3", email: pwEmail, name: null, emailVerified: false });
  } catch { refused = true; }
  eq("refuses an unverified Google email", refused, true);

  await u.deleteUser(gUser.id);
  await u.deleteUser(pwUser.id);
}

console.log("\n\x1b[1mcascade on delete (no foreign keys in Mongo)\x1b[0m");
await u.deleteUser(user.id);
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB ?? "ideaforge");
for (const name of ["projects", "sessions", "reminders", "reminderLogs", "telegramLinks", "rateHits", "verificationTokens", "passwordResetTokens"]) {
  eq(`${name} cleaned up`, await db.collection(name).countDocuments({ userId: user.id }), 0);
}
eq("user gone", await u.getUserById(user.id), null);
await client.close();

console.log(failed ? `\n\x1b[31m${failed} check(s) failed.\x1b[0m` : "\n\x1b[32mAll checks passed.\x1b[0m");
process.exit(failed ? 1 : 0);
