-- The Tests module replaces homework. score_records are deliberately untouched:
-- homework_grades.score_record_id is a child reference, so dropping the child
-- preserves every historical gradebook entry on /assessments.
DROP TABLE homework_grades;
DROP TABLE homework;
DELETE FROM sent_notifications WHERE key LIKE 'homework:%';
