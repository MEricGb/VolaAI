DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'WhatsAppGroupMemberStatus'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'WhatsAppGroupMemberStatus'
      AND e.enumlabel = 'PAUSED'
  ) THEN
    ALTER TYPE "WhatsAppGroupMemberStatus" ADD VALUE 'PAUSED';
  END IF;
END $$;
