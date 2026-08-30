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
const bill = await import("../src/lib/billing/provider.ts");
const sim = await import("../src/lib/db/similar.ts");
const simx = await import("../src/lib/similarity/index.ts");
const vfy = await import("../src/lib/verify/citations.ts");
const gnd = await import("../src/lib/db/grounding.ts");
const seg = await import("../src/lib/verify/segment.ts");
const clm = await import("../src/lib/verify/claims.ts");
const clmdb = await import("../src/lib/db/claims.ts");
const shg = await import("../src/lib/verify/shingle.ts");
const evd = await import("../src/lib/verify/evidence.ts");
const snap = await import("../src/lib/db/snapshots.ts");
const shash = await import("../src/lib/verify/simhash.ts");
const indep = await import("../src/lib/verify/independence.ts");
const sched = await import("../src/lib/plan/schedule.ts");
const cons = await import("../src/lib/verify/consistency.ts");
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

console.log("\n\x1b[1msimulated billing gate\x1b[0m");
{
  // The mock provider grants a plan with no money involved. Reachable on a live
  // deployment, that is a free upgrade for anyone who guesses the URL.
  const allowed = (env) => bill.simulatedBillingAllowed(env);

  eq("on in development", allowed({ NODE_ENV: "development" }), true);
  eq("on in test", allowed({ NODE_ENV: "test" }), true);
  eq("off in production by default", allowed({ NODE_ENV: "production" }), false);
  eq("off in production when the flag is absent", allowed({ NODE_ENV: "production", ALLOW_SIMULATED_BILLING: "" }), false);
  eq("off for a non-affirmative value", allowed({ NODE_ENV: "production", ALLOW_SIMULATED_BILLING: "no" }), false);
  eq("off for 0", allowed({ NODE_ENV: "production", ALLOW_SIMULATED_BILLING: "0" }), false);
  // A demo deployment can still opt in deliberately.
  eq("on in production with =1", allowed({ NODE_ENV: "production", ALLOW_SIMULATED_BILLING: "1" }), true);
  eq("on in production with =true", allowed({ NODE_ENV: "production", ALLOW_SIMULATED_BILLING: "true" }), true);
  eq("case and whitespace tolerant", allowed({ NODE_ENV: "production", ALLOW_SIMULATED_BILLING: " TRUE " }), true);
}

console.log("\n\x1b[1mdemo output cannot be published\x1b[0m");
{
  // The offline provider fabricates plausible URLs (arxiv.org/abs/2404.<hash>,
  // github.com/opensource/<slug>). Those are fine locally and unacceptable on a
  // page a stranger can find via Google.
  const dUser = await u.createUser(`demo-${Date.now()}@example.test`, "salt:hash", "Demo");
  const fakeResearch = {
    idea: "x", queries: [], summaryMarkdown: "Prior work shows demand [1].",
    citations: [{ id: 1, title: "Invented paper", url: "https://arxiv.org/abs/2404.81734", source: "arxiv.org" }],
    existingSolutions: [], gaps: [], demo: true,
  };

  eq("demo research is detected", p.isDemoDerived({ research: fakeResearch }), true);
  eq("demo plans are detected", p.isDemoDerived({ plan: { demo: true } }), true);
  eq("real output is not", p.isDemoDerived({ research: { ...fakeResearch, demo: false } }), false);
  eq("an empty project is not", p.isDemoDerived({}), false);

  const demoProj = await p.createProject({ userId: dUser.id, title: "Demo brief", idea: "An idea" });
  await p.updateProjectArtifacts(demoProj.id, dUser.id, {
    userId: dUser.id, title: "Demo brief", idea: "An idea",
    validationMarkdown: "## Verdict\n\nWorth building.", research: fakeResearch,
  });
  await p.enableShare(demoProj.id, dUser.id);
  eq("it can still be shared by link", !!(await p.getProject(demoProj.id, dUser.id)).shareToken, true);
  eq("but never listed publicly", await p.setListed(demoProj.id, dUser.id, true), false);
  eq("and stays out of the directory", (await p.listPublicBriefs()).some((b) => b.title === "Demo brief"), false);

  // A real project is unaffected by the new rule.
  const realProj = await p.createProject({ userId: dUser.id, title: "Real brief", idea: "Another idea" });
  await p.updateProjectArtifacts(realProj.id, dUser.id, {
    userId: dUser.id, title: "Real brief", idea: "Another idea",
    validationMarkdown: "## Verdict\n\nWorth building.",
    research: { ...fakeResearch, demo: false },
  });
  await p.enableShare(realProj.id, dUser.id);
  eq("real output still publishes", await p.setListed(realProj.id, dUser.id, true), true);

  // The warning rides along with every export, since they all build this text.
  const brief = await import("../src/lib/export/brief.ts");
  const demoText = brief.buildMarkdownBrief({ title: "t", idea: "i", research: fakeResearch });
  ok("the brief warns it is demo output", /do not cite/i.test(demoText));
  ok("and says the sources are not real", /do not exist/i.test(demoText));
  const realText = brief.buildMarkdownBrief({ title: "t", idea: "i", research: { ...fakeResearch, demo: false } });
  ok("a real brief carries no such warning", !/do not cite/i.test(realText));

  await p.deleteProject(demoProj.id, dUser.id);
  await p.deleteProject(realProj.id, dUser.id);
  await u.deleteUser(dUser.id);
}

