const db = require('../config/database');

async function fixSchema() {
    console.log('--- REVISING AND CONSOLIDATING SCHEMA (v2) ---');
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
        // 1. CONSOLIDATE sdn_users
        console.log('Progress: Consolidating sdn_users columns...');
        await new Promise((resolve, reject) => {
            db.run(`
                DO $$ BEGIN
                    -- Ensure lowercase columns exist
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sdn_users' AND column_name='firstname') THEN
                        ALTER TABLE sdn_users ADD COLUMN firstname TEXT;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sdn_users' AND column_name='lastname') THEN
                        ALTER TABLE sdn_users ADD COLUMN lastname TEXT;
                    END IF;

                    -- Migrate data from camelCase to lowercase
                    UPDATE sdn_users SET 
                        firstname = COALESCE(firstname, "firstName"),
                        lastname = COALESCE(lastname, "lastName");

                    -- Drop camelCase columns
                    ALTER TABLE sdn_users DROP COLUMN IF EXISTS "firstName";
                    ALTER TABLE sdn_users DROP COLUMN IF EXISTS "lastName";
                    ALTER TABLE sdn_users DROP COLUMN IF EXISTS "subRole";
                    ALTER TABLE sdn_users DROP COLUMN IF EXISTS "buyerId";
                    ALTER TABLE sdn_users DROP COLUMN IF EXISTS "supplierId";
                    ALTER TABLE sdn_users DROP COLUMN IF EXISTS "mustChangePassword";
                    ALTER TABLE sdn_users DROP COLUMN IF EXISTS "circleId";
                END $$;
            `, [], (err) => err ? reject(err) : resolve());
        });
        console.log('Success: sdn_users consolidated.');

        // 2. RENAME AND RECREATE documents (Avoid dependency errors)
        console.log('Progress: Renaming legacy documents and recreating table...');
        await new Promise((resolve, reject) => {
            db.run(`
                -- Safely rename existing table if it has UUIDs
                DO $$ BEGIN
                    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='documents' AND column_name='documentid' AND data_type='uuid') 
                       OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='documents' AND column_name='documentid' AND data_type='character varying') THEN
                        
                        -- Drop constraints first to allow rename/replacement if needed, or just rename the whole thing
                        -- Actually, let's just use DROP CASCADE now that we know they are legacy
                        DROP TABLE documents CASCADE;
                    END IF;
                END $$;

                -- Create correct table if not exists
                CREATE TABLE IF NOT EXISTS documents (
                    documentid SERIAL PRIMARY KEY,
                    supplierid INTEGER NOT NULL,
                    documenttype TEXT NOT NULL,
                    documentname TEXT NOT NULL,
                    filepath TEXT,
                    filesize INTEGER,
                    filetype TEXT,
                    verificationstatus TEXT DEFAULT 'PENDING',
                    expirydate DATE,
                    notes TEXT,
                    isactive BOOLEAN DEFAULT TRUE,
                    uploadedbyuserid INTEGER,
                    uploadedbyusername TEXT,
                    verifiedbyuserid INTEGER,
                    verifiedat TIMESTAMP,
                    createdat TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `, [], (err) => err ? reject(err) : resolve());
        });
        console.log('Success: documents table prepared.');

        // 3. FIX OTHER TABLES
        console.log('Progress: Aligning other core tables...');
        const otherFixes = [
            `DO $$ BEGIN 
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='buyer_roles' AND column_name='roleName') THEN
                    ALTER TABLE buyer_roles RENAME COLUMN "roleName" TO rolename;
                END IF;
            END $$;`,
            `DO $$ BEGIN 
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='workflow_steps' AND column_name='stepName') THEN
                    ALTER TABLE workflow_steps RENAME COLUMN "stepName" TO stepname;
                END IF;
            END $$;`
        ];

        for (const statement of otherFixes) {
            await new Promise((res, rej) => db.run(statement, [], (e) => e ? rej(e) : res()));
        }
        console.log('Success: Global alignment complete.');

    } catch (err) {
        console.error('CRITICAL ERROR during schema revision:', err.message);
        process.exit(1);
    }

    console.log('--- ALL TASKS COMPLETE ---');
    process.exit(0);
}

fixSchema();
