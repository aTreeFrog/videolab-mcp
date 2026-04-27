import { ObjectId } from "mongodb";
import type { SceneAsset, SceneRef } from "../../types.js";
import type { SceneAssetProvider } from "../types.js";
import { getDb } from "../../lib/mongo.js";

export type TreeFrogSceneCfg = {
  uri: string;
  dbName: string;
};

type SceneBranch = {
  locationImageUrl?: string;
  locationVideoUrl?: string;
  npcs?: string[];
  enemies?: string[];
  pointOfInterestId?: string;
  sections?: Array<{ sectionImageUrl?: string; sectionVideoUrl?: string; npcs?: string[]; enemies?: string[] }>;
};

type SceneDoc = {
  _id?: unknown;
  campaignName?: string;
  questId?: string;
  sceneNumber?: number;
  mapName?: string;
  branch?: SceneBranch[];
};

export class TreeFrogMongoSceneAssetProvider implements SceneAssetProvider {
  readonly kind = "treefrog-mongo";
  constructor(private cfg: TreeFrogSceneCfg) {}

  describeRefShape(): string {
    return 'treefrog-mongo expects sceneRef = { campaignName: string, questId: string (e.g. "Main-1"), sceneNumber: number, mapName?: string }. Returns branch images/videos, section images/videos, NPC/enemy portraits, and POI images.';
  }

  async listAssets(ref: SceneRef): Promise<SceneAsset[]> {
    const r = ref as { campaignName?: string; questId?: string; sceneNumber?: number; mapName?: string };
    if (!r.campaignName || !r.questId || r.sceneNumber == null) {
      throw new Error('treefrog-mongo sceneRef requires { campaignName, questId, sceneNumber }');
    }
    if (!this.cfg.uri) throw new Error("MONGODB_URI env var is required to use the treefrog-mongo scene-assets provider.");
    const db = await getDb(this.cfg.uri, this.cfg.dbName);
    const scene = await db.collection<SceneDoc>("scenes").findOne({
      campaignName: r.campaignName, questId: r.questId, sceneNumber: r.sceneNumber,
    });
    if (!scene) return [];
    const sceneId = String(scene._id);

    const assets: SceneAsset[] = [];
    const npcNames = new Set<string>();
    const enemyNames = new Set<string>();
    const poiIds = new Set<string>();

    (scene.branch ?? []).forEach((b, bi) => {
      if (b.locationImageUrl) assets.push({ id: `branch:${sceneId}:${bi}:loc-img`, type: "image", label: `Branch ${bi + 1} location`, url: b.locationImageUrl });
      if (b.locationVideoUrl) assets.push({ id: `branch:${sceneId}:${bi}:loc-vid`, type: "video", label: `Branch ${bi + 1} location (video)`, url: b.locationVideoUrl });
      (b.sections ?? []).forEach((s, si) => {
        if (s.sectionImageUrl) assets.push({ id: `section:${sceneId}:${bi}:${si}:img`, type: "image", label: `Branch ${bi + 1} section ${si + 1}`, url: s.sectionImageUrl });
        if (s.sectionVideoUrl) assets.push({ id: `section:${sceneId}:${bi}:${si}:vid`, type: "video", label: `Branch ${bi + 1} section ${si + 1} (video)`, url: s.sectionVideoUrl });
        (s.npcs ?? []).forEach(n => npcNames.add(n));
        (s.enemies ?? []).forEach(e => enemyNames.add(e));
      });
      (b.npcs ?? []).forEach(n => npcNames.add(n));
      (b.enemies ?? []).forEach(e => enemyNames.add(e));
      if (b.pointOfInterestId) poiIds.add(b.pointOfInterestId);
    });

    if (npcNames.size > 0) {
      const npcs = await db.collection("npcs").find({
        gameName: r.campaignName,
        name: { $in: Array.from(npcNames) },
      }).toArray();
      for (const npc of npcs) {
        const url = npc.userImageUrl || npc.imageUrl || npc.figureIcon;
        if (url) assets.push({ id: `npc:${String(npc._id)}`, type: "portrait", label: `NPC: ${npc.name}`, url });
      }
    }

    if (enemyNames.size > 0) {
      const enemies = await db.collection("enemies").find({
        name: { $in: Array.from(enemyNames) },
      }).toArray();
      for (const enemy of enemies) {
        const url = enemy.userImageUrl || enemy.imageUrl || enemy.figureIcon;
        if (url) assets.push({ id: `enemy:${String(enemy._id)}`, type: "portrait", label: `Enemy: ${enemy.name}`, url });
      }
    }

    const mapName = r.mapName ?? scene.mapName;
    if (mapName) {
      const locationId = `${mapName}-${r.questId}`;
      const pois = await db.collection("pointofinterests").find({ parentLocationId: locationId }).toArray();
      for (const poi of pois) {
        const url = poi.userImageUrl || poi.imageUrl;
        if (url) assets.push({ id: `poi:${String(poi._id)}`, type: "poi", label: `POI: ${poi.name ?? poi.locationId}`, url });
      }
    }

    return assets;
  }