console.log("\n\x1b[1mduplicate idea detection\x1b[0m");
{
  const emb = simx.getEmbedder();
  const a = await emb.embed("A campus tool that matches students to research labs by interest");
  const b = await emb.embed("A platform connecting undergraduates with professors' labs based on their interests");
  const c = await emb.embed("An app that reminds students to drink water");

  eq("vectors are the declared width", a.length, emb.dimensions);
  ok("vectors are unit length", Math.abs(Math.sqrt(a.reduce((s, x) => s + x * x, 0)) - 1) < 1e-6);
  eq("a vector is identical to itself", Number(simx.cosine(a, a).toFixed(4)), 1);
  eq("mismatched widths never pretend to match", simx.cosine(a, [1, 2, 3]), 0);

  // The property the feature depends on: a paraphrase sharing almost no words
  // must still outrank an unrelated idea, by enough that a fixed threshold can
  // sit between them. Measured separation for this pair is ~0.73 vs ~0.36.
  const para = simx.cosine(a, b);
  const unrel = simx.cosine(a, c);
  ok("a paraphrase clears the threshold", para >= sim.SIMILARITY_THRESHOLD);
  ok("an unrelated idea does not", unrel < sim.SIMILARITY_THRESHOLD);
  ok("and the two classes are separable", para - unrel > 0.2);

  // The lexical fallback is kept, and is honestly worse. Asserted so that a
  // future change claiming they are interchangeable fails here.
  const lex = simx.makeEmbedder("lexical");
  const lexPara = simx.cosine(await lex.embed("Cut hostel food waste with demand forecasting"),
                              await lex.embed("Reduce food wastage in college messes by predicting how many will eat"));
  const neuPara = simx.cosine(await emb.embed("Cut hostel food waste with demand forecasting"),
                              await emb.embed("Reduce food wastage in college messes by predicting how many will eat"));
  ok("lexical misses a reworded paraphrase the neural model catches",
     lexPara < sim.SIMILARITY_THRESHOLD && neuPara >= sim.SIMILARITY_THRESHOLD);

  // End to end, against the database.
  const u1 = await u.createUser(`dup1-${Date.now()}@example.test`, "salt:hash", "Student One");
  const u2 = await u.createUser(`dup2-${Date.now()}@example.test`, "salt:hash", "Student Two");
  const outsider = await u.createUser(`dup3-${Date.now()}@example.test`, "salt:hash", "Outsider");

  const p1 = await p.createProject({
    userId: u1.id, title: "Lab matcher",
    idea: "A campus tool that matches students to research labs by interest",
  });
  const pOut = await p.createProject({
    userId: outsider.id, title: "Other lab matcher",
    idea: "A campus tool that matches students to research labs by interest",
  });
  // createProject indexes in the background; wait for it to land.
  await new Promise((r) => setTimeout(r, 400));

  eq("a saved project gets indexed", await sim.countIndexed([u1.id]), 1);

  const hits = await sim.findSimilarIdeas({
    text: "A platform connecting undergraduates with professors' labs based on their interests",
    userIds: [u1.id, u2.id],
  });
  ok("a reworded duplicate is found", hits.some((h) => h.projectId === p1.id));
  ok("and carries a score above the threshold",
     (hits[0]?.score ?? 0) >= sim.SIMILARITY_THRESHOLD);
  eq("the owner is named", hits[0]?.ownerName, "Student One");

  // The privacy property: scope is the mechanism, not a filter.
  const scoped = await sim.findSimilarIdeas({
    text: "A campus tool that matches students to research labs by interest",
    userIds: [u1.id, u2.id],
  });
  ok("another workspace's identical idea is never returned",
     !scoped.some((h) => h.projectId === pOut.id));

  const excluded = await sim.findSimilarIdeas({
    text: "A campus tool that matches students to research labs by interest",
    userIds: [u1.id], excludeProjectId: p1.id,
  });
  eq("a project never matches itself", excluded.length, 0);

  const unrelated = await sim.findSimilarIdeas({
    text: "A hardware sensor that measures classroom air quality",
    userIds: [u1.id],
  });
  eq("an unrelated idea returns nothing", unrelated.length, 0);

  // Cohort view: the same vectors read the other way round.
  //
  // The second idea is deliberately the same project under another name. A
  // near-paraphrase would score somewhere in a measured band and make this
  // assert a threshold rather than the clustering, which is what is under test.
  const p2 = await p.createProject({
    userId: u2.id, title: "Lab finder",
    idea: "A campus tool that matches students to research labs by interest",
  });
  await new Promise((r) => setTimeout(r, 400));

  const cohort = await sim.clusterWorkspaceIdeas({ userIds: [u1.id, u2.id] });
  ok("the cohort report compares every indexed idea", cohort.indexed >= 2);
  eq("and names the model it used", cohort.model, simx.getEmbedder().id);
  ok("two people proposing the same idea land in one group", cohort.clusters.length >= 1);
  const twin = cohort.clusters[0];
  ok("a group holds at least two ideas", twin.members.length >= 2);
  ok("and spans both owners",
     new Set(twin.members.map((m) => m.userId)).size === 2);
  ok("the group reports how alike its ideas are", twin.peak >= 0.7 && twin.peak <= 1);
  ok("members are ordered oldest first",
     twin.members.every((m, i, a) => i === 0 || a[i - 1].createdAt <= m.createdAt));
  eq("clustered never exceeds indexed", cohort.clustered <= cohort.indexed, true);

  // Scope is the guarantee, so it is asserted rather than assumed.
  const outsiderOnly = await sim.clusterWorkspaceIdeas({ userIds: [outsider.id] });
  eq("one person's single idea forms no group", outsiderOnly.clusters.length, 0);
  eq("an empty roster compares nothing", (await sim.clusterWorkspaceIdeas({ userIds: [] })).indexed, 0);

  // A threshold nothing can reach must produce no groups, not an empty crash.
  const impossible = await sim.clusterWorkspaceIdeas({ userIds: [u1.id, u2.id], threshold: 1.001 });
  eq("an unreachable threshold groups nothing", impossible.clusters.length, 0);
  ok("but still reports what it looked at", impossible.indexed >= 2);

  ok("the outsider's identical idea never enters the workspace report",
     !cohort.clusters.some((c) => c.members.some((m) => m.projectId === pOut.id)));

  await p.deleteProject(p2.id, u2.id);

  await p.deleteProject(p1.id, u1.id);
  await new Promise((r) => setTimeout(r, 200));
  eq("deleting a project drops its vector", await sim.countIndexed([u1.id]), 0);

  await u.deleteUser(u1.id); await u.deleteUser(u2.id); await u.deleteUser(outsider.id);
}

