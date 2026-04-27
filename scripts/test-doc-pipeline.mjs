// End-to-end smoke test of the documentary pipeline
// Loads the built MCP modules directly and runs:
//   extract_pdf -> split_chapters -> plan_documentary_scenes -> validate_attention
import { config as dotenvConfig } from "dotenv";
import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = pathResolve(__dirname, "..");
dotenvConfig({ path: pathResolve(PACKAGE_ROOT, ".env") });
if (!process.env.VIDEOLAB_CONFIG && !process.env.PROMO_VIDEO_CONFIG) {
  process.env.VIDEOLAB_CONFIG = pathResolve(PACKAGE_ROOT, "videolab.config.json");
}

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse/lib/pdf-parse.js");

const { loadConfig } = await import("../build/config.js");
const { buildContext } = await import("../build/lib/context.js");

const PDF_PATH = process.argv[2] ?? "C:/tmp/chap02.pdf";
const TARGET_MINUTES = Number(process.argv[3] ?? 5);

const loaded = loadConfig();
const ctx = buildContext(loaded);

console.log(`\n=== Phase 1: extract_pdf (${PDF_PATH}) ===`);
const buf = readFileSync(PDF_PATH);
const parsed = await pdfParse(buf);
const fullText = parsed.text;
console.log(`pages: ${parsed.numpages} | chars: ${fullText.length}`);

console.log(`\n=== Phase 2: chapter detection ===`);
// chap02.pdf is already a single chapter — wrap as one chapter
const chapter = {
  number: 2,
  title: "Egypt and the Fertile Crescent",
  text: fullText,
  wordCount: fullText.trim().split(/\s+/).filter(Boolean).length,
};
console.log(`treating PDF as single chapter: "${chapter.title}" (${chapter.wordCount} words)`);

console.log(`\n=== Phase 3: plan_documentary_scenes (target ${TARGET_MINUTES} min) ===`);
const targetSec = TARGET_MINUTES * 60;
const targetSceneCount = Math.round(targetSec / 20);

const SCENE_PLANNER_SYSTEM = `You are a senior documentary writer specializing in ADHD-optimized educational video.
You convert dense source material into short, punchy, attention-aware scenes for a video documentary.
You output STRICT JSON only — no prose, no markdown fences, no commentary.`;

const userPrompt = `Chapter title: "${chapter.title}"

Convert the chapter below into a documentary scene plan.

Target: ~${TARGET_MINUTES} minutes, ~${targetSceneCount} scenes.
Each scene MUST be 15–25 seconds, 40–70 words of narration.

ADHD optimization rules (enforce strictly):
- Scene 1 must have attentionPurpose = "Hook" with a thumb-stopping opening line
- One idea per scene
- Insert a "PatternInterrupt" every 3–5 scenes (a question, contradiction, or sharp pivot)
- Insert a "MicroRecap" every 6–8 scenes (1-sentence "so far we've learned…")
- Insert a "WhyItMatters" every 4–6 scenes (real-world relevance, stakes)
- Conversational tone — no academic phrasing
- Use phrases like "Here's the twist.", "But that's not the whole story.", "This is where it gets interesting.", "Why does this matter?"
- Final scene should be a "Cliffhanger" or strong closing line

Per-scene fields (JSON):
- sceneNumber: integer 1..N
- durationSeconds: 15–25
- narration: 40–70 words, the spoken voiceover
- subtitle: ≤12 words, what shows large on screen during the scene
- visualText: ≤6 words, the title-card overlay
- attentionPurpose: one of Hook|CoreIdea|Example|PatternInterrupt|MicroRecap|Transition|WhyItMatters|Cliffhanger
- visualPrompt: 1-2 sentence cinematic visual description for AI b-roll generation. Concrete, photographable.

Output ONLY a JSON array of scene objects. No wrapping object, no markdown, no prose.

CHAPTER TEXT:
${chapter.text}`;

const llmRes = await ctx.llm().complete({
  system: SCENE_PLANNER_SYSTEM,
  user: userPrompt,
  maxTokens: 8000,
  jsonOnly: true,
});

