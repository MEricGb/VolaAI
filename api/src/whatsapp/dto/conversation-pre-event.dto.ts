/**
 * Twilio Conversations pre-event webhook payload (onMessageAdd).
 * @see https://www.twilio.com/docs/conversations/conversations-webhooks#pre-event-webhooks
 */
export class ConversationPreEventDto {
  EventType!: string;
  ConversationSid!: string;
  Author!: string;
  Body?: string;
  ParticipantSid?: string;
  ChatServiceSid?: string;
  // JSON string representing an array of attached media objects (if any).
  Media?: string;
}
