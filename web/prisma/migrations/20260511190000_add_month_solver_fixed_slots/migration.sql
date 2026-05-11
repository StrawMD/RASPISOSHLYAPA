-- JSON map: day -> postId -> list of names, e.g. "Иванов(д)" on 24h posts
ALTER TABLE "Month" ADD COLUMN "solverFixedSlots" TEXT NOT NULL DEFAULT '{}';
