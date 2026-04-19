const db = require('./config/database');

async function checkColumns() {
    console.log('--- Checking Columns for Sub-resources ---');
    await new Promise(resolve => setTimeout(resolve, 2000));

    const tables = ['addresses', 'contacts', 'bank_accounts', 'workflow_instances', 'step_instances'];
    
    for (const table of tables) {
        await new Promise((resolve) => {
            db.all(`SELECT column_name FROM information_schema.columns WHERE table_name = ?`, [table], (err, rows) => {
                if (err) console.error(`Error checking ${table}:`, err);
                else {
                    console.log(`Columns for ${table}:`, rows.map(r => r.column_name));
                }
                resolve();
            });
        });
    }

    process.exit(0);
}

checkColumns();