console.log("\n\x1b[1mcitation verification\x1b[0m");
{
  // Live network. These are stable, well-known endpoints, and the point of the
  // feature is precisely that it makes real requests.
  const report = await vfy.verifyCitations([
    { id: 1, title: "Example Domain", url: "https://example.com", source: "example.com" },
    { id: 2, title: "This page does not exist anywhere", url: "https://example.com/definitely-missing-404", source: "example.com" },
    { id: 3, title: "Not even a URL", url: "not-a-url", source: "" },
  ]);

  eq("every citation gets a verdict", report.verdicts.length, 3);
  eq("verdicts keep citation order", report.verdicts.map((v) => v.id), [1, 2, 3]);
  eq("a live page whose content matches is verified", report.verdicts[0].kind, "verified");
  ok("and records the status", report.verdicts[0].status === 200);
  ok("a 404 is reported dead", ["dead", "unreachable"].includes(report.verdicts[1].kind));
  eq("a malformed URL is dead without a request", report.verdicts[2].kind, "dead");
  ok("the grounding score is a fraction", report.groundingScore >= 0 && report.groundingScore <= 1);
  ok("and reflects the failures", report.groundingScore < 1);
  eq("tallies sum to the citation count",
     report.verified + report.mismatch + report.dead + report.unreachable, 3);

  // A page that resolves but is about something else must not pass as grounded.
  const mismatched = await vfy.verifyCitations([
    { id: 1, title: "Quantum cryptography protocols for satellite mesh networks", url: "https://example.com", source: "example.com" },
  ]);
  eq("a live page unrelated to its title is a mismatch", mismatched.verdicts[0].kind, "mismatch");
  eq("which does not count as grounded", mismatched.groundingScore, 0);

  eq("an empty citation list scores zero, not one", (await vfy.verifyCitations([])).groundingScore, 0);
}

console.log("\n\x1b[1msentence segmentation\x1b[0m");
{
  const md = [
    "## Market size",
    "",
    "Waste costs approx. Rs. 40.5 crore annually [3]. A study by Dr. Mehta et al. found 31.2% is discarded [1, 4].",
    "",
    "Worst in Tier-2 cities. [2] Tools (e.g. MealTrack) target restaurants.",
    "",
    "- Forecasting cuts over-preparation by up to 22% [5]",
    "- No vendor serves the U.S. college market today",
    "",
    "See https://example.com/report.v2.pdf for more.",
    "",
    "```",
    "npm install foo.bar",
    "```",
  ].join("\n");

  const parts = seg.segment(md);
  const texts = parts.map((x) => x.clean);

  eq("a decimal does not end a sentence", texts.filter((t) => t.includes("40.5")).length, 1);
  ok("an abbreviation does not end a sentence", texts[0].includes("approx.") && texts[0].includes("Rs."));
  ok("a title and 'et al.' do not end a sentence",
     texts.some((t) => t.includes("Dr. Mehta et al. found")));
  eq("a sentence carries the citations written inside it", parts[1].citationIds, [1, 4]);
  ok("a marker after the full stop attaches to the sentence before it",
     parts.some((t) => t.clean.startsWith("Worst in Tier-2") && t.citationIds.includes(2)));
  ok("list items are separate claims",
     texts.some((t) => t.startsWith("Forecasting cuts")) &&
     texts.some((t) => t.startsWith("No vendor serves")));
  ok("a list bullet is not part of the claim", texts.every((t) => !t.startsWith("-")));
  ok("a heading is not a claim", texts.every((t) => !t.includes("Market size")));
  ok("a code fence is not a claim", texts.every((t) => !t.includes("npm install")));
  ok("a URL's dots do not split a sentence",
     texts.some((t) => t.includes("report.v2.pdf") && t.includes("for more")));
  ok("offsets point back at the original text",
     parts.every((x) => md.slice(x.start, x.end) === x.text));
  eq("empty input segments to nothing", seg.segment("").length, 0);

  // A short sentence is a fragment unless the author cited it, in which case
  // they have already said it is a claim.
  const short = seg.segment("Adoption doubled [4].\n\nYes indeed.");
  eq("a short cited sentence is still a claim", short.length, 1);
  eq("and keeps its citation", short[0].citationIds, [4]);
  ok("a short uncited fragment is not", !short.some((x) => x.clean.includes("Yes indeed")));
}

