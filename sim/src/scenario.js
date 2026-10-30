// End-to-end PinPay story: two fictional shops fund campaigns, three agents
// with different creative skills compete for them, the oracle reports clicks,
// the contract pays per click, and the shops close campaigns to get refunds.
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Chain, call, near, toNear } from "./chain.js";
import { Market } from "./market.js";
import { Agent } from "./agent.js";
import { Oracle } from "./oracle.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const WASM = resolve(ROOT, "contract/target/near/pinpay.wasm");

// Fictional shops; budgets in NEAR. `scale` shrinks them on testnet.
const SHOPS = [
  {
    name: "shop-lumen",
    title: "Lumen Candles — autumn launch",
    brief: "Hand-poured soy candles. Cozy, calm, giftable.",
    budget: 4,
    price: 0.003,
    taste: { minimal: 1.3, story: 1.5, hype: 0.5, deal: 0.9 },
  },
  {
    name: "shop-trail",
    title: "Trailhead Coffee — cold brew",
    brief: "Cold brew cans for hikers. Energetic, outdoorsy.",
    budget: 2,
    price: 0.005,
    taste: { minimal: 0.7, story: 0.9, hype: 1.6, deal: 1.3 },
  },
];

const AGENTS = [
  { name: "agent-muse", styles: ["story", "minimal"] },
  { name: "agent-blitz", styles: ["hype", "deal"] },
  { name: "agent-gen", styles: ["minimal", "hype", "story", "deal"] },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} o
 * @param {Chain} o.chain
 * @param {import("near-api-js").Account} o.master funded account that creates everything
 * @param {number} [o.rounds]
 * @param {number} [o.scale] multiply budgets/prices (testnet uses < 1)
 * @param {number} [o.durationSec] campaign duration
 */
export async function runScenario({ chain, master, rounds = 5, scale = 1, durationSec = 25, seed = 7, log = console.log, network = "sandbox" }) {
  const tag = Date.now().toString(36);
  const market = new Market(seed);

  log(`▶ Deploying PinPay contract`);
  const contract = await chain.createSubAccount(master, `pinpay-${tag}`, 3);
  await chain.deploy(contract.account, WASM);
  const contractId = contract.accountId;

  const oracle = await chain.createSubAccount(master, `oracle-${tag}`, 0.5);
  const shops = [];
  for (const s of SHOPS) shops.push({ ...s, ...(await chain.createSubAccount(master, `${s.name}-${tag}`, s.budget * scale + 0.5)) });
  const agents = [];
  for (const a of AGENTS) {
    const acc = await chain.createSubAccount(master, `${a.name}-${tag}`, 0.3);
    agents.push(new Agent({ name: a.name, account: acc.account, contractId, styles: a.styles, chain, market, log }));
  }
  const startBalances = Object.fromEntries(await Promise.all(agents.map(async (a) => [a.id, await chain.balance(a.id)])));

  log(`▶ Shops fund campaigns`);
  const campaignIds = [];
  for (const s of shops) {
    const { value: id, txHash } = await call(
      s.account,
      contractId,
      "create_campaign",
      {
        title: s.title,
        brief: s.brief,
        price_per_click: (near(s.price) * BigInt(Math.round(scale * 1000))) / 1000n + "",
        oracle: oracle.accountId,
        duration_sec: String(durationSec),
      },
      { deposit: (near(s.budget) * BigInt(Math.round(scale * 1000))) / 1000n },
    );
    s.campaignId = id;
    s.createTx = txHash;
    campaignIds.push(id);
    market.addAudience(id, s.taste);
    log(`  ${s.title}: campaign ${id}, budget ${s.budget * scale} NEAR`);
  }
  const startedAt = Date.now();

  const oracleBot = new Oracle({ account: oracle.account, contractId, chain, market, log });
  const timeline = [];
  for (let round = 1; round <= rounds; round++) {
    log(`▶ Round ${round}`);
    const decisions = {};
    for (const a of agents) decisions[a.name] = await a.act(round);
    market.tick(round);
    await oracleBot.report(round);
    const board = await chain.view(contractId, "leaderboard", {});
    timeline.push({ round, decisions, leaderboard: board });
  }

  const waitMs = durationSec * 1000 - (Date.now() - startedAt) + 3000;
  if (waitMs > 0) {
    log(`▶ Waiting ${Math.ceil(waitMs / 1000)}s for campaign deadlines`);
    await sleep(waitMs);
  }
  log(`▶ Shops close campaigns`);
  for (const s of shops) {
    const { value: refund, txHash } = await call(s.account, contractId, "close_campaign", { campaign_id: s.campaignId });
    s.refund = refund;
    s.closeTx = txHash;
    log(`  ${s.title}: refund ${toNear(refund)} NEAR`);
  }

  const campaigns = [];
  for (const id of campaignIds) {
    const c = await chain.view(contractId, "get_campaign", { campaign_id: id });
    const posts = await chain.view(contractId, "get_campaign_posts", { campaign_id: id });
    campaigns.push({
      ...c,
      posts: posts.map((p) => {
        const local = agents.flatMap((a) => a.myPosts).find((m) => m.postId === p.id);
        return { ...p, ...market.stats(p.id), caption: local?.caption, style: local?.style, svg: local?.svg };
      }),
    });
  }
  const leaderboard = await chain.view(contractId, "leaderboard", {});
  const agentsOut = [];
  for (const a of agents) {
    const end = await chain.balance(a.id);
    agentsOut.push({ name: a.name, accountId: a.id, styles: a.styles, balanceDelta: (end - startBalances[a.id]).toString() });
  }

  return {
    network,
    generatedAt: new Date().toISOString(),
    synthetic: true,
    contractId,
    oracle: oracle.accountId,
    shops: shops.map((s) => ({ name: s.name, accountId: s.accountId, title: s.title, campaignId: s.campaignId, refund: s.refund, createTx: s.createTx, closeTx: s.closeTx })),
    agents: agentsOut,
    campaigns,
    leaderboard,
    payouts: oracleBot.payouts,
    timeline,
  };
}

export async function saveRun(result, file) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(result, null, 2));
}

export async function loadRun(file) {
  return JSON.parse(await readFile(file, "utf8"));
}
