const db = require('./config/database');

async function migrate() {
    try {
        console.log("Starting forced migrations...");

        // Delete duplicate circles before adding constraint
        console.log("Cleaning duplicate circles...");
        await new Promise((resolve) => {
            db.run(`
                DELETE FROM circles 
                WHERE circleId NOT IN (
                    SELECT MIN(circleId) 
                    FROM circles 
                    GROUP BY buyerId, circleName
                );
            `, [], (err) => {
                if (err) console.error("Error cleaning circles:", err.message);
                else console.log("Duplicate circles cleaned.");
                resolve();
            });
        });

        // Fix circles unique constraint
        console.log("Adding unique constraint to 'circles'...");
        await new Promise((resolve) => {
            db.run("ALTER TABLE circles ADD CONSTRAINT unique_buyer_circle UNIQUE (buyerId, circleName)", [], (err) => {
                if (err) console.warn("Circles Unique Constraint Warning (Probably already exists):", err.message);
                else console.log("Circles Unique Constraint added.");
                resolve();
            });
        });

        // Fix circle_members primary key
        console.log("Verifying 'circle_members' primary key...");
        await new Promise((resolve) => {
            db.run("ALTER TABLE circle_members ADD PRIMARY KEY (circleId, supplierId)", [], (err) => {
                if (err) console.warn("Circle Members PK Warning:", err.message);
                else console.log("Circle Members PK added.");
                resolve();
            });
        });

        // Fix circle_workflows primary key
        console.log("Verifying 'circle_workflows' primary key...");
        await new Promise((resolve) => {
            db.run("ALTER TABLE circle_workflows ADD PRIMARY KEY (circleId, workflowId)", [], (err) => {
                if (err) console.warn("Circle Workflows PK Warning:", err.message);
                else console.log("Circle Workflows PK added.");
                resolve();
            });
        });

        console.log("Migrations completed.");
        process.exit(0);
    } catch (err) {
        console.error("Migration fatal error:", err);
        process.exit(1);
    }
}

migrate();
