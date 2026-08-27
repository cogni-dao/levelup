// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/home/content`
 * Purpose: Single customization surface for the public landing page. ALL editable
 *   copy and placeholder data for the homepage lives here — hero, showcase cards,
 *   activity feed, and stats. The components in `./components/*` are layout only;
 *   they read everything from this file.
 * Scope: Public homepage content. No logic, no IO — pure data.
 * Invariants: Shapes are stable so layout components stay generic. Customize VALUES,
 *   not shapes, when minting a new node.
 * Side-effects: none
 * Links: src/features/home/components/LandingHero.tsx,
 *   src/features/home/components/ShowcaseCards.tsx,
 *   src/features/home/components/ActivityFeed.tsx,
 *   src/features/home/components/AgentStream.tsx,
 *   src/features/home/components/HomeStats.tsx
 * @public
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  ███  CUSTOMIZE YOUR NODE HERE  ███
 *
 *  This file is the homepage. To make the landing page yours, you edit WORDS in
 *  this file and the brand HUE in `src/styles/tailwind.css`. You should not need
 *  to touch the layout components for a first-class customization.
 *
 *  Walk top-to-bottom and replace every placeholder with copy + data that sells
 *  YOUR node's mission. A stranger should understand what this node is for in
 *  five seconds. See `docs/guides/new-node-styling.md` and the `node-styling`
 *  skill for the full playbook.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  Activity,
  BrainCircuit,
  CheckCircle,
  Network,
  Search,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

/* ─── HERO ────────────────────────────────────────────────────────────────
 * The first thing a visitor sees. `headline` renders as two lines; the second
 * line gets the brand gradient. Keep it short and declarative.
 */
export interface HeroContent {
  /** Tiny uppercase label inside the status pill at the top of the hero. */
  statusLabel: string;
  /** Line 1 of the headline (plain foreground color). */
  headlineTop: string;
  /** Line 2 of the headline (renders with the brand gradient). */
  headlineAccent: string;
  /** One- to two-sentence value prop under the headline. */
  subhead: string;
  /** Primary CTA — wired to the "try the demo" sign-in flow. */
  primaryCta: string;
  /** Small uppercase tagline shown next to the primary CTA. */
  ctaTagline: string;
}

export const HERO: HeroContent = {
  statusLabel: "LevelUp online",
  headlineTop: "Tell it what you want to learn.",
  headlineAccent: "Get a plan that levels you up.",
  subhead:
    "LevelUp is an AI education node. It grows a living, confidence-scored knowledge network, then builds you a custom learning plan — every step cited to real sources and paired with exercises that prove you actually learned it.",
  primaryCta: "Build my learning plan",
  ctaTagline: "Assess · Plan · Practice · Level up.",
};

/* ─── HERO LINKS ──────────────────────────────────────────────────────────
 * Secondary buttons in the hero. Point them at your community + source.
 */
export const HERO_LINKS = {
  chatUrl: "https://discord.gg/3b9sSyhZ4z",
  sourceUrl: "https://github.com/cogni-dao/levelup",
} as const;

/* ─── AGENT STREAM ────────────────────────────────────────────────────────
 * The live "console" embedded in the hero. Each sequence plays out like the
 * agent thinking in real time, then loops to the next. Rewrite these lines to
 * describe what YOUR agent actually does, step by step. Keep ~4-6 events each.
 */
export type StreamEventType =
  | "thinking"
  | "searching"
  | "analyzing"
  | "signal"
  | "done";

export interface StreamEvent {
  id: string;
  type: StreamEventType;
  text: string;
  /** ms offset from the start of the sequence when this line appears. */
  at: number;
}

/** Label shown in the stream header next to the spinner. */
export const AGENT_STREAM_SUBJECT = "cogni/levelup";

