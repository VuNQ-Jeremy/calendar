-- Undo scripts/practice-demo-seed.sql.
--
-- Order matters twice over: practice_warnings is found THROUGH practice_misses, so it goes
-- first, and practice_student_tasks references practice_tasks, so copies go before tasks.
--
-- What this deliberately does NOT undo:
--   * practice_settings — the seed used INSERT OR REPLACE, so the class's previous row (if it
--     had one) is already gone and there is nothing faithful to restore. The class is left with
--     Practice ENABLED and every weekday a practice day; turn it off from the Practice page, or
--     fix the weekday mask there, if that is not what you want.
--   * anything without a `seedtest-` id that you created by hand while clicking around.

DELETE FROM practice_warnings
 WHERE student_id IN (SELECT student_id FROM practice_misses WHERE id LIKE 'seedtest-%')
   AND class_id   IN (SELECT class_id   FROM practice_misses WHERE id LIKE 'seedtest-%');

DELETE FROM practice_misses         WHERE id LIKE 'seedtest-%';
DELETE FROM practice_excuses        WHERE id LIKE 'seedtest-%';
DELETE FROM practice_student_tasks  WHERE id LIKE 'seedtest-%';
DELETE FROM practice_tasks          WHERE id LIKE 'seedtest-%';

-- Should print 0 across the board.
SELECT (SELECT COUNT(*) FROM practice_tasks         WHERE id LIKE 'seedtest-%') AS tasks_left,
       (SELECT COUNT(*) FROM practice_student_tasks WHERE id LIKE 'seedtest-%') AS copies_left,
       (SELECT COUNT(*) FROM practice_excuses       WHERE id LIKE 'seedtest-%') AS excuses_left,
       (SELECT COUNT(*) FROM practice_misses        WHERE id LIKE 'seedtest-%') AS misses_left;
