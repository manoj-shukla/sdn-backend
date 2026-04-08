// Reset ALL user passwords to: admin@123
// Run: node reset-all-passwords.js

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

async function resetPasswords() {
    const NEW_PASSWORD = 'admin@123';
    const client = await pool.connect();

    try {
        console.log('Connected to:', process.env.PGHOST);

        // Fetch all users first
        const { rows: users } = await client.query(
            'SELECT userid, username, email, role FROM users ORDER BY userid'
        );

        if (users.length === 0) {
            console.log('No users found in the database.');
            return;
        }

        console.log(`\nFound ${users.length} user(s). Resetting passwords...\n`);

        // Hash the new password once (same hash for all)
        const hash = await bcrypt.hash(NEW_PASSWORD, 10);

        // Update all at once
        await client.query('UPDATE users SET password = $1', [hash]);

        console.log('✅ Password updated for:');
        users.forEach(u => {
            console.log(`   [${u.role}] ${u.username} — ${u.email || 'no email'}`);
        });

        console.log(`\n🔑 New password for ALL users: ${NEW_PASSWORD}\n`);

    } catch (err) {
        console.error('\n❌ Error:', err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

resetPasswords();
