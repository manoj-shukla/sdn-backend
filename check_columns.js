const db = require('./config/database');

db.all("SELECT * FROM suppliers LIMIT 1", [], (err, rows) => {
    if (err) {
        console.error("Error:", err);
        process.exit(1);
    }
    if (rows && rows.length > 0) {
        console.log("Columns:", Object.keys(rows[0]));
    } else {
        console.log("No rows found, trying to get columns from PRAGMA or information_schema");
        db.all("SELECT column_name FROM information_schema.columns WHERE table_name = 'suppliers'", [], (err, rows) => {
            if (err) console.error(err);
            else console.log("Columns from info_schema:", rows.map(r => r.column_name || r.columnName));
            db.close().then(() => process.exit(0));
        });
        return;
    }
    db.close().then(() => process.exit(0));
});
