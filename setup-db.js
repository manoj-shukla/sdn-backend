// Emergency DB setup — run this if the server restart doesn't create tables:
//   node setup-db.js
//
// This bypasses the wrapper and runs schema creation directly via pg.

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

async function setup() {
    const client = await pool.connect();
    console.log('Connected to database:', process.env.PGHOST);

    try {
        console.log('Creating tables...');

        // Each statement run individually to avoid multi-statement issues
        const statements = [
            `CREATE TABLE IF NOT EXISTS users (
                userId SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                email TEXT UNIQUE,
                role TEXT NOT NULL CHECK(role IN ('ADMIN', 'BUYER', 'SUPPLIER')),
                subRole TEXT,
                buyerId INTEGER,
                supplierId INTEGER,
                circleId INTEGER,
                isActive BOOLEAN DEFAULT TRUE,
                phone TEXT,
                "firstName" TEXT,
                "lastName" TEXT,
                mustChangePassword BOOLEAN DEFAULT FALSE,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS buyers (
                buyerId SERIAL PRIMARY KEY,
                buyerName TEXT NOT NULL,
                buyerCode TEXT UNIQUE,
                email TEXT,
                phone TEXT,
                country TEXT,
                isActive BOOLEAN DEFAULT TRUE,
                isSandboxActive BOOLEAN DEFAULT FALSE,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updatedAt TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS suppliers (
                supplierId SERIAL PRIMARY KEY,
                legalName TEXT NOT NULL,
                businessType TEXT,
                country TEXT,
                taxId TEXT,
                website TEXT,
                description TEXT,
                isActive BOOLEAN DEFAULT TRUE,
                approvalStatus TEXT DEFAULT 'DRAFT',
                profileStatus TEXT DEFAULT 'PENDING',
                documentStatus TEXT DEFAULT 'PENDING',
                financeStatus TEXT DEFAULT 'PENDING',
                buyerId INTEGER,
                createdByUserId INTEGER,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS invitations (
                invitationId SERIAL PRIMARY KEY,
                buyerId INTEGER,
                buyerName TEXT,
                supplierId INTEGER,
                email TEXT NOT NULL,
                invitationToken TEXT UNIQUE NOT NULL,
                status TEXT DEFAULT 'PENDING',
                expiresAt TIMESTAMP,
                acceptedAt TIMESTAMP,
                role TEXT DEFAULT 'SUPPLIER',
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS password_resets (
                email TEXT PRIMARY KEY,
                token TEXT NOT NULL,
                expiresat TIMESTAMP NOT NULL
            )`,
            `CREATE TABLE IF NOT EXISTS notifications (
                notificationId SERIAL PRIMARY KEY,
                type TEXT NOT NULL,
                message TEXT NOT NULL,
                entityId TEXT,
                recipientRole TEXT,
                supplierId INTEGER,
                buyerId INTEGER,
                isRead BOOLEAN DEFAULT FALSE,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS user_supplier_memberships (
                membershipId SERIAL PRIMARY KEY,
                userId INTEGER NOT NULL,
                supplierId INTEGER NOT NULL,
                isActive BOOLEAN DEFAULT TRUE,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
        ];

        for (const sql of statements) {
            await client.query(sql);
            const tableName = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/i)?.[1];
            console.log(`  ✅ ${tableName}`);
        }

        // Seed admin user
        console.log('\nSeeding admin user...');
        const hash = await bcrypt.hash('Admin123!', 10);
        await client.query(`
            INSERT INTO users (username, password, email, role, subrole, isactive, is_deleted)
            VALUES ($1, $2, $3, $4, $5, TRUE, FALSE)
            ON CONFLICT (username) DO UPDATE
                SET password = EXCLUDED.password,
                    role = EXCLUDED.role,
                    email = EXCLUDED.email,
                    subrole = EXCLUDED.subrole,
                    isactive = TRUE,
                    is_deleted = FALSE
        `, ['admin', hash, 'admin@sdn.tech', 'ADMIN', 'Super Admin']);
        console.log('  ✅ Admin user: admin@sdn.tech / Admin123!');

        console.log('\n✅ Database setup complete! You can now start the server.\n');
    } catch (err) {
        console.error('\n❌ Setup failed:', err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

setup();
