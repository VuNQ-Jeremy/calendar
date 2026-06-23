-- Seed master admin account.
-- Auth is currently mocked on the frontend (any non-empty password is accepted).
-- When real auth is wired, add the matching row to the accounts table with a
-- bcrypt/argon2 hash for the chosen password.

INSERT INTO staff (id, name, email, role, color)
VALUES ('admin-0000-0000-0000-000000000001', 'Admin', 'admin@mochi.edu', 'Admin', 'orange')
ON CONFLICT(id) DO NOTHING;
