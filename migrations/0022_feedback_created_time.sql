-- Feedback: give the time-less rows a time.
--
-- Until now the client wrote `createdAt` as `iso(TODAY)` — a bare 'YYYY-MM-DD' — so the inbox
-- could only ever show a day. The server stamps a full ISO timestamp from here on, which leaves
-- the rows written before that with no clock, and nothing recoverable to reconstruct one from:
-- the ids are random UUIDv4 and D1 keeps no per-row timestamp.
--
-- So they get the earliest instant they could possibly hold. Every one of them was submitted
-- from build v0.0092 (00cecfa), committed 2026-08-04 15:53:21 +07 = 08:53:21Z, so that is the
-- floor. Anchoring on each row's own date rather than one fixed day keeps a row created on some
-- other date on that date. The minutes are not invented per row — all of them read 15:53 local,
-- because nothing here knows which came first to a finer grain than that.
--
-- Plain concatenation, no strftime: the stored date is already the local calendar day, and
-- appending the time is the whole operation. Rows that already carry a 'T' are length 24 and the
-- WHERE clause leaves them alone.

UPDATE feedback
SET created_at = created_at || 'T08:53:21.000Z'
WHERE created_at IS NOT NULL AND length(created_at) = 10;
