/**
 * What the AI bros shout while they run you off the extraction pad.
 *
 * Tone target: confidently wrong on LinkedIn. They are not threatening you,
 * they are networking at you, and that is the joke — the danger is that they
 * physically will not stop coming.
 *
 * **Keep them short.** A speech bubble wraps at roughly 25 characters, and
 * twenty-five bros shouting three-line paragraphs at once buries the fight
 * they are supposed to be decorating. A line that needs a comma to land is
 * usually two lines that both land harder. `MAX_BUBBLE_CHARS` in
 * `ai-bro-lines.test.ts` holds the ceiling.
 *
 * Grouped by theme so it's obvious which register is thin when adding more.
 * Plain array on purpose: adding a line is a one-line diff, and the mission
 * RNG picks from it, so the same commit always gets the same nonsense.
 */
export const AI_BRO_LINES: readonly string[] = [
  // Hype and worship
  'AGI is basically here',
  'we are so back',
  'this changes everything',
  'the singularity is next quarter',
  'Claude is my cofounder',
  'GPT-7 is insane',
  'Gemini Pro solves everything',
  'Kimi 3 destroys benchmarks',
  'Qwen 3.8 is criminally slept on',
  'open weights won',

  // Fable 5 has become the name they drop, so it gets its own register: the
  // specificity is the joke — nobody says what it actually did.
  'Fable 5 centers my divs',
  'Fable 5 one-shotted it',
  'Fable 5 changed my life',
  'have you run this through Fable 5',
  'Fable 5 would never do that',
  'I only use Fable 5 now',
  'Fable 5 gets it',

  // Tools and workflow
  'I switched to Cursor',
  'just use an agent for that',
  'just prompt engineer it',
  'have you tried vibe coding?',
  "you're still coding manually?",
  'I automated my entire job',
  'Copilot writes all my code',
  'I replaced my whole team',
  'my agent is refactoring prod',
  'I vibe-coded our auth layer',
  'have you considered an MCP',
  'I gave it database access',

  // Hot takes
  'software engineers are done',
  'why would you learn to code?',
  'hallucinations are a feature',
  'context window is all you need',
  'college is obsolete',
  'typing is over',
  'commits are legacy',
  'why are you still using branches',
  'merge conflicts are a mindset',
  'shipping is a state of mind',
  'evals are a nice-to-have',
  'no tests, just conviction',
  'I review vibes, not diffs',

  // Startup energy
  'AI wrapper, $50M ARR',
  "we're building AGI",
  "it's an AI-first company",
  'pivoting to AI',
  'sniff my RAG pipeline',
  "we're pre-revenue but post-AGI",
  'my cofounder is an agent',
  'insane internal traction',
  "we're disrupting version control",
  'my P0 is a thought leadership post',
  "we're calling it AI-native",
  'we need a full-time prompter',

  // Meeting-brain
  'can we get this in the newsletter',
  "let's take this offline",
  'circling back on my circle back',
  "there's a Notion doc for this",
  "I'm not technical but I get it",
  'this is just like mobile',

  // Things it told them
  'the agent said it was done',
  'it wrote the tests too',
  'I skimmed the abstract',
  'I averaged three models',
  'the model gets our codebase',
  'the model writes the roadmap',
  'the monorepo fits in context',
  'trivial with a bigger model',
  'the repo is training data',
  "it's not a wrapper",
  'this whole repo is one prompt',
  "we 10x'd velocity last sprint",
] as const;
