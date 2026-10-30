// Creative generation. Offline by default (template engine, deterministic);
// set ANTHROPIC_API_KEY to let the agent write captions with Claude instead.
import { createHash } from "node:crypto";
import { rng, hashSeed } from "./market.js";

export const STYLES = ["minimal", "hype", "story", "deal"];

const TEMPLATES = {
  minimal: ["{product}. Nothing more.", "Less noise. {product}.", "{product} — made simple."],
  hype: ["🔥 {product} is HERE. Don't sleep on it!", "Everyone is talking about {product} 🚀", "Drop alert: {product} ⚡️"],
  story: ["The morning I found {product}, everything slowed down.", "We built {product} for the quiet hours.", "A small ritual: {product}, every day."],
  deal: ["{product}: 20% off this week only.", "Bundle & save on {product} — ends Sunday.", "Free shipping on {product} today."],
};

const PALETTES = {
  minimal: ["#f4f1ea", "#1f1f1f"],
  hype: ["#ff3d6e", "#ffffff"],
  story: ["#2c3e50", "#f6d6ad"],
  deal: ["#ffd23f", "#1a1a1a"],
};

function escapeXml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

/** A 1000x1500 vertical ad card as SVG (Pinterest-like ratio). */
export function renderCard(caption, product, style) {
  const [bg, fg] = PALETTES[style];
  const words = caption.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > 22) {
      lines.push(line.trim());
      line = w;
    } else line += " " + w;
  }
  lines.push(line.trim());
  const text = lines
    .map((l, i) => `<text x="80" y="${640 + i * 90}" font-size="72" font-family="Georgia, serif" fill="${fg}">${escapeXml(l)}</text>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1500"><rect width="1000" height="1500" fill="${bg}"/><circle cx="820" cy="260" r="150" fill="${fg}" opacity="0.12"/>${text}<text x="80" y="1380" font-size="44" font-family="Helvetica, sans-serif" fill="${fg}" opacity="0.7">${escapeXml(product)}</text></svg>`;
}

async function claudeCaption(brief, product, style) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.PINPAY_MODEL || "claude-haiku-5-5",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: `Write one social media caption (max 90 characters, no hashtags) in a "${style}" style for ${product}. Brief: ${brief}. Reply with the caption only.`,
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const data = await res.json();
  return data.content[0].text.trim().replace(/^"|"$/g, "");
}

/** Returns { caption, svg, contentHash, quality }. quality ∈ [0.8, 1.2] is the creative's intrinsic appeal. */
export async function makeCreative({ agentId, campaignId, brief, product, style, variant }) {
  const r = rng(hashSeed(`${agentId}:${campaignId}:${style}:${variant}`));
  let caption;
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      caption = await claudeCaption(brief, product, style);
    } catch {
      caption = null;
    }
  }
  const options = TEMPLATES[style];
  caption ??= options[Math.floor(r() * options.length)].replace("{product}", product);
  const svg = renderCard(caption, product, style);
  const contentHash = createHash("sha256").update(caption).update(svg).digest("hex");
  return { caption, svg, contentHash, quality: 0.8 + 0.4 * r() };
}
