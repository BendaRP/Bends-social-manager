-- CreateTable
CREATE TABLE "BrandProfile" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "businessName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "toneWords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "voiceNotes" TEXT,
    "preferWords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "avoidWords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contentPillars" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "language" TEXT NOT NULL DEFAULT 'he',
    "colorPrimary" TEXT NOT NULL DEFAULT '#2D2A32',
    "colorAccent" TEXT NOT NULL DEFAULT '#E4572E',
    "colorBackground" TEXT NOT NULL DEFAULT '#FAF7F2',
    "colorText" TEXT NOT NULL DEFAULT '#2D2A32',
    "logoUrl" TEXT,
    "useEmoji" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Generation" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "output" JSONB NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Generation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Generation_kind_createdAt_idx" ON "Generation"("kind", "createdAt");

-- AddForeignKey
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "BrandProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
