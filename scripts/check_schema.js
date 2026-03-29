const db = require('../config/database');

console.log("Checking schema for 'documents' table...");

db.all("PRAGMA table_info(documents)", [], (err, rows) => {
    if (err) {
        console.error("Error fetching schema:", err);
    } else {
        console.log("Schema:", JSON.stringify(rows, null, 2));
    }
});

// Keep alive for a bit
setTimeout(() => { }, 2000);
