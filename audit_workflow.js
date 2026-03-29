const db = require('./config/database');

async function auditWorkflow() {
    try {
        console.log("Auditing Workflow Steps...");

        // 1. Get default workflow
        db.get("SELECT * FROM workflows WHERE isDefault = true OR name = 'Default Supplier Onboarding' LIMIT 1", [], (err, workflow) => {
            if (err || !workflow) {
                console.log("Default workflow not found, checking all workflows...");
                db.all("SELECT * FROM workflows", [], (err, ws) => {
                    if (ws) ws.forEach(w => console.log(`Workflow: ID=${w.workflowid}, Name=${w.name}`));
                    process.exit(0);
                });
                return;
            }

            const wid = workflow.workflowid || workflow.workflowId;
            console.log(`Auditing Workflow ID: ${wid}, Name: ${workflow.name}`);

            // 2. Get steps
            db.all("SELECT * FROM workflow_steps WHERE workflowid = ? ORDER BY steporder ASC", [wid], (err, steps) => {
                if (err) console.error(err);
                if (steps) {
                    steps.forEach(s => {
                        console.log(`  Step ${s.steporder}: ${s.stepname} (Role: ${s.assignedroleid}, User: ${s.assigneduserid})`);
                    });
                }

                // 3. Check Buyer Roles
                db.all("SELECT * FROM buyer_roles", [], (err, roles) => {
                    if (roles) {
                        console.log("Buyer Roles:");
                        roles.forEach(r => console.log(`  ID=${r.roleid}: ${r.rolename}`));
                    }
                    process.exit(0);
                });
            });
        });
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

auditWorkflow();
