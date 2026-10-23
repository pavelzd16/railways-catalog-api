-- CreateTable
CREATE TABLE "NormDocument" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "replacedBy" TEXT,
    "introducedAt" TEXT,
    "scope" TEXT NOT NULL,
    "sections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceUrl" TEXT,
    "sourceName" TEXT,
    "file" TEXT,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "pageCount" INTEGER,
    "previews" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "h1" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "weight" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NormDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NormDocument_slug_key" ON "NormDocument"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "NormDocument_code_key" ON "NormDocument"("code");