console.log("\n\x1b[1mclaim-level verification\x1b[0m");
{
  // Live network, against a page whose text is fixed and well known.
  const citations = [
    { id: 1, title: "Example Domain", url: "https://example.com", source: "example.com" },
  ];
  const report = await clm.verifyClaims({
    markdown: [
      "This domain is intended for use in illustrative examples within documents [1].",
      "",
      "The domain handles 47.3 million requests every single day [1].",
      "",
      "Quantum satellite mesh routing reduces orbital latency substantially [1].",
      "",
      "Roughly 62% of hostels discard prepared food each evening.",
    ].join("\n"),
    citations,
  });

  const byStart = (prefix) => report.verdicts.find((v) => v.text.startsWith(prefix));

  eq("every checkable claim gets a verdict", report.verdicts.length, 4);
  eq("the model is named", report.model, simx.getEmbedder().id);
  ok("the cut-offs used are reported", report.thresholds !== null);
  ok("and the supported bar sits above the weak one",
     report.thresholds.supported > report.thresholds.weak);

  const paraphrase = byStart("This domain is intended");
  eq("a paraphrase of the source is supported", paraphrase.kind, "supported");
  ok("and is shown the passage that states it",
     typeof paraphrase.passage === "string" && paraphrase.passage.length > 0);
  ok("and names which source it came from", paraphrase.sourceId === 1);

  const fabricated = byStart("The domain handles");
  ok("a figure absent from the source is caught",
     fabricated.unmatchedFigures.some((f) => f.includes("47.3")));
  ok("and the claim is not called supported", fabricated.kind !== "supported");

  const offTopic = byStart("Quantum satellite");
  eq("a claim the source never makes is unsupported", offTopic.kind, "unsupported");
  eq("and is shown no passage, because none supports it", offTopic.passage, null);

  const uncited = byStart("Roughly 62%");
  eq("a figure with no citation is flagged", uncited.kind, "uncited");
  ok("with the figure named", uncited.unmatchedFigures.includes("62%"));

  // Guards, which decide before any threshold does.
  eq("an explicit denial about the claim's own subject is caught",
     clm.refutationIn(
       "The authors found no significant difference in accuracy by skin tone.",
       "Attendance systems fail more often for darker skin tones.",
     ),
     "no significant");
  eq("a denial about something else in the passage is not",
     clm.refutationIn(
       "The pilot ran for eleven weeks across four sites. Staff logged headcount each " +
         "evening. Where kitchens used the forecast to set batch sizes, over-preparation " +
         "fell noticeably compared with the control sites, though procurement costs were " +
         "unchanged and the labour saving was marginal.",
       "Demand forecasting reduces over-preparation in canteens.",
     ),
     null);
  // The scope test is proximity, so on a passage shorter than the window every
  // phrase is "near" everything. Asserted rather than hidden: it is the known
  // limit of the heuristic, and it errs towards flagging.
  ok("on a very short passage the proximity test cannot discriminate",
     clm.refutationIn(
       "Over-preparation fell, though costs were unchanged.",
       "Demand forecasting reduces over-preparation.",
     ) !== null);
  eq("a figure absent from the source is reported missing",
     clm.figuresMissingFrom("Waste costs 40 crore a year.", "The cost is about 4 crore rupees."),
     ["40 crore"]);
  eq("a figure present in the source is not",
     clm.figuresMissingFrom("Waste costs 40 crore a year.", "It runs to 40 crore annually."),
     []);
  eq("a spelled-out quantity is checked too",
     clm.figuresMissingFrom("Payback is under six years.", "Payback runs to eleven or twelve years."),
     ["six years"]);
  eq("and matches its digit form across notations",
     clm.figuresMissingFrom("Payback is under six years.", "Payback is about 6 years."),
     []);

  ok("the support score is a fraction",
     report.supportScore >= 0 && report.supportScore <= 1);
  ok("and is below 1, because not every claim held up", report.supportScore < 1);

  // Ordinary prose without figures or citations is not a finding.
  const prose = await clm.verifyClaims({
    markdown: "The opportunity here feels genuinely worth pursuing for a small team.",
    citations,
  });
  eq("uncited opinion is not reported as a claim", prose.verdicts.length, 0);
  eq("a briefing with no citations scores zero, not one", prose.supportScore, 0);

  // Storage round-trip.
  const owner = await u.createUser(`claim-${Date.now()}@example.test`, "salt:hash", "Claim Owner");
  const proj = await p.createProject({ userId: owner.id, title: "C", idea: "Checking claims" });
  await clmdb.saveClaims(proj.id, owner.id, report);
  const read = await clmdb.getClaims(proj.id);
  eq("the report round-trips through the database", read.verdicts.length, report.verdicts.length);
  eq("with its score intact", read.supportScore, report.supportScore);
  const scores = await clmdb.getClaimScores([proj.id]);
  eq("the batch summary excludes unreadable claims from the denominator",
     scores[proj.id].checked, report.verdicts.length - report.unavailable);
  await p.deleteProject(proj.id, owner.id);
  eq("deleting a project purges its claim report", await clmdb.getClaims(proj.id), null);
  await u.deleteUser(owner.id);
}

