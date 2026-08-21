-- Align sequences after explicit-ID reference inserts (prevents PK collisions in
-- data migrations, e.g. tasks_management.0002 inserting new RoleRights).
SELECT setval('"tblRole_RoleID_seq"', (SELECT COALESCE(MAX("RoleID"),1) FROM "tblRole"), true);
SELECT setval('"tblRoleRight_RoleRightID_seq"', (SELECT COALESCE(MAX("RoleRightID"),1) FROM "tblRoleRight"), true);
