-- CreateTable
CREATE TABLE "LinkedinProfile" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "followers" INTEGER,
    "followersAt" DATE,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkedinProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkedinProfileDaily" (
    "id" SERIAL NOT NULL,
    "profileId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "impressions" INTEGER,
    "engagements" INTEGER,
    "newFollowers" INTEGER,

    CONSTRAINT "LinkedinProfileDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkedinProfilePost" (
    "id" SERIAL NOT NULL,
    "profileId" INTEGER NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "publishedAt" DATE,
    "impressions" INTEGER,
    "engagements" INTEGER,

    CONSTRAINT "LinkedinProfilePost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkedinProfileDemographic" (
    "id" SERIAL NOT NULL,
    "profileId" INTEGER NOT NULL,
    "category" VARCHAR(40) NOT NULL,
    "value" VARCHAR(200) NOT NULL,
    "percentage" VARCHAR(10) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LinkedinProfileDemographic_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LinkedinProfile_name_key" ON "LinkedinProfile"("name");

-- CreateIndex
CREATE UNIQUE INDEX "LinkedinProfileDaily_profileId_date_key" ON "LinkedinProfileDaily"("profileId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "LinkedinProfilePost_profileId_url_key" ON "LinkedinProfilePost"("profileId", "url");

-- CreateIndex
CREATE INDEX "LinkedinProfileDemographic_profileId_category_idx" ON "LinkedinProfileDemographic"("profileId", "category");

-- AddForeignKey
ALTER TABLE "LinkedinProfileDaily" ADD CONSTRAINT "LinkedinProfileDaily_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "LinkedinProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkedinProfilePost" ADD CONSTRAINT "LinkedinProfilePost_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "LinkedinProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkedinProfileDemographic" ADD CONSTRAINT "LinkedinProfileDemographic_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "LinkedinProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