console.log("\n\x1b[1mcontent fingerprints and drift\x1b[0m");
{
  const base =
    "Food waste in Indian hostels is a persistent problem. A survey of residential campus " +
    "kitchens found that about a third of cooked food never reaches a plate. The study covered " +
    "eleven institutions over two academic terms and logged headcount at every service. " +
    "Researchers noted that dinner attendance was the least predictable meal of the day.";

  // Exact Jaccard, to check the estimator against ground truth.
  const exact = (a, b) => {
    const A = shg.shingles(a), B = shg.shingles(b);
    let inter = 0; for (const x of A) if (B.has(x)) inter++;
    const uni = A.size + B.size - inter;
    return uni === 0 ? 1 : inter / uni;
  };

  eq("normalisation makes formatting invisible to the hash",
     shg.contentHash(base), shg.contentHash(`  ${base.toUpperCase()}  `));
  ok("a changed word changes the hash",
     shg.contentHash(base) !== shg.contentHash(base.replace("persistent", "chronic")));

  const s0 = shg.sketchOf(base);
  eq("a document is identical to itself", shg.similarity(s0, shg.sketchOf(base)), 1);
  eq("sketches of different sizes never compare", shg.similarity(s0, [1, 2, 3]), 0);

  // The estimator should track exact Jaccard within MinHash's error, which at
  // 128 hashes has a standard deviation of about 1/sqrt(128) ≈ 0.088.
  const edited = base.replace("persistent", "chronic");
  const withNav = `Home About Contact Login ${base} Footer Terms Privacy`;
  const rewritten =
    "Campus dining halls throw away large amounts of prepared food, and institutional " +
    "kitchens over-cater because they cannot predict evening turnout.";

  for (const [label, text] of [["an edit", edited], ["added boilerplate", withNav], ["a rewrite", rewritten]]) {
    const e = exact(base, text), est = shg.similarity(s0, shg.sketchOf(text));
    ok(`the estimate tracks exact Jaccard for ${label} (${e.toFixed(2)} vs ${est.toFixed(2)})`,
       Math.abs(e - est) < 0.15);
  }

  ok("a rewrite on the same topic shares almost nothing",
     shg.similarity(s0, shg.sketchOf(rewritten)) < 0.1);
  ok("boilerplate around an unchanged article barely moves the score",
     shg.similarity(s0, shg.sketchOf(withNav)) > 0.8);

  ok("a passage still in the page is found",
     shg.passageSurvives("about a third of cooked food never reaches a plate", shg.shingles(base)));
  ok("a passage that was deleted is not",
     !shg.passageSurvives("costs forty crore rupees every single year", shg.shingles(base)));
  ok("an empty passage is never reported as deleted",
     shg.passageSurvives("", shg.shingles(base)));

  // Drift: the page is alive, but the cited passage is gone.
  const citation = { id: 1, title: "Hostel waste", url: "https://example.com/a", source: "example.com" };
  const previous = [evd.fingerprint("p1", { citation, text: base })];
  const trimmed = base.replace("A survey of residential campus kitchens found that about a third of cooked food never reaches a plate. ", "");

  const kept = evd.detectDrift({
    pages: [{ citation, text: base }], previous,
    claims: [{ index: 0, text: "About a third is wasted [1].", sourceId: 1, kind: "supported",
               passage: "about a third of cooked food never reaches a plate", citationIds: [1],
               score: 0.8, unmatchedFigures: [], note: "" }],
  });
  eq("an untouched page is unchanged", kept[0].kind, "unchanged");
  eq("and loses no claims", kept[0].lostClaims.length, 0);

  const lost = evd.detectDrift({
    pages: [{ citation, text: trimmed }], previous,
    claims: [{ index: 0, text: "About a third is wasted [1].", sourceId: 1, kind: "supported",
               passage: "about a third of cooked food never reaches a plate", citationIds: [1],
               score: 0.8, unmatchedFigures: [], note: "" }],
  });
  eq("a page that lost the cited paragraph is still recognisable", lost[0].kind, "edited");
  eq("but the claim it supported is reported lost", lost[0].lostClaims.length, 1);
  ok("the drift message leads with the lost claim",
     evd.driftMessage("Waste", lost).includes("no longer contains the passage"));

  const unseen = evd.detectDrift({ pages: [{ citation, text: base }], previous: [], claims: [] });
  eq("a source seen for the first time is new, not changed", unseen[0].kind, "new");
  eq("and produces no message", evd.driftMessage("Waste", unseen), null);

  // An unsupported claim had no evidence to lose.
  const noEvidence = evd.detectDrift({
    pages: [{ citation, text: trimmed }], previous,
    claims: [{ index: 0, text: "Something else [1].", sourceId: 1, kind: "unsupported",
               passage: null, citationIds: [1], score: 0.1, unmatchedFigures: [], note: "" }],
  });
  eq("an unsupported claim cannot lose a passage it never had",
     noEvidence[0].lostClaims.length, 0);

  // Storage round-trip.
  const owner = await u.createUser(`snap-${Date.now()}@example.test`, "salt:hash", "Snap Owner");
  const proj = await p.createProject({ userId: owner.id, title: "S", idea: "Fingerprinting evidence" });
  await snap.saveSnapshots(proj.id, owner.id, [evd.fingerprint(proj.id, { citation, text: base })]);
  const back = await snap.getSnapshots(proj.id);
  eq("a fingerprint round-trips", back.length, 1);
  eq("with its sketch intact", back[0].sketch.length, 128);
  eq("and compares as identical to the page it came from",
     shg.similarity(back[0].sketch, shg.sketchOf(base)), 1);
  await p.deleteProject(proj.id, owner.id);
  eq("deleting a project purges its fingerprints", (await snap.getSnapshots(proj.id)).length, 0);
  await u.deleteUser(owner.id);
}

