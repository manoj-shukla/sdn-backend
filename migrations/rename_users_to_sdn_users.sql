-- ============================================================
-- Migration: Rename 'users' table to 'sdn_users'
-- Purpose  : Prevent data loss from other applications that
--            share the same PostgreSQL database and accidentally
--            delete rows from a generic 'users' table.
-- Safe     : ALTER TABLE RENAME is atomic and preserves all
--            data, indexes, constraints, and sequences.
-- Date     : 2026-04-18
-- ============================================================

BEGIN;

-- Step 1: Rename the main table
ALTER TABLE IF EXISTS users RENAME TO sdn_users;

-- Step 2: Rename the primary key sequence if it exists
-- (PostgreSQL auto-names it <table>_<col>_seq)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'users_userid_seq') THEN
        ALTER SEQUENCE users_userid_seq RENAME TO sdn_users_userid_seq;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'users_user_id_seq') THEN
        ALTER SEQUENCE users_user_id_seq RENAME TO sdn_users_user_id_seq;
    END IF;
END $$;

-- Step 3: Rename indexes that reference the old table name
-- (covers auto-created PK/UNIQUE indexes)
DO $$
DECLARE
    idx RECORD;
BEGIN
    FOR idx IN
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'sdn_users' AND indexname LIKE 'users_%'
    LOOP
        EXECUTE format('ALTER INDEX %I RENAME TO %I',
            idx.indexname,
            replace(idx.indexname, 'users_', 'sdn_users_'));
    END LOOP;
END $$;

COMMIT;

-- Verify
SELECT COUNT(*) AS user_count FROM sdn_users;
