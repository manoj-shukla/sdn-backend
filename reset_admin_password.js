const { Pool } = require('pg');
require('dotenv').config();
const bcrypt = require('bcryptjs');

const pool = new Pool({
    host: process.env.PGHOST,
    user: process.env.PGUSER,
    database: process.env.PGDATABASE,
    password: process.env.PGPASSWORD,
    port: process.env.PGPORT || 5432,
    ssl: { rejectUnauthorized: false },
});

async function resetAdmin() {
    try {
        const hash = await bcrypt.hash('Admin123!', 10);
        await pool.query("UPDATE sdn_users SET password = $1 WHERE username = 'admin'", [hash]);
        console.log("Admin password reset to Admin123!");
    } catch (err) {
        console.error("Error:", err);
    } finally {
        await pool.end();
    }
}

resetAdmin();
