import type { Config, Secrets } from "../config.js";
import type {
  StorageProvider, IndexProvider, SceneAssetProvider,
  TtsProvider, MusicGenProvider, LlmProvider, AnimateProvider, TalkingHeadProvider,
  BlobUploader, ImageGenProvider,
} from "./types.js";
import { AzureBlobUploader } from "./upload/azure.js";
import type { MusicLibrary, BRollLibrary } from "./library-types.js";
import { LocalStorageProvider } from "./storage/local.js";
import { JsonManifestSceneAssetProvider } from "./scene-assets/json-manifest.js";
import { TreeFrogMongoSceneAssetProvider } from "./scene-assets/treefrog-mongo.js";
import { ElevenLabsTtsProvider } from "./tts/elevenlabs.js";
import { ElevenLabsMusicGenProvider } from "./music-gen/elevenlabs.js";
import { AnthropicLlmProvider } from "./llm/anthropic.js";
import { VeoAnimateProvider } from "./animate/veo.js";
import { FalOmniHumanProvider } from "./talking-head/fal-omnihuman.js";
import { GeminiNanoBananaImageGenProvider } from "./imagegen/gemini-nano-banana.js";
import {
  JsonStore,
  LocalJsonMusicLibrary, LocalJsonBRollLibrary,
  LocalJsonVoiceoverStore, LocalJsonScriptStore, LocalJsonRenderStore, LocalJsonImageStore,
} from "./library/json-store.js";
import {
  CompositeIndexProvider, HybridMusicLibrary, HybridBRollLibrary,
} from "./library/composite.js";
import { TreeFrogMongoMusicLibrary, TreeFrogMongoBRollLibrary } from "./library/treefrog.js";

export function buildStorage(config: Config, cwd: string): StorageProvider {
  switch (config.storage.kind) {
    case "local":
      return new LocalStorageProvider(config.storage.root, cwd);
    case "s3":
    case "azure":
      throw new Error(`Storage provider "${config.storage.kind}" not implemented yet (Phase 4+).`);
  }
}

export function buildIndex(config: Config, secrets: Secrets, cwd: string): IndexProvider {
  if (config.index.kind !== "json") {
    throw new Error(`Index kind "${config.index.kind}" not supported`);
  }
  const store = new JsonStore(config.index.path, cwd);
  const localMusic = new LocalJsonMusicLibrary(store);
  const localBroll = new LocalJsonBRollLibrary(store);
  const voStore = new LocalJsonVoiceoverStore(store);
  const scriptStore = new LocalJsonScriptStore(store);
  const renderStore = new LocalJsonRenderStore(store);
  const imageStore = new LocalJsonImageStore(store);

  const musicLib = buildMusicLib(config, secrets, localMusic);
  const brollLib = buildBRollLib(config, secrets, localBroll);

  return new CompositeIndexProvider(musicLib, brollLib, voStore, scriptStore, renderStore, imageStore);
}

function buildMusicLib(config: Config, secrets: Secrets, local: MusicLibrary): MusicLibrary {
  const tfCfg = {
    uri: secrets.mongoUri ?? "",
    dbName: config.treefrog.dbName,
    musicCampaignName: config.treefrog.musicCampaignName,
    musicCollection: config.treefrog.musicCollection,
  };
  switch (config.providers.musicLibrary) {
    case "local":
      return local;
    case "treefrog-mongo":
      return new TreeFrogMongoMusicLibrary(tfCfg);
    case "hybrid":
      return new HybridMusicLibrary(new TreeFrogMongoMusicLibrary(tfCfg), local);
  }
}

function buildBRollLib(config: Config, secrets: Secrets, local: BRollLibrary): BRollLibrary {
  const tfCfg = {
    uri: secrets.mongoUri ?? "",
    dbName: config.treefrog.dbName,
    brollCollection: config.treefrog.brollCollection,
  };
  switch (config.providers.brollLibrary) {
    case "local":
      return local;
    case "treefrog-mongo":
      return new TreeFrogMongoBRollLibrary(tfCfg);
    case "hybrid":
      return new HybridBRollLibrary(new TreeFrogMongoBRollLibrary(tfCfg), local);
  }
}

export function buildSceneAssets(config: Config, secrets: Secrets, cwd: string): SceneAssetProvider {
  switch (config.providers.sceneAssets) {
    case "json-manifest": {
      const path = config.sceneAssets.manifestPath;
      if (!path) {
        throw new Error("sceneAssets.manifestPath is required when providers.sceneAssets = 'json-manifest'");
      }
      return new JsonManifestSceneAssetProvider(path, cwd);
    }
    case "treefrog-mongo":
      return new TreeFrogMongoSceneAssetProvider({
        uri: secrets.mongoUri ?? "",
        dbName: config.treefrog.dbName,
      });
  }
}

function requireSecret(value: string | undefined, envVar: string, providerName: string): string {
  if (!value) {
    throw new Error(`${envVar} env var is required to use the ${providerName} provider.`);
  }
  return value;
}

export function buildTts(config: Config, secrets: Secrets): TtsProvider {
  switch (config.providers.tts) {
    case "elevenlabs":
      return new ElevenLabsTtsProvider(requireSecret(secrets.elevenlabs, "ELEVENLABS_API_KEY", "elevenlabs TTS"));
  }
}

export function buildMusicGen(config: Config, secrets: Secrets): MusicGenProvider {
  switch (config.providers.musicGen) {
    case "elevenlabs":
      return new ElevenLabsMusicGenProvider(requireSecret(secrets.elevenlabs, "ELEVENLABS_API_KEY", "elevenlabs music"));
  }
}

export function buildLlm(config: Config, secrets: Secrets): LlmProvider {
  switch (config.providers.llm) {
    case "anthropic":
      return new AnthropicLlmProvider(requireSecret(secrets.anthropic, "ANTHROPIC_API_KEY", "anthropic LLM"));
  }
}

export function buildAnimate(config: Config, secrets: Secrets): AnimateProvider {
  switch (config.providers.animate) {
    case "veo":
      return new VeoAnimateProvider(requireSecret(secrets.veo, "GOOGLE_VEO_API_KEY", "veo animate"));
    case "none":
      throw new Error(`providers.animate is "none" — animate_image_to_video is disabled. Set providers.animate = "veo" in your config.`);
  }
}

export function buildTalkingHead(config: Config, secrets: Secrets): TalkingHeadProvider {
  switch (config.providers.talkingHead) {
    case "fal-omnihuman":
      return new FalOmniHumanProvider(requireSecret(secrets.fal, "FAL_KEY", "fal omnihuman talking-head"));
    case "none":
      throw new Error(`providers.talkingHead is "none" — generate_talking_head is disabled. Set providers.talkingHead = "fal-omnihuman" in your config.`);
  }
}

export function buildBlobUploader(config: Config, secrets: Secrets): BlobUploader {
  return new AzureBlobUploader(secrets.azureConnectionString ?? "", config.treefrog.azureContainer);
}

export function buildImageGen(config: Config, secrets: Secrets): ImageGenProvider {
  switch (config.providers.imageGen) {
    case "gemini-nano-banana":
      return new GeminiNanoBananaImageGenProvider(requireSecret(secrets.veo, "GEMINI_API_KEY (or GOOGLE_VEO_API_KEY)", "gemini-nano-banana image-gen"));
    case "none":
      throw new Error(`providers.imageGen is "none" — generate_image is disabled. Set providers.imageGen = "gemini-nano-banana" in your config.`);
  }
}
