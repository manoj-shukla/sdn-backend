const db = require('../config/database');

const inspect = async () => {
    console.log("Inspecting supplier_change_requests schema...");

    // Query information_schema
    db.all(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'supplier_change_requests'`, [], (err, rows) => {
        if (err) console.error("Error:", err);
        else {
            console.log("Columns:", rows);
        }
        process.exit(0);
    });
};

setTimeout(inspect, 1000);
