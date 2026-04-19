/**
 * Cleanup test / e2e users from the database.
 *
 * Identifies users by:
 *  - email ending in @example.com
 *  - email/username containing 'e2e_', 'test_', '_test'
 *  - username starting with 'testuser'
 *
 * Run with:  node cleanup-test-users.js
 * Dry-run:   node cleanup-test-users.js --dry-run
 */

require('dotenv').config();
const db = require('./config/database');

const dryRun = process.argv.includes('--dry-run');

const q  = (sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r)  => e ? rej(e) : res(r)));
const qa = (sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r)  => e ? rej(e) : res(r || [])));
const ex = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, e        => e ? rej(e) : res()));

async function tableExists(name) {
    const r = await q(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema='public' AND table_name=$1) AS e`, [name]);
    return r && (r.e === true || r.e === 't' || r.e === 'true');
}

async function findTestUsers(table) {
    return qa(
        `SELECT userid, username, email, role, createdat
           FROM ${table}
          WHERE email ILIKE '%@example.com'
             OR email ILIKE '%e2e_%'
             OR email ILIKE '%_test@%'
             OR email ILIKE '%test_%@%'
             OR username ILIKE 'e2e_%'
             OR username ILIKE 'test_%'
             OR username ILIKE '%_test'
          ORDER BY createdat`,
        []
    );
}

async function main() {
    console.log(`\n=== Test User Cleanup${dryRun ? ' (DRY RUN — no changes)' : ''} ===\n`);

    const tables = [];
    if (await tableExists('users'))     tables.push('users');
    if (await tableExists('sdn_users')) tables.push('sdn_users');

    if (tables.length === 0) {
        console.log('No user tables found.');
        process.exit(0);
    }

    let totalFound = 0;

    for (const table of tables) {
        const testUsers = await findTestUsers(table);
        console.log(`Table '${table}': ${testUsers.length} test user(s) found`);

        if (testUsers.length === 0) continue;

        testUsers.forEach(u =>
            console.log(`  [${u.userid}] ${u.username} | ${u.email} | ${u.role} | created: ${u.createdat}`)
        );

        if (!dryRun) {
            for (const u of testUsers) {
                const uid = u.userid;

                // Clean up related supplier data if supplierId exists
                const userRow = await q(`SELECT supplierid FROM ${table} WHERE userid = $1`, [uid]);
                const sid = userRow?.supplierid || userRow?.supplierId;

                if (sid) {
                    // Delete supplier-linked records
                    const supplierCleanup = [
                        `DELETE FROM rfp_supplier               WHERE supplier_id = $1`,
                        `DELETE FROM supplier_rfp_response      WHERE supplier_id = $1`,
                        `DELETE FROM rfp_qualification_response WHERE supplier_id = $1`,
                        `DELETE FROM rfp_quality_response       WHERE supplier_id = $1`,
                        `DELETE FROM rfp_logistics_response     WHERE supplier_id = $1`,
                        `DELETE FROM rfp_esg_response           WHERE supplier_id = $1`,
                        `DELETE FROM rfp_terms_response         WHERE supplier_id = $1`,
                        `DELETE FROM supplier_change_items      WHERE requestId IN (SELECT requestId FROM supplier_change_requests WHERE supplierId = $1)`,
                        `DELETE FROM supplier_change_requests   WHERE supplierId = $1`,
                        `DELETE FROM addresses                  WHERE supplierId = $1`,
                        `DELETE FROM contacts                   WHERE supplierId = $1`,
                        `DELETE FROM documents                  WHERE supplierId = $1`,
                        `DELETE FROM reviews                    WHERE supplierId = $1`,
                        `DELETE FROM suppliers                  WHERE supplierId = $1`,
                    ];
                    for (const sql of supplierCleanup) {
                        await ex(sql, [sid]).catch(() => {}); // ignore if table doesn't exist
                    }
                    console.log(`  ✅ Cleaned supplier data for supplierId=${sid}`);
                }

                // Delete invitations linked to this user's email
                await ex(`DELETE FROM invitations WHERE email = $1`, [u.email]).catch(() => {});

                // Delete the user
                await ex(`DELETE FROM ${table} WHERE userid = $1`, [uid]);
                console.log(`  🗑️  Deleted user [${uid}] ${u.email} from ${table}`);
            }
        }

        totalFound += testUsers.length;
    }

    console.log(`\n${dryRun ? '[DRY RUN] Would delete' : 'Deleted'}: ${totalFound} test user(s) total`);
    if (dryRun && totalFound > 0) {
        console.log('Run without --dry-run to actually delete them.\n');
    } else {
        console.log('Done.\n');
    }

    process.exit(0);
}

main().catch(err => {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
});
