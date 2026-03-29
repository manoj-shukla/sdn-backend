const db = require('./config/database');

async function checkStatus() {
    try {
        console.log("Checking latest supplier status...");

        // 1. Get latest supplier
        db.get("SELECT * FROM suppliers ORDER BY supplierid DESC LIMIT 1", [], (err, supplier) => {
            if (err) {
                console.error("Error fetching supplier:", err);
                process.exit(1);
            }
            if (!supplier) {
                console.log("No suppliers found.");
                process.exit(0);
            }

            const sid = supplier.supplierid || supplier.supplierId;
            console.log(`Latest Supplier: ID=${sid}, Name=${supplier.legalname || supplier.legalName}, Status=${supplier.approvalstatus || supplier.approvalStatus}`);

            // 2. Get latest workflow instance for this supplier
            db.get("SELECT * FROM workflow_instances WHERE supplierid = ? OR supplierId = ? ORDER BY instanceid DESC LIMIT 1", [sid, sid], (err, instance) => {
                if (err) console.error("Error fetching workflow instance:", err);
                if (instance) {
                    const instId = instance.instanceid || instance.instanceId;
                    console.log(`Workflow Instance: ID=${instId}, Status=${instance.status}`);

                    // 3. Get step instances
                    db.all("SELECT * FROM step_instances WHERE instanceid = ? OR instanceId = ? ORDER BY steporder ASC", [instId, instId], (err, steps) => {
                        if (err) console.error("Error fetching steps:", err);
                        console.log("Steps:");
                        steps.forEach(s => {
                            console.log(`  Step ${s.steporder}: ${s.status} (By User: ${s.actionbyuserid})`);
                        });
                        process.exit(0);
                    });
                } else {
                    console.log("No workflow instance found for this supplier.");
                    process.exit(0);
                }
            });
        });
    } catch (e) {
        console.error("Script failed:", e);
        process.exit(1);
    }
}

checkStatus();
