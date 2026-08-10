-- Invites become *linked*: a code is minted for a person who already exists.
--
-- Before this, redeeming a code INSERTED a fresh students/staff/parents row, so a
-- staff-created record and the self-registered one ended up as two people. Now the
-- code carries the row it belongs to and redeeming only attaches an account to it.
--
-- All three NULL = a legacy (pre-0030) invite, still redeemed via the old
-- create-the-row path — the mobile app keeps minting those.
--
-- ON DELETE CASCADE, not SET NULL: deleting a person must kill their unused code.
-- SET NULL would quietly demote it to a legacy invite and resurrect the person as a
-- duplicate on redeem.
ALTER TABLE invites ADD COLUMN student_id TEXT REFERENCES students(id) ON DELETE CASCADE;
ALTER TABLE invites ADD COLUMN staff_id   TEXT REFERENCES staff(id)    ON DELETE CASCADE;
ALTER TABLE invites ADD COLUMN parent_id  TEXT REFERENCES parents(id)  ON DELETE CASCADE;

CREATE INDEX idx_invites_student ON invites(student_id);
CREATE INDEX idx_invites_staff   ON invites(staff_id);
CREATE INDEX idx_invites_parent  ON invites(parent_id);
