-- CreateTable
CREATE TABLE "user_media" (
    "id" TEXT NOT NULL,
    "user_phone" TEXT NOT NULL,
    "minio_url" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "file_size" INTEGER,
    "session_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_media_pkey" PRIMARY KEY ("id")
);
