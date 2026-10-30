// `npm run demo`            → local sandbox, no keys needed
// `npm run demo -- testnet` → testnet, needs a funded account (see README)
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { Chain, toNear } from "./chain.js";
import { runScenario, saveRun } from "./scenario.js";

const here = dirname(fileURLToPath(import.meta.url));
const network = process.argv[2] ?? "sandbox";

async function main() {
  let chain, master, sandbox;
  if (network === "sandbox") {
    const { Sandbox, DEFAULT_ACCOUNT_ID, DEFAULT_PRIVATE_KEY } = await import("near-sandbox");
    console.log("▶ Starting local NEAR sandbox");
    sandbox = await Sandbox.start({});
    chain = new Chain(sandbox.rpcUrl);
    master = chain.account(DEFAULT_ACCOUNT_ID, DEFAULT_PRIVATE_KEY);
  } else if (network === "testnet") {
    const id = process.env.PINPAY_MASTER;
    if (!id) throw new Error("Set PINPAY_MASTER=<your-account>.testnet (key read from ~/.near-credentials/testnet/)");
    const key = process.env.PINPAY_MASTER_KEY ?? JSON.parse(await readFile(resolve(homedir(), `.near-credentials/testnet/${id}.json`), "utf8")).private_key;
    chain = new Chain(process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com,https://rpc.testnet.near.org");
    master = chain.account(id, key);
    // Keys of accounts this run creates, so leftover test NEAR can be swept back.
    chain.keyFile = resolve(here, `../.keys/${network}-${Date.now()}.json`);
  } else throw new Error(`Unknown network ${network}`);

  try {
    const result = await runScenario({
      chain,
      master,
      network,
      scale: network === "testnet" ? 0.25 : 1,
      durationSec: network === "testnet" ? 300 : 25,
    });
    const file = resolve(here, `../../web/data/run-${network}.json`);
    await saveRun(result, file);

    console.log("\n=== Results (synthetic audience) ===");
    for (const c of result.campaigns) {
      const spent = c.posts.reduce((s, p) => s + BigInt(p.earned), 0n);
      console.log(`${c.title}: ${c.posts.length} posts, ${c.posts.reduce((s, p) => s + Number(p.clicks_paid), 0)} paid clicks, spent ${toNear(spent)} NEAR`);
    }
    console.log("\nLeaderboard:");
    for (const [acc, s] of result.leaderboard) console.log(`  ${acc.padEnd(40)} ${String(s.clicks).padStart(5)} clicks  ${toNear(s.earned)} NEAR`);
    console.log(`\nSaved ${file}`);
    console.log(`Open the dashboard: npm run web  →  http://localhost:8080/?run=${network}`);
  } finally {
    if (sandbox) await sandbox.tearDown();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