  async getAsset(id: string): Promise<SceneAsset | null> {
    if (!this.cfg.uri) throw new Error("MONGODB_URI env var is required to use the treefrog-mongo scene-assets provider.");
    const db = await getDb(this.cfg.uri, this.cfg.dbName);
    const m = id.match(/^(branch|section|npc|enemy|poi):(.+)$/);
    if (!m) return null;
    const [, kind, rest] = m;

    if (kind === "branch" || kind === "section") {
      const parts = rest.split(":");
      const sceneId = parts[0];
      const branchIdx = parseInt(parts[1], 10);
      const _id = await tryObjectId(sceneId);
      const scene = await db.collection<SceneDoc>("scenes").findOne({ _id } as Record<string, unknown>);
      if (!scene || !scene.branch?.[branchIdx]) return null;
      const b = scene.branch[branchIdx];
      if (kind === "branch") {
        const which = parts[2];
        if (which === "loc-img" && b.locationImageUrl) return { id, type: "image", label: `Branch ${branchIdx + 1} location`, url: b.locationImageUrl };
        if (which === "loc-vid" && b.locationVideoUrl) return { id, type: "video", label: `Branch ${branchIdx + 1} location (video)`, url: b.locationVideoUrl };
        return null;
      }
      const sectionIdx = parseInt(parts[2], 10);
      const which = parts[3];
      const s = b.sections?.[sectionIdx];
      if (!s) return null;
      if (which === "img" && s.sectionImageUrl) return { id, type: "image", label: `Branch ${branchIdx + 1} section ${sectionIdx + 1}`, url: s.sectionImageUrl };
      if (which === "vid" && s.sectionVideoUrl) return { id, type: "video", label: `Branch ${branchIdx + 1} section ${sectionIdx + 1} (video)`, url: s.sectionVideoUrl };
      return null;
    }

    if (kind === "npc") {
      const _id = await tryObjectId(rest);
      const doc = await db.collection("npcs").findOne({ _id } as Record<string, unknown>);
      const url = doc?.userImageUrl || doc?.imageUrl || doc?.figureIcon;
      return doc && url ? { id, type: "portrait", label: `NPC: ${doc.name}`, url } : null;
    }
    if (kind === "enemy") {
      const _id = await tryObjectId(rest);
      const doc = await db.collection("enemies").findOne({ _id } as Record<string, unknown>);
      const url = doc?.userImageUrl || doc?.imageUrl || doc?.figureIcon;
      return doc && url ? { id, type: "portrait", label: `Enemy: ${doc.name}`, url } : null;
    }
    if (kind === "poi") {
      const _id = await tryObjectId(rest);
      const doc = await db.collection("pointofinterests").findOne({ _id } as Record<string, unknown>);
      const url = doc?.userImageUrl || doc?.imageUrl;
      return doc && url ? { id, type: "poi", label: `POI: ${doc.name ?? doc.locationId}`, url } : null;
    }
    return null;
  }
}

async function tryObjectId(id: string): Promise<ObjectId | string> {
  if (/^[0-9a-fA-F]{24}$/.test(id)) return new ObjectId(id);
  return id;
}
