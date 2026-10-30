// An autonomous marketing agent. Each round it looks at open campaigns on the
// PinPay contract, estimates what a post would earn, and only spends gas on
// posts it expects to be profitable. It learns per-campaign click-through rates
// from its own post analytics (epsilon-greedy over creative styles).
import { call, near } from "./chain.js";
import { makeCreative } from "./creative.js";
import { rng, hashSeed } from "./market.js";

const GAS_COST = near(0.001); // rough cost of one submit_post, in yocto
const EXPECTED_IMPRESSIONS = 2500; // lifetime impressions of a post, prior

export class Agent {
  constructor({ name, account, contractId, styles, chain, market, maxPostsPerCampaign = 3, epsilon = 0.25, log = () => {} }) {
    Object.assign(this, { name, account, contractId, styles, chain, market, maxPostsPerCampaign, epsilon, log });
    this.id = account.accountId;
    this.myPosts = []; // { postId, campaignId, style, caption, svg, contentHash, txHash }
    this.random = rng(hashSeed(this.id));
  }

  /** Observed CTR for (campaign, style), or a neutral prior. */
  estimateCtr(campaignId, style) {
    const own = this.myPosts.filter((p) => p.campaignId === campaignId && p.style === style);
    const imp = own.reduce((s, p) => s + this.market.stats(p.postId).impressions, 0);
    const clk = own.reduce((s, p) => s + this.market.stats(p.postId).clicks, 0);
    return imp > 200 ? clk / imp : 0.01;
  }

  pickStyle(campaignId) {
    if (this.random() < this.epsilon) return this.styles[Math.floor(this.random() * this.styles.length)];
    return this.styles.reduce((best, s) => (this.estimateCtr(campaignId, s) > this.estimateCtr(campaignId, best) ? s : best));
  }

  async act(round) {
    const campaigns = await this.chain.view(this.contractId, "list_campaigns", {});
    const decisions = [];
    for (const c of campaigns) {
      if (c.status !== "Active" || BigInt(c.budget_left) < BigInt(c.price_per_click)) continue;
      // Leave a margin so the transaction lands before the deadline.
      if (BigInt(Date.now() + 15_000) * 1_000_000n >= BigInt(c.deadline_ns)) continue;
      const mine = this.myPosts.filter((p) => p.campaignId === c.id).length;
      if (mine >= this.maxPostsPerCampaign) continue;

      const style = this.pickStyle(c.id);
      const ev = BigInt(Math.round(this.estimateCtr(c.id, style) * EXPECTED_IMPRESSIONS)) * BigInt(c.price_per_click);
      if (ev <= GAS_COST) {
        decisions.push({ campaign: c.id, action: "skip", reason: "expected value below gas cost" });
        continue;
      }
      const product = c.title.split(" — ")[0];
      const creative = await makeCreative({ agentId: this.id, campaignId: c.id, brief: c.brief, product, style, variant: mine });
      const uri = `sim://feed/${c.id}/${this.name}/${mine}`;
      const { value: postId, txHash } = await call(this.account, this.contractId, "submit_post", {
        campaign_id: c.id,
        content_hash: creative.contentHash,
        uri,
      });
      this.market.publish(postId, c.id, style, creative.quality);
      this.myPosts.push({ postId, campaignId: c.id, style, round, uri, txHash, ...creative });
      decisions.push({ campaign: c.id, action: "post", style, postId, ev: ev.toString() });
      this.log(`  ${this.name} → campaign ${c.id}: posted "${creative.caption}" [${style}]`);
    }
    return decisions;
  }
}
