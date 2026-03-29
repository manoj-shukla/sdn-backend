const db = require('./config/database');

async function checkConstraints() {
    try {
        console.log("Checking constraints for 'circles' table...");
        const res = await new Promise((resolve, reject) => {
            db.all(`
                SELECT conname, contype 
                FROM pg_constraint 
                WHERE conrelid = 'circles'::regclass;
            `, [], (err, rows) => err ? reject(err) : resolve(rows));
        });
        console.log("Constraints:", JSON.stringify(res, null, 2));

        console.log("\nChecking column names for 'circles' table...");
        const columns = await new Promise((resolve, reject) => {
            db.all(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = 'circles';
            `, [], (err, rows) => err ? reject(err) : resolve(rows));
        });
        console.log("Columns:", JSON.stringify(columns, null, 2));

        process.exit(0);
    } catch (err) {
        console.error("Error checking constraints:", err);
        process.exit(1);
    }
}

checkConstraints();