export const AGENT_STREAM_SEQUENCES: StreamEvent[][] = [
  [
    {
      id: "a1",
      type: "thinking",
      text: "New learner goal: get from Python basics to shipping a REST API in 6 weeks",
      at: 0,
    },
    {
      id: "a2",
      type: "searching",
      text: "Placing them on the knowledge network — probing what they already know",
      at: 1800,
    },
    {
      id: "a3",
      type: "analyzing",
      text: "Found the gap: comfortable with syntax, weak on HTTP and async",
      at: 3400,
    },
    {
      id: "a4",
      type: "signal",
      text: "Plan drafted: 9 steps, each cited to a source and gated by an exercise.",
      at: 5600,
    },
    {
      id: "a5",
      type: "done",
      text: "Learning plan ready. First exercise unlocked.",
      at: 7200,
    },
  ],
  [
    {
      id: "b1",
      type: "thinking",
      text: "New source arrived: a peer-reviewed paper on spaced repetition...",
      at: 0,
    },
    {
      id: "b2",
      type: "searching",
      text: "Checking the network for existing atoms it confirms or contradicts",
      at: 2000,
    },
    {
      id: "b3",
      type: "analyzing",
      text: "Two atoms corroborated by 3 independent sources — raising confidence",
      at: 3800,
    },
    {
      id: "b4",
      type: "signal",
      text: "Atom 'interleaving beats blocking' → confidence 68% → 84%.",
      at: 5400,
    },
    {
      id: "b5",
      type: "done",
      text: "Knowledge network grew. Downstream plans re-cited automatically.",
      at: 6800,
    },
  ],
  [
    {
      id: "c1",
      type: "thinking",
      text: "Learner submitted exercise 4: implement a rate limiter...",
      at: 0,
    },
    {
      id: "c2",
      type: "searching",
      text: "Grading against the concept, not just the output",
      at: 1600,
    },
    {
      id: "c3",
      type: "analyzing",
      text: "Mastered token-bucket; the sliding-window edge case is still shaky",
      at: 3200,
    },
    {
      id: "c4",
      type: "done",
      text: "Plan re-sequenced: a targeted review step inserted before step 5.",
      at: 5000,
    },
  ],
];

/* ─── SHOWCASE CARDS ──────────────────────────────────────────────────────
 * A grid of cards showing what the node tracks / produces. The two-segment bar
 * is a generic split (e.g. Yes/No, Open/Closed, On-track/At-risk) — name the
 * segments per item. Replace the category list and the cards with your domain.
 */
export interface ShowcaseOutcome {
  label: string;
  /** 0-100; the two outcomes in a card should sum to ~100. */
  value: number;
}

export interface ShowcaseItem {
  id: string;
  title: string;
  /** Must match one of SHOWCASE_CATEGORIES (besides "All"). */
  category: string;
  /** Free-text source / origin shown in muted text. */
  source: string;
  /** Headline number shown top-right, e.g. "$4.2M" or "94%". */
  metric: string;
  /** 24h-style delta in percent; positive = up (success), negative = down. */
  change: number;
  /** Two-segment split bar. */
  outcomes: [ShowcaseOutcome, ShowcaseOutcome];
  /** Left footer meta (e.g. volume, members, size). */
  footerLeft: string;
  /** Right footer meta (e.g. "Updated 2h ago", "Resolves Jun 18"). */
  footerRight: string;
}

export const SHOWCASE_SECTION = {
  eyebrow: "How LevelUp works",
  heading: "A knowledge network that teaches, one learner at a time.",
  subhead:
    "LevelUp keeps a shared, confidence-scored knowledge base and turns it into a plan built for you: cited steps, exercises that gate progress, and mastery it re-checks as you go.",
} as const;

export const SHOWCASE_CATEGORIES = [
  "All",
  "Plans",
  "Knowledge",
  "Exercises",
  "Mastery",
] as const;

export const SHOWCASE_ITEMS: ShowcaseItem[] = [
  {
    id: "1",
    title: "A custom plan for your goal — every step cited",
    category: "Plans",
    source: "Learning plan",
    metric: "9 steps",
    change: 12,
    outcomes: [
      { label: "Cited", value: 100 },
      { label: "Unsourced", value: 0 },
    ],
    footerLeft: "Ordered by prerequisite",
    footerRight: "Built in ~30s",
  },
  {
    id: "2",
    title: "A growing knowledge network with confidence scores",
    category: "Knowledge",
    source: "Dolt knowledge base",
    metric: "4.1k atoms",
    change: 9,
    outcomes: [
      { label: "High confidence", value: 71 },
      { label: "Provisional", value: 29 },
    ],
    footerLeft: "Every atom links its sources",
    footerRight: "Versioned in Dolt",
  },
  {
    id: "3",
    title: "Exercises that prove you learned it, not just read it",
    category: "Exercises",
    source: "Practice engine",
    metric: "3 per step",
    change: 7,
    outcomes: [
      { label: "Concept-checked", value: 83 },
      { label: "Recall-only", value: 17 },
    ],
    footerLeft: "Graded on understanding",
    footerRight: "Gates the next step",
  },
  {
    id: "4",
    title: "Mastery tracked and the plan re-sequenced as you go",
    category: "Mastery",
    source: "Learner profile",
    metric: "live",
    change: 6,
    outcomes: [
      { label: "Mastered", value: 62 },
      { label: "In progress", value: 38 },
    ],
    footerLeft: "Weak spots trigger review",
    footerRight: "Updated each session",
  },
];

