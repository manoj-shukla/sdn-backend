/**
 * migrate_supplier_users.js
 *
 * Finds suppliers that have no linked user account and creates one for each,
 * using the accepted invitation email where possible, or a generated placeholder.
 *
 * Also finds SUPPLIER-role users with supplierId = NULL and tries to link them
 * to the correct supplier via accepted invitation.
 *
 * Usage: node scripts/migrate_supplier_users.js
 */

const db = require('../config/database');
const bcrypt = require('bcryptjs');
const SALT_ROUNDS = 10;

async function run() {
    console.log('\n──────────────────────────────────────────────');
    console.log(' RFP Supplier-User Migration');
    console.log('──────────────────────────────────────────────\n');

    // ── 1. Suppliers with no user record ─────────────────────
    console.log('Step 1: Finding suppliers with no linked user account…');
    const orphanedSuppliers = await new Promise((resolve, reject) => {
        db.all(
            `SELECT s.supplierid, s.legalname, s.buyerid
             FROM suppliers s
             WHERE NOT EXISTS (
                 SELECT 1 FROM users u WHERE u.supplierid = s.supplierid
             )
             ORDER BY s.supplierid ASC`,
            [],
            (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            }
        );
    });

    console.log(`  Found ${orphanedSuppliers.length} supplier(s) without a user account.\n`);

    for (const supplier of orphanedSuppliers) {
        const sid = supplier.supplierid;
        const name = supplier.legalname;

        // Try to find their email from accepted invitation
        const invitation = await new Promise((resolve, reject) => {
            db.get(
                `SELECT email FROM invitations
                 WHERE supplierid = ? AND status = 'ACCEPTED'
                 ORDER BY acceptedat DESC LIMIT 1`,
                [sid],
                (err, row) => {
                    if (err) return reject(err);
                    resolve(row);
                }
            );
        });

        const email = invitation?.email || `supplier_${sid}@placeholder.local`;
        const username = email;

        // Check if user with this email already exists (might just be unlinked)
        const existingUser = await new Promise((resolve, reject) => {
            db.get(
                `SELECT userid, supplierid FROM users WHERE email = ? OR username = ?`,
                [email, username],
                (err, row) => {
                    if (err) return reject(err);
                    resolve(row);
                }
            );
        });

        if (existingUser) {
            if (!existingUser.supplierid) {
                // Link existing user to supplier
                await new Promise((resolve, reject) => {
                    db.run(
                        `UPDATE users SET supplierid = ?, role = 'SUPPLIER', buyerid = ?
                         WHERE userid = ?`,
                        [sid, supplier.buyerid || null, existingUser.userid],
                        (err) => err ? reject(err) : resolve()
                    );
                });
                console.log(`  ✓ Linked existing user (id=${existingUser.userid}) → supplier "${name}" (id=${sid})`);
            } else {
                console.log(`  ⚠ User for "${name}" (id=${sid}) already exists and is linked to supplier ${existingUser.supplierid} — skipped.`);
            }
            continue;
        }

        // Create new user account with a must-change-password flag
        const tempPassword = `Supplier@${sid}!`;
        const hashed = await bcrypt.hash(tempPassword, SALT_ROUNDS);

        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO users (username, email, password, role, supplierid, buyerid, mustchangepassword)
                 VALUES (?, ?, ?, 'SUPPLIER', ?, ?, TRUE)`,
                [username, email, hashed, sid, supplier.buyerid || null],
                (err) => err ? reject(err) : resolve()
            );
        });

        const isPlaceholder = email.includes('@placeholder.local');
        console.log(
            isPlaceholder
                ? `  ✓ Created user for "${name}" (id=${sid}) — no invitation email found, placeholder used: ${email}`
                : `  ✓ Created user for "${name}" (id=${sid}) — email: ${email}  temp password: ${tempPassword}`
        );
    }

    // ── 2. SUPPLIER users with no supplierId ────────────────
    console.log('\nStep 2: Finding SUPPLIER users with supplierId = NULL…');
    const unlinkedUsers = await new Promise((resolve, reject) => {
        db.all(
            `SELECT u.userid, u.username, u.email
             FROM users u
             WHERE u.role = 'SUPPLIER' AND u.supplierid IS NULL
             ORDER BY u.userid ASC`,
            [],
            (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            }
        );
    });

    console.log(`  Found ${unlinkedUsers.length} SUPPLIER user(s) with no supplierId.\n`);

    for (const user of unlinkedUsers) {
        // Try to find their supplier via invitation
        const inv = await new Promise((resolve, reject) => {
            db.get(
                `SELECT i.supplierid, s.legalname
                 FROM invitations i
                 JOIN suppliers s ON s.supplierid = i.supplierid
                 WHERE i.email = ? AND i.status = 'ACCEPTED' AND i.supplierid IS NOT NULL
                 LIMIT 1`,
                [user.email],
                (err, row) => {
                    if (err) return reject(err);
                    resolve(row);
                }
            );
        });

        if (inv?.supplierid) {
            await new Promise((resolve, reject) => {
                db.run(
                    `UPDATE users SET supplierid = ? WHERE userid = ?`,
                    [inv.supplierid, user.userid],
                    (err) => err ? reject(err) : resolve()
                );
            });
            console.log(`  ✓ Linked user "${user.email}" (id=${user.userid}) → supplier "${inv.legalname}" (id=${inv.supplierid})`);
        } else {
            console.log(`  ⚠ Could not find supplier for user "${user.email}" (id=${user.userid}) — no accepted invitation found.`);
        }
    }

    // ── 3. Summary ───────────────────────────────────────────
    console.log('\n──────────────────────────────────────────────');
    console.log('Summary after migration:');

    const counts = await new Promise((resolve, reject) => {
        db.get(
            `SELECT
                (SELECT COUNT(*) FROM suppliers) AS total_suppliers,
                (SELECT COUNT(*) FROM users WHERE role = 'SUPPLIER') AS total_supplier_users,
                (SELECT COUNT(*) FROM users WHERE role = 'SUPPLIER' AND supplierid IS NOT NULL) AS linked_users,
                (SELECT COUNT(*) FROM suppliers s WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.supplierid = s.supplierid)) AS still_orphaned`,
            [],
            (err, row) => {
                if (err) return reject(err);
                resolve(row);
            }
        );
    });

    console.log(`  Total suppliers        : ${counts.total_suppliers}`);
    console.log(`  Supplier user accounts : ${counts.total_supplier_users}`);
    console.log(`  Properly linked        : ${counts.linked_users}`);
    console.log(`  Still without a user   : ${counts.still_orphaned}`);
    console.log('──────────────────────────────────────────────\n');

    if (Number(counts.still_orphaned) > 0) {
        console.log('⚠  Some suppliers still have no user account (likely no invitation record).');
        console.log('   Check the table above — placeholder emails were used for those.');
    } else {
        console.log('✅ All suppliers now have a linked user account.');
    }

    process.exit(0);
}

// Wait for DB to initialise
const interval = setInterval(() => {
    if (db && db.initialized !== false) {
        clearInterval(interval);
        setTimeout(run, 1500);
    }
}, 300);
