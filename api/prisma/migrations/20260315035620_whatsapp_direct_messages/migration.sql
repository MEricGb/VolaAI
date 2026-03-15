DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'WhatsAppDirectMessageDirection'
  ) THEN
    CREATE TYPE "WhatsAppDirectMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "whatsapp_direct_messages" (
  "id" TEXT NOT NULL,
  "userPhone" TEXT NOT NULL,
  "direction" "WhatsAppDirectMessageDirection" NOT NULL,
  "body" TEXT NOT NULL,
  "twilioMessageSid" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_direct_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_direct_messages_twilioMessageSid_key"
ON "whatsapp_direct_messages"("twilioMessageSid");

CREATE INDEX IF NOT EXISTS "whatsapp_direct_messages_userPhone_createdAt_idx"
ON "whatsapp_direct_messages"("userPhone", "createdAt");
