const db = require('./config/database');

db.get("SELECT username FROM users WHERE role = 'BUYER' LIMIT 1", [], (err, row) => {
    if (err) {
        console.error("Error:", err);
        process.exit(1);
    }
    if (row) {
        console.log("Found Buyer:", row.username);
    } else {
        console.log("No Buyer found.");
    }
    db.close().then(() => process.exit(0));
});
