import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { StripeService } from './stripe.service';

@Controller('stripe')
export class StripeController {
  constructor(private readonly stripeService: StripeService) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(@Body() body: unknown): Promise<{ received: boolean }> {
    this.stripeService.handleWebhook(body);
    return { received: true };
  }
}