console.log("\n\x1b[1mcross-artifact consistency\x1b[0m");
{
  eq("a severity score is read from the validation prose",
     cons.parseSeverity("**Severity** — 8/10 because the pain is daily."), 8);
  eq("spacing and punctuation do not matter",
     cons.parseSeverity("3. Severity: 3 / 10"), 3);
  eq("an impossible score is rejected rather than clamped",
     cons.parseSeverity("Severity — 11/10"), null);
  eq("prose with no score yields none",
     cons.parseSeverity("The severity here is high"), null);

  const cite = (id, url) => ({ id, title: `Source ${id}`, url, source: "x.com" });
  const clean = {
    validationMarkdown: "**Severity** — 8/10. A real problem.",
    research: {
      queries: ["q"], summaryMarkdown: "Waste is high [1]. Costs are rising [2].",
      citations: [cite(1, "https://a.com/x"), cite(2, "https://b.com/y")],
      existingSolutions: [{ name: "MealTrack", what: "w", strengths: [], gaps: [], citations: [1] }],
      gaps: [{ title: "Hostel forecasting", description: "d", opportunity: "Forecast hostel dinner headcount" }],
      demo: false,
    },
    plan: {
      title: "T", pitch: "Forecast hostel dinner headcount to cut waste",
      techStack: [{ category: "AI", choice: "Prophet", why: "forecasting hostel headcount" }],
      architecture: [{ name: "API", responsibility: "r", connectsTo: ["Store"] },
                     { name: "Store", responsibility: "r", connectsTo: [] }],
      milestones: [
        { phase: "Week 1-2 · Build", goal: "g", tasks: ["t"], deliverable: "d", dependsOn: [], durationWeeks: 2 },
        { phase: "Week 3-4 · Ship", goal: "g", tasks: ["t"], deliverable: "d", dependsOn: [0], durationWeeks: 2 }],
      apis: [], repos: [], datasets: [], papers: [], clusters: [], demo: false,
    },
  };
  const fired = (r) => r.findings.map((f) => f.rule);

  // The property that matters most: a coherent brief must stay silent. A
  // detector that fires on healthy input is worse than none, because people
  // learn to ignore it.
  const ok0 = cons.checkConsistency(clean);
  eq("a coherent brief produces no findings", ok0.findings.length, 0);
  eq("with every rule having run", ok0.ran, cons.RULE_COUNT);
  eq("and none skipped", ok0.skipped, 0);

  const dangling = cons.checkConsistency({ ...clean, research: { ...clean.research,
    summaryMarkdown: "Waste is high [1]. Also [7].",
    citations: [cite(1, "https://a.com/x"), cite(2, "https://b.com/y"), cite(3, "https://a.com/x?utm=1")] }});
  ok("a marker pointing at no source is a contradiction",
     fired(dangling).includes("dangling-citation"));
  ok("a listed source never referenced is reported",
     fired(dangling).includes("unused-citation"));
  ok("the same URL listed twice is reported",
     fired(dangling).includes("duplicate-source"));
  eq("the dangling marker is ranked as a contradiction",
     dangling.findings[0].severity, "contradiction");

  ok("a briefing that attaches no source to any claim is caught",
     fired(cons.checkConsistency({ ...clean,
       research: { ...clean.research, summaryMarkdown: "Waste is high." } }))
       .includes("no-citation-markers"));

  ok("a competitor backed by a source that does not exist is caught",
     fired(cons.checkConsistency({ ...clean, research: { ...clean.research,
       existingSolutions: [{ name: "M", what: "w", strengths: [], gaps: [], citations: [9] }] }}))
       .includes("solution-cites-unknown"));

  ok("an architecture wired to a component that was never defined is caught",
     fired(cons.checkConsistency({ ...clean, plan: { ...clean.plan,
       architecture: [{ name: "API", responsibility: "r", connectsTo: ["Ghost"] }] }}))
       .includes("dangling-architecture-link"));

  // The cross-artifact one: the system advised against the idea, then planned it.
  const contradicted = cons.checkConsistency({ ...clean,
    validationMarkdown: "**Severity** — 3/10. Not worth building." });
  ok("planning an idea the validation rejected is a contradiction",
     fired(contradicted).includes("planned-despite-weak-verdict"));
  eq("and is ranked as one", contradicted.findings[0].severity, "contradiction");

  const bad = cons.checkConsistency({ ...clean, plan: { ...clean.plan, milestones: [
    { phase: "Week 1-2 · A", goal: "g", tasks: [], deliverable: "d", dependsOn: [1], durationWeeks: 2 },
    { phase: "Week 1-2 · A", goal: "g", tasks: ["t"], deliverable: "", dependsOn: [0], durationWeeks: 2 }] }});
  ok("an unschedulable plan is surfaced here too", fired(bad).includes("unschedulable-plan"));
  ok("duplicate milestone labels are reported", fired(bad).includes("duplicate-milestone-phase"));
  ok("a milestone with no tasks or no deliverable is reported",
     fired(bad).includes("empty-milestone"));

  const mixed = cons.checkConsistency({ ...clean,
    research: { ...clean.research, citations: [], summaryMarkdown: "No sources.", demo: true } });
  ok("a plan built on research with no sources is reported",
     fired(mixed).includes("ungrounded-plan"));
  ok("mixing demo output with real output is reported",
     fired(mixed).includes("demo-artifacts-mixed"));

  const unaddressed = cons.checkConsistency({ ...clean, research: { ...clean.research,
    gaps: [{ title: "Satellite crop insurance underwriting", description: "d",
             opportunity: "Underwrite crop insurance from satellite imagery" }] }});
  ok("a gap the plan never touches is raised", fired(unaddressed).includes("unaddressed-gaps"));
  eq("but only as a note, since focus can be deliberate",
     unaddressed.findings.find((f) => f.rule === "unaddressed-gaps").severity, "note");

  // Missing artifacts skip rules rather than firing them.
  const partial = cons.checkConsistency({ validationMarkdown: "**Severity** — 6/10.", research: null, plan: null });
  eq("rules needing absent artifacts are skipped, not failed", partial.findings.length, 0);
  eq("and counted as skipped", partial.skipped, cons.RULE_COUNT);
  eq("an empty project runs nothing",
     cons.checkConsistency({ validationMarkdown: null, research: null, plan: null }).ran, 0);

  ok("findings are ordered worst-first", (() => {
    const order = ["contradiction", "gap", "note"];
    const f = dangling.findings.map((x) => order.indexOf(x.severity));
    return f.every((v, i, a) => i === 0 || a[i - 1] <= v);
  })());
}

