-- Channel topic (short, shown in the header) and description (what the channel is for)
ALTER TABLE "Channel" ADD COLUMN "topic" VARCHAR(250);
ALTER TABLE "Channel" ADD COLUMN "description" VARCHAR(1000);
