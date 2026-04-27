import { z } from "zod";
import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve as pathResolve, basename } from "node:path";
import { createRequire } from "node:module";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../lib/context.js";
import type { DocChapter, DocScene, AttentionPurpose, AttentionValidation } from "../types.js";

const require = createRequire(import.meta.url);

const ATTENTION_PURPOSES = [
  "Hook", "CoreIdea", "Example", "PatternInterrupt",
  "MicroRecap", "Transition", "WhyItMatters", "Cliffhanger",
] as const;

const SceneSchema = z.object({
  sceneNumber: z.number().int().positive(),
  durationSeconds: z.number().min(5).max(45),
  narration: z.string().min(1),
  subtitle: z.string().min(1),
  visualText: z.string().min(1),
  attentionPurpose: z.enum(ATTENTION_PURPOSES),
  visualPrompt: z.string().optional(),
});

export function registerDocumentaryTools(server: McpServer, ctx: Context): void {
  server.registerTool(
    "extract_pdf",
    {
      description: "Extract plain text + page count + candidate chapter boundaries from a PDF file. Use this as the first step in the text-to-documentary workflow when input is a PDF. The candidateChapters[] array is heuristic — review it before passing to split_chapters.",
      inputSchema: {
        path: z.string().describe("Absolute or relative path to a .pdf file"),
        maxChars: z.number().int().positive().optional().describe("Max characters of full text to return inline. Default 100000. Larger PDFs are still parsed; this just truncates the response payload."),
      },
    },
    async ({ path, maxChars = 4000 }) => {
      const absPath = isAbsolute(path) ? path : pathResolve(ctx.cwd, path);
      const buf = readFileSync(absPath);
      const pdfParse = require("pdf-parse/lib/pdf-parse.js");
      const result = await pdfParse(buf);
      const fullText: string = result.text ?? "";
      const candidates = detectChapterCandidates(fullText);

      // Always persist full text to disk so downstream tools can read it without bloating responses.
      const stem = basename(absPath).replace(/\.pdf$/i, "").replace(/[^a-zA-Z0-9_-]/g, "_");
      const textRel = `extracted/${stem}.txt`;
      const textLocal = await ctx.storage.localPathFor(textRel);
      writeFileSync(textLocal, fullText, "utf8");

      const preview = fullText.slice(0, maxChars);
      return {
        content: [
          { type: "text", text:
            `pdf: ${absPath}\n` +
            `pages: ${result.numpages}\n` +
            `chars: ${fullText.length}\n` +
            `full text saved to: ${textLocal}\n` +
            `(pass this path to split_chapters/plan_documentary_scenes via the *Path params)\n` +
            `candidate chapters: ${candidates.length}\n\n` +
            (candidates.length > 0
              ? candidates.map(c => `  ${c.number}. "${c.title}" (offset ${c.startCharOffset})`).join("\n") + "\n\n"
              : "No chapter headings auto-detected. Use split_chapters with strategy='wordcount' or treat the whole PDF as one chapter.\n\n") +
            `--- PREVIEW (first ${preview.length}/${fullText.length} chars) ---\n${preview}${fullText.length > preview.length ? "\n... [truncated]" : ""}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "split_chapters",
    {
      description: "Split a long text body into chapters. Pass full PDF text (from extract_pdf) or any pasted document. Use strategy='auto' to try heading detection first then fall back to word-count slicing.",
      inputSchema: {
        text: z.string().optional().describe("Inline text (≤ a few thousand chars). For long documents, use textPath instead."),
        textPath: z.string().optional().describe("Absolute or relative path to a text file (e.g., the file written by extract_pdf). Preferred for long inputs."),
        strategy: z.enum(["auto", "headings", "numeric", "wordcount"]).optional().describe("Default 'auto'. 'headings' = match 'Chapter N' / 'CHAPTER N'. 'numeric' = match '1. Title' / '2. Title' style. 'wordcount' = even slices."),
        targetWordsPerChapter: z.number().int().min(500).max(20_000).optional().describe("Used by 'wordcount' (and as fallback). Default 5000."),
      },
    },
    async ({ text, textPath, strategy = "auto", targetWordsPerChapter = 5000 }) => {
      const body = await loadTextInput(ctx.cwd, text, textPath);
      if (body.length < 50) {
        return { content: [{ type: "text", text: "Input text too short (< 50 chars). Provide longer text or a valid textPath." }], isError: true };
      }
      const chapters = splitIntoChapters(body, strategy, targetWordsPerChapter);

      // Save chapter texts to disk (avoids large response payloads downstream)
      const dirRel = `extracted/chapters_${Date.now()}`;
      const chapterFiles: Array<{ number: number; title: string; wordCount: number; textPath: string }> = [];
      for (const c of chapters) {
        const fileRel = `${dirRel}/chapter_${String(c.number).padStart(2, "0")}.txt`;
        const fileLocal = await ctx.storage.localPathFor(fileRel);
        writeFileSync(fileLocal, c.text, "utf8");
        chapterFiles.push({ number: c.number, title: c.title, wordCount: c.wordCount, textPath: fileLocal });
      }

      const lines = chapterFiles.map(c => `  ${c.number}. "${c.title}" (${c.wordCount} words) → ${c.textPath}`);
      return {
        content: [
          { type: "text", text:
            `${chapters.length} chapter(s) [strategy=${strategy}]:\n${lines.join("\n")}\n\n` +
            `(Pass each chapter's textPath to plan_documentary_scenes via chapterTextPath)\n\n` +
            `--- chapters meta JSON ---\n${JSON.stringify(chapterFiles, null, 2)}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "plan_documentary_scenes",
    {
      description: "Convert a chapter into ~12-20 ADHD-optimized scenes targeting a 5-minute video. Calls the configured LLM with strict structural rules (Hook in scene 1, PatternInterrupt every 3-5 scenes, MicroRecap every 6-8, WhyItMatters every 4-6). Returns scenes[] with narration, subtitle, visualText, attentionPurpose, durationSeconds, visualPrompt. Pipe into validate_attention before rendering.",
      inputSchema: {
        chapterText: z.string().min(100).optional().describe("The chapter body inline. For long chapters, use chapterTextPath instead."),
        chapterTextPath: z.string().optional().describe("Absolute or relative path to a chapter text file (e.g., from split_chapters or extract_pdf). Preferred for long chapters."),
        chapterTitle: z.string().optional(),
        targetMinutes: z.number().min(2).max(15).optional().describe("Target chapter video length. Default 5."),
        sceneSecondsRange: z.tuple([z.number(), z.number()]).optional().describe("Min/max scene length in seconds. Default [15, 25]."),
        includeVisualPrompts: z.boolean().optional().describe("Ask the LLM to include a cinematic visual prompt per scene (used by visualMode='broll' or 'mixed' to generate Veo b-roll). Default true."),
      },
    },
    async ({ chapterText, chapterTextPath, chapterTitle, targetMinutes = 5, sceneSecondsRange = [15, 25], includeVisualPrompts = true }) => {
      const resolvedText = await loadTextInput(ctx.cwd, chapterText, chapterTextPath);
      if (resolvedText.length < 100) {
        return { content: [{ type: "text", text: "Chapter text too short (< 100 chars). Provide chapterText or a valid chapterTextPath." }], isError: true };
      }
      const targetSeconds = targetMinutes * 60;
      const avgScene = (sceneSecondsRange[0] + sceneSecondsRange[1]) / 2;
      const targetSceneCount = Math.round(targetSeconds / avgScene);

      const prompt = buildScenePlannerPrompt({
        chapterText: resolvedText, chapterTitle,
        targetMinutes, targetSceneCount,
        sceneSecondsRange, includeVisualPrompts,
      });

      const llmRes = await ctx.llm().complete({
        system: SCENE_PLANNER_SYSTEM,
        user: prompt,
        maxTokens: 8000,
        jsonOnly: true,
      });

      const parsed = parseScenesFromLlm(llmRes.text);
      const validated = z.array(SceneSchema).safeParse(parsed);
      if (!validated.success) {
        return {
          content: [{ type: "text", text:
            `LLM returned invalid scene JSON.\n\nValidation errors:\n${validated.error.toString()}\n\n--- raw LLM output ---\n${llmRes.text.slice(0, 4000)}`,
          }],
          isError: true,
        };
      }
      const scenes = validated.data as DocScene[];
      const totalSec = scenes.reduce((s, x) => s + x.durationSeconds, 0);
      return {
        content: [
          { type: "text", text:
            `${scenes.length} scene(s) planned (~${Math.round(totalSec)}s = ${(totalSec/60).toFixed(1)} min)\n` +
            scenes.map(s => `  [${s.sceneNumber}] ${s.attentionPurpose} ${s.durationSeconds}s — "${s.subtitle}"`).join("\n") +
            `\n\n--- scenes JSON ---\n${JSON.stringify(scenes, null, 2)}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "validate_attention",
    {
      description: "Check that a planned scene array follows ADHD-optimization rules (deterministic, no LLM call). Validates: scene 1 is Hook, no scene > 25s, PatternInterrupt density, MicroRecap cadence, subtitle/visualText word caps. Returns { ok, issues[], warnings[], stats }. Run after plan_documentary_scenes; if !ok, re-plan or hand-edit.",
      inputSchema: {
        scenes: z.array(SceneSchema).min(1),
      },
    },
    async ({ scenes }) => {
      const result = validateScenes(scenes as DocScene[]);
      const lines: string[] = [];
      lines.push(`ok: ${result.ok}`);
      lines.push(`scenes: ${result.stats.sceneCount} | total: ${result.stats.totalSeconds}s (${(result.stats.totalSeconds/60).toFixed(1)} min) | avg ${result.stats.avgSceneSeconds.toFixed(1)}s/scene`);
      lines.push(`avg subtitle words: ${result.stats.avgSubtitleWords.toFixed(1)} (cap 12)`);
      lines.push(`avg visualText words: ${result.stats.avgVisualTextWords.toFixed(1)} (cap 6)`);
      lines.push(`purpose counts: ${Object.entries(result.stats.purposeCounts).map(([k,v])=>`${k}=${v}`).join(", ")}`);
      if (result.issues.length) {
        lines.push("\nISSUES (block render):");
        for (const i of result.issues) lines.push(`  ✗ ${i}`);
      }
      if (result.warnings.length) {
        lines.push("\nwarnings:");
        for (const w of result.warnings) lines.push(`  ! ${w}`);
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function loadTextInput(cwd: string, inline?: string, path?: string): Promise<string> {
  if (inline && inline.length > 0) return inline;
  if (path && path.length > 0) {
    const abs = isAbsolute(path) ? path : pathResolve(cwd, path);
    return readFileSync(abs, "utf8");
  }
  return "";
}

// ── Chapter detection ────────────────────────────────────────────────────────

const HEADING_RE = /^[ \t]*(?:chapter|CHAPTER)\s+([IVXLCDM\d]+|[a-zA-Z]+)\b[ \t:.-]*([^\n]*)$/m;
const NUMERIC_HEADING_RE = /^[ \t]*(\d{1,2})\.[ \t]+([A-Z][^\n]{2,80})$/m;

function detectChapterCandidates(text: string): DocChapter[] {
  const headingMatches = matchAll(text, /^[ \t]*(?:chapter|CHAPTER)\s+([IVXLCDM\d]+|[a-zA-Z]+)\b[ \t:.-]*([^\n]*)$/gm);
  if (headingMatches.length >= 2) return materializeChapters(text, headingMatches);
  const numericMatches = matchAll(text, /^[ \t]*(\d{1,2})\.[ \t]+([A-Z][^\n]{2,80})$/gm);
  if (numericMatches.length >= 2) return materializeChapters(text, numericMatches);
  return [];
}

function matchAll(text: string, re: RegExp): Array<{ index: number; title: string }> {
  const out: Array<{ index: number; title: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const fullLine = m[0].trim();
    const titleSuffix = (m[2] ?? "").trim();
    const title = titleSuffix || fullLine;
    out.push({ index: m.index, title });
  }
  return out;
}

function materializeChapters(text: string, marks: Array<{ index: number; title: string }>): DocChapter[] {
  const out: DocChapter[] = [];
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].index;
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
    const body = text.slice(start, end).trim();
    out.push({
      number: i + 1,
      title: marks[i].title.slice(0, 120),
      text: body,
      wordCount: countWords(body),
      startCharOffset: start,
      endCharOffset: end,
    });
  }
  return out;
}

function splitIntoChapters(text: string, strategy: string, targetWords: number): DocChapter[] {
  if (strategy === "auto" || strategy === "headings") {
    const m = matchAll(text, /^[ \t]*(?:chapter|CHAPTER)\s+([IVXLCDM\d]+|[a-zA-Z]+)\b[ \t:.-]*([^\n]*)$/gm);
    if (m.length >= 2) return materializeChapters(text, m);
    if (strategy === "headings") return [singletonChapter(text)];
  }
  if (strategy === "auto" || strategy === "numeric") {
    const m = matchAll(text, /^[ \t]*(\d{1,2})\.[ \t]+([A-Z][^\n]{2,80})$/gm);
    if (m.length >= 2) return materializeChapters(text, m);
    if (strategy === "numeric") return [singletonChapter(text)];
  }
  return wordcountChapters(text, targetWords);
}

function singletonChapter(text: string): DocChapter {
  return { number: 1, title: "Full Text", text: text.trim(), wordCount: countWords(text) };
}

function wordcountChapters(text: string, target: number): DocChapter[] {
  const words = text.split(/\s+/);
  const chapters: DocChapter[] = [];
  let n = 1;
  for (let i = 0; i < words.length; i += target) {
    const slice = words.slice(i, i + target).join(" ");
    chapters.push({
      number: n,
      title: `Section ${n}`,
      text: slice,
      wordCount: Math.min(target, words.length - i),
    });
    n++;
  }
  return chapters;
}

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

// ── Scene planning prompt ────────────────────────────────────────────────────

const SCENE_PLANNER_SYSTEM = `You are a senior documentary writer specializing in ADHD-optimized educational video.
You convert dense source material into short, punchy, attention-aware scenes for a video documentary.
You output STRICT JSON only — no prose, no markdown fences, no commentary.`;

function buildScenePlannerPrompt(opts: {
  chapterText: string;
  chapterTitle?: string;
  targetMinutes: number;
  targetSceneCount: number;
  sceneSecondsRange: [number, number];
  includeVisualPrompts: boolean;
}): string {
  const titleLine = opts.chapterTitle ? `Chapter title: "${opts.chapterTitle}"\n\n` : "";
  return `${titleLine}Convert the chapter below into a documentary scene plan.

Target: ~${opts.targetMinutes} minutes, ~${opts.targetSceneCount} scenes.
Each scene MUST be ${opts.sceneSecondsRange[0]}–${opts.sceneSecondsRange[1]} seconds, 40–70 words of narration.

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
- durationSeconds: ${opts.sceneSecondsRange[0]}–${opts.sceneSecondsRange[1]}
- narration: 40–70 words, the spoken voiceover
- subtitle: ≤12 words, what shows large on screen during the scene (NOT a duplicate of narration)
- visualText: ≤6 words, the title-card overlay (very short, evocative)
- attentionPurpose: one of Hook|CoreIdea|Example|PatternInterrupt|MicroRecap|Transition|WhyItMatters|Cliffhanger
${opts.includeVisualPrompts ? `- visualPrompt: 1-2 sentence cinematic visual description for AI b-roll generation (e.g. "A weathered map of medieval Europe with red ink spreading across borders, candlelight, slow zoom"). Concrete, photographable.\n` : ""}
Output ONLY a JSON array of scene objects. No wrapping object, no markdown, no prose.

CHAPTER TEXT:
${opts.chapterText}`;
}

function parseScenesFromLlm(text: string): unknown {
  const trimmed = text.trim();
  // Strip ```json fences if present
  const stripped = trimmed.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
  // Find the first [ and last ]
  const start = stripped.indexOf("[");
  const end = stripped.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("No JSON array found in LLM output");
  }
  const slice = stripped.slice(start, end + 1);
  return JSON.parse(slice);
}

// ── Validation ───────────────────────────────────────────────────────────────

function validateScenes(scenes: DocScene[]): AttentionValidation {
  const issues: string[] = [];
  const warnings: string[] = [];

  if (scenes[0]?.attentionPurpose !== "Hook") {
    issues.push(`Scene 1 must be Hook, got "${scenes[0]?.attentionPurpose}"`);
  }

  for (const s of scenes) {
    if (s.durationSeconds > 25) {
      issues.push(`Scene ${s.sceneNumber} is ${s.durationSeconds}s (> 25s cap)`);
    }
    if (s.durationSeconds < 10) {
      warnings.push(`Scene ${s.sceneNumber} is ${s.durationSeconds}s (under 10s — may feel rushed)`);
    }
    const subWords = countWords(s.subtitle);
    if (subWords > 12) {
      warnings.push(`Scene ${s.sceneNumber} subtitle has ${subWords} words (cap 12)`);
    }
    const visWords = countWords(s.visualText);
    if (visWords > 6) {
      warnings.push(`Scene ${s.sceneNumber} visualText has ${visWords} words (cap 6)`);
    }
  }

  // Density checks (sliding-window sentinels)
  const lastN = (n: number) => scenes.slice(-n);
  if (scenes.length >= 5 && !lastN(5).some(s => s.attentionPurpose === "PatternInterrupt")) {
    issues.push("No PatternInterrupt in the last 5 scenes (rule: every 3–5 scenes)");
  }
  if (scenes.length >= 8 && !lastN(8).some(s => s.attentionPurpose === "MicroRecap")) {
    warnings.push("No MicroRecap in the last 8 scenes (rule: every 6–8 scenes)");
  }
  if (scenes.length >= 6 && !lastN(6).some(s => s.attentionPurpose === "WhyItMatters")) {
    warnings.push("No WhyItMatters in the last 6 scenes (rule: every 4–6 scenes)");
  }

  const totalSec = scenes.reduce((s, x) => s + x.durationSeconds, 0);
  const subWordsTotal = scenes.reduce((s, x) => s + countWords(x.subtitle), 0);
  const visWordsTotal = scenes.reduce((s, x) => s + countWords(x.visualText), 0);
  const purposeCounts = scenes.reduce<Record<string, number>>((acc, s) => {
    acc[s.attentionPurpose] = (acc[s.attentionPurpose] ?? 0) + 1;
    return acc;
  }, {});

  return {
    ok: issues.length === 0,
    issues,
    warnings,
    stats: {
      sceneCount: scenes.length,
      totalSeconds: totalSec,
      avgSceneSeconds: totalSec / scenes.length,
      avgSubtitleWords: subWordsTotal / scenes.length,
      avgVisualTextWords: visWordsTotal / scenes.length,
      purposeCounts,
    },
  };
}
