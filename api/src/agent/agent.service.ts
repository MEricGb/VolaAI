import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { join } from 'path';

// ── Types matching agent.proto ──────────────────────────────────────────────

export interface ChatRequest {
  session_id: string;
  user_message: string;
  image_urls: string[];
}

export interface ChatResponse {
  reply: string;
}

type AgentGrpcClient = grpc.Client & {
  Chat: (
    req: ChatRequest,
    meta: grpc.Metadata,
    opts: grpc.CallOptions,
    cb: (err: grpc.ServiceError | null, res: ChatResponse) => void,
  ) => void;
};

// ── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class AgentService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentService.name);
  private client!: AgentGrpcClient;

  onModuleInit() {
    // Proto lives at repo root: vibehack-2026/proto/agent.proto
    // When running via ts-node, __dirname is vibehack-2026/api/src/agent
    // so we walk up 3 levels.
    const protoPath = join(__dirname, '../../../proto/agent.proto');

    const packageDef = protoLoader.loadSync(protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });

    const proto = grpc.loadPackageDefinition(packageDef) as Record<
      string,
      Record<string, grpc.ServiceClientConstructor>
    >;

    const host = process.env['AGENT_GRPC_URL'] ?? 'localhost:50052';

    this.client = new proto['agent']['AgentService'](
      host,
      grpc.credentials.createInsecure(),
    ) as unknown as AgentGrpcClient;

    this.logger.log(`gRPC client connected to agent at ${host}`);
  }

  onModuleDestroy() {
    this.client?.close();
  }

  /**
   * Send a user message to the agent and receive a reply.
   * Uses a 2-minute deadline — enough for the LLM to respond.
   */
  chat(sessionId: string, userMessage: string, imageUrls: string[] = []): Promise<string> {
    const deadline = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes
    return new Promise((resolve, reject) => {
      this.client.Chat(
        { session_id: sessionId, user_message: userMessage, image_urls: imageUrls },
        new grpc.Metadata(),
        { deadline },
        (err, res) => {
          if (err) return reject(err);
          resolve(res.reply);
        },
      );
    });
  }
}
