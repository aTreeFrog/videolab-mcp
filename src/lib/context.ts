import type { LoadedConfig } from "../config.js";
import type {
  StorageProvider, IndexProvider, SceneAssetProvider,
  TtsProvider, MusicGenProvider, LlmProvider, AnimateProvider, TalkingHeadProvider,
  BlobUploader, ImageGenProvider,
} from "../providers/types.js";
import {
  buildStorage, buildIndex, buildSceneAssets,
  buildTts, buildMusicGen, buildLlm, buildAnimate, buildTalkingHead, buildBlobUploader, buildImageGen,
} from "../providers/factory.js";
import { getDb } from "./mongo.js";
import type { Db } from "mongodb";

export type Context = {
  config: LoadedConfig["config"];
  secrets: LoadedConfig["secrets"];
  configPath: string;
  configDir: string;
  cwd: string;
  storage: StorageProvider;
  index: IndexProvider;
  sceneAssets: SceneAssetProvider;
  tts(): TtsProvider;
  musicGen(): MusicGenProvider;
  llm(): LlmProvider;
  animate(): AnimateProvider;
  talkingHead(): TalkingHeadProvider;
  imageGen(): ImageGenProvider;
  blobUploader(): BlobUploader;
  treefrogDb(): Promise<Db>;
};

export function buildContext(loaded: LoadedConfig): Context {
  let _tts: TtsProvider | undefined;
  let _musicGen: MusicGenProvider | undefined;
  let _llm: LlmProvider | undefined;
  let _animate: AnimateProvider | undefined;
  let _talkingHead: TalkingHeadProvider | undefined;
  let _imageGen: ImageGenProvider | undefined;
  let _blobUploader: BlobUploader | undefined;
  return {
    config: loaded.config,
    secrets: loaded.secrets,
    configPath: loaded.configPath,
    configDir: loaded.configDir,
    cwd: loaded.cwd,
    storage: buildStorage(loaded.config, loaded.configDir),
    index: buildIndex(loaded.config, loaded.secrets, loaded.configDir),
    sceneAssets: buildSceneAssets(loaded.config, loaded.secrets, loaded.configDir),
    tts() { return _tts ??= buildTts(loaded.config, loaded.secrets); },
    musicGen() { return _musicGen ??= buildMusicGen(loaded.config, loaded.secrets); },
    llm() { return _llm ??= buildLlm(loaded.config, loaded.secrets); },
    animate() { return _animate ??= buildAnimate(loaded.config, loaded.secrets); },
    talkingHead() { return _talkingHead ??= buildTalkingHead(loaded.config, loaded.secrets); },
    imageGen() { return _imageGen ??= buildImageGen(loaded.config, loaded.secrets); },
    blobUploader() { return _blobUploader ??= buildBlobUploader(loaded.config, loaded.secrets); },
    async treefrogDb() {
      if (!loaded.secrets.mongoUri) throw new Error("MONGODB_URI env var is required for TreeFrog write operations.");
      return getDb(loaded.secrets.mongoUri, loaded.config.treefrog.dbName);
    },
  };
}
