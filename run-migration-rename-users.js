/**
 * Migration: Rename 'users' table to 'sdn_users'
 * Handles the case where sdn_users was auto-created with 1 seed row.
 *
 * Run with:  node run-migration-rename-users.js
 */

require('dotenv').config();
const db = require('./config/database');

const q  = (sql, params = []) => new Promise((resolve, reject) => db.get(sql,  params, (err, row)  => err ? reject(err) : resolve(row)));
const qa = (sql, params = []) => new Promise((resolve, reject) => db.all(sql,  params, (err, rows) => err ? reject(err) : resolve(rows || [])));
const ex = (sql, params = []) => new Promise((resolve, reject) => db.run(sql,  params, err          => err ? reject(err) : resolve()));

async function tableExists(name) {
    const row = await q(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema='public' AND table_name=$1) AS e`, [name]);
    return row && (row.e === true || row.e === 't' || row.e === 'true');
}

async function cnt(table) {
    const row = await q(`SELECT COUNT(*) AS n FROM ${table}`);
    return Number(row?.n ?? 0);
}

async function main() {
    console.log('\n=== SDN Users Table Migration ===\n');

    const usersExists    = await tableExists('users');
    const sdnUsersExists = await tableExists('sdn_users');

    console.log(`  'users' table exists    : ${usersExists}`);
    console.log(`  'sdn_users' table exists: ${sdnUsersExists}`);

    // ── Already done ──────────────────────────────────────────
    if (!usersExists && sdnUsersExists) {
        console.log(`\n✅ Already migrated — sdn_users has ${await cnt('sdn_users')} rows.\n`);
        process.exit(0);
    }

    if (!usersExists && !sdnUsersExists) {
        console.log('\n⚠️  Neither table exists yet — app will create sdn_users on next start.\n');
        process.exit(0);
    }

    // ── Only users exists ─────────────────────────────────────
    if (usersExists && !sdnUsersExists) {
        const n = await cnt('users');
        console.log(`\n  Renaming users (${n} rows) → sdn_users ...`);
        await ex('ALTER TABLE users RENAME TO sdn_users');
        console.log(`✅ Done — sdn_users now has ${await cnt('sdn_users')} rows.\n`);
        process.exit(0);
    }

    // ── Both exist ────────────────────────────────────────────
    const usersCount    = await cnt('users');
    const sdnUsersCount = await cnt('sdn_users');
    console.log(`\n  'users' has     : ${usersCount} rows`);
    console.log(`  'sdn_users' has : ${sdnUsersCount} rows`);

    // Show what is in sdn_users
    const sdnRows = await qa(`SELECT userid, username, email, role FROM sdn_users ORDER BY userid`);
    console.log('\n  Rows in sdn_users:');
    sdnRows.forEach(r => console.log(`    [${r.userid}] ${r.username} | ${r.email} | ${r.role}`));

    // Check which sdn_users rows already exist in users (match by email)
    const alreadyInUsers = [];
    const genuinelyNew   = [];

    for (const sdnRow of sdnRows) {
        const match = await q(`SELECT userid FROM users WHERE email = $1`, [sdnRow.email]);
        if (match) {
            alreadyInUsers.push({ ...sdnRow, existingUserId: match.userid });
        } else {
            genuinelyNew.push(sdnRow);
        }
    }

    console.log(`\n  sdn_users rows already present in users (by email): ${alreadyInUsers.length}`);
    alreadyInUsers.forEach(r => console.log(`    ✓ ${r.email} (users.userid=${r.existingUserId})`));

    console.log(`  sdn_users rows NOT in users (would need inserting)  : ${genuinelyNew.length}`);
    genuinelyNew.forEach(r => console.log(`    ✗ ${r.email}`));

    if (genuinelyNew.length > 0) {
        // Copy the genuinely new rows into users first
        console.log('\n  Copying genuinely new rows from sdn_users into users ...');
        for (const r of genuinelyNew) {
            const full = await q(`SELECT * FROM sdn_users WHERE userid = $1`, [r.userid]);
            if (!full) continue;
            await ex(
                `INSERT INTO users (username, password, email, role, subrole, buyerid, supplierid, circleid,
                                    isactive, phone, "firstName", "lastName", mustchangepassword, is_deleted, deleted_at, createdat)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
                 ON CONFLICT (email) DO NOTHING`,
                [
                    full.username, full.password, full.email, full.role,
                    full.subrole || full.subRole || null,
                    full.buyerid || full.buyerId || null,
                    full.supplierid || full.supplierId || null,
                    full.circleid || full.circleId || null,
                    full.isactive ?? full.isActive ?? true,
                    full.phone || null,
                    full.firstName || full.firstname || null,
                    full.lastName  || full.lastname  || null,
                    full.mustchangepassword ?? full.mustChangePassword ?? false,
                    full.is_deleted ?? false,
                    full.deleted_at ?? null,
                    full.createdat || full.createdAt || new Date(),
                ]
            );
            console.log(`  ✅ Copied ${r.email} into users`);
        }
    }

    // Now sdn_users only has rows that are present (or now merged) in users
    // Drop sdn_users and rename users → sdn_users
    const finalUsersCount = await cnt('users');
    console.log(`\n  Final 'users' row count before rename: ${finalUsersCount}`);
    console.log('  Dropping sdn_users (all data is now in users) ...');
    await ex('DROP TABLE sdn_users');
    console.log('  Renaming users → sdn_users ...');
    await ex('ALTER TABLE users RENAME TO sdn_users');

    // Rename PK sequence if present
    for (const seq of ['users_userid_seq', 'users_user_id_seq', 'users_id_seq']) {
        const seqRow = await q(`SELECT EXISTS (SELECT FROM pg_class WHERE relname=$1 AND relkind='S') AS e`, [seq]);
        if (seqRow && (seqRow.e === true || seqRow.e === 't')) {
            const newSeq = seq.replace('users_', 'sdn_users_');
            await ex(`ALTER SEQUENCE ${seq} RENAME TO ${newSeq}`);
            console.log(`  ✅ Sequence ${seq} → ${newSeq}`);
        }
    }

    const afterCount = await cnt('sdn_users');
    if (afterCount < finalUsersCount) {
        console.error(`\n❌ Row count dropped! Expected ≥${finalUsersCount}, got ${afterCount}`);
        process.exit(1);
    }

    console.log(`\n✅ Migration complete — sdn_users has ${afterCount} rows.`);
    console.log('   Restart the backend to apply.\n');
    process.exit(0);
}

main().catch(err => {
    console.error('\n❌ Migration failed:', err.message);
    process.exit(1);
});
