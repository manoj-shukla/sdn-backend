const db = require('../config/database');

// Map step names to the review scope a user should see in the UI
function determineReviewScope(stepName = '') {
    const name = stepName.toLowerCase();
    if (name.includes('compliance')) return 'COMPLIANCE';
    if (name.includes('finance')) return 'FINANCE';
    if (name.includes('ap') || name.includes('payable')) return 'AP';
    if (name.includes('procurement') || name.includes('inviter') || name.includes('requestor')) return 'PROCUREMENT';
    return 'GENERAL';
}

// Map a step's scope to the field roles emitted by ChangeRequestService.getFieldRole
// Used to filter supplier_change_items so approvers only see items relevant to their step.
function stepScopeToFieldRole(stepName = '') {
    const scope = determineReviewScope(stepName);
    switch (scope) {
        case 'COMPLIANCE': return 'Compliance';
        case 'FINANCE': return 'Finance';
        case 'AP': return 'AP';
        case 'PROCUREMENT': return 'Procurement';
        default: return null;
    }
}

// Filter a list of supplier_change_items down to those belonging to the step's scope.
// Returns the input unchanged when scope is unknown (GENERAL) so we don't accidentally hide work.
function filterItemsByStepScope(items, stepName) {
    if (!Array.isArray(items) || items.length === 0) return items || [];
    const targetRole = stepScopeToFieldRole(stepName);
    if (!targetRole) return items;
    const ChangeRequestService = require('./ChangeRequestService');
    return items.filter(i => {
        const fieldRole = ChangeRequestService.getFieldRole(i.fieldName || i.fieldname);
        return fieldRole && fieldRole.toLowerCase() === targetRole.toLowerCase();
    });
}