console.log(`LLM returned ${llmRes.text.length} chars`);

// Parse JSON
let scenes;
{
  const trimmed = llmRes.text.trim().replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  scenes = JSON.parse(trimmed.slice(start, end + 1));
}

const totalSec = scenes.reduce((s, x) => s + x.durationSeconds, 0);
console.log(`\n${scenes.length} scenes planned (~${Math.round(totalSec)}s = ${(totalSec/60).toFixed(1)} min)`);
for (const s of scenes) {
  console.log(`  [${s.sceneNumber}] ${s.attentionPurpose} ${s.durationSeconds}s — "${s.subtitle}"`);
}

console.log(`\n=== Phase 4: validate_attention ===`);

function countWords(s) { return s.trim().split(/\s+/).filter(Boolean).length; }
const issues = [];
const warnings = [];
if (scenes[0]?.attentionPurpose !== "Hook") issues.push(`Scene 1 must be Hook, got "${scenes[0]?.attentionPurpose}"`);
for (const s of scenes) {
  if (s.durationSeconds > 25) issues.push(`Scene ${s.sceneNumber} is ${s.durationSeconds}s (> 25s cap)`);
  if (s.durationSeconds < 10) warnings.push(`Scene ${s.sceneNumber} is ${s.durationSeconds}s (< 10s)`);
  if (countWords(s.subtitle) > 12) warnings.push(`Scene ${s.sceneNumber} subtitle has ${countWords(s.subtitle)} words (cap 12)`);
  if (countWords(s.visualText) > 6) warnings.push(`Scene ${s.sceneNumber} visualText has ${countWords(s.visualText)} words (cap 6)`);
}
const lastN = (n) => scenes.slice(-n);
if (scenes.length >= 5 && !lastN(5).some(s => s.attentionPurpose === "PatternInterrupt")) issues.push("No PatternInterrupt in last 5 scenes");
if (scenes.length >= 8 && !lastN(8).some(s => s.attentionPurpose === "MicroRecap")) warnings.push("No MicroRecap in last 8 scenes");
if (scenes.length >= 6 && !lastN(6).some(s => s.attentionPurpose === "WhyItMatters")) warnings.push("No WhyItMatters in last 6 scenes");

const purposeCounts = scenes.reduce((acc, s) => { acc[s.attentionPurpose] = (acc[s.attentionPurpose] ?? 0) + 1; return acc; }, {});
console.log(`ok: ${issues.length === 0}`);
console.log(`avg duration: ${(totalSec/scenes.length).toFixed(1)}s/scene`);
console.log(`avg subtitle words: ${(scenes.reduce((s,x) => s + countWords(x.subtitle), 0) / scenes.length).toFixed(1)}`);
console.log(`avg visualText words: ${(scenes.reduce((s,x) => s + countWords(x.visualText), 0) / scenes.length).toFixed(1)}`);
console.log(`purpose counts: ${Object.entries(purposeCounts).map(([k,v])=>`${k}=${v}`).join(", ")}`);
if (issues.length) {
  console.log("\nISSUES:");
  for (const i of issues) console.log(`  ✗ ${i}`);
}
if (warnings.length) {
  console.log("\nwarnings:");
  for (const w of warnings) console.log(`  ! ${w}`);
}

// Save scenes for next phase
const outPath = pathResolve(PACKAGE_ROOT, "media", "doc-test-scenes.json");
writeFileSync(outPath, JSON.stringify({ chapter, scenes, validation: { issues, warnings, ok: issues.length === 0 } }, null, 2));
console.log(`\nscenes written to: ${outPath}`);

// Cost estimate
const veoCostPerScene = 2.0;
const estCost = scenes.length * veoCostPerScene;
console.log(`\n=== Cost estimate (default broll mode) ===`);
console.log(`${scenes.length} scenes × ~$${veoCostPerScene.toFixed(2)}/scene = ~$${estCost.toFixed(0)}`);
console.log(`+ VO/music: ~$1`);
console.log(`Total: ~$${(estCost + 1).toFixed(0)} per chapter\n`);
