// End-to-end test on a local sandbox: deploys the real wasm, runs the full
// scenario and checks the money invariants on chain.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Sandbox, DEFAULT_ACCOUNT_ID, DEFAULT_PRIVATE_KEY } from "near-sandbox";
import { Chain, call, near } from "../src/chain.js";
import { runScenario } from "../src/scenario.js";

let sandbox, chain, master, run;

before(async () => {
  sandbox = await Sandbox.start({});
  chain = new Chain(sandbox.rpcUrl);
  master = chain.account(DEFAULT_ACCOUNT_ID, DEFAULT_PRIVATE_KEY);
  run = await runScenario({ chain, master, rounds: 4, durationSec: 20, log: () => {} });
});

after(async () => {
  await sandbox?.tearDown();
});

test("every campaign balances: payouts + refund = budget", () => {
  for (const c of run.campaigns) {
    const paid = c.posts.reduce((s, p) => s + BigInt(p.earned), 0n);
    const shop = run.shops.find((s) => s.campaignId === c.id);
    assert.equal(paid + BigInt(shop.refund), BigInt(c.budget_total), c.title);
    assert.equal(c.status, "Closed");
    assert.equal(c.budget_left, "0");
  }
});

test("agents are paid exactly price × paid clicks", () => {
  for (const c of run.campaigns) {
    for (const p of c.posts) assert.equal(BigInt(p.earned), BigInt(p.clicks_paid) * BigInt(c.price_per_click));
  }
});

test("oracle never reports more than the synthetic platform measured", () => {
  for (const c of run.campaigns) {
    for (const p of c.posts) assert.ok(Number(p.clicks_paid) + Number(p.clicks_unpaid) <= p.clicks);
  }
});

test("agent wallets actually received NEAR", () => {
  for (const [accountId, stats] of run.leaderboard) {
    const a = run.agents.find((x) => x.accountId === accountId);
    if (BigInt(stats.earned) > 0n) assert.ok(BigInt(a.balanceDelta) > 0n, `${accountId} balance should grow`);
  }
});

test("only the campaign oracle can report clicks", async () => {
  const contractId = run.contractId;
  const fresh = await chain.createSubAccount(master, `cheat-${Date.now().toString(36)}`, 3);
  const { value: id } = await call(
    fresh.account,
    contractId,
    "create_campaign",
    { title: "Test", brief: "", price_per_click: near(0.01).toString(), oracle: run.oracle, duration_sec: "600" },
    { deposit: near(1) },
  );
  const poster = await chain.createSubAccount(master, `poster-${Date.now().toString(36)}`, 1);
  const { value: postId } = await call(poster.account, contractId, "submit_post", { campaign_id: id, content_hash: "b".repeat(64), uri: "sim://x" });
  await assert.rejects(call(poster.account, contractId, "report_clicks", { post_id: postId, total_clicks: "50" }), /Only the campaign oracle/);
});
