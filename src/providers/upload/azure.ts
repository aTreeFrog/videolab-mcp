import { BlobServiceClient } from "@azure/storage-blob";
import type { BlobUploader } from "../types.js";
import { logger } from "../../logger.js";

export class AzureBlobUploader implements BlobUploader {
  readonly kind = "azure";
  private client: BlobServiceClient | undefined;

  constructor(private readonly connectionString: string, private readonly containerName: string) {}

  private getClient(): BlobServiceClient {
    if (!this.connectionString) {
      throw new Error("AZURE_STORAGE_CONNECTION_STRING env var is required for the azure blob uploader.");
    }
    if (!this.client) {
      this.client = BlobServiceClient.fromConnectionString(this.connectionString);
    }
    return this.client;
  }

  async uploadBuffer(blobPath: string, data: Buffer, contentType: string): Promise<string> {
    const container = this.getClient().getContainerClient(this.containerName);
    const block = container.getBlockBlobClient(blobPath);
    logger.info(`azure: uploading ${blobPath} (${data.length} bytes, ${contentType})`);
    await block.uploadData(data, { blobHTTPHeaders: { blobContentType: contentType } });
    return block.url;
  }
}
