const db = require('./config/database');

(async () => {
    try {
        db.all("SELECT * FROM invitations WHERE email LIKE 'single_level_sup_%' ORDER BY createdat DESC LIMIT 5", [], (err, rows) => {
            if (err) {
                console.error("DB Error:", err);
            } else {
                console.log("Invitations:", JSON.stringify(rows, null, 2));
            }
            process.exit(0);
        });
    } catch (e) {
        console.error("Failed:", e);
        process.exit(1);
    }
})();
