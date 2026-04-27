import { ObjectId } from "mongodb";
import type { MusicTrack, BRollClip } from "../../types.js";
import type { MusicLibrary, BRollLibrary } from "../library-types.js";
import type { MusicFilter, BRollFilter } from "../types.js";
import { getDb } from "../../lib/mongo.js";

export type TreeFrogConfig = {
  uri: string;
  dbName: string;
  musicCampaignName?: string;
  musicCollection?: string;
  brollCollection?: string;
};

export class TreeFrogMongoMusicLibrary implements MusicLibrary {
  readonly kind = "treefrog-mongo";
  constructor(private cfg: TreeFrogConfig) {}

  private async coll() {
    if (!this.cfg.uri) throw new Error("MONGODB_URI env var is required to use the treefrog-mongo music library provider.");
    const db = await getDb(this.cfg.uri, this.cfg.dbName);
    return db.collection(this.cfg.musicCollection ?? "campaignmusics");
  }

  async list(f?: MusicFilter): Promise<MusicTrack[]> {
    const c = await this.coll();
    const query: Record<string, unknown> = {};
    if (this.cfg.musicCampaignName) query.campaignName = this.cfg.musicCampaignName;
    if (f?.mood) query.mood = f.mood;
    if (f?.genre) query.genre = f.genre;
    if (f?.intensity) query.intensity = f.intensity;
    if (f?.tags?.length) query.tags = { $all: f.tags };
    const docs = await c.find(query).limit(500).toArray();
    return docs.map(toMusicTrack);
  }

  async get(id: string): Promise<MusicTrack | null> {
    const c = await this.coll();
    const _id = parseObjectId(id);
    if (!_id) return null;
    const doc = await c.findOne({ _id } as Record<string, unknown>);
    return doc ? toMusicTrack(doc) : null;
  }

  async add(_t: MusicTrack): Promise<void> {
    throw new Error("treefrog-mongo music library is read-only. Use a hybrid setup if you want to also save generated tracks locally.");
  }
  async remove(_id: string): Promise<boolean> {
    throw new Error("treefrog-mongo music library is read-only.");
  }
}

export class TreeFrogMongoBRollLibrary implements BRollLibrary {
  readonly kind = "treefrog-mongo";
  constructor(private cfg: TreeFrogConfig) {}

  private async coll() {
    if (!this.cfg.uri) throw new Error("MONGODB_URI env var is required to use the treefrog-mongo broll library provider.");
    const db = await getDb(this.cfg.uri, this.cfg.dbName);
    return db.collection(this.cfg.brollCollection ?? "brollclips");
  }

  async list(f?: BRollFilter): Promise<BRollClip[]> {
    const c = await this.coll();
    const query: Record<string, unknown> = {};
    if (f?.platform) query.platform = f.platform;
    if (f?.tags?.length) query.tags = { $all: f.tags };
    if (f?.minDurationSec != null || f?.maxDurationSec != null) {
      const range: Record<string, number> = {};
      if (f.minDurationSec != null) range.$gte = f.minDurationSec;
      if (f.maxDurationSec != null) range.$lte = f.maxDurationSec;
      query.duration = range;
    }
    const docs = await c.find(query).limit(500).toArray();
    return docs.map(toBRollClip);
  }

  async get(id: string): Promise<BRollClip | null> {
    const c = await this.coll();
    const _id = parseObjectId(id);
    if (!_id) return null;
    const doc = await c.findOne({ _id } as Record<string, unknown>);
    return doc ? toBRollClip(doc) : null;
  }

  async add(_c: BRollClip): Promise<void> {
    throw new Error("treefrog-mongo broll library is read-only.");
  }
  async remove(_id: string): Promise<boolean> {
    throw new Error("treefrog-mongo broll library is read-only.");
  }
}

function toMusicTrack(d: any): MusicTrack {
  return {
    id: String(d._id),
    displayName: d.displayName ?? d.prompt ?? String(d._id),
    url: d.audioUrl ?? d.blobPath ?? "",
    durationMs: typeof d.durationMs === "number" ? d.durationMs : undefined,
    mood: d.mood,
    genre: d.genre,
    intensity: d.intensity,
    themes: Array.isArray(d.themes) ? d.themes : undefined,
    tags: Array.isArray(d.tags) ? d.tags : undefined,
    source: "stock",
  };
}

function toBRollClip(d: any): BRollClip {
  return {
    id: String(d._id),
    url: d.blobUrl ?? d.url ?? "",
    filename: d.filename ?? `${String(d._id)}.mp4`,
    platform: (d.platform === "desktop" ? "desktop" : "mobile"),
    durationSec: typeof d.duration === "number" ? d.duration : (typeof d.durationSec === "number" ? d.durationSec : 0),
    description: d.description ?? "",
    source: d.source ?? "treefrog",
    tags: Array.isArray(d.tags) ? d.tags : [],
    firstFrameUrl: d.firstFrameUrl,
  };
}

function parseObjectId(id: string): ObjectId | string | null {
  try {
    if (/^[0-9a-fA-F]{24}$/.test(id)) return new ObjectId(id);
    return id;
  } catch {
    return null;
  }
}
