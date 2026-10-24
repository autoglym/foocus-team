-- CreateTable
CREATE TABLE "KpiMetric" (
    "id" SERIAL NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "unit" VARCHAR(20) NOT NULL DEFAULT 'count',
    "source" VARCHAR(20) NOT NULL DEFAULT 'manual',
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KpiMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KpiValue" (
    "id" SERIAL NOT NULL,
    "metricId" INTEGER NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,

    CONSTRAINT "KpiValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KpiMetric_key_key" ON "KpiMetric"("key");

-- CreateIndex
CREATE INDEX "KpiValue_metricId_capturedAt_idx" ON "KpiValue"("metricId", "capturedAt");

-- AddForeignKey
ALTER TABLE "KpiValue" ADD CONSTRAINT "KpiValue_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "KpiMetric"("id") ON DELETE CASCADE ON UPDATE CASCADE;

