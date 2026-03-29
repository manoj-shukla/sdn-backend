const db = require('../config/database');

const runMigration = async () => {
    console.log("Starting Migration: Fixing supplier_change_requests schema...");

    const sql = `
        ALTER TABLE supplier_change_requests ADD COLUMN IF NOT EXISTS requestType TEXT DEFAULT 'PROFILE_UPDATE';
        ALTER TABLE supplier_change_requests ADD COLUMN IF NOT EXISTS buyerId INTEGER;
        ALTER TABLE supplier_change_requests ADD COLUMN IF NOT EXISTS rejectionReason TEXT;
        ALTER TABLE supplier_change_requests ADD COLUMN IF NOT EXISTS requestedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        ALTER TABLE supplier_change_requests ADD COLUMN IF NOT EXISTS reviewedAt TIMESTAMP;
    `;

    await new Promise((resolve) => {
        db.run(sql, [], (err) => {
            if (err) {
                console.error("Migration Failed:", err.message);
            } else {
                console.log("Migration Successful: Columns added to supplier_change_requests.");
            }
            resolve();
        });
    });

    console.log("Migration script finished.");
    setTimeout(() => process.exit(0), 1000);
};

// Wait for DB connection
setTimeout(runMigration, 1000);
