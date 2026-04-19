const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    host: process.env.PGHOST,
    user: process.env.PGUSER,
    database: process.env.PGDATABASE,
    password: process.env.PGPASSWORD,
    port: process.env.PGPORT || 5432,
    ssl: { rejectUnauthorized: false },
});

async function checkAdmin() {
    try {
        const res = await pool.query("SELECT userid, username, email FROM sdn_users WHERE username = 'admin'");
        console.log("Admin User:", res.rows[0]);
    } catch (err) {
        console.error("Error:", err);
    } finally {
        await pool.end();
    }
}

checkAdmin();
