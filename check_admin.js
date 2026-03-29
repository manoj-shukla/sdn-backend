const db = require('./config/database');

db.get("SELECT username, password, role FROM users WHERE username ILIKE 'admin' OR email ILIKE 'admin@sdn.tech'", [], (err, row) => {
    if (err) {
        console.error("Error fetching admin:", err);
    } else {
        console.log("Admin User in DB:", row);
    }
    process.exit();
});
