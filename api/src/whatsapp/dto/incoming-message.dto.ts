/**
 * Incoming Twilio WhatsApp webhook payload.
 * @see https://www.twilio.com/docs/messaging/guides/webhook-request
 */
export class IncomingMessageDto {
  Body!: string;
  From!: string;
  To!: string;
  NumMedia!: string;
  MediaUrl0?: string;
  ProfileName?: string;
  ButtonText?: string;
  ButtonPayload?: string;
  MessageSid!: string;
  AccountSid!: string;
}
