/*
  Warnings:

  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `WhatsAppGroup` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `WhatsAppGroupMember` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `WhatsAppGroupMessage` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "WhatsAppGroup" DROP CONSTRAINT "WhatsAppGroup_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "WhatsAppGroupMember" DROP CONSTRAINT "WhatsAppGroupMember_groupId_fkey";

-- DropForeignKey
ALTER TABLE "WhatsAppGroupMember" DROP CONSTRAINT "WhatsAppGroupMember_userId_fkey";

-- DropForeignKey
ALTER TABLE "WhatsAppGroupMessage" DROP CONSTRAINT "WhatsAppGroupMessage_groupId_fkey";

-- DropForeignKey
ALTER TABLE "WhatsAppGroupMessage" DROP CONSTRAINT "WhatsAppGroupMessage_senderUserId_fkey";

-- DropTable
DROP TABLE "User";

-- DropTable
DROP TABLE "WhatsAppGroup";

-- DropTable
DROP TABLE "WhatsAppGroupMember";

-- DropTable
DROP TABLE "WhatsAppGroupMessage";

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "joinCode" TEXT NOT NULL,
    "conversationSid" TEXT,
    "chatbotEnabled" BOOLEAN NOT NULL DEFAULT true,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_group_members" (
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

    CONSTRAINT "whatsapp_group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_group_messages" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "senderUserId" TEXT,
    "senderPhone" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_group_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_groups_joinCode_key" ON "whatsapp_groups"("joinCode");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_groups_conversationSid_key" ON "whatsapp_groups"("conversationSid");

-- CreateIndex
CREATE INDEX "whatsapp_group_members_phone_status_idx" ON "whatsapp_group_members"("phone", "status");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_group_members_groupId_phone_key" ON "whatsapp_group_members"("groupId", "phone");

-- CreateIndex
CREATE INDEX "whatsapp_group_messages_groupId_createdAt_idx" ON "whatsapp_group_messages"("groupId", "createdAt");

-- AddForeignKey
ALTER TABLE "whatsapp_groups" ADD CONSTRAINT "whatsapp_groups_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_group_members" ADD CONSTRAINT "whatsapp_group_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_group_members" ADD CONSTRAINT "whatsapp_group_members_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "whatsapp_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_group_messages" ADD CONSTRAINT "whatsapp_group_messages_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "whatsapp_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_group_messages" ADD CONSTRAINT "whatsapp_group_messages_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