console.log("\n\x1b[1mplan feasibility (critical path)\x1b[0m");
{
  const M = (phase, dependsOn, durationWeeks) =>
    ({ phase, goal: "g", tasks: [], deliverable: "d", dependsOn, durationWeeks });

  eq("a week range is read from a phase label",
     sched.parsePhase("Week 1–2 · Foundation"), { start: 1, end: 2 });
  eq("so is a plural, colon-separated one",
     sched.parsePhase("Weeks 3-4: Build"), { start: 3, end: 4 });
  eq("a single week is a one-week range", sched.parsePhase("Week 5"), { start: 5, end: 5 });
  eq("a range inside parentheses is found",
     sched.parsePhase("Phase 2 (Weeks 6–8)"), { start: 6, end: 8 });
  eq("months convert to weeks", sched.parsePhase("Month 2 · Launch"), { start: 5, end: 8 });
  eq("an unreadable label is null, not a guess", sched.parsePhase("Discovery"), null);

  // A diamond: 0 -> {1, 2} -> 3, where branch 2 is much shorter than branch 1.
  // Worked by hand: ES 1,3,3,7 · EF 2,6,3,8 · milestone 2 has three weeks of slack.
  const diamond = sched.schedulePlan([
    M("Week 1-2 · Setup", [], 2),
    M("Week 3-6 · Model", [0], 4),
    M("Week 3-3 · Copy", [0], 1),
    M("Week 7-8 · Ship", [1, 2], 2),
  ]);
  eq("the critical path length is the project length", diamond.computedWeeks, 8);
  eq("earliest starts follow the dependencies",
     diamond.milestones.map((m) => m.earliestStart), [1, 3, 3, 7]);
  eq("and earliest finishes follow the durations",
     diamond.milestones.map((m) => m.earliestFinish), [2, 6, 3, 8]);
  eq("the short branch carries slack", diamond.milestones[2].slack, 3);
  eq("and is therefore not critical", diamond.milestones[2].critical, false);
  eq("the critical path is the long branch", diamond.criticalPath, [0, 1, 3]);
  eq("a consistent plan reports no problems", diamond.problems.length, 0);
  eq("dependencies were declared, not assumed", diamond.inferred, false);

  const over = sched.schedulePlan([
    M("Week 1-3 · Research", [], 3),
    M("Week 4-6 · Build", [0], 3),
    M("Week 7-8 · Test", [1], 4),
  ]);
  eq("a plan that needs longer than it claims is caught",
     over.problems.filter((x) => x.kind === "overruns").length, 1);
  eq("the claimed length is read from the labels", over.statedWeeks, 8);
  eq("and the required length is computed", over.computedWeeks, 10);

  const early = sched.schedulePlan([
    M("Week 1-4 · Collect data", [], 4),
    M("Week 2-3 · Train model", [0], 2),
  ]);
  ok("a milestone scheduled before its prerequisite is caught",
     early.problems.some((x) => x.kind === "starts-too-early"));

  const cyclic = sched.schedulePlan([M("Week 1-2 · A", [1], 2), M("Week 3-4 · B", [0], 2)]);
  eq("a dependency loop is detected", cyclic.problems.filter((x) => x.kind === "cycle").length, 1);
  eq("and names both milestones", cyclic.problems[0].milestones.length, 2);
  // With a cycle there is no ordering, so slack and criticality are undefined
  // rather than zero — reporting a critical path would dress up a non-answer.
  eq("no critical path is claimed for an unsolvable plan", cyclic.criticalPath, []);
  ok("and no milestone is marked critical", cyclic.milestones.every((m) => !m.critical));

  const bad = sched.schedulePlan([M("Week 1-2 · A", [0], 2), M("Week 3-4 · B", [9], 2)]);
  ok("a milestone depending on itself is caught",
     bad.problems.some((x) => x.kind === "self-dependency"));
  ok("so is one depending on a milestone that does not exist",
     bad.problems.some((x) => x.kind === "unknown-dependency"));

  const legacy = sched.schedulePlan([
    { phase: "Week 1-2 · Foundation", goal: "g", tasks: [], deliverable: "d" },
    { phase: "Week 3-5 · Build", goal: "g", tasks: [], deliverable: "d" },
  ]);
  eq("a plan with no declared dependencies is marked inferred", legacy.inferred, true);
  eq("and is sequenced as a chain", legacy.milestones.map((m) => m.earliestStart), [1, 3]);
  eq("with durations taken from the labels", legacy.milestones.map((m) => m.duration), [2, 3]);

  eq("an empty plan schedules to nothing", sched.schedulePlan([]).computedWeeks, 0);
  eq("and reports no problems", sched.schedulePlan([]).problems.length, 0);
}

console.log("\n\x1b[1msource independence\x1b[0m");
{
  eq("a plain domain is its own publisher",
     indep.registrableDomain("https://example.com/a"), "example.com");
  eq("www is not a publisher",
     indep.registrableDomain("https://www.example.com/a"), "example.com");
  eq("subdomains belong to their parent",
     indep.registrableDomain("https://blog.deep.example.com/a"), "example.com");
  eq("a two-part public suffix is not a publisher",
     indep.registrableDomain("https://www.bbc.co.uk/news"), "bbc.co.uk");
  eq("nor is an academic one",
     indep.registrableDomain("https://iisc.ac.in/research"), "iisc.ac.in");
  eq("and two sites under it stay separate",
     indep.registrableDomain("https://other.ac.in/x") !== indep.registrableDomain("https://iisc.ac.in/y"),
     true);
  eq("a malformed URL has no publisher", indep.registrableDomain("not a url"), "");

  const release =
    "Acme Robotics today announced the launch of FieldSense, a soil monitoring platform for " +
    "smallholder farms. The company said the system uses low-cost capacitive sensors and a solar " +
    "gateway to report moisture at root depth every fifteen minutes. FieldSense will be available " +
    "across three states from the second quarter, priced per hectare on an annual subscription.";
  const reprint = `Home News Markets Subscribe\n\n${release}\n\nAbout us. Contact. Terms.`;
  const reworded = release.replace("today announced the launch of", "has launched");
  const independentPiece =
    "Researchers published a two-season evaluation of low-cost soil moisture sensors across " +
    "saline and loam plots, reporting substantial drift and twice-yearly recalibration.";

  const h = (a, b) => shash.hamming(shash.simhash(a), shash.simhash(b));
  eq("a document is zero bits from itself", h(release, release), 0);
  ok("a reprint with site furniture is near-duplicate",
     shash.isNearDuplicate(shash.simhash(release), shash.simhash(reprint)));
  ok("so is a lightly reworded reprint",
     shash.isNearDuplicate(shash.simhash(release), shash.simhash(reworded)));
  ok("independent writing on the same topic is not",
     !shash.isNearDuplicate(shash.simhash(release), shash.simhash(independentPiece)));
  // The gap the threshold sits in — asserted so narrowing it is a test failure.
  ok(`reprints stay well below independent writing (${h(release, reworded)} vs ${h(release, independentPiece)})`,
     h(release, reworded) + 10 < h(release, independentPiece));
  eq("a fingerprint round-trips through hex",
     shash.toHex(shash.fromHex(shash.toHex(shash.simhash(release)))), shash.toHex(shash.simhash(release)));

  const c = (id, url) => ({ id, title: `S${id}`, url, source: "" });
  const report = indep.assessIndependence([
    { citation: c(1, "https://acme.com/press/fieldsense"), text: release },
    { citation: c(2, "https://tradewire.example/agritech"), text: reprint },
    { citation: c(3, "https://acme.com/blog/why"), text: `${release} Extra blog paragraph.` },
    { citation: c(4, "https://university.ac.in/reports"), text: independentPiece },
  ]);

  eq("every citation is counted", report.citations, 4);
  eq("publishers are counted distinctly", report.domains, 3);
  eq("four citations collapse to two independent sources", report.independent, 2);
  eq("the collapsed group is named", report.groups.length, 1);
  eq("with all of its members", report.groups[0].citationIds, [1, 2, 3]);
  ok("and both reasons it formed",
     report.groups[0].reasons.includes("same-publisher") &&
     report.groups[0].reasons.includes("republished-text"));
  eq("the over-cited publisher is surfaced", report.concentration[0].domain, "acme.com");
  eq("with its count", report.concentration[0].count, 2);
  ok("entropy is a fraction", report.entropy >= 0 && report.entropy <= 1);
  ok("the summary states the shortfall",
     indep.independenceSentence(report).includes("2 independent sources"));

  // A source that could not be read still counts towards its publisher.
  const partial = indep.assessIndependence([
    { citation: c(1, "https://acme.com/a"), text: "" },
    { citation: c(2, "https://acme.com/b"), text: "" },
    { citation: c(3, "https://other.example/c"), text: "" },
  ]);
  eq("an unreadable source still names its publisher", partial.independent, 2);
  eq("and is reported as unread", partial.unread, 3);

  const diverse = indep.assessIndependence([
    { citation: c(1, "https://a.example/x"), text: release },
    { citation: c(2, "https://b.example/y"), text: independentPiece },
  ]);
  eq("genuinely separate sources do not collapse", diverse.independent, 2);
  eq("and form no groups", diverse.groups.length, 0);
  ok("perfect spread scores full entropy", diverse.entropy === 1);
  ok("and says so plainly",
     indep.independenceSentence(diverse).includes("independent sources"));
  eq("an empty citation list reports nothing", indep.assessIndependence([]).citations, 0);
}

