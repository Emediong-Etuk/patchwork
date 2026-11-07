-- AlterTable
ALTER TABLE "Evidence" ADD COLUMN     "attempt" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "taskId" TEXT,
ADD COLUMN     "verificationNote" TEXT;
