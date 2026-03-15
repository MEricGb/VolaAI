import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as Minio from 'minio';

export interface StoredMedia {
  key: string;
  url: string;
  contentType: string;
}

export interface TwilioMediaItem {
  url: string;
  contentType: string;
}

export interface ConversationsMediaRef {
  sid: string;
  contentType: string;
}

@Injectable()
export class MediaService implements OnModuleInit {
  private readonly logger = new Logger(MediaService.name);
  private client!: Minio.Client;

  private readonly bucket: string;
  private readonly endpoint: string;
  private readonly port: number;
  private readonly useSSL: boolean;
  private readonly accessKey: string;
  private readonly secretKey: string;

  private readonly publicBaseUrl: string;
  private readonly mcsBaseUrls: string[];

  constructor() {
    this.endpoint = process.env.MINIO_ENDPOINT ?? 'localhost';
    this.port = parseInt(process.env.MINIO_PORT ?? '9000', 10);
    this.bucket = process.env.MINIO_BUCKET ?? 'whatsapp-media';
    this.useSSL = String(process.env.MINIO_USE_SSL ?? '').toLowerCase() === 'true';
    this.accessKey = process.env.MINIO_ACCESS_KEY ?? 'admin';
    this.secretKey = process.env.MINIO_SECRET_KEY ?? 'password';

    const port = process.env.PORT ?? '3000';
    this.publicBaseUrl =
      (process.env.MEDIA_PUBLIC_BASE_URL ??
        process.env.PUBLIC_BASE_URL ??
        `http://localhost:${port}`).replace(/\/+$/, '');

    const override = (process.env.TWILIO_MCS_BASE_URL ?? '').trim();
    this.mcsBaseUrls = (override
      ? [override]
      : ['https://mcs.twilio.com', 'https://mcs.us1.twilio.com']).map((s) =>
      s.replace(/\/+$/, ''),
    );
  }

