const db = require('../config/database');

const runMigration = async () => {
    console.log("Starting Migration: Adding status columns to supplier_change_items...");

    const sql = `
        ALTER TABLE supplier_change_items ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'PENDING';
        ALTER TABLE supplier_change_items ADD COLUMN IF NOT EXISTS reviewedByUserId INTEGER;
        ALTER TABLE supplier_change_items ADD COLUMN IF NOT EXISTS reviewedAt TIMESTAMP;
    `;

    await new Promise((resolve) => {
        db.run(sql, [], (err) => {
            if (err) {
                console.error("Migration Failed:", err.message);
            } else {
                console.log("Migration Successful: Columns added to supplier_change_items.");
            }
            resolve();
        });
    });

    console.log("Migration script finished.");
    setTimeout(() => process.exit(0), 1000);
};

// Wait for DB connection
setTimeout(runMigration, 1000);
