import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);

  handleWebhook(payload: unknown): void {
    this.logger.log('Stripe webhook received');
    this.logger.debug(JSON.stringify(payload));
  }
}