console.log("\n\x1b[1mgrounding history and link rot\x1b[0m");
{
  const owner = await u.createUser(`rot-${Date.now()}@example.test`, "salt:hash", "Rot Owner");
  const proj = await p.createProject({ userId: owner.id, title: "Rot", idea: "A brief whose sources decay" });

  // Reports are synthesised rather than fetched: this is a test of the diff,
  // and depending on a real site going down would make it untestable.
  const at = (ts, kinds) => ({
    verdicts: kinds.map((kind, i) => ({
      id: i + 1, url: `https://example.com/${i + 1}`, title: `Source ${i + 1}`,
      kind, status: kind === "verified" ? 200 : 404, overlap: null, note: "", checkedAt: ts,
    })),
    groundingScore: kinds.filter((k) => k === "verified").length / kinds.length,
    verified: kinds.filter((k) => k === "verified").length,
    mismatch: kinds.filter((k) => k === "mismatch").length,
    dead: kinds.filter((k) => k === "dead").length,
    unreachable: kinds.filter((k) => k === "unreachable").length,
    checkedAt: ts,
  });

  const first = await gnd.saveGrounding(proj.id, owner.id, at(1000, ["verified", "verified", "verified"]));
  eq("a first check starts a one-point history", first.history.length, 1);
  eq("and has nothing to report as rotted", first.rotted.length, 0);
  eq("the first check date is recorded", first.firstCheckedAt, 1000);

  const second = await gnd.saveGrounding(proj.id, owner.id, at(2000, ["verified", "dead", "verified"]));
  eq("a second check appends to the history", second.history.length, 2);
  eq("a source that stopped verifying is reported rotted", second.rotted.length, 1);
  eq("and names which one", second.rotted[0].url, "https://example.com/2");
  eq("with what it became", second.rotted[0].now, "dead");
  eq("the first-checked date survives later checks", second.firstCheckedAt, 1000);
  ok("the score fell", second.groundingScore < first.groundingScore);

  // Still broken on the next pass: carried, not duplicated.
  const third = await gnd.saveGrounding(proj.id, owner.id, at(3000, ["verified", "dead", "verified"]));
  eq("a still-broken source is not reported twice", third.rotted.length, 1);
  eq("history keeps growing", third.history.length, 3);

  const healed = await gnd.saveGrounding(proj.id, owner.id, at(4000, ["verified", "verified", "verified"]));
  eq("a source that comes back leaves the rotted list", healed.rotted.length, 0);
  eq("and the score recovers", healed.groundingScore, 1);

  const read = await gnd.getGrounding(proj.id);
  eq("the history round-trips through the database", read.history.length, 4);
  eq("as does the original check date", read.firstCheckedAt, 1000);

  // The stale query is what the cron pass is driven by.
  const stale = await gnd.staleGrounding(5000, 10);
  ok("a check older than the cut-off is due", stale.some((x) => x.projectId === proj.id));
  const notStale = await gnd.staleGrounding(3999, 10);
  ok("a recent check is not", !notStale.some((x) => x.projectId === proj.id));

  const scores = await gnd.getGroundingScores([proj.id]);
  eq("the batch summary agrees with the stored report", scores[proj.id].verified, 3);
  eq("and carries the denominator", scores[proj.id].total, 3);

  await p.deleteProject(proj.id, owner.id);
  eq("deleting a project purges its grounding", await gnd.getGrounding(proj.id), null);
  await u.deleteUser(owner.id);
}

console.log("\n\x1b[1mcascade on delete (no foreign keys in Mongo)\x1b[0m");
await u.deleteUser(user.id);
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB ?? "scrutan");
for (const name of ["projects", "sessions", "reminders", "reminderLogs", "telegramLinks", "rateHits", "verificationTokens", "passwordResetTokens"]) {
  eq(`${name} cleaned up`, await db.collection(name).countDocuments({ userId: user.id }), 0);
}
eq("user gone", await u.getUserById(user.id), null);
await client.close();

console.log(failed ? `\n\x1b[31m${failed} check(s) failed.\x1b[0m` : "\n\x1b[32mAll checks passed.\x1b[0m");
process.exit(failed ? 1 : 0);
