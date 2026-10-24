-- Group DMs are private channels flagged as isGroupDM (shown under Direct messages)
ALTER TABLE "Channel" ADD COLUMN "isGroupDM" BOOLEAN NOT NULL DEFAULT false;
