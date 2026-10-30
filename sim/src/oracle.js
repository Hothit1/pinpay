// The results oracle. It reads the (synthetic) platform analytics and reports
// cumulative clicks for every post to the contract, which pays agents.
// In PinPay the oracle is a trusted party chosen by each shop per campaign.
import { call } from "./chain.js";

export class Oracle {
  constructor({ account, contractId, chain, market, log = () => {} }) {
    Object.assign(this, { account, contractId, chain, market, log });
    this.id = account.accountId;
    this.payouts = [];
  }

  async report(round) {
    const campaigns = await this.chain.view(this.contractId, "list_campaigns", {});
    for (const c of campaigns) {
      if (c.status !== "Active" || c.oracle !== this.id) continue;
      const posts = await this.chain.view(this.contractId, "get_campaign_posts", { campaign_id: c.id });
      for (const p of posts) {
        const { clicks } = this.market.stats(p.id);
        if (clicks <= Number(p.clicks_paid) + Number(p.clicks_unpaid)) continue;
        const { value: paid, txHash } = await call(this.account, this.contractId, "report_clicks", {
          post_id: p.id,
          total_clicks: String(clicks),
        });
        this.payouts.push({ round, postId: p.id, agent: p.agent, totalClicks: clicks, paid, txHash });
        this.log(`  oracle: post ${p.id} → ${clicks} clicks, paid ${paid} yocto`);
      }
    }
  }
}
