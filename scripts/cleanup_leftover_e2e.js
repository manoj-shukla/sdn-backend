const db = require('../config/database');

async function cleanupLeftoverE2E() {
    console.log('--- Cleaning Up Leftover E2E Users ---');
    
    // Give the database wrapper a moment to initialize
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
        const cleanupStatements = [
            `DELETE FROM sdn_users WHERE username ILIKE '%e2e%' OR email ILIKE '%e2e%'`,
            `DELETE FROM users WHERE username ILIKE '%e2e%' OR email ILIKE '%e2e%'`,
            // Also clean up playwright users which are often E2E
            `DELETE FROM sdn_users WHERE username ILIKE '%playwright%' OR email ILIKE '%playwright%'`,
            `DELETE FROM users WHERE username ILIKE '%playwright%' OR email ILIKE '%playwright%'`,
            // Clean up 'flow' users which are also E2E test artifacts
            `DELETE FROM sdn_users WHERE username ILIKE '%flow%' AND (role = 'BUYER' OR role = 'SUPPLIER')`,
            `DELETE FROM users WHERE username ILIKE '%flow%' AND (role = 'BUYER' OR role = 'SUPPLIER')`
        ];

        for (const sql of cleanupStatements) {
            await new Promise((resolve) => {
                db.run(sql, [], (err) => {
                    if (err) console.error(`Failed: ${sql.substring(0, 50)}... -> ${err.message}`);
                    else console.log(`Executed: ${sql.substring(0, 50)}...`);
                    resolve();
                });
            });
        }
        
        console.log('--- Leftover Cleanup Complete ---');

    } catch (error) {
        console.error('Cleanup failed:', error);
    } finally {
        process.exit(0);
    }
}

cleanupLeftoverE2E();
