DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'WhatsAppGroupMemberStatus'
  ) THEN
    CREATE TYPE "WhatsAppGroupMemberStatus" AS ENUM ('INVITED', 'ACTIVE', 'LEFT');
  END IF;
END $$;

ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "credits" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "WhatsAppGroup" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "joinCode" TEXT NOT NULL,
  "ownerId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhatsAppGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WhatsAppGroupMember" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "userId" TEXT,
  "phone" TEXT NOT NULL,
  "status" "WhatsAppGroupMemberStatus" NOT NULL DEFAULT 'INVITED',
  "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "joinedAt" TIMESTAMP(3),
  "lastInboundAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhatsAppGroupMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WhatsAppGroupMessage" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "senderUserId" TEXT,
  "senderPhone" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "sourceMessageSid" TEXT,
  "deliveredCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppGroupMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppGroup_joinCode_key"
ON "WhatsAppGroup"("joinCode");

CREATE INDEX IF NOT EXISTS "WhatsAppGroupMember_phone_status_idx"
ON "WhatsAppGroupMember"("phone", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppGroupMember_groupId_phone_key"
ON "WhatsAppGroupMember"("groupId", "phone");

CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppGroupMessage_sourceMessageSid_key"
ON "WhatsAppGroupMessage"("sourceMessageSid");

CREATE INDEX IF NOT EXISTS "WhatsAppGroupMessage_groupId_createdAt_idx"
ON "WhatsAppGroupMessage"("groupId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'WhatsAppGroup_ownerId_fkey'
  ) THEN
    ALTER TABLE "WhatsAppGroup"
    ADD CONSTRAINT "WhatsAppGroup_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'WhatsAppGroupMember_groupId_fkey'
  ) THEN
    ALTER TABLE "WhatsAppGroupMember"
    ADD CONSTRAINT "WhatsAppGroupMember_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "WhatsAppGroup"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'WhatsAppGroupMember_userId_fkey'
  ) THEN
    ALTER TABLE "WhatsAppGroupMember"
    ADD CONSTRAINT "WhatsAppGroupMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'WhatsAppGroupMessage_groupId_fkey'
  ) THEN
    ALTER TABLE "WhatsAppGroupMessage"
    ADD CONSTRAINT "WhatsAppGroupMessage_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "WhatsAppGroup"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'WhatsAppGroupMessage_senderUserId_fkey'
  ) THEN
    ALTER TABLE "WhatsAppGroupMessage"
    ADD CONSTRAINT "WhatsAppGroupMessage_senderUserId_fkey"
    FOREIGN KEY ("senderUserId") REFERENCES "User"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
  END IF;
END $$;
