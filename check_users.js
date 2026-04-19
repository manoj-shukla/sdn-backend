const db = require('./config/database');

async function checkUsers() {
    try {
        db.get("SELECT userId, username, password, role FROM sdn_users WHERE username = 'admin'", [], (err, row) => {
            if (err) {
                console.error("Error fetching admin user:", err);
            } else if (row) {
                console.log("Admin user found:");
                console.table([row]);
            } else {
                console.log("Admin user NOT found!");
            }
            db.close();
        });
    } catch (error) {
        console.error("Unexpected error:", error);
    }
}

checkUsers();
