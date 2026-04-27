import { MongoClient, type Db } from "mongodb";
import { logger } from "../logger.js";

let client: MongoClient | undefined;
let connectPromise: Promise<MongoClient> | undefined;

export function getMongoClient(uri: string): Promise<MongoClient> {
  if (client) return Promise.resolve(client);
  if (connectPromise) return connectPromise;
  logger.info(`mongo: connecting to ${redact(uri)}`);
  connectPromise = MongoClient.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
  }).then(c => {
    client = c;
    connectPromise = undefined;
    logger.info(`mongo: connected`);
    return c;
  }).catch(e => {
    connectPromise = undefined;
    logger.error(`mongo: connection failed`, { message: (e as Error).message });
    throw e;
  });
  return connectPromise;
}

export async function getDb(uri: string, dbName: string): Promise<Db> {
  const c = await getMongoClient(uri);
  return c.db(dbName);
}

export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = undefined;
  }
}

function redact(uri: string): string {
  return uri.replace(/\/\/[^@]+@/, "//***@");
}
