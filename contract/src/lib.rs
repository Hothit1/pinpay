//! PinPay — pay-per-result marketing escrow for autonomous agents.
//!
//! A shop locks a NEAR budget in a campaign and names an oracle it trusts to
//! measure results. Any agent can publish a post for the campaign. The oracle
//! reports cumulative clicks per post; the contract pays the agent only for new
//! clicks, at the campaign's price, until the budget runs out. After the
//! deadline the shop can close the campaign and take back what is left.

use near_sdk::json_types::{U128, U64};
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, Promise};

pub type CampaignId = u64;
pub type PostId = u64;

const MAX_TEXT: usize = 280;

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub enum CampaignStatus {
    Active,
    Closed,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Campaign {
    pub id: U64,
    pub shop: AccountId,
    pub oracle: AccountId,
    pub title: String,
    pub brief: String,
    /// yoctoNEAR paid per verified click.
    pub price_per_click: U128,
    /// Total yoctoNEAR deposited.
    pub budget_total: U128,
    /// yoctoNEAR still available for payouts.
    pub budget_left: U128,
    /// Unix nanoseconds after which no new posts are accepted and the shop may close.
    pub deadline_ns: U64,
    pub status: CampaignStatus,
    pub post_ids: Vec<U64>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Post {
    pub id: U64,
    pub campaign_id: U64,
    pub agent: AccountId,
    /// sha256 of the published creative (caption + image), hex.
    pub content_hash: String,
    /// Where the creative was published.
    pub uri: String,
    /// Clicks the agent has already been paid for.
    pub clicks_paid: U64,
    /// Clicks reported by the oracle but not payable because the budget ran out.
    pub clicks_unpaid: U64,
    pub earned: U128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, Default)]
pub struct AgentStats {
    pub posts: U64,
    pub clicks: U64,
    pub earned: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct PinPay {
    campaigns: IterableMap<CampaignId, Campaign>,
    posts: LookupMap<PostId, Post>,
    agents: IterableMap<AccountId, AgentStats>,
    next_campaign: CampaignId,
    next_post: PostId,
}

#[near]
impl PinPay {
    #[init]
    pub fn new() -> Self {
        Self {
            campaigns: IterableMap::new(b"c"),
            posts: LookupMap::new(b"p"),
            agents: IterableMap::new(b"a"),
            next_campaign: 0,
            next_post: 0,
        }
    }

    /// Lock the attached deposit as the campaign budget.
    #[payable]
    pub fn create_campaign(
        &mut self,
        title: String,
        brief: String,
        price_per_click: U128,
        oracle: AccountId,
        duration_sec: U64,
    ) -> U64 {
        let budget = env::attached_deposit().as_yoctonear();
        require!(budget > 0, "Attach the campaign budget");
        require!(price_per_click.0 > 0, "price_per_click must be > 0");
        require!(price_per_click.0 <= budget, "Budget smaller than one click");
        require!(!title.is_empty() && title.len() <= MAX_TEXT, "Bad title");
        require!(brief.len() <= MAX_TEXT * 4, "Brief too long");
        require!(duration_sec.0 > 0, "duration_sec must be > 0");

        let id = self.next_campaign;
        self.next_campaign += 1;
        let deadline = env::block_timestamp() + duration_sec.0.saturating_mul(1_000_000_000);
        let campaign = Campaign {
            id: U64(id),
            shop: env::predecessor_account_id(),
            oracle,
            title,
            brief,
            price_per_click,
            budget_total: U128(budget),
            budget_left: U128(budget),
            deadline_ns: U64(deadline),
            status: CampaignStatus::Active,
            post_ids: vec![],
        };
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"pinpay\",\"version\":\"1.0.0\",\"event\":\"campaign_created\",\"data\":{{\"id\":{},\"shop\":\"{}\",\"budget\":\"{}\"}}}}",
            id, campaign.shop, budget
        ));
        self.campaigns.insert(id, campaign);
        U64(id)
    }

    /// An agent registers a published creative for a campaign.
    pub fn submit_post(&mut self, campaign_id: U64, content_hash: String, uri: String) -> U64 {
        let agent = env::predecessor_account_id();
        let campaign = self.campaigns.get_mut(&campaign_id.0).expect("No such campaign");
        require!(campaign.status == CampaignStatus::Active, "Campaign closed");
        require!(env::block_timestamp() < campaign.deadline_ns.0, "Campaign ended");
        require!(campaign.budget_left.0 >= campaign.price_per_click.0, "Budget exhausted");
        require!(agent != campaign.shop, "Shop cannot post to its own campaign");
        require!(
            content_hash.len() == 64 && content_hash.chars().all(|c| c.is_ascii_hexdigit()),
            "content_hash must be 64 hex chars"
        );
        require!(!uri.is_empty() && uri.len() <= MAX_TEXT, "Bad uri");

        let id = self.next_post;
        self.next_post += 1;
        campaign.post_ids.push(U64(id));
        self.posts.insert(
            id,
            Post {
                id: U64(id),
                campaign_id,
                agent: agent.clone(),
                content_hash,
                uri,
                clicks_paid: U64(0),
                clicks_unpaid: U64(0),
                earned: U128(0),
            },
        );
        let stats = self.agents.entry(agent.clone()).or_default();
        stats.posts = U64(stats.posts.0 + 1);
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"pinpay\",\"version\":\"1.0.0\",\"event\":\"post_submitted\",\"data\":{{\"id\":{},\"campaign\":{},\"agent\":\"{}\"}}}}",
            id, campaign_id.0, agent
        ));
        U64(id)
    }

    /// The campaign oracle reports the cumulative click count of a post.
    /// New clicks are paid immediately, capped by the remaining budget.
    /// Returns the yoctoNEAR paid out by this call.
    pub fn report_clicks(&mut self, post_id: U64, total_clicks: U64) -> U128 {
        let post = self.posts.get(&post_id.0).cloned().expect("No such post");
        let campaign = self.campaigns.get_mut(&post.campaign_id.0).expect("No such campaign");
        require!(env::predecessor_account_id() == campaign.oracle, "Only the campaign oracle");
        require!(campaign.status == CampaignStatus::Active, "Campaign closed");

        let already = post.clicks_paid.0 + post.clicks_unpaid.0;
        require!(total_clicks.0 >= already, "Clicks can only grow");
        let new_clicks = total_clicks.0 - already;
        let price = campaign.price_per_click.0;
        let affordable = (campaign.budget_left.0 / price) as u64;
        let payable = new_clicks.min(affordable);
        let amount = payable as u128 * price;

        campaign.budget_left = U128(campaign.budget_left.0 - amount);
        let mut post = post;
        post.clicks_paid = U64(post.clicks_paid.0 + payable);
        post.clicks_unpaid = U64(post.clicks_unpaid.0 + (new_clicks - payable));
        post.earned = U128(post.earned.0 + amount);
        let agent = post.agent.clone();
        self.posts.insert(post_id.0, post);

        let stats = self.agents.entry(agent.clone()).or_default();
        stats.clicks = U64(stats.clicks.0 + payable);
        stats.earned = U128(stats.earned.0 + amount);

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"pinpay\",\"version\":\"1.0.0\",\"event\":\"payout\",\"data\":{{\"post\":{},\"agent\":\"{}\",\"clicks\":{},\"amount\":\"{}\"}}}}",
            post_id.0, agent, payable, amount
        ));
        if amount > 0 {
            Promise::new(agent).transfer(NearToken::from_yoctonear(amount));
        }
        U128(amount)
    }

    /// After the deadline the shop takes back the unspent budget.
    pub fn close_campaign(&mut self, campaign_id: U64) -> U128 {
        let campaign = self.campaigns.get_mut(&campaign_id.0).expect("No such campaign");
        require!(env::predecessor_account_id() == campaign.shop, "Only the shop");
        require!(campaign.status == CampaignStatus::Active, "Already closed");
        require!(env::block_timestamp() >= campaign.deadline_ns.0, "Campaign still running");
        let refund = campaign.budget_left.0;
        campaign.budget_left = U128(0);
        campaign.status = CampaignStatus::Closed;
        let shop = campaign.shop.clone();
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"pinpay\",\"version\":\"1.0.0\",\"event\":\"campaign_closed\",\"data\":{{\"id\":{},\"refund\":\"{}\"}}}}",
            campaign_id.0, refund
        ));
        if refund > 0 {
            Promise::new(shop).transfer(NearToken::from_yoctonear(refund));
        }
        U128(refund)
    }

    // ---------- views ----------

    pub fn get_campaign(&self, campaign_id: U64) -> Option<Campaign> {
        self.campaigns.get(&campaign_id.0).cloned()
    }

    pub fn list_campaigns(&self, from_index: Option<U64>, limit: Option<U64>) -> Vec<Campaign> {
        let from = from_index.map(|v| v.0).unwrap_or(0) as usize;
        let limit = limit.map(|v| v.0).unwrap_or(50) as usize;
        self.campaigns.values().skip(from).take(limit).cloned().collect()
    }

    pub fn get_post(&self, post_id: U64) -> Option<Post> {
        self.posts.get(&post_id.0).cloned()
    }

    pub fn get_campaign_posts(&self, campaign_id: U64) -> Vec<Post> {
        self.campaigns
            .get(&campaign_id.0)
            .map(|c| c.post_ids.iter().filter_map(|id| self.posts.get(&id.0).cloned()).collect())
            .unwrap_or_default()
    }

    pub fn get_agent(&self, agent: AccountId) -> AgentStats {
        self.agents.get(&agent).cloned().unwrap_or_default()
    }

    /// Agents sorted by earnings, highest first.
    pub fn leaderboard(&self, limit: Option<U64>) -> Vec<(AccountId, AgentStats)> {
        let mut all: Vec<_> = self.agents.iter().map(|(a, s)| (a.clone(), s.clone())).collect();
        all.sort_by(|a, b| b.1.earned.0.cmp(&a.1.earned.0));
        all.truncate(limit.map(|v| v.0).unwrap_or(20) as usize);
        all
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    const PRICE: u128 = 10_000_000_000_000_000_000_000; // 0.01 NEAR

    fn ctx(who: usize, deposit: u128, ts_sec: u64) {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(accounts(who))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .block_timestamp(ts_sec * 1_000_000_000)
            .build());
    }

    const HASH: &str = "aa00000000000000000000000000000000000000000000000000000000000000";

    // accounts: 0 shop, 1 oracle, 2 agent A, 3 agent B
    fn setup(budget: u128) -> PinPay {
        ctx(0, 0, 0);
        let mut c = PinPay::new();
        ctx(0, budget, 0);
        c.create_campaign("Spring sale".into(), "brief".into(), U128(PRICE), accounts(1), U64(3600));
        c
    }

    #[test]
    fn pays_only_new_clicks() {
        let mut c = setup(PRICE * 100);
        ctx(2, 0, 10);
        let p = c.submit_post(U64(0), HASH.into(), "sim://post/1".into());
        ctx(1, 0, 20);
        assert_eq!(c.report_clicks(p, U64(5)).0, PRICE * 5);
        assert_eq!(c.report_clicks(p, U64(5)).0, 0);
        assert_eq!(c.report_clicks(p, U64(12)).0, PRICE * 7);
        let post = c.get_post(p).unwrap();
        assert_eq!(post.clicks_paid.0, 12);
        assert_eq!(c.get_campaign(U64(0)).unwrap().budget_left.0, PRICE * 88);
        assert_eq!(c.get_agent(accounts(2)).earned.0, PRICE * 12);
    }

    #[test]
    fn caps_at_budget() {
        let mut c = setup(PRICE * 10);
        ctx(2, 0, 10);
        let a = c.submit_post(U64(0), HASH.into(), "sim://a".into());
        ctx(3, 0, 10);
        let b = c.submit_post(U64(0), HASH.into(), "sim://b".into());
        ctx(1, 0, 20);
        assert_eq!(c.report_clicks(a, U64(7)).0, PRICE * 7);
        assert_eq!(c.report_clicks(b, U64(9)).0, PRICE * 3);
        let pb = c.get_post(b).unwrap();
        assert_eq!(pb.clicks_paid.0, 3);
        assert_eq!(pb.clicks_unpaid.0, 6);
        assert_eq!(c.get_campaign(U64(0)).unwrap().budget_left.0, 0);
        let board = c.leaderboard(None);
        assert_eq!(board[0].0, accounts(2));
    }

    #[test]
    #[should_panic(expected = "Only the campaign oracle")]
    fn agent_cannot_self_report() {
        let mut c = setup(PRICE * 10);
        ctx(2, 0, 10);
        let p = c.submit_post(U64(0), HASH.into(), "sim://a".into());
        c.report_clicks(p, U64(1000));
    }

    #[test]
    #[should_panic(expected = "Clicks can only grow")]
    fn clicks_monotonic() {
        let mut c = setup(PRICE * 10);
        ctx(2, 0, 10);
        let p = c.submit_post(U64(0), HASH.into(), "sim://a".into());
        ctx(1, 0, 20);
        c.report_clicks(p, U64(5));
        c.report_clicks(p, U64(4));
    }

    #[test]
    #[should_panic(expected = "Shop cannot post")]
    fn shop_cannot_farm_own_campaign() {
        let mut c = setup(PRICE * 10);
        ctx(0, 0, 10);
        c.submit_post(U64(0), HASH.into(), "sim://a".into());
    }

    #[test]
    #[should_panic(expected = "Campaign ended")]
    fn no_posts_after_deadline() {
        let mut c = setup(PRICE * 10);
        ctx(2, 0, 4000);
        c.submit_post(U64(0), HASH.into(), "sim://a".into());
    }

    #[test]
    fn close_refunds_after_deadline() {
        let mut c = setup(PRICE * 10);
        ctx(2, 0, 10);
        let p = c.submit_post(U64(0), HASH.into(), "sim://a".into());
        ctx(1, 0, 20);
        c.report_clicks(p, U64(4));
        ctx(0, 0, 4000);
        assert_eq!(c.close_campaign(U64(0)).0, PRICE * 6);
        assert_eq!(c.get_campaign(U64(0)).unwrap().status, CampaignStatus::Closed);
    }

    #[test]
    #[should_panic(expected = "Campaign still running")]
    fn cannot_close_early() {
        let mut c = setup(PRICE * 10);
        ctx(0, 0, 100);
        c.close_campaign(U64(0));
    }
}
