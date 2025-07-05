-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "twitterId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "oauthTokens" TEXT NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Engagement" (
    "id" SERIAL NOT NULL,
    "tweetUrl" TEXT NOT NULL,
    "engagedUserIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Engagement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_twitterId_key" ON "User"("twitterId");
