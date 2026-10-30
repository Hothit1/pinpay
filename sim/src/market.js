// Synthetic audience. All numbers in PinPay demos come from here: there is no
// real social network behind them. The model is deterministic for a given seed
// so tests and recordings are reproducible.

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(str) {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/**
 * Each campaign audience has a taste vector over creative styles.
 * Click-through rate of a post = base CTR × taste[style] × quality.
 */
export class Market {
  constructor(seed = 42) {
    this.seed = seed;
    this.audiences = new Map(); // campaignId -> { taste, reach }
    this.posts = new Map(); // postId -> { campaignId, style, quality, age, impressions, clicks }
  }

  addAudience(campaignId, taste, reach = 900) {
    this.audiences.set(String(campaignId), { taste, reach });
  }

  publish(postId, campaignId, style, quality) {
    this.posts.set(String(postId), { campaignId: String(campaignId), style, quality, age: 0, impressions: 0, clicks: 0 });
  }

  /** Advance one round: every live post gets impressions that decay with age. */
  tick(round) {
    for (const [postId, p] of this.posts) {
      const aud = this.audiences.get(p.campaignId);
      const r = rng(hashSeed(`${this.seed}:${postId}:${round}`));
      const decay = Math.pow(0.7, p.age);
      const impressions = Math.round(aud.reach * decay * (0.8 + 0.4 * r()));
      const ctr = 0.02 * (aud.taste[p.style] ?? 0.5) * p.quality;
      let clicks = 0;
      for (let i = 0; i < impressions; i++) if (r() < ctr) clicks++;
      p.impressions += impressions;
      p.clicks += clicks;
      p.age += 1;
    }
  }

  stats(postId) {
    const p = this.posts.get(String(postId));
    return p ? { impressions: p.impressions, clicks: p.clicks } : { impressions: 0, clicks: 0 };
  }
}
