const db = require('./config/database');

db.all("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'invitations'", [], (err, rows) => {
    if (err) {
        console.error("Error fetching columns:", err);
    } else {
        console.log("Columns in 'invitations':");
        rows.forEach(r => console.log(`- ${r.column_name} (${r.data_type})` || `- ${r.column_name} (${r.DATA_TYPE})`));
    }
    process.exit();
});

db.all("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users'", [], (err, rows) => {
    if (err) {
        console.error("Error fetching columns for users:", err);
    } else {
        console.log("Columns in 'users':");
        rows.forEach(r => console.log(`- ${r.column_name} (${r.data_type})`));
    }
    process.exit();
});
