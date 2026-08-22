-- Align sequences after explicit-ID reference inserts (prevents PK collisions in
-- data migrations, e.g. tasks_management.0002 inserting new RoleRights).
SELECT setval('"tblRole_RoleID_seq"', (SELECT COALESCE(MAX("RoleID"),1) FROM "tblRole"), true);
SELECT setval('"tblRoleRight_RoleRightID_seq"', (SELECT COALESCE(MAX("RoleRightID"),1) FROM "tblRoleRight"), true);

-- Attach DEFAULT nextval() for any legacy identity column that has a matching
-- sequence but no default. Found via officer provisioning: tblOfficerVillages
-- was created without its default, so inserts failed with a NOT NULL violation
-- on the primary key. Written as a scan rather than a single fix so the whole
-- class is closed, and idempotent so re-running is safe.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_name = c.table_name AND t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public'
      AND c.is_nullable = 'NO'
      AND c.column_default IS NULL
      AND c.data_type IN ('integer', 'bigint')
      AND c.table_name LIKE 'tbl%'
      AND EXISTS (
        SELECT 1 FROM information_schema.sequences s
        WHERE s.sequence_schema = 'public'
          AND s.sequence_name = c.table_name || '_' || c.column_name || '_seq'
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN %I SET DEFAULT nextval(%L)',
      r.table_name, r.column_name,
      format('"public"."%s_%s_seq"', r.table_name, r.column_name)
    );
    EXECUTE format(
      'SELECT setval(%L, COALESCE((SELECT MAX(%I) FROM %I), 1), true)',
      format('"public"."%s_%s_seq"', r.table_name, r.column_name),
      r.column_name, r.table_name
    );
    RAISE NOTICE 'bootstrap: attached sequence default to %.%', r.table_name, r.column_name;
  END LOOP;
END $$;
