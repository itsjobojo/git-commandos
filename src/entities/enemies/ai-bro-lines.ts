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
  'open weights won',
  'GLM-5.2 open weights are wild',
  'Kimi K2.7 changes everything',
  "DeepSeek V4 shipped we're back",
  'Qwen 3.6 made me feel AGI',
  'Laguna XS 2.1 orchestrates agents',
  'MiniMax M3 killed prompting',
  'thin wrapper GLM-5.2 is the moat',
  'SWE-bench Verified is saturated',
  'we eval Kimi K2.7 on vibes',
  'DeepSeek V4 Pro one-shot my repo',
  'running Gemma 4 to save compute',
  'scaling laws suggest Qwen 3.7 soon',
  'Nemotron 3 Ultra is a preview',
  'gpt-oss:20b is all you need',
  'MiniMax M3 moved us beyond RAG',
  'context is the moat ask MiniMax',
  'Kimi K2.7 runs fully autonomous',
  "GLM-5.2 a clone? that's slurs",
  'deprecated Qwen 3.5 for progress',
  'VibeThinker-3B hallucinates well',
  'Llama 4 Scout spun our flywheel',
  'human in the Claude Opus 5 loop',
  "Kimi K2.7's latency is on purpose",
  'Gemma 4 shows emergent behavior',
  'our stack is DeepSeek-native',
  'Mistral Medium 3.5 just gets it',
  "everyone sleeps on Qwen's pace",
  "can't brew coffee without Fable 5",
  'my kettle runs Gemma 4 E2B',
  'coffee is RAG for brains',
  'even GPT-5.5 still hallucinates',
  'Opus 5 is just autocomplete',

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
