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
const w = await import("../src/lib/db/watches.ts");
const o = await import("../src/lib/db/orgs.ts");
const fail = await import("../src/lib/health/failures.ts");
const health = await import("../src/lib/health/status.ts");
const ver = await import("../src/lib/db/versions.ts");
const vdiff = await import("../src/lib/versions/diff.ts");
const ent2 = await import("../src/lib/billing/resolve.ts");
const dom = await import("../src/lib/orgs/domains.ts");
const ent = await import("../src/lib/billing/plans.ts");

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

console.log("\n\x1b[1mwatches: the new-findings diff\x1b[0m");
{
  const wUser = await u.createUser(`watch-${Date.now()}@example.test`, "s:h", "Watcher");
  const wProj = await p.createProject({ userId: wUser.id, title: "Watched project", idea: "flood alerts" });

  const watch = await w.createWatch({
    projectId: wProj.id, projectTitle: wProj.title, userId: wUser.id,
    cadence: "weekly", queries: ["flood alerts", "flood forecasting"],
  });
  ok("watch created", !!watch.id);
  eq("due immediately so the user sees it work", watch.nextRunAt <= Date.now(), true);
  eq("enabling twice is idempotent", await (async () => {
    await w.createWatch({ projectId: wProj.id, projectTitle: wProj.title, userId: wUser.id, cadence: "weekly", queries: ["x"] });
    return (await w.listWatches(wUser.id)).length;
  })(), 1);

  const mk = (url, title) => ({ watchId: watch.id, projectId: wProj.id, userId: wUser.id, title, url, source: "example.com", kind: "news" });

  const first = await w.recordFindings(watch.id, [mk("https://a.com/1", "One"), mk("https://a.com/2", "Two")]);
  eq("first cycle reports both", first.length, 2);

  // The whole point: a repeat cycle returning the same URLs must report nothing.
  const repeat = await w.recordFindings(watch.id, [mk("https://a.com/1", "One"), mk("https://a.com/2", "Two")]);
  eq("re-seeing the same results reports nothing", repeat.length, 0);

  const mixed = await w.recordFindings(watch.id, [mk("https://a.com/2", "Two"), mk("https://a.com/3", "Three")]);
  eq("a mixed batch reports only the new one", mixed.length, 1);
  eq("…and it is the right one", mixed[0]?.url, "https://a.com/3");
  eq("history holds every unique result", (await w.listFindings(wProj.id, wUser.id)).length, 3);

  await w.bumpUnseen(watch.id, 3);
  eq("unseen count tracks new findings", (await w.getWatch(wProj.id, wUser.id)).unseenCount, 3);
  eq("unseen findings surface for the inbox", (await w.listUnseenFindings(wUser.id)).length, 3);
  await w.markFindingsSeen(wProj.id, wUser.id);
  eq("marking seen clears the badge", (await w.getWatch(wProj.id, wUser.id)).unseenCount, 0);
  eq("…and the inbox", (await w.listUnseenFindings(wUser.id)).length, 0);

  // Two watches must not share a dedupe namespace.
  const other = await p.createProject({ userId: wUser.id, title: "Other", idea: "unrelated" });
  const w2 = await w.createWatch({ projectId: other.id, projectTitle: other.title, userId: wUser.id, cadence: "weekly", queries: ["q"] });
  const cross = await w.recordFindings(w2.id, [{ watchId: w2.id, projectId: other.id, userId: wUser.id, title: "One", url: "https://a.com/1", source: "example.com", kind: "news" }]);
  eq("the same URL is new for a different watch", cross.length, 1);

  eq("due list picks it up", (await w.dueWatches(Date.now())).some(x => x.id === watch.id), true);
  await w.advanceWatch(watch.id, "weekly");
  eq("advancing reschedules it out of the queue", (await w.dueWatches(Date.now())).some(x => x.id === watch.id), false);

  await p.deleteProject(wProj.id, wUser.id);
  eq("deleting a project removes its watch", await w.getWatch(wProj.id, wUser.id), null);
  eq("…and its findings", (await w.listFindings(wProj.id, wUser.id)).length, 0);
  await u.deleteUser(wUser.id);
  eq("deleting an account clears watches", (await w.listWatches(wUser.id)).length, 0);
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

console.log("\n\x1b[1morganisations\x1b[0m");
{
  // Domain policy is the whole security model for auto-join, so it is checked
  // before anything that depends on it.
  eq("domainOf lowercases", dom.domainOf("A@IITB.ac.in"), "iitb.ac.in");
  eq("domainOf rejects a bare host", dom.domainOf("a@localhost"), null);
  eq("domainOf rejects no address", dom.domainOf("nope"), null);
  ok("gmail is public", dom.isPublicDomain("gmail.com"));
  ok("an institution is not", !dom.isPublicDomain("iitb.ac.in"));
  ok("claiming gmail is refused", !!dom.rejectDomainClaim("gmail.com", "a@gmail.com"));
  eq("claiming your own domain is allowed", dom.rejectDomainClaim("iitb.ac.in", "a@iitb.ac.in"), null);
  eq("a subdomain of your own is allowed", dom.rejectDomainClaim("cse.iitb.ac.in", "a@iitb.ac.in"), null);
  ok("claiming the parent from a subdomain is refused",
     !!dom.rejectDomainClaim("iitb.ac.in", "a@cse.iitb.ac.in"));
  ok("claiming an unrelated domain is refused",
     !!dom.rejectDomainClaim("mit.edu", "a@iitb.ac.in"));

  const stamp = Date.now();
  const domain = `smoke-${stamp}.test`;
  const prof = await u.createUser(`prof-${stamp}@${domain}`, "salt:hash", "Prof");
  const student = await u.createUser(`stud-${stamp}@${domain}`, "salt:hash", "Student");
  const outsider = await u.createUser(`out-${stamp}@elsewhere.test`, "salt:hash", "Outsider");

  const org = await o.createOrg({ name: `Smoke Lab ${stamp}`, createdBy: prof.id, seats: 2 });
  eq("creator is the owner", (await o.roleIn(org.id, prof.id)), "owner");
  eq("creating counts as one seat", await o.countOrgMembers(org.id), 1);
  ok("slug is url-safe", /^[a-z0-9-]+$/.test(org.slug));

  eq("domain claim sticks", await o.addOrgDomain(org.id, domain), true);

  // Auto-join.
  const joined = await o.autoJoinByDomain(student.id, `stud-${stamp}@${domain}`);
  eq("a matching address joins", joined.joined, true);
  eq("and joins as a member", await o.roleIn(org.id, student.id), "member");
  const twice = await o.autoJoinByDomain(student.id, `stud-${stamp}@${domain}`);
  eq("joining twice is a no-op", twice.joined, false);
  const nomatch = await o.autoJoinByDomain(outsider.id, `out-${stamp}@elsewhere.test`);
  eq("a non-matching address does not join", nomatch.joined, false);

  // Seats are the cap on the one path that adds people without a decision.
  const extra = await u.createUser(`extra-${stamp}@${domain}`, "salt:hash", "Extra");
  const full = await o.autoJoinByDomain(extra.id, `extra-${stamp}@${domain}`);
  eq("a full workspace stops absorbing signups", full.reason, "full");

  // Two workspaces cannot own the same domain.
  const rival = await o.createOrg({ name: `Rival ${stamp}`, createdBy: outsider.id });
  eq("a claimed domain cannot be re-claimed", await o.addOrgDomain(rival.id, domain), false);

  // Entitlements: the seat is what the plan check has to see.
  eq("org plan beats free", ent.betterPlan(ent.PLANS.free, ent.PLANS.team).id, "team");
  eq("a personal Pro is not downgraded by a Pro org",
     ent.betterPlan(ent.PLANS.pro, ent.PLANS.pro).id, "pro");
  eq("a personal Team beats an org Pro", ent.betterPlan(ent.PLANS.team, ent.PLANS.pro).id, "team");
  // A workspace nobody has paid for grants nothing — creating one must not be
  // a way to hand yourself the most expensive plan.
  eq("a new workspace is free", (await ent2.planFor(student.id)).id, "free");
  await o.setOrgPlan({ orgId: org.id, planId: "team", status: "active" });
  eq("a paid workspace lifts its members", (await ent2.planFor(student.id)).id, "team");
  const stranger = await u.createUser(`nobody-${stamp}@elsewhere.test`, "salt:hash", "Nobody");
  eq("someone in no workspace gets nothing", (await ent2.planFor(stranger.id)).id, "free");
  await u.deleteUser(stranger.id);

  // Mentor visibility.
  const studentProject = await p.createProject({
    userId: student.id, title: "Student idea", idea: "Something worth building",
  });
  ok("a plain member cannot read a peer", !(await o.canMentorView(student.id, prof.id)));
  ok("an owner can read a member", await o.canMentorView(prof.id, student.id));
  ok("an outsider cannot", !(await o.canMentorView(outsider.id, student.id)));
  ok("you can always read yourself", await o.canMentorView(student.id, student.id));

  await o.setOrgRole(org.id, student.id, "mentor");
  ok("a promoted mentor can read a peer", await o.canMentorView(student.id, prof.id));
  await o.setOrgRole(org.id, student.id, "member");

  const asMentor = await p.getProjectForViewer(studentProject.id, prof.id);
  eq("the mentor read path flags itself", asMentor?.asMentor, true);
  eq("and returns the project", asMentor?.project.id, studentProject.id);
  eq("an outsider gets nothing", await p.getProjectForViewer(studentProject.id, outsider.id), null);
  const asOwner = await p.getProjectForViewer(studentProject.id, student.id);
  eq("the owner is not flagged as a mentor", asOwner?.asMentor, false);
  // The narrow path must stay narrow: mentors are not collaborators.
  eq("getProject still refuses the mentor", await p.getProject(studentProject.id, prof.id), null);

  const overview = await o.orgProjectOverview(org.id);
  const studentRow = overview.find((row) => row.userId === student.id);
  eq("the overview counts the project", studentRow?.projects, 1);
  eq("and knows it has no plan yet", studentRow?.withPlan, 0);

  // Last-owner protection.
  eq("the only owner cannot be demoted", await o.setOrgRole(org.id, prof.id, "member"), false);
  eq("the only owner cannot be removed", await o.removeOrgMember(org.id, prof.id), false);
  eq("a member can be removed", await o.removeOrgMember(org.id, student.id), true);

  // Deleting the last owner's account must not strand the workspace.
  await o.addOrgMember(org.id, student.id, "member", "invite");
  await u.deleteUser(prof.id);
  eq("the longest-standing member inherits it", await o.roleIn(org.id, student.id), "owner");
  await u.deleteUser(student.id);
  eq("an emptied workspace is removed", await o.getOrg(org.id), null);

  await u.deleteUser(outsider.id);
  await u.deleteUser(extra.id);
  eq("its rival goes with its last member", await o.getOrg(rival.id), null);
}

console.log("\n\x1b[1mpublic listing\x1b[0m");
{
  const owner = await u.createUser(`pub-${Date.now()}@example.test`, "salt:hash", "Publisher");
  const other = await u.createUser(`oth-${Date.now()}@example.test`, "salt:hash", "Other");

  const draft = await p.createProject({ userId: owner.id, title: "Draft", idea: "Half an idea" });
  eq("a new project is unlisted", draft.listed, false);

  // Listing is gated twice: the brief must be shared, and it must have content.
  eq("cannot list an unshared project", await p.setListed(draft.id, owner.id, true), false);
  const token = await p.enableShare(draft.id, owner.id);
  ok("sharing mints a token", !!token);
  eq("cannot list a project with no validation", await p.setListed(draft.id, owner.id, true), false);

  await p.updateProjectArtifacts(draft.id, owner.id, {
    userId: owner.id,
    title: "Draft",
    idea: "Half an idea",
    validationMarkdown: "## Verdict\n\nWorth building.",
  });
  eq("a shared, validated brief can be listed", await p.setListed(draft.id, owner.id, true), true);
  eq("and reads back as listed", (await p.getProject(draft.id, owner.id))?.listed, true);

  const directory = await p.listPublicBriefs();
  ok("it appears in the directory", directory.some((b) => b.token === token));

  // Someone else's project is not theirs to publish.
  eq("a stranger cannot list it", await p.setListed(draft.id, other.id, true), false);

  // Revoking the link must take the listing with it, or the sitemap advertises
  // a URL that 404s.
  await p.disableShare(draft.id, owner.id);
  eq("revoking the link delists it", (await p.getProject(draft.id, owner.id))?.listed, false);
  const after = await p.listPublicBriefs();
  ok("and drops it from the directory", !after.some((b) => b.token === token));

  await u.deleteUser(owner.id);
  await u.deleteUser(other.id);
}

console.log("\n\x1b[1mdependency health\x1b[0m");
{
  // Classification decides what a user is told and whether anyone is alerted,
  // so it is checked against the real messages these providers actually send.
  const credit = fail.classifyFailure(new Error('Anthropic request failed (400): {"message":"Your credit balance is too low to access the Anthropic API."}'));
  eq("no credit is an outage", credit.kind, "outage");
  eq("and will not fix itself", credit.selfHealing, false);
  ok("the user is told nothing about the vendor", !/anthropic|credit|balance/i.test(credit.userMessage));
  ok("but the operator gets the whole message", credit.detail.includes("credit balance"));

  // The literal strings these providers send, not paraphrases of them.
  eq("a bad key is an outage", fail.classifyFailure(new Error("invalid x-api-key")).kind, "outage");
  eq("an OpenAI bad key is too",
     fail.classifyFailure(new Error("Incorrect API key provided; authentication failed")).kind, "outage");
  eq("an expired key is too", fail.classifyFailure(new Error("api_key_expired")).kind, "outage");
  eq("401 is an outage", fail.classifyFailure(new Error("HTTP 401 unauthorized")).kind, "outage");

  const limited = fail.classifyFailure(new Error("HTTP 429 rate_limit_error"));
  eq("a rate limit is not an outage", limited.kind, "rate_limit");
  eq("and does fix itself", limited.selfHealing, true);
  // The ordering trap: an overloaded provider whose body also mentions billing
  // must not page anyone.
  eq("429 wins over a billing word in the same body",
     fail.classifyFailure(new Error("429 too many requests — check your billing")).kind, "rate_limit");

  eq("a dropped socket is transient", fail.classifyFailure(new Error("fetch failed")).kind, "transient");
  eq("a timeout is transient", fail.classifyFailure(new Error("ETIMEDOUT")).kind, "transient");
  eq("an unrecognised error is our bug", fail.classifyFailure(new Error("Cannot read x of undefined")).kind, "bad_request");

  // The registry.
  health.resetHealth();
  eq("starts unknown", health.getHealth("ai").status, "unknown");
  eq("and unknown reads as ok publicly", health.publicHealth().checks.ai, "ok");

  // One failure is noise, three is a pattern.
  health.recordFailure("ai", new Error("fetch failed"));
  eq("one transient failure is not degradation", health.getHealth("ai").status, "unknown");
  health.recordFailure("ai", new Error("fetch failed"));
  health.recordFailure("ai", new Error("fetch failed"));
  eq("three in a row is", health.getHealth("ai").status, "degraded");
  ok("and it records when it started", !!health.getHealth("ai").degradedSince);
  eq("which shows in the public shape", health.publicHealth().status, "degraded");

  health.recordSuccess("ai");
  eq("one success clears it", health.getHealth("ai").status, "healthy");
  eq("and resets the counter", health.getHealth("ai").consecutiveFailures, 0);

  // An outage skips the threshold: waiting for two more users to hit a billing
  // failure before admitting it helps nobody.
  health.resetHealth();
  health.recordFailure("ai", new Error("Your credit balance is too low"));
  eq("an outage degrades on the first failure", health.getHealth("ai").status, "degraded");

  // The public shape must never carry provider detail.
  const pub = JSON.stringify(health.publicHealth());
  ok("the public health payload leaks nothing", !/credit|balance|anthropic|error/i.test(pub));

  // Dependencies are tracked apart — search being down must not blame the model.
  health.resetHealth();
  health.recordFailure("search", new Error("Your credit balance is too low"));
  eq("search degrades alone", health.getHealth("search").status, "degraded");
  eq("and the model is untouched", health.getHealth("ai").status, "unknown");
  health.resetHealth();
}

console.log("\n\x1b[1mversion history\x1b[0m");
{
  // The pure diff first — everything the UI says rests on it.
  const d = vdiff.diffLines("a\nb\nc", "a\nB\nc");
  eq("a changed line is one add and one remove", [d.added.length, d.removed.length], [1, 1]);
  eq("and the rest is unchanged", d.unchanged, 2);
  // A set difference would call every reordered line both added and removed.
  const reordered = vdiff.diffLines("one\ntwo\nthree", "three\none\ntwo");
  ok("reordering is not reported as a rewrite", reordered.added.length + reordered.removed.length <= 2);
  eq("identical text has no diff", vdiff.diffLines("same", "same").added.length, 0);

  const pd = vdiff.diffPlans(
    { milestones: [{ phase: "W1", goal: "Ship auth", tasks: [], deliverable: "x" }], techStack: [{ category: "Data", choice: "Postgres", why: "" }], apis: [] },
    { milestones: [{ phase: "W1", goal: "Ship auth", tasks: [], deliverable: "x" }, { phase: "W2", goal: "Add billing", tasks: [], deliverable: "y" }], techStack: [{ category: "Data", choice: "Mongo", why: "" }], apis: [] },
  );
  eq("a new milestone is detected", pd.milestones.added, ["Add billing"]);
  eq("and the count delta", pd.milestoneDelta, 1);
  eq("swapping a stack choice shows both sides", [pd.techStack.added, pd.techStack.removed], [["Data: Mongo"], ["Data: Postgres"]]);

  const rd = vdiff.diffResearch(
    { citations: [{ id: 1, title: "a", url: "https://one.test/x", source: "one" }], existingSolutions: [], gaps: [] },
    { citations: [{ id: 1, title: "a", url: "https://one.test/x", source: "one" }, { id: 2, title: "b", url: "https://two.test/y", source: "two" }], existingSolutions: [{}], gaps: [] },
  );
  eq("citation delta", rd.citationDelta, 1);
  eq("only genuinely new domains are listed", rd.newSources, ["two.test"]);

  // Now the storage behaviour, against the real database.
  const vUser = await u.createUser(`ver-${Date.now()}@example.test`, "salt:hash", "Ver");
  const proj = await p.createProject({ userId: vUser.id, title: "V1", idea: "An idea" });
  eq("a new project has no history", await ver.countVersions(proj.id), 0);

  // First save has nothing before it — a blank version 1 is noise.
  await p.updateProjectArtifacts(proj.id, vUser.id, { userId: vUser.id, title: "V1", idea: "An idea", validationMarkdown: "first verdict" });
  eq("the first save records nothing", await ver.countVersions(proj.id), 0);

  // The case this feature exists for: regenerating over existing work.
  await p.updateProjectArtifacts(proj.id, vUser.id, { userId: vUser.id, title: "V1", idea: "An idea", validationMarkdown: "second verdict" });
  eq("overwriting real content snapshots it", await ver.countVersions(proj.id), 1);
  const [first] = await ver.listVersions(proj.id);
  eq("the snapshot holds the OLD text", (await ver.getVersion(proj.id, first.id)).validationMarkdown, "first verdict");
  eq("and says what changed", first.changed, ["validation"]);
  eq("while the project holds the new", (await p.getProject(proj.id, vUser.id)).validationMarkdown, "second verdict");

  // Autosave re-sends identical artifacts constantly.
  await p.updateProjectArtifacts(proj.id, vUser.id, { userId: vUser.id, title: "V1", idea: "An idea", validationMarkdown: "second verdict" });
  eq("an identical save adds nothing", await ver.countVersions(proj.id), 1);

  // Rapid edits coalesce rather than filling the timeline.
  await p.updateProjectArtifacts(proj.id, vUser.id, { userId: vUser.id, title: "V1", idea: "An idea", validationMarkdown: "third verdict" });
  eq("a quick follow-up edit coalesces", await ver.countVersions(proj.id), 1);

  // Restore, and restoring is itself undoable — including inside the coalescing
  // window, where folding into the entry being restored from would silently
  // discard the state the user is replacing.
  const beforeRestore = (await p.getProject(proj.id, vUser.id)).validationMarkdown;
  const countBefore = await ver.countVersions(proj.id);
  const restored = await p.restoreVersion(proj.id, vUser.id, first.id);
  eq("restore reports success", restored, true);
  eq("and the project is back to the old text", (await p.getProject(proj.id, vUser.id)).validationMarkdown, "first verdict");
  eq("a restore always appends, never coalesces", await ver.countVersions(proj.id), countBefore + 1);
  const afterRestore = await ver.listVersions(proj.id);
  const undo = await ver.getVersion(proj.id, afterRestore[0].id);
  eq("so the replaced state is recoverable", undo.validationMarkdown, beforeRestore);

  // A version id alone must not reach across projects.
  const other = await p.createProject({ userId: vUser.id, title: "Other", idea: "Another" });
  eq("a version is scoped to its project", await ver.getVersion(other.id, first.id), null);
  eq("and cannot be restored into another", await p.restoreVersion(other.id, vUser.id, first.id), false);

  // Someone else's project is not theirs to roll back.
  const stranger = await u.createUser(`str-${Date.now()}@example.test`, "salt:hash", "Stranger");
  eq("a stranger cannot restore", await p.restoreVersion(proj.id, stranger.id, first.id), false);
  await u.deleteUser(stranger.id);

  // Deleting the project takes its history with it.
  await p.deleteProject(proj.id, vUser.id);
  eq("history is purged with the project", await ver.countVersions(proj.id), 0);
  await u.deleteUser(vUser.id);
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