class WorkflowService {
    // --- Roles ---
    static async createRole(buyerId, roleName, description, permissions) {
        return new Promise((resolve, reject) => {
            db.get(`INSERT INTO buyer_roles (buyerid, rolename, description, permissions) VALUES (?, ?, ?, ?) RETURNING roleid, buyerid, rolename, description, permissions`,
                [buyerId, roleName, description, JSON.stringify(permissions)],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
    }

    static async getRoles(buyerId) {
        return new Promise((resolve, reject) => {
            db.all(`SELECT roleid, buyerid, rolename, description, permissions FROM buyer_roles WHERE buyerid = ?`, [buyerId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    static async deleteRole(roleId) {
        return new Promise((resolve, reject) => {
            // Check if any user is assigned to this role
            db.get("SELECT rolename FROM buyer_roles WHERE roleid = ?", [roleId], (err, role) => {
                if (err) return reject(err);
                if (!role) return resolve(); // Already gone

                db.get("SELECT COUNT(*) as count FROM sdn_users WHERE subrole = $1", [role.rolename], (err, user) => {
                    if (err) return reject(err);
                    if (user && parseInt(user.count) > 0) {
                        const error = new Error(`Cannot delete role: ${user.count} user(s) are assigned to it.`);
                        error.status = 400;
                        return reject(error);
                    }

                    // Check workflow steps
                    db.get("SELECT COUNT(*) as count FROM workflow_steps WHERE assignedroleid = ?", [roleId], (err, step) => {
                        if (err) return reject(err);
                        if (step && parseInt(step.count) > 0) {
                            const error = new Error("Cannot delete role: It is being used in an active workflow step.");
                            error.status = 400;
                            return reject(error);
                        }

                        db.run("DELETE FROM buyer_roles WHERE roleid = ?", [roleId], (err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    });
                });
            });
        });
    }

    static async seedDefaults(buyerId) {
        const roles = [
            { name: "Buyer Admin", desc: "Full system access and configuration.", perms: ["ALL"] },
            { name: "Supplier Inviter / Requestor", desc: "Can invite suppliers and initiate workflows.", perms: ["CAN_INVITE", "VIEW_WORKFLOWS"] },
            { name: "Procurement Reviewer", desc: "Initial review of supplier capability and strategic fit.", perms: ["CAN_APPROVE", "CAN_REJECT", "VIEW_WORKFLOWS"] },
            { name: "Compliance Reviewer", desc: "Checks legal, risk, and compliance requirements.", perms: ["CAN_APPROVE", "CAN_REJECT", "VIEW_WORKFLOWS"] },
            { name: "Finance Approver", desc: "Validates financial details and budget.", perms: ["CAN_APPROVE", "CAN_REJECT", "VIEW_WORKFLOWS"] },
            { name: "Accounts Payable (AP) Activator", desc: "Final verification and ERP entry.", perms: ["CAN_APPROVE", "CAN_REJECT", "VIEW_WORKFLOWS"] }
        ];

        console.log(`[Seeding] Creating default roles for Buyer ${buyerId}...`);

        const roleMap = {};

        // 1. Create Roles
        for (const role of roles) {
            try {
                // Check if role exists first to avoid duplicates/errors on re-seed
                const existing = await new Promise(resolve => {
                    db.get("SELECT roleid FROM buyer_roles WHERE buyerid = ? AND rolename = ?", [buyerId, role.name], (err, row) => resolve(row));
                });

                if (existing) {
                    roleMap[role.name] = existing.roleid || existing.roleId;
                } else {
                    const res = await this.createRole(buyerId, role.name, role.desc, role.perms);
                    roleMap[role.name] = res.roleid || res.roleId;
                }
            } catch (e) {
                console.error(`Failed to seed role ${role.name}:`, e.message);
            }
        }

        // 2. Create Default Workflow "Standard Supplier Onboarding"
        // Steps: Procurement -> Compliance -> Finance -> AP (Optional)
        const steps = [
            { stepOrder: 1, stepName: "Procurement Review", assignedRoleId: roleMap["Procurement Reviewer"], isOptional: false },
            { stepOrder: 2, stepName: "Compliance Check", assignedRoleId: roleMap["Compliance Reviewer"], isOptional: false },
            { stepOrder: 3, stepName: "Finance Validation", assignedRoleId: roleMap["Finance Approver"], isOptional: false },
            { stepOrder: 4, stepName: "AP Activation", assignedRoleId: roleMap["Accounts Payable (AP) Activator"], isOptional: true }
        ];

        // Filter out any steps where role creation failed
        const validSteps = steps.filter(s => s.assignedRoleId);

        if (validSteps.length > 0) {
            console.log(`[Seeding] Creating default workflow for Buyer ${buyerId}...`);

            // Check if workflow exists
            const existingWf = await new Promise(resolve => {
                db.get("SELECT workflowid FROM workflows WHERE buyerid = ? AND name = ?", [buyerId, "Standard Supplier Onboarding"], (err, row) => resolve(row));
            });

            let workflowId;
            if (existingWf) {
                workflowId = existingWf.workflowid || existingWf.workflowId;
                console.log(`[Seeding] Workflow 'Standard Supplier Onboarding' already exists (${workflowId})`);

                // Update steps to ensure isOptional is correct
                for (const step of validSteps) {
                    await new Promise(res => {
                        db.run("UPDATE workflow_steps SET isoptional = ? WHERE workflowid = ? AND stepname = ?",
                            [step.isOptional, workflowId, step.stepName], () => res());
                    });
                }
            } else {
                const wf = await this.createWorkflow(buyerId, "Standard Supplier Onboarding", "Default approval chain (Procurement -> Compliance -> Finance -> AP-Optional)", validSteps);
                workflowId = wf.workflowId;
            }

            // Mark as default and system-enforced workflow
            if (workflowId) {
                await this.setDefaultWorkflow(buyerId, workflowId);
                // Mark as system-enforced (cannot be deactivated by admins)
                await new Promise(res => {
                    db.run("UPDATE workflows SET issystemenforced = TRUE WHERE workflowid = ?", [workflowId], () => res());
                });
                console.log(`[Seeding] Marked workflow ${workflowId} as default and system-enforced for Buyer ${buyerId}`);
            }
        }
    }

    // --- Workflows ---
    static async createWorkflow(buyerId, name, description, steps = []) {
        console.log(`[WorkflowService] Creating workflow: "${name}" for Buyer ${buyerId} with ${steps.length} steps`);

        return new Promise(async (resolve, reject) => {
            try {
                // Validation
                if (!steps || steps.length === 0) {
                    return reject(new Error("Workflow must have steps"));
                }
                const orders = steps.map(s => s.stepOrder || s.order);
                if (new Set(orders).size !== orders.length) {
                    return reject(new Error("Duplicate step orders are not allowed"));
                }

                // Check if workflow with same name exists for this buyer
                const existing = await new Promise(res => {
                    db.get("SELECT workflowid FROM workflows WHERE buyerid = ? AND name = ?", [buyerId, name], (err, row) => res(row));
                });

                if (existing) {
                    console.log(`[WorkflowService] Workflow "${name}" already exists for Buyer ${buyerId}`);
                    const details = await this.getWorkflowDetails(existing.workflowid || existing.workflowId);
                    return resolve({ ...details, workflowName: details.name });
                }

                db.get(`INSERT INTO workflows (buyerid, name, description) VALUES (?, ?, ?) RETURNING workflowid, name, description`,
                    [buyerId, name, description],
                    async (err, workflow) => {
                        if (err) {
                            console.error(`[WorkflowService] Error creating workflow:`, err.message);
                            return reject(err);
                        }

                        const workflowId = workflow.workflowid || workflow.workflowId;
                        if (!workflowId) return reject(new Error("Failed to retrieve workflowId after insert"));

                        console.log(`[WorkflowService] Workflow created: ${workflowId}. Inserting ${steps.length} steps...`);

                        if (steps && steps.length > 0) {
                            const stepPromises = steps.map((step) => {
                                return new Promise((stepResolve, stepReject) => {
                                    db.run(`INSERT INTO workflow_steps (workflowid, stepname, steporder, assignedroleid, requiredactions) VALUES (?, ?, ?, ?, ?)`,
                                        [workflowId, step.stepName, step.stepOrder || step.order, step.assignedRoleId, JSON.stringify(step.requiredActions || [])],
                                        (err) => err ? stepReject(err) : stepResolve()
                                    );
                                });
                            });

                            Promise.all(stepPromises)
                                .then(() => {
                                    console.log(`[WorkflowService] All steps inserted for workflow ${workflowId}`);
                                    resolve({ workflowId, workflowName: name, steps: steps });
                                })
                                .catch(e => {
                                    console.error(`[WorkflowService] Step insertion failed:`, e.message);
                                    reject(e);
                                });
                        } else {
                            reject(new Error("Workflow must have at least one step"));
                        }
                    }
                );
            } catch (err) {
                reject(err);
            }
        });
    }

    static async getWorkflows(buyerId) {
        return new Promise((resolve, reject) => {
            let query = `SELECT 
                    w.workflowid, 
                    w.buyerid, 
                    w.name, 
                    w.description, 
                    w.isactive, 
                    w.isdefault, 
                    w.issystemenforced, 
                    w.clonedfromid, 
                    w.createdat,
                    (SELECT COUNT(*) FROM workflow_steps ws WHERE ws.workflowid = w.workflowid) as stepcount
                FROM workflows w`;

            let params = [];
            if (buyerId) {
                query += ` WHERE w.buyerid = ?`;
                params.push(buyerId);
            }

            db.all(query, params, async (err, rows) => {
                if (err) return reject(err);

                try {
                    const enhancedRows = await Promise.all((rows || []).map(async (wf) => {
                        const steps = await new Promise((res, rej) => {
                            db.all(`SELECT stepid, workflowid, steporder, stepname FROM workflow_steps WHERE workflowid = ? ORDER BY steporder ASC`, [wf.workflowid || wf.workflowId], (e, s) => {
                                if (e) return rej(e);
                                res((s || []).map(step => ({
                                    ...step,
                                    stepId: step.stepid || step.stepId,
                                    workflowId: step.workflowid || step.workflowId,
                                    stepOrder: step.steporder || step.stepOrder,
                                    stepName: step.stepname || step.stepName
                                })));
                            });
                        });
                        return {
                            ...wf,
                            workflowId: wf.workflowid || wf.workflowId,
                            buyerId: wf.buyerid || wf.buyerId,
                            workflowname: wf.name,
                            isActive: !!(wf.isactive || wf.isActive),
                            isDefault: !!(wf.isdefault || wf.isDefault),
                            isSystemEnforced: !!(wf.issystemenforced || wf.isSystemEnforced),
                            clonedFromId: wf.clonedfromid || wf.clonedFromId,
                            createdAt: wf.createdat || wf.createdAt,
                            stepCount: parseInt(wf.stepcount || wf.stepCount || 0),
                            steps
                        };
                    }));
                    resolve(enhancedRows);
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    static async getWorkflowDetails(workflowId) {
        return new Promise((resolve, reject) => {
            db.get(`SELECT workflowid, buyerid, name, description, isactive, isdefault, issystemenforced, clonedfromid FROM workflows WHERE workflowid = ?`, [workflowId], (err, row) => {
                if (err) return reject(err);
                if (!row) return resolve(null);

                const workflow = {
                    ...row,
                    workflowId: row.workflowid || row.workflowId,
                    buyerId: row.buyerid || row.buyerId,
                    isActive: !!(row.isactive || row.isActive),
                    isDefault: !!(row.isdefault || row.isDefault),
                    isSystemEnforced: !!(row.issystemenforced || row.isSystemEnforced),
                    clonedFromId: row.clonedfromid || row.clonedFromId
                };

                db.all(`
                    SELECT 
                        ws.stepid, 
                        ws.workflowid, 
                        ws.steporder, 
                        ws.stepname, 
                        ws.stepdescription, 
                        ws.assignedroleid, 
                        ws.isoptional,
                        br.rolename
                    FROM workflow_steps ws 
                    LEFT JOIN buyer_roles br ON ws.assignedroleid = br.roleid 
                    WHERE ws.workflowid = ? 
                    ORDER BY ws.steporder ASC`,
                    [workflowId],
                    (err, steps) => {
                        if (err) return reject(err);
                        workflow.steps = (steps || []).map(step => ({
                            ...step,
                            stepId: step.stepid || step.stepId,
                            workflowId: step.workflowid || step.workflowId,
                            stepOrder: step.steporder || step.stepOrder,
                            stepName: step.stepname || step.stepName,
                            stepDescription: step.stepdescription || step.stepDescription,
                            assignedRoleId: step.assignedroleid || step.assignedRoleId,
                            isOptional: !!(step.isoptional || step.isOptional),
                            roleName: step.rolename || step.roleName
                        }));
                        resolve(workflow);
                    }
                );
            });
        });
    }

    static async toggleWorkflowStatus(workflowId, isActive) {
        return new Promise((resolve, reject) => {
            // Check if workflow is system-enforced (cannot be deactivated)
            db.get(`SELECT issystemenforced FROM workflows WHERE workflowid = ?`, [workflowId], (err, row) => {
                if (err) return reject(err);

                const isEnforced = row?.issystemenforced || row?.isSystemEnforced;
                if (isEnforced && !isActive) {
                    return reject(new Error("Cannot deactivate system-enforced workflow. This is the mandatory default workflow."));
                }

                db.run(`UPDATE workflows SET isactive = ? WHERE workflowid = ?`, [isActive, workflowId], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });
    }

    // --- Default Workflow Management ---
    static async getDefaultWorkflow(buyerId) {
        return new Promise((resolve, reject) => {
            db.get(`SELECT * FROM workflows WHERE buyerid = ? AND isdefault = TRUE`, [buyerId], (err, row) => {
                if (err) return reject(err);
                if (!row) return resolve(null);
                resolve({
                    workflowId: row.workflowid || row.workflowId,
                    buyerId: row.buyerid || row.buyerId,
                    name: row.name,
                    description: row.description,
                    isActive: row.isactive || row.isActive || false,
                    isDefault: row.isdefault || row.isDefault || false
                });
            });
        });
    }

    static async setDefaultWorkflow(buyerId, workflowId) {
        return new Promise((resolve, reject) => {
            // First, unset any existing default for this buyer
            db.run(`UPDATE workflows SET isdefault = FALSE WHERE buyerid = ?`, [buyerId], (err) => {
                if (err) return reject(err);
                // Then set the new default
                db.run(`UPDATE workflows SET isdefault = TRUE WHERE workflowid = ? AND buyerid = ?`, [workflowId, buyerId], (err) => {
                    if (err) reject(err);
                    else resolve({ success: true, message: `Workflow ${workflowId} set as default` });
                });
            });
        });
    }

    static async assignWorkflowToSupplier(supplierId, workflowId) {
        return new Promise((resolve, reject) => {
            db.run(`UPDATE suppliers SET assignedworkflowid = ? WHERE supplierid = ?`, [workflowId, supplierId], (err) => {
                if (err) reject(err);
                else resolve({ success: true, message: `Workflow ${workflowId} assigned to supplier ${supplierId}` });
            });
        });
    }

    static async getSupplierWorkflow(supplierId, buyerId) {
        // Returns the workflow to use for a supplier: assigned workflow if set, otherwise default
        return new Promise((resolve, reject) => {
            db.get(`SELECT assignedworkflowid FROM suppliers WHERE supplierid = ?`, [supplierId], async (err, supplier) => {
                if (err) return reject(err);

                const assignedId = supplier?.assignedworkflowid || supplier?.assignedWorkflowId;
                if (assignedId) {
                    // Supplier has a custom assigned workflow
                    db.get(`SELECT workflowid FROM workflows WHERE workflowid = ? AND isactive = TRUE`, [assignedId], (err, wf) => {
                        if (err) reject(err);
                        else resolve(wf ? (wf.workflowid || wf.workflowId) : null);
                    });
                } else {
                    // Use default workflow for buyer
                    const defaultWf = await this.getDefaultWorkflow(buyerId);
                    if (defaultWf && defaultWf.isActive !== false) {
                        resolve(defaultWf.workflowId);
                    } else {
                        // Fallback: get first active workflow
                        db.get(`SELECT workflowid FROM workflows WHERE buyerid = ? AND isactive = TRUE LIMIT 1`, [buyerId], (err, wf) => {
                            if (err) reject(err);
                            else resolve(wf ? (wf.workflowid || wf.workflowId) : null);
                        });
                    }
                }
            });
        });
    }

    // --- Execution ---
    static async initiateWorkflow(supplierId, workflowId, submissionType = 'INITIAL') {
        console.log(`[DEBUG-WORKFLOW] initiateWorkflow - supplierId: ${supplierId}, workflowId: ${workflowId}, type: ${submissionType}`);
        // 0. Check for existing active workflow (Prevent Duplicates) — includes REWORK_REQUIRED state
        const existingInstance = await new Promise((resolve, reject) => {
            db.get(
                `SELECT instanceid FROM workflow_instances WHERE supplierid = ? AND status IN ('PENDING', 'REWORK_REQUIRED')`,
                [supplierId],
                (err, row) => err ? reject(err) : resolve(row)
            );
        });

        if (existingInstance) {
            const instanceId = existingInstance.instanceid || existingInstance.instanceId;
            console.log(`[Workflow] Resuming existing workflow ${instanceId} for supplier ${supplierId}. Resetting for ${submissionType}`);

            // Reset workflow instance back to active PENDING state
            await new Promise((resolve, reject) => {
                db.run(
                    `UPDATE workflow_instances SET status = 'PENDING', submissiontype = ?, completedat = NULL WHERE instanceid = ?`,
                    [submissionType, instanceId],
                    (err) => err ? reject(err) : resolve()
                );
            });

            // Reset all step instances: first step back to PENDING, rest back to WAITING
            await new Promise((resolve, reject) => {
                db.run(
                    `UPDATE step_instances SET status = CASE WHEN steporder = 1 THEN 'PENDING' ELSE 'WAITING' END,
                        actionbyuserid = NULL, actionat = NULL, comments = NULL
                     WHERE instanceid = ?`,
                    [instanceId],
                    (err) => err ? reject(err) : resolve()
                );
            });

            // Reset currentsteporder to 1 so approval restarts from first step
            await new Promise((resolve, reject) => {
                db.run(
                    `UPDATE workflow_instances SET currentsteporder = 1 WHERE instanceid = ?`,
                    [instanceId],
                    (err) => err ? reject(err) : resolve()
                );
            });

            return instanceId;
        }

        // 1. Get Template & Steps
        const stepsRaw = await new Promise((resolve, reject) => {
            db.all(`SELECT * FROM workflow_steps WHERE workflowid = ? ORDER BY steporder ASC`, [workflowId], (err, r) => err ? reject(err) : resolve(r));
        });

        console.log(`[DEBUG-WORKFLOW] Found ${stepsRaw ? stepsRaw.length : 0} steps for workflow ${workflowId}`);

        const steps = (stepsRaw || []).map(s => ({
            stepOrder: s.steporder || s.stepOrder,
            stepName: s.stepname || s.stepName,
            assignedRoleId: s.assignedroleid || s.assignedRoleId,
            isOptional: s.isoptional || s.isOptional || false
        }));

        if (steps.length === 0) {
            console.error(`[DEBUG-WORKFLOW] FAILED: Workflow ${workflowId} has no steps!`);
            throw new Error("Workflow has no steps");
        }

        // 2. Create Instance
        return new Promise((resolve, reject) => {
            console.log(`[DEBUG-WORKFLOW] Creating instance for supplier ${supplierId}, template ${workflowId}`);
            db.get(`INSERT INTO workflow_instances (supplierid, workflowtemplateid, currentsteporder, status, submissiontype) VALUES (?, ?, 1, 'PENDING', ?) RETURNING instanceid`,
                [supplierId, workflowId, submissionType],
                async (err, row) => {
                    if (err) {
                        console.error(`[DEBUG-WORKFLOW] FAILED INSERT instance:`, err.message);
                        return reject(err);
                    }
                    const instanceId = row.instanceid || row.instanceId;
                    console.log(`[DEBUG-WORKFLOW] SUCCESS INSERT instance. ID: ${instanceId}`);

                    // 3. Create Step Instances (Snapshot)
                    try {
                        for (const step of steps) {
                            console.log(`[DEBUG-WORKFLOW] Creating step instance: ${step.stepName} (Order: ${step.stepOrder})`);
                            await new Promise((res, rej) => {
                                db.run(`INSERT INTO step_instances (instanceid, steporder, stepname, assignedroleid, status, isoptional) VALUES (?, ?, ?, ?, ?, ?)`,
                                    [instanceId, step.stepOrder, step.stepName, step.assignedRoleId, step.stepOrder === 1 ? 'PENDING' : 'WAITING', step.isOptional],
                                    (e) => e ? rej(e) : res()
                                );
                            });
                        }
                        resolve(instanceId);
                    } catch (e) {
                        console.error(`[DEBUG-WORKFLOW] FAILED step instances:`, e.message);
                        reject(e);
                    }
                }
            );
        });
    }

    /**
     * Parallel Update Workflow
     * Initiates fixed steps for profile updates, all starting in PENDING status.
     */
    static async initiateUpdateWorkflow(supplierId, buyerId, roleKeywords = null) {
        // 1. Define required roles for parallel review
        let baseRoles = ['Procurement Reviewer', 'Finance Reviewer', 'Compliance Reviewer', 'AP Admin'];
        let roleNames = baseRoles;

        if (roleKeywords && roleKeywords.length > 0) {
            // Handle special cases
            const normalizedKeywords = roleKeywords.map(k => k.toLowerCase());
            
            if (normalizedKeywords.includes('shared')) {
                // Documents or shared fields: Compliance and Procurement usually handle these
                roleNames = baseRoles.filter(rn => rn.includes('Compliance') || rn.includes('Procurement'));
            } else if (normalizedKeywords.includes('admin')) {
                roleNames = baseRoles; // Keep all for admin-level changes
            } else {
                // Filter by specific keywords (Finance, AP, etc.)
                roleNames = baseRoles.filter(rn => 
                    normalizedKeywords.some(kw => rn.toLowerCase().includes(kw))
                );
            }
        }

        // If filtering resulted in no roles, fallback to Procurement
        if (roleNames.length === 0) roleNames = ['Procurement Reviewer'];

        const placeholders = roleNames.map(() => 'LOWER(?)').join(',');

        // 2. Resolve Role IDs for this buyer
        const roles = await new Promise((resolve, reject) => {
            const conditions = roleNames.map(() => 'LOWER(roleName) LIKE ?').join(' OR ');
            db.all(
                `SELECT roleid, rolename FROM buyer_roles WHERE buyerid = ? AND (${conditions})`,
                [buyerId, ...roleNames.map(r => `%${r.split(' ')[0].toLowerCase()}%`)],
                (err, rows) => err ? reject(err) : resolve(rows)
            );
        });

        // 3. Create Instance
        return new Promise((resolve, reject) => {
            db.get(`INSERT INTO workflow_instances (supplierid, workflowtemplateid, currentsteporder, status, submissiontype) VALUES (?, 0, 1, 'PENDING', 'UPDATE') RETURNING instanceid`,
                [supplierId],
                async (err, row) => {
                    if (err) return reject(err);
                    const instanceId = row.instanceid || row.instanceId || row.instanceID;

                    // 4. Create Step Instances in parallel (all PENDING)
                    const stepPromises = roles.map(role => {
                        const rName = (role.rolename || role.roleName || '').toLowerCase();
                        const stepName = rName.includes('procurement') ? 'Procurement Review' :
                            rName.includes('finance') ? 'Finance Review' :
                                rName.includes('compliance') ? 'Compliance Review' : 'AP Activation';

                        return new Promise((res, rej) => {
                            db.run(`INSERT INTO step_instances (instanceid, steporder, stepname, assignedroleid, status, isoptional) VALUES (?, ?, ?, ?, ?, ?)`,
                                [instanceId, 1, stepName, role.roleid || role.roleId, 'PENDING', false],
                                (e) => e ? rej(e) : res()
                            );
                        });
                    });

                    await Promise.all(stepPromises);
                    console.log(`[Workflow] Initiated parallel UPDATE workflow ${instanceId} for supplier ${supplierId} with ${roles.length} roles found.`);
                    resolve(instanceId);
                }
            );
        });
    }

    static async getExecutionDetails(instanceId) {
        return new Promise((resolve, reject) => {
            db.get(`
                SELECT 
                    wi.instanceId as "executionId",
                    wi.instanceId as "instanceId",
                    wi.supplierId as "supplierId",
                    wi.workflowTemplateId as "workflowId",
                    wi.currentStepOrder as "currentStepOrder",
                    wi.status as "status",
                    wi.submissionType as "submissionType",
                    wi.startedAt as "startedAt",
                    wi.completedAt as "completedAt",
                    w.name as "workflowName",
                    s.legalName as "supplierName"
                FROM workflow_instances wi
                JOIN workflows w ON wi.workflowtemplateid = w.workflowid
                JOIN suppliers s ON wi.supplierid = s.supplierid
                WHERE wi.instanceid = ?
            `, [instanceId], (err, row) => {
                if (err) return reject(err);
                if (!row) return resolve(null);

                // Handle lowercase keys from Postgres
                const instance = {
                    executionId: row.executionid || row.instanceid || row.instanceId,
                    instanceId: row.instanceid || row.instanceId,
                    supplierId: row.supplierid || row.supplierId,
                    workflowId: row.workflowid || row.workflowTemplateId || row.workflowtemplateid,
                    currentStepOrder: parseInt(row.currentsteporder || row.currentStepOrder),
                    status: row.status,
                    submissionType: row.submissiontype || row.submissionType,
                    startedAt: row.startedat || row.startedAt,
                    completedAt: row.completedat || row.completedAt,
                    rejectedAt: row.status === 'REJECTED' ? (row.completedat || row.completedAt) : null,
                    workflowName: row.workflowname || row.workflowName,
                    supplierName: row.suppliername || row.supplierName
                };

                db.all(`
                    SELECT 
                        si.stepInstanceId as "stepInstanceId",
                        si.stepOrder as "stepOrder",
                        si.stepName as "stepName",
                        si.assignedRoleId as "assignedRoleId",
                        si.status as "status",
                        si.isOptional as "isOptional",
                        si.actionByUserId as "actionByUserId",
                        si.actionAt as "actionAt",
                        si.comments as "comments",
                        u.username as "actionByUsername",
                        u.subrole as "actionByRole"
                    FROM step_instances si
                    LEFT JOIN sdn_users u ON si.actionbyuserid = u.userid
                    WHERE si.instanceid = ?
                    ORDER BY si.steporder ASC
                `, [instanceId], (err, stepsRaw) => {
                    if (err) return reject(err);

                    const steps = (stepsRaw || []).map(s => ({
                        stepInstanceId: s.stepinstanceid || s.stepInstanceId,
                        stepOrder: parseInt(s.steporder || s.stepOrder),
                        stepName: s.stepname || s.stepName,
                        assignedRoleId: s.assignedroleid || s.assignedRoleId,
                        status: s.status,
                        isOptional: s.isoptional || s.isOptional || false,
                        actionByUsername: s.actionbyusername || s.actionByUsername,
                        actionByRole: s.actionbyrole || s.actionByRole,
                        actionAt: s.actionat || s.actionAt,
                        comments: s.comments
                    }));

                    instance.steps = steps;
                    const currentStep = steps.find(s => s.stepOrder === instance.currentStepOrder);
                    if (currentStep) instance.currentStepName = currentStep.stepName || currentStep.stepname;
                    resolve(instance);
                });
            });
        });
    }

    static async getExecutions(buyerId, filters = {}) {
        return new Promise((resolve, reject) => {
            let sql = `
                SELECT 
                    wi.instanceId as "instanceId",
                    wi.supplierId as "supplierId",
                    wi.workflowTemplateId as "workflowId",
                    wi.currentStepOrder as "currentStepOrder",
                    wi.status as "status",
                    wi.submissionType as "submissionType",
                    wi.startedAt as "startedAt",
                    wi.completedAt as "completedAt",
                    w.name as "workflowName",
                    s.legalName as "supplierName"
                FROM workflow_instances wi
                JOIN workflows w ON wi.workflowtemplateid = w.workflowid
                JOIN suppliers s ON wi.supplierid = s.supplierid
                WHERE w.buyerid = ?
            `;
            const params = [buyerId];

            if (filters.status) {
                let statusFilter = filters.status.toUpperCase();
                if (statusFilter === 'IN_PROGRESS') statusFilter = 'PENDING';
                sql += ` AND wi.status = ?`;
                params.push(statusFilter);
            }

            if (filters.supplierId) {
                sql += ` AND wi.supplierid = ?`;
                params.push(filters.supplierId);
            }

            db.all(sql, params, (err, rows) => {
                if (err) return reject(err);
                resolve((rows || []).map(r => ({
                    executionId: r.instanceId || r.instanceid,
                    instanceId: r.instanceId || r.instanceid,
                    supplierId: r.supplierId || r.supplierid,
                    workflowId: r.workflowId || r.workflowid,
                    currentStepOrder: parseInt(r.currentStepOrder || r.currentsteporder || 0),
                    status: r.status,
                    submissionType: r.submissionType || r.submissiontype,
                    startedAt: r.startedAt || r.startedat,
                    completedAt: r.completedAt || r.completedat,
                    workflowName: r.workflowName || r.workflowname,
                    supplierName: r.supplierName || r.suppliername
                })));
            });
        });
    }

    static async getPendingTasks(tokenUser) {
        console.log("DEBUG: getPendingTasks tokenUser:", JSON.stringify(tokenUser));

        // REFRESH ROLE FROM DB (Crucial for Sandbox Mode switching)
        const user = await new Promise((resolve) => {
            db.get("SELECT role, subrole, buyerid FROM sdn_users WHERE userid = ?", [tokenUser.userId], (err, row) => {
                if (err || !row) resolve(tokenUser); // Fallback to token if error
                else {
                    // Normalize: use DB values, prefer lowercase from postgres
                    const refreshedUser = {
                        ...tokenUser,
                        subRole: row.subrole || row.subRole || tokenUser.subRole,
                        buyerId: row.buyerid || row.buyerId || tokenUser.buyerId
                    };
                    console.log(`[WorkflowService.getPendingTasks] userId: ${tokenUser.userId}, buyerId: ${refreshedUser.buyerId}, subRole: ${refreshedUser.subRole}`);
                    resolve(refreshedUser);
                }
            });
        });

        console.log("DEBUG: getPendingTasks Refresh User:", JSON.stringify(user));

        // Early return if no buyerId - can't query workflows without it
        if (!user.buyerId) {
            console.log("DEBUG: No buyerId found for user, returning empty tasks");
            return [];
        }

        return new Promise((resolve, reject) => {
            // Admin/B. Admin -> see all pending tasks for their buyerId
            // Platform super admin (role === 'ADMIN') also gets elevated visibility
            // Sandbox mode: any user sees all tasks (so testers can simulate each role in sequence)
            const isElevated = user.role === 'ADMIN' || user.subRole === 'Admin' || user.subRole === 'Buyer Admin' || user.isSandboxActive === true;

            console.log("DEBUG: isElevated:", isElevated, "subRole:", user.subRole);

            if (isElevated) {
                const sql = `
                    SELECT 
                        si.stepinstanceid, si.instanceid, si.steporder, si.stepname, si.status, si.assignedroleid,
                        CASE WHEN wi.workflowtemplateid = 0 THEN 'Change Request' ELSE w.name END as "workflowName", 
                        s.legalname as "supplierName", s.supplierid as "supplierId", 
                        s.bankname as "bankName", s.accountnumber as "accountNumber", s.taxid as "taxId", s.isgstregistered as "isGstRegistered", s.gstin,
                        s.country, s.website, s.description,
                        wi.startedat as "startedAt", wi.submissiontype as "submissionType",
                        (
                            SELECT json_agg(json_build_object(
                                'documentId', d.documentid,
                                'documentType', d.documenttype,
                                'documentName', d.documentname,
                                'fileUrl', d.filepath,
                                'verificationStatus', d.verificationstatus
                            )) FROM documents d WHERE d.supplierid = s.supplierid
                        ) as documents,
                        (
                            SELECT json_agg(json_build_object(
                                'addressId', a.addressid,
                                'addressType', a.addresstype,
                                'addressLine1', a.addressline1,
                                'addressLine2', a.addressline2,
                                'city', a.city,
                                'state', a.stateprovince,
                                'postalCode', a.postalcode,
                                'country', a.country,
                                'isPrimary', a.isprimary
                            )) FROM addresses a WHERE a.supplierid = s.supplierid
                        ) as addresses,
                        (
                            SELECT json_agg(json_build_object(
                                'contactId', c.contactid,
                                'contactType', c.contacttype,
                                'firstName', c.firstname,
                                'lastName', c.lastname,
                                'email', c.email,
                                'phone', c.phone,
                                'isPrimary', c.isprimary,
                                'designation', c.designation
                            )) FROM contacts c WHERE c.supplierid = s.supplierid
                        ) as contacts,
                        (
                            SELECT json_agg(json_build_object(
                                'itemId', sci.itemid,
                                'fieldName', sci.fieldname,
                                'oldValue', sci.oldvalue,
                                'newValue', sci.newvalue,
                                'changeCategory', sci.changecategory,
                                'status', sci.status
                            )) 
                            FROM supplier_change_items sci
                            JOIN supplier_change_requests scr ON sci.requestid = scr.requestid
                            WHERE scr.supplierid = s.supplierid 
                            AND scr.status = 'PENDING'
                            AND sci.status = 'PENDING'
                        ) as items
                    FROM step_instances si
                    JOIN workflow_instances wi ON si.instanceid = wi.instanceid
                    LEFT JOIN workflows w ON wi.workflowtemplateid = w.workflowid
                    JOIN suppliers s ON wi.supplierid = s.supplierid
                    WHERE si.status = 'PENDING' AND wi.status = 'PENDING'
                    AND (w.buyerid = ? OR (wi.workflowtemplateid = 0 AND s.buyerid = ?))
                `;
                db.all(sql, [user.buyerId, user.buyerId], async (err, rows) => {
                    try {
                        if (err) {
                            console.error(`[WorkflowService] db.all ERROR (Elevated): ${err.message}`);
                            return reject(err);
                        }
                        console.log(`[WorkflowService] db.all success (Elevated). Rows: ${rows?.length}`);
                        const mapped = (rows || []).map(r => {
                            const task = {
                                stepInstanceId: r.stepInstanceId || r.stepinstanceid,
                                executionId: r.instanceId || r.instanceid,
                                instanceId: r.instanceId || r.instanceid,
                                stepOrder: r.stepOrder || r.steporder,
                                stepName: r.stepName || r.stepname,
                                status: r.status,
                                assignedRoleId: r.assignedRoleId || r.assignedroleid,
                                workflowName: r.workflowName || r.workflowname,
                                supplierName: r.supplierName || r.suppliername,
                                supplierId: r.supplierId || r.supplierid,
                                bankName: r.bankName || r.bankname,
                                accountNumber: r.accountNumber || r.accountnumber,
                                taxId: r.taxId || r.taxid,
                                isGstRegistered: (r.isGstRegistered !== undefined ? r.isGstRegistered : r.isgstregistered) === 1 || r.isGstRegistered === true || r.isgstregistered === true,
                                gstin: r.gstin,
                                website: r.website || r.Website || r.WEBSITE,
                                description: r.description || r.Description || r.DESCRIPTION,
                                country: r.country || r.Country || r.COUNTRY,
                                startedAt: r.startedAt || r.startedat,
                                submissionType: r.submissionType || r.submissiontype || 'INITIAL',
                                isChangeRequest: (r.submissionType || r.submissiontype) === 'UPDATE',
                                documents: typeof r.documents === 'string' ? JSON.parse(r.documents) : (r.documents || []),
                                addresses: typeof r.addresses === 'string' ? JSON.parse(r.addresses) : (r.addresses || []),
                                contacts: typeof r.contacts === 'string' ? JSON.parse(r.contacts) : (r.contacts || []),
                                items: (() => {
                                    const parsed = typeof r.items === 'string' ? JSON.parse(r.items) : (r.items || []);
                                    // Scope items so each step only shows the changes it's responsible for.
                                    return filterItemsByStepScope(parsed, r.stepName || r.stepname);
                                })(),
                                reviewScope: determineReviewScope(r.stepName || r.stepname)
                            };
                            return task;
                        });
                        console.log(`[WorkflowService] Mapped ${mapped.length} tasks (Elevated)`);
                        resolve(mapped);
                    } catch (e) {
                        console.error("[WorkflowService] Critical Error in getPendingTasks (Elevated):", e);
                        reject(e);
                    }
                });
            } else {
                // Map generic roles to potential DB specific role names (handle variations like 'Reviewer' vs 'Approver')
                let dbRoleNames = [user.subRole];
                const subRoleLower = (user.subRole || '').toLowerCase();

                if (subRoleLower.includes('finance')) dbRoleNames = ['Finance Approver', 'Finance Reviewer', 'Finance'];
                else if (subRoleLower.includes('compliance')) dbRoleNames = ['Compliance Reviewer', 'Compliance Approver', 'Compliance'];
                else if (subRoleLower.includes('procurement')) dbRoleNames = ['Procurement Approver', 'Procurement Reviewer', 'Procurement', 'Supplier Inviter / Requestor'];
                else if (subRoleLower === 'ap' || subRoleLower === 'accounts payable' || subRoleLower.startsWith('ap ')) dbRoleNames = ['Accounts Payable (AP) Activator', 'AP Admin', 'AP'];
                console.log(`DEBUG [getPendingTasks]: User subRole='${user.subRole}' mapped to dbRoleNames=[${dbRoleNames.join(', ')}], buyerId=${user.buyerId}`);

                // Regular users see only tasks assigned to their subRole (mapped via roleName)
                // We construct the placeholders for the IN clause
                const lowerRoleNames = dbRoleNames.map(n => n.toLowerCase());
                const placeholders = lowerRoleNames.map(() => '?').join(',');

                const sql = `
                    SELECT 
                        si.stepinstanceid as "stepInstanceId", 
                        si.instanceid as "instanceId", 
                        si.steporder as "stepOrder", 
                        si.stepname as "stepName", 
                        si.status as "status", 
                        si.assignedroleid as "assignedRoleId",
                        CASE WHEN wi.workflowtemplateid = 0 THEN 'Change Request' ELSE w.name END as "workflowName", 
                        s.legalname as "supplierName", 
                        s.supplierid as "supplierId", 
                        s.bankname as "bankName", 
                        s.accountnumber as "accountNumber", 
                        s.taxid as "taxId", 
                        s.isgstregistered as "isGstRegistered", 
                        s.gstin,
                        s.country, 
                        s.website, 
                        s.description,
                        wi.startedat as "startedAt", 
                        wi.submissiontype as "submissionType",
                        (
                            SELECT json_agg(json_build_object(
                                'documentId', d.documentid,
                                'documentType', d.documenttype,
                                'documentName', d.documentname,
                                'fileUrl', d.filepath, 
                                'verificationStatus', d.verificationstatus
                            ))
                            FROM documents d
                            WHERE d.supplierid = s.supplierid
                        ) as documents
                        ,(
                            SELECT json_agg(json_build_object(
                                'addressId', a.addressid,
                                'addressType', a.addresstype,
                                'addressLine1', a.addressline1,
                                'addressLine2', a.addressline2,
                                'city', a.city,
                                'state', a.stateprovince,
                                'postalCode', a.postalcode,
                                'country', a.country,
                                'isPrimary', a.isprimary
                            )) FROM addresses a WHERE a.supplierid = s.supplierid
                        ) as addresses
                        ,(
                            SELECT json_agg(json_build_object(
                                'contactId', c.contactid,
                                'contactType', c.contacttype,
                                'firstName', c.firstname,
                                'lastName', c.lastname,
                                'email', c.email,
                                'phone', c.phone,
                                'isPrimary', c.isprimary,
                                'designation', c.designation
                            )) FROM contacts c WHERE c.supplierid = s.supplierid
                        ) as contacts,
                        (
                            SELECT json_agg(json_build_object(
                                'itemId', sci.itemid,
                                'fieldName', sci.fieldname,
                                'oldValue', sci.oldvalue,
                                'newValue', sci.newvalue,
                                'changeCategory', sci.changecategory,
                                'status', sci.status
                            )) 
                            FROM supplier_change_items sci
                            JOIN supplier_change_requests scr ON sci.requestid = scr.requestid
                            WHERE scr.supplierid = s.supplierid 
                            AND scr.status = 'PENDING'
                            AND sci.status = 'PENDING'
                        ) as items
                    FROM step_instances si
                    JOIN workflow_instances wi ON si.instanceid = wi.instanceid
                    LEFT JOIN workflows w ON wi.workflowtemplateid = w.workflowid
                    JOIN suppliers s ON wi.supplierid = s.supplierid
                    LEFT JOIN buyer_roles br ON si.assignedroleid = br.roleid
                    WHERE si.status = 'PENDING' AND wi.status = 'PENDING'
                    AND (w.buyerid = ? OR (wi.workflowtemplateid = 0 AND s.buyerid = ?))
                    AND (TRIM(LOWER(br.rolename)) IN (${placeholders}) OR si.assignedroleid IS NULL) -- Strict match
                `;

                const params = [user.buyerId, user.buyerId, ...lowerRoleNames];
                console.log(`DEBUG [getPendingTasks] Params: ${JSON.stringify(params)}`);

                db.all(sql, params, (err, rows) => {
                    if (err) {
                        console.error(`[WorkflowService] DB Error: ${err.message}`);
                        reject(err);
                    } else {
                        console.log(`[WorkflowService] db.all success. Rows count: ${rows?.length}`);
                        const canViewFinance = ['Finance', 'Finance Approver', 'Admin'].includes(user.subRole);
                        const canViewCompliance = ['Compliance', 'Compliance Reviewer', 'Admin'].includes(user.subRole);
                        // Tax is shared: Finance (Primary) + Compliance (Secondary)
                        const canViewTax = canViewFinance || canViewCompliance;

                        resolve(rows.map(r => {
                            const task = {
                                stepInstanceId: r.stepInstanceId || r.stepinstanceid,
                                executionId: r.instanceId || r.instanceid,
                                instanceId: r.instanceId || r.instanceid,
                                stepOrder: r.stepOrder || r.steporder,
                                stepName: r.stepName || r.stepname,
                                status: r.status,
                                assignedRoleId: r.assignedRoleId || r.assignedroleid,
                                workflowName: r.workflowName || r.workflowname,
                                supplierName: r.supplierName || r.suppliername,
                                supplierId: r.supplierId || r.supplierid,

                                // Company Details
                                website: r.website,
                                description: r.description,
                                country: r.country,

                                // Secure Finance Data
                                bankName: canViewFinance ? (r.bankName || r.bankname) : null,
                                accountNumber: canViewFinance ? (r.accountNumber || r.accountnumber) : null,

                                // Tax Data
                                taxId: canViewTax ? (r.taxId || r.taxid) : null,
                                isGstRegistered: canViewTax ? (r.isGstRegistered || r.isgstregistered) : null,
                                gstin: canViewTax ? r.gstin : null,

                                startedAt: r.startedAt || r.startedat,
                                submissionType: r.submissionType || r.submissiontype || 'INITIAL',
                                isChangeRequest: (r.submissionType || r.submissiontype) === 'UPDATE',
                                documents: (canViewCompliance || canViewFinance) ? (typeof r.documents === 'string' ? JSON.parse(r.documents) : (r.documents || [])) : [],
                                addresses: typeof r.addresses === 'string' ? JSON.parse(r.addresses) : (r.addresses || []),
                                contacts: typeof r.contacts === 'string' ? JSON.parse(r.contacts) : (r.contacts || []),
                                items: (() => {
                                    const parsed = typeof r.items === 'string' ? JSON.parse(r.items) : (r.items || []);
                                    // Scope items so each step only shows the changes it's responsible for.
                                    return filterItemsByStepScope(parsed, r.stepName || r.stepname);
                                })(),
                                reviewScope: determineReviewScope(r.stepName || r.stepname)
                            };
                            console.log(`[WorkflowService] Task mapped: ID=${task.instanceId}, Supplier="${task.supplierName}", Type=${task.submissionType}`);
                            return task;
                        }));
                    }
                });
            }
        });
    }

    static async approveStep(instanceId, stepOrder, userId, comments, isSandboxActive = false, stepInstanceId = null) {
        // 0. Instance Status Check
        const instanceDataRaw = await new Promise((resolve) => {
            db.get(`SELECT status, currentsteporder FROM workflow_instances WHERE instanceid = ?`, [instanceId], (err, row) => resolve(row));
        });
        if (!instanceDataRaw) throw new Error("Workflow instance not found");
        const instanceData = {
            status: instanceDataRaw.status || instanceDataRaw.STATUS,
            currentStepOrder: instanceDataRaw.currentsteporder || instanceDataRaw.currentStepOrder || instanceDataRaw.CURRENTSTEPORDER
        };
        const instStatus = (instanceData.status || '').toUpperCase();

        if (instStatus !== 'PENDING') {
            throw new Error(`Cannot advance: Workflow is already ${instStatus.toLowerCase()}`);
        }

        // 1. Step Status Check — use stepInstanceId for precision when provided (parallel workflows
        //    may have multiple steps sharing the same stepOrder, e.g. Finance + Compliance both at 1).
        const stepWhereClause = stepInstanceId
            ? `stepinstanceid = ?`
            : `instanceid = ? AND steporder = ?`;
        const stepWhereParams = stepInstanceId
            ? [stepInstanceId]
            : [instanceId, stepOrder];

        const stepDataRaw = await new Promise((resolve) => {
            db.get(`SELECT stepinstanceid, status, stepname FROM step_instances WHERE ${stepWhereClause}`, stepWhereParams, (err, row) => resolve(row));
        });
        const stepData = stepDataRaw ? {
            stepInstanceId: stepDataRaw.stepinstanceid || stepDataRaw.stepInstanceId,
            status: stepDataRaw.status || stepDataRaw.STATUS,
            stepName: stepDataRaw.stepname || stepDataRaw.stepName || stepDataRaw.STEPNAME
        } : null;

        if (!stepData || (stepData.status || '').toUpperCase() !== 'PENDING') {
            throw new Error(`This step is not currently pending approval. (Status: ${stepData ? stepData.status : 'NOT FOUND'})`);
        }

        // Use the resolved stepInstanceId for all subsequent targeted updates
        const resolvedStepInstanceId = stepData.stepInstanceId;

        // 2. Strict Sequencing Check (skipped in sandbox mode or for parallel steps at stepOrder=1)
        if (stepOrder > 1 && !isSandboxActive) {
            const prevStepRaw = await new Promise((resolve) => {
                db.get(`SELECT status FROM step_instances WHERE instanceid = ? AND steporder = ?`, [instanceId, stepOrder - 1], (err, row) => resolve(row));
            });
            const prevStep = prevStepRaw ? { status: prevStepRaw.status || prevStepRaw.STATUS } : null;
            if (!prevStep || prevStep.status !== 'APPROVED') {
                throw new Error("Previous step must be approved before proceeding.");
            }
        }

        // 3. Compliance Document Verification
        if ((stepData.stepName || '').toLowerCase().includes('compliance')) {
            const wfInstance = await new Promise((resolve) => {
                db.get(`SELECT supplierid FROM workflow_instances WHERE instanceid = ?`, [instanceId], (err, row) => resolve(row));
            });

            if (wfInstance) {
                const supplierId = wfInstance.supplierid || wfInstance.supplierId;
                const documents = await new Promise((resolve) => {
                    db.all(`SELECT verificationstatus, isactive FROM documents WHERE supplierid = ? AND isactive = TRUE`, [supplierId], (err, rows) => resolve(rows || []));
                });

                const pendingDocs = documents.filter(d => (d.verificationstatus || d.verificationStatus) !== 'VERIFIED');
                if (pendingDocs.length > 0) {
                    throw new Error(`Cannot approve Compliance step: ${pendingDocs.length} documents are not verified.`);
                }
            }
        }

        // 4. Update only THIS specific step instance (prevents cascading all parallel steps)
        await new Promise((resolve, reject) => {
            db.run(`UPDATE step_instances SET status = 'APPROVED', actionbyuserid = ?, actionat = CURRENT_TIMESTAMP, comments = ? WHERE stepinstanceid = ?`,
                [userId, comments, resolvedStepInstanceId], (err) => err ? reject(err) : resolve()
            );
        });

        // 5. Check for remaining PENDING steps in this workflow instance.
        //    For parallel workflows (all steps at stepOrder=1), ALL parallel steps must be
        //    approved before the workflow completes — NOT just one.
        const remainingPendingCount = await new Promise((resolve) => {
            db.get(`SELECT COUNT(*) as cnt FROM step_instances WHERE instanceid = ? AND status = 'PENDING'`, [instanceId], (err, row) => resolve(row ? (row.cnt || row.CNT || 0) : 0));
        });

        if (remainingPendingCount > 0) {
            // Other steps are still pending (parallel workflow) — keep workflow PENDING, nothing more to do
            console.log(`[WorkflowService] approveStep: ${remainingPendingCount} step(s) still pending for instance ${instanceId}. Workflow stays PENDING.`);
            return;
        }

        // 6. Check for sequential next step (for sequential workflows)
        let nextOrder = stepOrder + 1;
        let nextStepRaw = await new Promise((resolve) => {
            db.get(`SELECT stepinstanceid, stepname, isoptional FROM step_instances WHERE instanceid = ? AND steporder = ? AND status = 'WAITING'`, [instanceId, nextOrder], (err, row) => resolve(row || null));
        });
        let nextStep = nextStepRaw ? {
            stepInstanceId: nextStepRaw.stepinstanceid || nextStepRaw.stepInstanceId,
            stepName: nextStepRaw.stepname || nextStepRaw.stepName,
            isOptional: nextStepRaw.isoptional || nextStepRaw.isOptional
        } : null;

        // Loop to skip optional steps
        while (nextStep && nextStep.isOptional) {
            await new Promise(resolve => {
                db.run(`UPDATE step_instances SET status = 'SKIPPED', actionat = CURRENT_TIMESTAMP, comments = 'Auto-skipped (optional)' WHERE stepinstanceid = ?`,
                    [nextStep.stepInstanceId], () => resolve());
            });

            nextOrder++;
            nextStepRaw = await new Promise((resolve) => {
                db.get(`SELECT stepinstanceid, stepname, isoptional FROM step_instances WHERE instanceid = ? AND steporder = ? AND status = 'WAITING'`, [instanceId, nextOrder], (err, row) => resolve(row || null));
            });
            nextStep = nextStepRaw ? {
                stepInstanceId: nextStepRaw.stepinstanceid || nextStepRaw.stepInstanceId,
                stepName: nextStepRaw.stepname || nextStepRaw.stepName,
                isOptional: nextStepRaw.isoptional || nextStepRaw.isOptional
            } : null;
        }

        if (nextStep) {
            // Activate Next sequential step
            await new Promise((resolve, reject) => {
                db.run(`UPDATE step_instances SET status = 'PENDING' WHERE stepinstanceid = ?`, [nextStep.stepInstanceId], (err) => err ? reject(err) : resolve());
            });
            await new Promise((resolve, reject) => {
                db.run(`UPDATE workflow_instances SET currentsteporder = ? WHERE instanceid = ?`, [nextOrder, instanceId], (err) => err ? reject(err) : resolve());
            });
            return; // Next step activated, workflow stays PENDING
        }

        // No next step and no remaining PENDING steps — complete the workflow
        {
            // Complete workflow
            await new Promise((resolve, reject) => {
                db.run(`UPDATE workflow_instances SET status = 'COMPLETED', completedat = CURRENT_TIMESTAMP WHERE instanceid = ?`, [instanceId], (err) => err ? reject(err) : resolve());
            });
            await new Promise((resolve, reject) => {
                db.get(`SELECT supplierId as "supplierId", supplierid FROM workflow_instances WHERE instanceId = ?`, [instanceId], async (err, row) => {
                    if (err) return reject(err);
                    if (row) {
                        const sid = row.supplierid || row.supplierId;
                        db.run(`UPDATE suppliers SET approvalstatus = 'APPROVED', isactive = TRUE WHERE supplierid = ?`, [sid], async (err) => {
                            if (err) return reject(err);

                            // Send "Profile Approved" Notification
                            try {
                                const NotificationService = require('./NotificationService');
                                await NotificationService.createNotification({
                                    type: 'APPROVAL_APPROVED',
                                    message: 'Congratulations! Your supplier profile has been fully approved.',
                                    entityId: sid,
                                    recipientRole: 'SUPPLIER',
                                    supplierId: sid
                                });
                            } catch (e) { console.error("Failed to send approval notification:", e); }
                            resolve();
                        });
                    } else resolve();
                });
            });
        }
    }

    static async rejectStep(instanceId, stepOrder, userId, comments, stepInstanceId = null) {
        if (!comments || comments.trim() === '') {
            throw new Error("A reason (note) is mandatory for rejection.");
        }

        // 0. Instance Status Check
        const instanceData = await new Promise((resolve) => {
            db.get(`SELECT status FROM workflow_instances WHERE instanceid = ?`, [instanceId], (err, row) => resolve(row));
        });
        if (!instanceData) throw new Error("Workflow instance not found");
        const instStatus = (instanceData.status || '').toUpperCase();
        if (instStatus !== 'PENDING') {
            throw new Error(`Cannot reject: Workflow is already ${instStatus.toLowerCase()}`);
        }

        // 1. Update only this specific step to REJECTED (use stepInstanceId to avoid cascading parallel steps)
        const rejectWhere = stepInstanceId ? `stepinstanceid = ?` : `instanceid = ? AND steporder = ?`;
        const rejectParams = stepInstanceId ? [userId, comments, stepInstanceId] : [userId, comments, instanceId, stepOrder];
        await new Promise((resolve, reject) => {
            db.run(`UPDATE step_instances SET status = 'REJECTED', actionbyuserid = ?, actionat = CURRENT_TIMESTAMP, comments = ? WHERE ${rejectWhere}`,
                rejectParams, (err) => err ? reject(err) : resolve()
            );
        });

        // 2. Terminate Workflow
        await new Promise((resolve, reject) => {
            db.run(`UPDATE workflow_instances SET status = 'REJECTED', completedat = CURRENT_TIMESTAMP WHERE instanceid = ?`, [instanceId], (err) => err ? reject(err) : resolve());
        });

        // 3. Mark Supplier as REJECTED & Send Notification
        await new Promise((resolve, reject) => {
            db.get(`SELECT wi.supplierId, s.buyerId FROM workflow_instances wi JOIN suppliers s ON wi.supplierid = s.supplierid WHERE wi.instanceId = ?`, [instanceId], async (err, row) => {
                if (err) {
                    console.error("[WorkflowService.rejectStep] DB Error fetching supplier/buyer:", err);
                    return reject(err);
                }
                if (row) {
                    const sid = row.supplierid || row.supplierId;
                    const bid = row.buyerid || row.buyerId;
                    db.run(`UPDATE suppliers SET approvalstatus = 'REJECTED', isactive = FALSE WHERE supplierid = ?`, [sid], async (err) => {
                        if (err) return reject(err);

                        // Send Rejection Notification & Message
                        try {
                            const NotificationService = require('./NotificationService');
                            const MessageService = require('./MessageService');
                            
                            await NotificationService.createNotification({
                                type: 'APPROVAL_REJECTED',
                                message: `Your profile was rejected. Reason: ${comments}`,
                                entityId: sid,
                                recipientRole: 'SUPPLIER',
                                supplierId: sid
                            });

                            await MessageService.createMessage({
                                supplierId: sid,
                                buyerId: bid,
                                subject: 'Profile Rejected',
                                content: `Your supplier profile has been rejected. Reason: ${comments}. Please contact procurement for details.`,
                                recipientRole: 'SUPPLIER',
                                type: 'SYSTEM',
                                priority: 'HIGH'
                            }, { username: 'System', role: 'SYSTEM' });

                        } catch (e) { console.error("Failed to send rejection notification/message:", e); }
                        resolve();
                    });
                } else resolve();
            });
        });
    }

    static async requestRework(instanceId, stepOrder, userId, comments, stepInstanceId = null) {
        if (!comments || comments.trim() === '') {
            throw new Error("A reason (note) is mandatory for requesting rework.");
        }

        // 1. Update only this specific step to REWORK_REQUIRED (use stepInstanceId to avoid cascading parallel steps)
        const reworkWhere = stepInstanceId ? `stepinstanceid = ?` : `instanceid = ? AND steporder = ?`;
        const reworkParams = stepInstanceId ? [userId, comments, stepInstanceId] : [userId, comments, instanceId, stepOrder];
        await new Promise((resolve, reject) => {
            db.run(`UPDATE step_instances SET status = 'REWORK_REQUIRED', actionbyuserid = ?, actionat = CURRENT_TIMESTAMP, comments = ? WHERE ${reworkWhere}`,
                reworkParams, (err) => err ? reject(err) : resolve()
            );
        });

        // 2. Terminate Workflow Instance temporarily (so supplier can edit)
        await new Promise((resolve, reject) => {
            db.run(`UPDATE workflow_instances SET status = 'REWORK_REQUIRED', completedat = CURRENT_TIMESTAMP WHERE instanceid = ?`, [instanceId], (err) => err ? reject(err) : resolve());
        });

        // 3. Notify Supplier and Update Overall Status
        await new Promise((resolve, reject) => {
            db.get(`SELECT wi.supplierId, s.buyerId FROM workflow_instances wi JOIN suppliers s ON wi.supplierid = s.supplierid WHERE wi.instanceId = ?`, [instanceId], async (err, row) => {
                if (err) {
                    console.error(`[DEBUG-REWORK] Error fetching supplier/buyer from workflow:`, err);
                    return reject(err);
                }
                if (row) {
                    const sid = row.supplierid || row.supplierId;
                    const bid = row.buyerid || row.buyerId;
                    console.log(`[DEBUG-REWORK] Found supplier ${sid} for instance ${instanceId}. Updating status to REWORK_REQUIRED.`);

                    // Mark Supplier as REWORK_REQUIRED
                    db.run(`UPDATE suppliers SET approvalstatus = 'REWORK_REQUIRED' WHERE supplierid = ?`, [sid], async function (err) {
                        if (err) {
                            console.error(`[DEBUG-REWORK] Error updating supplier status:`, err);
                            return reject(err);
                        }
                        console.log(`[DEBUG-REWORK] Supplier ${sid} status updated. Changes: ${this.changes}`);

                        try {
                            const NotificationService = require('./NotificationService');
                            const MessageService = require('./MessageService');
                            
                            await NotificationService.createNotification({
                                type: 'REWORK_REQUIRED',
                                message: `Your profile requires rework. Note: ${comments}`,
                                entityId: sid,
                                recipientRole: 'SUPPLIER',
                                supplierId: sid
                            });

                            await MessageService.createMessage({
                                supplierId: sid,
                                buyerId: bid,
                                subject: 'Rework Required',
                                content: `Changes are required for your supplier profile. Reason: ${comments}. Please update and resubmit.`,
                                recipientRole: 'SUPPLIER',
                                type: 'SYSTEM',
                                priority: 'NORMAL'
                            }, { username: 'System', role: 'SYSTEM' });

                        } catch (e) { console.error("Failed to send rework notification/message:", e); }
                        resolve();
                    });
                } else {
                    console.warn(`[DEBUG-REWORK] No workflow instance found for ID ${instanceId} to update supplier status.`);
                    resolve();
                }
            });
        });
    }

    static async addNote(instanceId, stepOrder, userId, comments) {
        // Just update the comments field or handle a separate notes table? 
        // For simplicity and matching current schema, we might append to comments or just log it.
        // But wait, the prompt asked for "Add Note".
        // Let's assume we want to just record an action without changing status, OR append to comments.
        // Since we don't have a separate notes table visible in the viewed schema, let's treat it as a non-status-changing update
        // OR effectively just updating the comment for the current step if it's pending.

        // Actually, a better approach for "Notes" without changing status might be just logging it. 
        // But the user specificially asked for it. 
        // Let's implement it as updating the `comments` field WITHOUT changing status, effectively a "Save Draft Comment" or "Internal Note".
        return new Promise((resolve, reject) => {
            db.run(`UPDATE step_instances SET comments = ? WHERE instanceid = ? AND steporder = ?`,
                [comments, instanceId, stepOrder], (err) => err ? reject(err) : resolve()
            );
        });
    }
    // ========== WORKFLOW TEMPLATE MANAGEMENT ==========

    static async cloneWorkflow(sourceWorkflowId, newName, buyerId) {
        const source = await this.getWorkflowDetails(sourceWorkflowId);
        if (!source) throw new Error('Source workflow not found');

        return new Promise((resolve, reject) => {
            db.run(`INSERT INTO workflows (buyerid, name, description, clonedfromid) VALUES (?, ?, ?, ?)`,
                [buyerId || source.buyerid, newName, `Cloned from: ${source.name}`, sourceWorkflowId],
                async function (err) {
                    if (err) return reject(err);
                    const newWorkflowId = this.lastID;

                    try {
                        for (const step of source.steps) {
                            await new Promise((res, rej) => {
                                db.run(`INSERT INTO workflow_steps (workflowid, steporder, stepname, stepdescription, assignedroleid, isoptional) VALUES (?, ?, ?, ?, ?, ?)`,
                                    [newWorkflowId, step.steporder, step.stepname, step.stepdescription || '', step.assignedroleid, step.isoptional || false],
                                    (e) => e ? rej(e) : res()
                                );
                            });
                        }
                        resolve({ workflowId: newWorkflowId, workflowName: newName, steps: source.steps.length });
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        });
    }

    static async addStepToWorkflow(workflowId, stepData) {
        // Prevent editing system-enforced workflows
        const wf = await this.getWorkflowDetails(workflowId);
        if (!wf) throw new Error('Workflow not found');
        if (wf.isSystemEnforced) throw new Error('Cannot modify system-enforced default workflow. Clone it first.');

        // Insert at the specified position, shifting existing steps
        const { stepName, stepDescription, assignedRoleId, position, isOptional } = stepData;
        const insertOrder = position || (wf.steps.length + 1);

        // Shift steps at or after the insert position
        await new Promise((resolve, reject) => {
            db.run(`UPDATE workflow_steps SET steporder = steporder + 1 WHERE workflowid = ? AND steporder >= ?`,
                [workflowId, insertOrder], (err) => err ? reject(err) : resolve()
            );
        });

        // Insert the new step
        return new Promise((resolve, reject) => {
            db.run(`INSERT INTO workflow_steps (workflowid, steporder, stepname, stepdescription, assignedroleid, isoptional) VALUES (?, ?, ?, ?, ?, ?)`,
                [workflowId, insertOrder, stepName, stepDescription || '', assignedRoleId, isOptional || false],
                function (err) {
                    if (err) return reject(err);
                    resolve({ stepId: this.lastID, stepOrder: insertOrder, stepName });
                }
            );
        });
    }

    static async removeStepFromWorkflow(workflowId, stepId) {
        // Prevent editing system-enforced workflows
        const wf = await this.getWorkflowDetails(workflowId);
        if (!wf) throw new Error('Workflow not found');
        if (wf.isSystemEnforced) throw new Error('Cannot modify system-enforced default workflow. Clone it first.');
        if (wf.steps.length <= 1) throw new Error('Cannot remove the last step from a workflow.');

        // Get the step to know its order
        const step = wf.steps.find(s => s.stepId === parseInt(stepId));
        if (!step) throw new Error('Step not found in this workflow');

        // Delete it
        await new Promise((resolve, reject) => {
            db.run(`DELETE FROM workflow_steps WHERE stepid = ? AND workflowid = ?`, [stepId, workflowId],
                (err) => err ? reject(err) : resolve()
            );
        });

        // Re-order remaining steps
        await new Promise((resolve, reject) => {
            db.run(`UPDATE workflow_steps SET steporder = steporder - 1 WHERE workflowid = ? AND steporder > ?`,
                [workflowId, step.steporder || step.stepOrder], (err) => err ? reject(err) : resolve()
            );
        });

        return { success: true, removedStep: step.stepName };
    }

    static async reorderSteps(workflowId, stepOrders) {
        // stepOrders = [{ stepId, newOrder }, ...]
        const wf = await this.getWorkflowDetails(workflowId);
        if (!wf) throw new Error('Workflow not found');
        if (wf.isSystemEnforced) throw new Error('Cannot modify system-enforced default workflow. Clone it first.');

        for (const item of stepOrders) {
            await new Promise((resolve, reject) => {
                db.run(`UPDATE workflow_steps SET steporder = ? WHERE stepid = ? AND workflowid = ?`,
                    [item.newOrder, item.stepId, workflowId],
                    (err) => err ? reject(err) : resolve()
                );
            });
        }
        return { success: true };
    }

    static async updateWorkflow(workflowId, data) {
        const wf = await this.getWorkflowDetails(workflowId);
        if (!wf) throw new Error('Workflow not found');
        if (wf.isSystemEnforced && data.workflowName) throw new Error('Cannot rename system-enforced workflow.');

        const updates = [];
        const params = [];
        const name = data.workflowName || data.name;
        if (name !== undefined) { updates.push('name = ?'); params.push(name); }
        if (data.description !== undefined) { updates.push('description = ?'); params.push(data.description); }

        // Handle adding new steps
        if (data.steps && Array.isArray(data.steps) && data.steps.length > 0) {
            const stepPromises = data.steps.map(async (step) => {
                const stepOrder = step.stepOrder || step.order;
                const stepName = step.stepName || step.name;
                // Get the roleId for the role name if provided
                let roleId = step.assignedRoleId;
                if (!roleId && step.assignedRole) {
                    try {
                        const role = await new Promise((resolve) => {
                            db.get('SELECT roleid FROM buyer_roles WHERE rolename = ?', [step.assignedRole], (err, row) => {
                                if (err) resolve(null);
                                else resolve(row || null);
                            });
                        });
                        if (role) {
                            roleId = role.roleId || role.roleid || role.ROLEID;
                        }
                    } catch (e) {
                        roleId = null;
                    }
                }
                return new Promise((resolve, reject) => {
                    db.run(`INSERT INTO workflow_steps (workflowid, stepname, steporder, assignedroleid, requiredactions) VALUES (?, ?, ?, ?, ?)`,
                        [workflowId, stepName, stepOrder, roleId, JSON.stringify(step.requiredActions || [])],
                        (err) => err ? reject(err) : resolve()
                    );
                });
            });
            await Promise.all(stepPromises);
        }

        if (updates.length === 0 && (!data.steps || data.steps.length === 0)) return { ...wf, workflowName: wf.name };

        if (updates.length > 0) {
            params.push(workflowId);
            return new Promise((resolve, reject) => {
                db.run(`UPDATE workflows SET ${updates.join(', ')} WHERE workflowid = ?`, params,
                    async (err) => {
                        if (err) return reject(err);
                        const updated = await this.getWorkflowDetails(workflowId);
                        resolve({ ...updated, workflowName: updated.name });
                    }
                );
            });
        } else {
            const updated = await this.getWorkflowDetails(workflowId);
            return { ...updated, workflowName: updated.name };
        }
    }

    static async deleteWorkflow(workflowId) {
        const wf = await this.getWorkflowDetails(workflowId);
        if (!wf) throw new Error('Workflow not found');
        if (wf.isSystemEnforced) throw new Error('Cannot delete system-enforced workflow.');
        if (wf.isDefault) throw new Error('Cannot delete the default workflow. Set another as default first.');

        // Check if assigned to any suppliers
        const assignedCount = await new Promise((resolve, reject) => {
            db.get(`SELECT COUNT(*) as count FROM suppliers WHERE assignedworkflowid = ?`, [workflowId], (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });
        if (assignedCount > 0) throw new Error(`Cannot delete workflow. It is currently assigned to ${assignedCount} supplier(s).`);

        // Check if used in any country risk rules
        const ruleCount = await new Promise((resolve, reject) => {
            db.get(`SELECT COUNT(*) as count FROM country_risk_rules WHERE workflowid = ?`, [workflowId], (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });
        if (ruleCount > 0) throw new Error(`Cannot delete workflow. It is used in ${ruleCount} country risk rule(s).`);

        // Delete steps first, then workflow
        await new Promise((resolve, reject) => {
            db.run(`DELETE FROM workflow_steps WHERE workflowid = ?`, [workflowId],
                (err) => err ? reject(err) : resolve()
            );
        });
        return new Promise((resolve, reject) => {
            db.run(`DELETE FROM workflows WHERE workflowid = ?`, [workflowId],
                (err) => err ? reject(err) : resolve({ success: true })
            );
        });
    }

    // ========== COUNTRY RISK RULES ==========

    static async getCountryRiskRules(buyerId) {
        return new Promise((resolve, reject) => {
            db.all(`SELECT cr.*, w.name as workflowName 
                    FROM country_risk_rules cr 
                    LEFT JOIN workflows w ON cr.workflowid = w.workflowid
                    WHERE cr.buyerid = ? ORDER BY cr.country ASC`, [buyerId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows.map(r => ({
                    ruleId: r.ruleid || r.ruleId,
                    buyerId: r.buyerid || r.buyerId,
                    country: r.country,
                    riskLevel: r.risklevel || r.riskLevel,
                    workflowId: r.workflowid || r.workflowId,
                    workflowName: r.workflowname || r.workflowName,
                    createdAt: r.createdat || r.createdAt
                })));
            });
        });
    }

    static async upsertCountryRiskRule(buyerId, country, riskLevel, workflowId) {
        return new Promise((resolve, reject) => {
            // Use INSERT ... ON CONFLICT for Postgres upsert
            db.run(`INSERT INTO country_risk_rules (buyerId, country, riskLevel, workflowId) 
                    VALUES (?, ?, ?, ?) 
                    ON CONFLICT (buyerid, country) DO UPDATE SET risklevel = EXCLUDED.risklevel, workflowid = EXCLUDED.workflowid`,
                [buyerId, country, riskLevel, workflowId],
                function (err) {
                    if (err) return reject(err);
                    resolve({ ruleId: this.lastID, country, riskLevel, workflowId });
                }
            );
        });
    }

    static async deleteCountryRiskRule(ruleId) {
        return new Promise((resolve, reject) => {
            db.run(`DELETE FROM country_risk_rules WHERE ruleid = ?`, [ruleId],
                (err) => err ? reject(err) : resolve({ success: true })
            );
        });
    }

    // ========== WORKFLOW RESOLUTION ==========

    static async resolveWorkflowForSupplier(supplierId, buyerId) {
        // Priority: 1. Manual assignment → 2. Country risk rule → 3. Default workflow

        // 1. Check manual assignment
        const supplier = await new Promise((resolve, reject) => {
            db.get(`SELECT assignedworkflowid, country FROM suppliers WHERE supplierid = ?`, [supplierId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!supplier) throw new Error('Supplier not found');

        const manualId = supplier.assignedworkflowid || supplier.assignedWorkflowId;
        if (manualId) {
            return { workflowId: manualId, source: 'MANUAL' };
        }

        // 2. Check country risk rule
        const country = supplier.country;
        if (country) {
            const rule = await new Promise((resolve, reject) => {
                db.get(`SELECT workflowid FROM country_risk_rules WHERE buyerid = ? AND country = ?`,
                    [buyerId, country], (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    });
            });
            if (rule) {
                const ruleWfId = rule.workflowid || rule.workflowId;
                return { workflowId: ruleWfId, source: 'COUNTRY_RULE' };
            }
        }

        // 3. Default workflow
        const defaultWf = await this.getDefaultWorkflow(buyerId);
        if (defaultWf) {
            return { workflowId: defaultWf.workflowId, source: 'DEFAULT' };
        }

        throw new Error('No workflow found for this supplier. Please configure a default workflow.');
    }
}

module.exports = WorkflowService;
