/**
 * Incoming Twilio WhatsApp webhook payload.
 * @see https://www.twilio.com/docs/messaging/guides/webhook-request
 */
export class IncomingMessageDto {
  Body!: string;
  From!: string;
  To!: string;
  NumMedia!: string;
  // Twilio sends up to 10 media attachments per message
  MediaUrl0?: string;  MediaContentType0?: string;
  MediaUrl1?: string;  MediaContentType1?: string;
  MediaUrl2?: string;  MediaContentType2?: string;
  MediaUrl3?: string;  MediaContentType3?: string;
  MediaUrl4?: string;  MediaContentType4?: string;
  MediaUrl5?: string;  MediaContentType5?: string;
  MediaUrl6?: string;  MediaContentType6?: string;
  MediaUrl7?: string;  MediaContentType7?: string;
  MediaUrl8?: string;  MediaContentType8?: string;
  MediaUrl9?: string;  MediaContentType9?: string;
  ProfileName?: string;
  ButtonText?: string;
  ButtonPayload?: string;
  MessageSid!: string;
  AccountSid!: string;
}