/* ─── ACTIVITY FEED ───────────────────────────────────────────────────────
 * "What the agent is thinking" — public, explainable output. Each signal shows
 * the call, a confidence, the reasoning, and the sources. This is where you
 * prove the node works in the open. Rewrite for your domain.
 */
export type SignalDirection = "positive" | "negative" | "neutral";

export interface FeedSignal {
  id: string;
  title: string;
  category: string;
  source: string;
  direction: SignalDirection;
  /** 0-100 self-reported confidence. */
  confidence: number;
  /** The agent's reasoning, 1-2 sentences. */
  thesis: string;
  /** Citations / inputs the agent used. */
  sources: string[];
  /** Human-friendly relative time, e.g. "2m ago". */
  timestamp: string;
}

export const FEED_SECTION = {
  eyebrow: "The knowledge network, in the open",
  heading: "Every claim scored. Every plan cited.",
  subhead:
    "LevelUp never asks you to trust it blind. Each knowledge atom carries a confidence score and the sources behind it — and you can watch the network sharpen as new evidence lands.",
} as const;

/** The status-bar verbs and the running totals shown above the feed. */
export const FEED_STATUS = {
  scannedLabel: "sources reviewed",
  signalsLabel: "atoms updated today",
  startScanned: 4127,
  signalsToday: 23,
} as const;

export const FEED_SIGNALS: FeedSignal[] = [
  {
    id: "s1",
    title: "Atom promoted: 'retrieval practice beats re-reading'",
    category: "Knowledge",
    source: "Dolt knowledge base",
    direction: "positive",
    confidence: 88,
    thesis:
      "A fourth independent source corroborated this atom, so its confidence crossed the threshold to anchor plan steps directly.",
    sources: ["Roediger & Karpicke 2006", "Dunlosky 2013", "2 replication studies"],
    timestamp: "2m ago",
  },
  {
    id: "s2",
    title: "Learning plan generated: SQL → analytics engineering",
    category: "Plans",
    source: "Plan builder",
    direction: "positive",
    confidence: 79,
    thesis:
      "Learner tested out of joins and aggregation, so the plan opens at window functions — 11 steps, each linked to a source and an exercise.",
    sources: ["Learner assessment", "Knowledge network", "Cited references"],
    timestamp: "9m ago",
  },
  {
    id: "s3",
    title: "Conflict flagged between two nutrition atoms",
    category: "Knowledge",
    source: "Consistency check",
    direction: "neutral",
    confidence: 54,
    thesis:
      "A new meta-analysis contradicts an older atom; both are held as provisional and demoted in confidence until a reviewer resolves the conflict.",
    sources: ["2024 meta-analysis", "Prior guideline", "Reviewer queue"],
    timestamp: "16m ago",
  },
  {
    id: "s4",
    title: "Plan re-sequenced after exercise result",
    category: "Mastery",
    source: "Learner profile",
    direction: "positive",
    confidence: 82,
    thesis:
      "The learner aced recursion but missed the base-case exercise, so a short review step was inserted before the next topic unlocks.",
    sources: ["Exercise grade", "Mastery model", "Plan graph"],
    timestamp: "24m ago",
  },
];

/* ─── STATS ───────────────────────────────────────────────────────────────
 * The closing band of big numbers. Keep them true and specific to your node.
 */
export interface StatItem {
  value: string;
  label: string;
}

export const STATS: StatItem[] = [
  { value: "4.1k", label: "Knowledge atoms" },
  { value: "100%", label: "Plan steps cited" },
  { value: "3x", label: "Exercises per step" },
  { value: "Live", label: "Mastery tracking" },
];

/* ─── STREAM ICONS ────────────────────────────────────────────────────────
 * Maps stream event types to icons. You usually won't need to touch this.
 */
export const STREAM_ICONS: Record<StreamEventType, LucideIcon> = {
  thinking: BrainCircuit,
  searching: Search,
  analyzing: Activity,
  signal: Sparkles,
  done: CheckCircle,
};

export const SECTION_ICON: LucideIcon = Network;
