const db = require('./config/database');

db.all("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name", [], (err, rows) => {
    if (err) {
        console.error("Error fetching tables:", err);
        process.exit(1);
    }
    console.log("Full table list:");
    console.table(rows.map(r => r.table_name));
    process.exit(0);
});
