// Copies all buyers into the users table so they can log in.
// Sets password to: admin@123
// Run: node copy-buyers-to-users.js

require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD,
    database: process.env.PGDATABASE,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
});

async function run() {
    const NEW_PASSWORD = 'admin@123';
    const client = await pool.connect();

    try {
        console.log('Connected to:', process.env.PGHOST);
        const hash = await bcrypt.hash(NEW_PASSWORD, 10);

        // ── 1. Fetch all buyers ──────────────────────────────────────────────
        const { rows: buyers } = await client.query(
            `SELECT buyerid, buyername, buyercode, email, isactive
             FROM buyers
             ORDER BY buyerid`
        );

        console.log(`\nFound ${buyers.length} buyer(s) in buyers table.\n`);

        if (buyers.length === 0) {
            console.log('Nothing to migrate.');
            return;
        }

        // ── 2. For each buyer, upsert a user record ──────────────────────────
        let created = 0;
        let skipped = 0;

        for (const b of buyers) {
            const email = b.email || null;

            // Build a clean username from buyercode or buyername
            const username = (b.buyercode || b.buyername || `buyer_${b.buyerid}`)
                .toLowerCase()
                .replace(/\s+/g, '_')
                .replace(/[^a-z0-9_@.-]/g, '');

            // Skip if we have no email AND the username already exists as a user
            const { rows: existing } = await client.query(
                `SELECT userid FROM users
                 WHERE username = $1 OR (email IS NOT NULL AND email = $2)
                 LIMIT 1`,
                [username, email]
            );

            if (existing.length > 0) {
                // User exists — just make sure their password and buyerId are in sync
                await client.query(
                    `UPDATE users
                     SET password  = $1,
                         buyerid   = $2,
                         isactive  = $3
                     WHERE userid = $4`,
                    [hash, b.buyerid, b.isactive ?? true, existing[0].userid]
                );
                console.log(`  🔄 Updated  : [BUYER] ${username} — ${email || 'no email'}`);
                skipped++;
            } else {
                // Create fresh user record
                await client.query(
                    `INSERT INTO users (username, password, email, role, subrole, buyerid, isactive)
                     VALUES ($1, $2, $3, 'BUYER', 'Admin', $4, $5)`,
                    [username, hash, email, b.buyerid, b.isactive ?? true]
                );
                console.log(`  ✅ Created  : [BUYER] ${username} — ${email || 'no email'}`);
                created++;
            }
        }

        // ── 3. Summary ───────────────────────────────────────────────────────
        console.log(`\n──────────────────────────────────────────`);
        console.log(`  Created  : ${created} new user(s)`);
        console.log(`  Updated  : ${skipped} existing user(s)`);
        console.log(`  Password : ${NEW_PASSWORD}  (all accounts)`);
        console.log(`──────────────────────────────────────────\n`);

        // ── 4. Print final users table ───────────────────────────────────────
        const { rows: allUsers } = await client.query(
            `SELECT userid, username, email, role, subrole, buyerid, isactive
             FROM users ORDER BY userid`
        );
        console.log('All users now in the users table:');
        console.table(allUsers);

    } catch (err) {
        console.error('\n❌ Error:', err.message);
        console.error(err);
    } finally {
        client.release();
        await pool.end();
    }
}

run();