  async onModuleInit() {
    this.logger.log(
      `Connecting to MinIO at ${this.endpoint}:${this.port} ssl=${this.useSSL} bucket=${this.bucket}`,
    );
    this.client = new Minio.Client({
      endPoint: this.endpoint,
      port: this.port,
      useSSL: this.useSSL,
      accessKey: this.accessKey,
      secretKey: this.secretKey,
    });

    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      await this.client.makeBucket(this.bucket);
      this.logger.log(`Created bucket: ${this.bucket}`);
    }
  }

  buildPublicUrl(key: string): string {
    const safe = this.safeKey(key);
    return `${this.publicBaseUrl}/media/${encodeURIComponent(safe)}`;
  }

  async getObjectStream(key: string): Promise<{
    stream: NodeJS.ReadableStream;
    contentType: string;
    contentLength: number | null;
  }> {
    const safe = this.safeKey(key);
    const objectKey = this.objectKey(safe);

    const stat = await this.client.statObject(this.bucket, objectKey);
    const metaCt =
      (stat.metaData?.['content-type'] as string | undefined) ??
      (stat.metaData?.['Content-Type'] as string | undefined) ??
      null;

    const stream = await this.client.getObject(this.bucket, objectKey);
    return {
      stream,
      contentType: metaCt || this.contentTypeFromExt(safe),
      contentLength: typeof stat.size === 'number' ? stat.size : null,
    };
  }

  async storeTwilioMessagingMedia(
    items: TwilioMediaItem[],
    accountSid: string,
    authToken: string,
  ): Promise<StoredMedia[]> {
    if (items.length === 0) return [];

    const out: StoredMedia[] = [];
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      try {
        const buf = await this.downloadWithBasicAuth(item.url, accountSid, authToken);
        const stored = await this.storeBuffer(buf, item.contentType);
        out.push(stored);
      } catch (err: any) {
        this.logger.warn(
          `[media] Failed to ingest Twilio Messaging media ${i}: ${err?.message ?? err}`,
        );
      }
    }
    return out;
  }

  async storeTwilioConversationsMedia(
    refs: ConversationsMediaRef[],
    chatServiceSid: string,
    accountSid: string,
    authToken: string,
  ): Promise<StoredMedia[]> {
    if (refs.length === 0) return [];

    const out: StoredMedia[] = [];
    for (let i = 0; i < refs.length; i += 1) {
      const ref = refs[i];
      try {
        const tempUrl = await this.resolveMcsTempUrl(
          chatServiceSid,
          ref.sid,
          accountSid,
          authToken,
        );
        // tempUrl is usually pre-signed; auth not required, but we can try with auth then fall back.
        let buf: Buffer;
        try {
          buf = await this.downloadWithBasicAuth(tempUrl, accountSid, authToken);
        } catch {
          buf = await this.downloadWithoutAuth(tempUrl);
        }
        const stored = await this.storeBuffer(buf, ref.contentType);
        out.push(stored);
      } catch (err: any) {
        this.logger.error(
          `[media] Failed to ingest Twilio Conversations media ${i} after retries: ${err?.message ?? err}`,
        );
      }
    }
    return out;
  }

  private objectKey(safeKey: string): string {
    // Keep API keys stable and non-traversable.
    return `uploads/${safeKey}`;
  }

  private safeKey(key: string): string {
    // Only allow a filename (no traversal). We store under a fixed prefix in the bucket.
    return (key || '').replace(/[^a-zA-Z0-9._-]/g, '');
  }

  private extensionFromContentType(contentType: string): string {
    const map: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/heic': 'heic',
      'application/pdf': 'pdf',
    };
    return map[(contentType || '').toLowerCase()] ?? 'bin';
  }

  private contentTypeFromExt(key: string): string {
    const lower = (key || '').toLowerCase();
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.heic')) return 'image/heic';
    if (lower.endsWith('.pdf')) return 'application/pdf';
    return 'application/octet-stream';
  }

  private async storeBuffer(buf: Buffer, contentType: string): Promise<StoredMedia> {
    const ext = this.extensionFromContentType(contentType);
    const safeKey = `${Date.now()}-${randomBytes(8).toString('hex')}.${ext}`;
    const objectKey = this.objectKey(safeKey);

    await this.client.putObject(this.bucket, objectKey, buf, buf.length, {
      'Content-Type': contentType || 'application/octet-stream',
    });

    return {
      key: safeKey,
      contentType: contentType || 'application/octet-stream',
      url: this.buildPublicUrl(safeKey),
    };
  }

  private async downloadWithoutAuth(url: string): Promise<Buffer> {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'vibehack-2026-api/1.0 (media-ingest)',
        Accept: '*/*',
      },
    });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  private async downloadWithBasicAuth(
    url: string,
    accountSid: string,
    authToken: string,
  ): Promise<Buffer> {
    const basic = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const res = await fetch(url, {
      headers: {
        Authorization: `Basic ${basic}`,
        'User-Agent': 'vibehack-2026-api/1.0 (media-ingest)',
        Accept: '*/*',
      },
    });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  private async resolveMcsTempUrl(
    chatServiceSid: string,
    mediaSid: string,
    accountSid: string,
    authToken: string,
  ): Promise<string> {
    const maxRetries = 3;
    const baseDelayMs = 1000;
    let lastErr: any = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        this.logger.warn(
          `[media] MCS retry ${attempt}/${maxRetries - 1} for media ${mediaSid} after ${delay}ms`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }

      for (const base of this.mcsBaseUrls) {
        try {
          const infoUrl = `${base}/v1/Services/${chatServiceSid}/Media/${mediaSid}`;
          const basic = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
          const res = await fetch(infoUrl, {
            headers: {
              Authorization: `Basic ${basic}`,
              'User-Agent': 'vibehack-2026-api/1.0 (media-ingest)',
              Accept: 'application/json',
            },
          });
          if (res.status >= 500) throw new Error(`MCS fetch failed (${res.status})`);
          if (!res.ok) throw new Error(`MCS fetch failed (${res.status})`);
          const data: any = await res.json();
          const link = data?.links?.content_direct_temporary as string | undefined;
          if (!link) throw new Error('MCS response missing links.content_direct_temporary');
          if (link.startsWith('http://') || link.startsWith('https://')) return link;
          return `${base}${link.startsWith('/') ? '' : '/'}${link}`;
        } catch (err) {
          lastErr = err;
        }
      }
    }
    throw lastErr ?? new Error('Failed to resolve MCS temporary URL');
  }
}

