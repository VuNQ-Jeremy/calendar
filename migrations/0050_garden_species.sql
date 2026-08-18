-- 0050: personal plant species (vườn cây từ vựng).
--
-- 'classic' is the drawing every plant had before species existed, so the default keeps every
-- existing plant looking exactly as it did on deploy day. Which species a student may pick is
-- derived at read time from `fruits_total` (see shared/garden-art.ts) — there is deliberately no
-- unlock table: lifetime fruit is already stored here and never decreases.
ALTER TABLE garden_plants ADD COLUMN species TEXT NOT NULL DEFAULT 'classic';

-- Reserved for the pets feature. Nothing reads or writes it yet; it ships now so that adding pets
-- later needs no migration against a table every garden read touches.
ALTER TABLE garden_plants ADD COLUMN companion TEXT;
