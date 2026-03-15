import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as Minio from 'minio';
import axios from 'axios';
import { PrismaService } from '../db/prisma.service';

export interface MediaItem {
  twilioUrl: string;
  contentType: string;
}

export interface UploadResult {
  minioUrl: string;
  contentType: string;
  fileSize: number;
}

@Injectable()
export class MediaService implements OnModuleInit {
  private readonly logger = new Logger(MediaService.name);
  private client!: Minio.Client;
  private readonly bucket: string;
  private readonly endpoint: string;
  private readonly port: number;
  private readonly publicBaseUrl: string;

  constructor(private readonly prisma: PrismaService) {
    this.endpoint = process.env.MINIO_ENDPOINT ?? 'localhost';
    this.port = parseInt(process.env.MINIO_PORT ?? '9000', 10);
    this.bucket = process.env.MINIO_BUCKET ?? 'whatsapp-media';
    // URL prefix used in MinIO URLs passed to agent/OCR.
    // In deploy, set MINIO_PUBLIC_URL to a hostname reachable by all services.
    this.publicBaseUrl = process.env.MINIO_PUBLIC_URL
      ?? `http://${this.endpoint}:${this.port}`;
  }

  async onModuleInit() {
    this.logger.log(`Connecting to MinIO at ${this.endpoint}:${this.port}, bucket=${this.bucket}`);
    this.client = new Minio.Client({
      endPoint: this.endpoint,
      port: this.port,
      useSSL: false,
      accessKey: process.env.MINIO_ACCESS_KEY ?? 'admin',
      secretKey: process.env.MINIO_SECRET_KEY ?? 'password',
    });

    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      await this.client.makeBucket(this.bucket);
      this.logger.log(`Created bucket: ${this.bucket}`);
    }

    // Set public-read policy so agent and OCR service can download without auth
    const policy = JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${this.bucket}/*`],
        },
      ],
    });
    await this.client.setBucketPolicy(this.bucket, policy);
  }

  /**
   * Upload a list of Twilio media items to MinIO and record them in the DB.
   * Returns MinIO URLs for successfully uploaded items.
   * Per-item failures are logged and skipped.
   */
  async uploadFromTwilio(
    items: MediaItem[],
    userPhone: string,
    sessionId: string | null,
    twilioAccountSid: string,
    twilioAuthToken: string,
  ): Promise<string[]> {
    const results: string[] = [];

    for (let i = 0; i < items.length; i++) {
      const { twilioUrl, contentType } = items[i];
      try {
        const minioUrl = await this.uploadOne(
          twilioUrl,
          contentType,
          userPhone,
          i,
          twilioAccountSid,
          twilioAuthToken,
        );
        await this.prisma.userMedia.create({
          data: {
            userPhone,
            minioUrl,
            contentType,
            sessionId,
          },
        });
        results.push(minioUrl);
        this.logger.log(`Uploaded media ${i} for ${userPhone} → ${minioUrl}`);
      } catch (err) {
        this.logger.error(`Failed to upload media ${i} for ${userPhone}`, err);
      }
    }

    return results;
  }

  private async uploadOne(
    twilioUrl: string,
    contentType: string,
    userPhone: string,
    index: number,
    accountSid: string,
    authToken: string,
  ): Promise<string> {
    const response = await axios.get<Buffer>(twilioUrl, {
      auth: { username: accountSid, password: authToken },
      responseType: 'arraybuffer',
    });

    const buffer = Buffer.from(response.data);
    const ext = this.extensionFromContentType(contentType);
    const ts = Date.now();
    const safePhone = userPhone.replace(/[^a-zA-Z0-9+]/g, '_');
    const key = `uploads/${safePhone}/${ts}-${index}.${ext}`;

    await this.client.putObject(this.bucket, key, buffer, buffer.length, {
      'Content-Type': contentType,
    });

    return `${this.publicBaseUrl}/${this.bucket}/${key}`;
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
    return map[contentType.toLowerCase()] ?? 'bin';
  }
}
