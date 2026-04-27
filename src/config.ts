import { readFileSync, existsSync } from "node:fs";
import { resolve, isAbsolute, dirname } from "node:path";
import { z } from "zod";
import { logger } from "./logger.js";

const StorageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local"), root: z.string() }),
  z.object({ kind: z.literal("s3"), bucket: z.string(), region: z.string().optional(), prefix: z.string().optional() }),
  z.object({ kind: z.literal("azure"), container: z.string(), prefix: z.string().optional() }),
]);

const IndexSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("json"), path: z.string() }),
]);

const ProvidersSchema = z.object({
  musicGen: z.enum(["elevenlabs"]).default("elevenlabs"),
  tts: z.enum(["elevenlabs"]).default("elevenlabs"),
  llm: z.enum(["anthropic"]).default("anthropic"),
  animate: z.enum(["veo", "none"]).default("veo"),
  talkingHead: z.enum(["fal-omnihuman", "none"]).default("fal-omnihuman"),
  imageGen: z.enum(["gemini-nano-banana", "none"]).default("gemini-nano-banana"),
  sceneAssets: z.enum(["json-manifest", "treefrog-mongo"]).default("json-manifest"),
  musicLibrary: z.enum(["local", "treefrog-mongo", "hybrid"]).default("local"),
  brollLibrary: z.enum(["local", "treefrog-mongo", "hybrid"]).default("local"),
});

const TreeFrogSchema = z.object({
  dbName: z.string().default("video_assets"),
  musicCampaignName: z.string().optional(),
  musicCollection: z.string().optional(),
  brollCollection: z.string().optional(),
  sceneCollection: z.string().default("scenes"),
  azureContainer: z.string().default("media-assets"),
}).default({ dbName: "video_assets", sceneCollection: "scenes", azureContainer: "media-assets" });

const FfmpegSchema = z.object({
  binary: z.string().default("ffmpeg"),
  videoCodec: z.string().default("libx264"),
  preset: z.string().default("fast"),
  crf: z.number().int().default(23),
  audioCodec: z.string().default("aac"),
  audioBitrate: z.string().default("128k"),
}).default({
  binary: "ffmpeg", videoCodec: "libx264", preset: "fast", crf: 23, audioCodec: "aac", audioBitrate: "128k",
});

const DefaultsSchema = z.object({
  platform: z.enum(["mobile", "desktop"]).default("mobile"),
  voiceId: z.string().default("4YYIPFl9wE5c4L2eu2Gb"),
  ttsModel: z.string().default("eleven_multilingual_v2"),
  musicBedVolume: z.number().min(0).max(1).default(0.18),
  voiceoverVolume: z.number().min(0).max(1).default(1.0),
}).default({
  platform: "mobile", voiceId: "4YYIPFl9wE5c4L2eu2Gb", ttsModel: "eleven_multilingual_v2",
  musicBedVolume: 0.18, voiceoverVolume: 1.0,
});

const SceneAssetsSchema = z.object({
  manifestPath: z.string().optional(),
}).default({});

const ConfigSchema = z.object({
  storage: StorageSchema,
  index: IndexSchema,
  providers: ProvidersSchema.default({
    musicGen: "elevenlabs", tts: "elevenlabs", llm: "anthropic", animate: "veo",
    talkingHead: "fal-omnihuman", imageGen: "gemini-nano-banana", sceneAssets: "json-manifest",
    musicLibrary: "local", brollLibrary: "local",
  }),
  ffmpeg: FfmpegSchema,
  defaults: DefaultsSchema,
  sceneAssets: SceneAssetsSchema,
  treefrog: TreeFrogSchema,
});

export type Config = z.infer<typeof ConfigSchema>;

export type Secrets = {
  elevenlabs?: string;
  anthropic?: string;
  veo?: string;
  fal?: string;
  mongoUri?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsRegion?: string;
  azureConnectionString?: string;
};

export type LoadedConfig = {
  config: Config;
  secrets: Secrets;
  configPath: string;
  configDir: string;
  cwd: string;
};

function resolveConfigPath(): string {
  const envPath = process.env.VIDEOLAB_CONFIG ?? process.env.PROMO_VIDEO_CONFIG;
  if (envPath) {
    return isAbsolute(envPath) ? envPath : resolve(process.cwd(), envPath);
  }
  const cwd = process.cwd();
  const candidates = ["videolab.config.json", "promo-video.config.json"];
  for (const name of candidates) {
    const p = resolve(cwd, name);
    if (existsSync(p)) return p;
  }
  return resolve(cwd, candidates[0]);
}

export function loadConfig(): LoadedConfig {
  const configPath = resolveConfigPath();
  if (!existsSync(configPath)) {
    throw new Error(
      `Config file not found at ${configPath}. ` +
      `Set VIDEOLAB_CONFIG env var or place videolab.config.json in cwd. ` +
      `See videolab.config.example.json for the schema.`
    );
  }
  const raw = JSON.parse(readFileSync(configPath, "utf8"));
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid config at ${configPath}:\n${parsed.error.toString()}`);
  }
  const secrets: Secrets = {
    elevenlabs: process.env.ELEVENLABS_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    veo: process.env.GOOGLE_VEO_API_KEY ?? process.env.GEMINI_API_KEY,
    fal: process.env.FAL_KEY,
    mongoUri: process.env.MONGODB_URI,
    awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
    awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    awsRegion: process.env.AWS_REGION,
    azureConnectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
  };
  logger.info(`config loaded from ${configPath}`);
  return { config: parsed.data, secrets, configPath, configDir: dirname(configPath), cwd: process.cwd() };
}
