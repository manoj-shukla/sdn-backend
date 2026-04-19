const db = require('../config/database');

class CircleService {
    static async getBuyerCircles(buyerId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT c.circleId as \"circleId\", c.buyerId as \"buyerId\", c.circleName as \"circleName\", c.description, c.createdAt as \"createdAt\",
                       (SELECT COUNT(*) FROM sdn_users WHERE circleid = c.circleId) as \"memberCount\"
                FROM circles c 
                WHERE c.buyerId = ?
            `;
            db.all(query, [buyerId], (err, rows) => err ? reject(err) : resolve(rows));
        });
    }

    static async getCircleById(circleId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT c.circleId as \"circleId\", c.buyerId as \"buyerId\", c.circleName as \"circleName\", c.description, c.createdAt as \"createdAt\",
                       (SELECT COUNT(*) FROM sdn_users WHERE circleid = c.circleId) as \"memberCount\"
                FROM circles c 
                WHERE c.circleId = ?
            `;
            db.get(query, [circleId], (err, row) => err ? reject(err) : resolve(row));
        });
    }

    static async createCircle(data, user) {
        return new Promise((resolve, reject) => {
            let buyerId = data.buyerId || user?.buyerId || user?.buyerid;

            if (!buyerId) return reject(new Error("No buyerId associated with this request."));

            const { circleName, name, description } = data;
            const finalName = circleName || name;

            if (!finalName) return reject(new Error("Circle name is required"));

            db.run(`INSERT INTO circles (buyerId, circleName, description) VALUES (?, ?, ?)`,
                [buyerId, finalName, description],
                function (err) {
                    if (err) {
                        if (err.message.toLowerCase().includes('unique') || err.message.toLowerCase().includes('duplicate')) {
                            const error = new Error("Circle with this name already exists for this buyer");
                            error.status = 400;
                            return reject(error);
                        }
                        return reject(err);
                    }
                    const circleId = this.lastID;
                    db.get("SELECT circleId as \"circleId\", circleName as \"circleName\", buyerId as \"buyerId\", description, createdAt as \"createdAt\" FROM circles WHERE circleId = ?", [circleId], (err, row) => {
                        if (row) {
                            row.circleId = row.circleId || row.circleid;
                            row.circleName = row.circleName || row.circlename;
                            row.buyerId = row.buyerId || row.buyerid;
                        }
                        resolve(row);
                    });
                }
            );
        });
    }

    static async updateCircle(circleId, data) {
        return new Promise((resolve, reject) => {
            const { circleName, description } = data;
            let sql = `UPDATE circles SET `;
            const params = [];
            const fields = [];

            if (circleName) {
                fields.push(`circleName = ?`);
                params.push(circleName);
            }
            if (description !== undefined) {
                fields.push(`description = ?`);
                params.push(description);
            }

            if (fields.length === 0) return resolve();

            sql += fields.join(', ') + ` WHERE circleId = ?`;
            params.push(circleId);

            db.run(sql, params, function (err) {
                if (err) {
                    if (err.message.toLowerCase().includes('unique') || err.message.toLowerCase().includes('duplicate')) {
                        const error = new Error("Circle with this name already exists");
                        error.status = 400;
                        return reject(error);
                    }
                    return reject(err);
                }
                db.get("SELECT circleId as \"circleId\", circleName as \"circleName\", buyerId as \"buyerId\", description, createdAt as \"createdAt\" FROM circles WHERE circleId = ?", [circleId], (err, row) => {
                    if (row) {
                        row.circleId = row.circleId || row.circleid;
                        row.circleName = row.circleName || row.circlename;
                        row.buyerId = row.buyerId || row.buyerid;
                    }
                    resolve(row);
                });
            });
        });
    }

    static async deleteCircle(id) {
        return new Promise((resolve, reject) => {
            // Check if users are assigned to this circle
            db.get("SELECT COUNT(*) as count FROM sdn_users WHERE \"circleid\" = $1", [id], (err, row) => {
                if (err) return reject(err);
                if (row && parseInt(row.count) > 0) {
                    const error = new Error("Cannot delete circle: There are team members assigned to it.");
                    error.status = 400;
                    return reject(error);
                }

                // Cascade cleanup
                db.run("DELETE FROM circle_members WHERE \"circleId\" = $1", [id], () => {
                    db.run("DELETE FROM circle_workflows WHERE \"circleId\" = $1", [id], () => {
                        db.run("DELETE FROM circles WHERE \"circleId\" = $1", [id], (err) => err ? reject(err) : resolve());
                    });
                });
            });
        });
    }

    static async addSupplierToCircle(circleId, supplierId) {
        // Validation: supplier must belong to the same buyer as the circle
        return new Promise((resolve, reject) => {
            db.get("SELECT buyerId as \"buyerId\" FROM suppliers WHERE supplierId = ?", [supplierId], (err, supplier) => {
                if (err) return reject(err);
                if (!supplier) return reject(new Error("Supplier not found"));

                db.get("SELECT buyerId as \"buyerId\" FROM circles WHERE circleId = ?", [circleId], (err, circle) => {
                    if (err) return reject(err);
                    if (!circle) return reject(new Error("Circle not found"));

                    if (parseInt(supplier.buyerId) !== parseInt(circle.buyerId)) {
                        const error = new Error("Supplier must belong to the same buyer as the circle");
                        error.status = 400;
                        return reject(error);
                    }

                    db.run("INSERT INTO circle_members (circleId, supplierId) VALUES (?, ?) ON CONFLICT DO NOTHING",
                        [circleId, supplierId],
                        function (err) {
                            if (err) return reject(err);
                            if (this.changes === 0) {
                                const error = new Error("Supplier is already a member of this circle");
                                error.status = 400;
                                return reject(error);
                            }
                            resolve({ message: "Supplier added to circle successfully" });
                        }
                    );
                });
            });
        });
    }

    static async removeSupplierFromCircle(circleId, supplierId) {
        return new Promise((resolve, reject) => {
            db.run("DELETE FROM circle_members WHERE circleId = ? AND supplierId = ?", [circleId, supplierId], function (err) {
                if (err) return reject(err);
                resolve({ message: "Supplier removed from circle" });
            });
        });
    }

    static async getCircleSuppliers(circleId, query = {}) {
        const { page = 1, pageSize = 10 } = query;
        const offset = (page - 1) * pageSize;

        return new Promise((resolve, reject) => {
            const countQuery = `SELECT COUNT(*) as total FROM circle_members WHERE circleId = ?`;
            const dataQuery = `
                SELECT s.supplierId as \"supplierId\", s.legalName as \"legalName\", s.country, s.approvalStatus as \"approvalStatus\"
                FROM suppliers s
                JOIN circle_members cm ON s.supplierId = cm.supplierId
                WHERE cm.circleId = ?
                LIMIT ? OFFSET ?
            `;

            db.get(countQuery, [circleId], (err, countRow) => {
                if (err) return reject(err);

                db.all(dataQuery, [circleId, parseInt(pageSize), parseInt(offset)], (err, rows) => {
                    if (err) return reject(err);
                    resolve({
                        suppliers: rows,
                        total: countRow.total,
                        page: parseInt(page),
                        pageSize: parseInt(pageSize)
                    });
                });
            });
        });
    }

    static async bulkAddSuppliers(circleId, supplierIds) {
        let added = 0;
        let failed = 0;

        for (const supplierId of supplierIds) {
            try {
                await CircleService.addSupplierToCircle(circleId, supplierId);
                added++;
            } catch (e) {
                failed++;
            }
        }

        return { added, failed };
    }

    static async assignWorkflowToCircle(circleId, workflowId) {
        return new Promise((resolve, reject) => {
            db.get("SELECT buyerId as \"buyerId\" FROM circles WHERE circleId = ?", [circleId], (err, circle) => {
                if (err) return reject(err);
                if (!circle) return reject(new Error("Circle not found"));

                db.get("SELECT buyerId as \"buyerId\" FROM workflows WHERE workflowId = ?", [workflowId], (err, workflow) => {
                    if (err) return reject(err);
                    if (!workflow) return reject(new Error("Workflow not found"));

                    if (parseInt(circle.buyerId) !== parseInt(workflow.buyerId)) {
                        const error = new Error("Workflow must belong to the same buyer as the circle");
                        error.status = 400;
                        return reject(error);
                    }

                    db.run("INSERT INTO circle_workflows (circleId, workflowId) VALUES (?, ?) ON CONFLICT DO NOTHING",
                        [circleId, workflowId],
                        function (err) {
                            if (err) return reject(err);
                            if (this.changes === 0) {
                                const error = new Error("Workflow is already assigned to this circle");
                                error.status = 400;
                                return reject(error);
                            }
                            resolve({ message: "Workflow assigned to circle successfully" });
                        }
                    );
                });
            });
        });
    }

    static async removeWorkflowFromCircle(circleId, workflowId) {
        return new Promise((resolve, reject) => {
            db.run("DELETE FROM circle_workflows WHERE circleId = ? AND workflowId = ?", [circleId, workflowId], (err) => err ? reject(err) : resolve());
        });
    }

    static async getCircleWorkflows(circleId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT w.workflowId as \"workflowId\", w.circleName as \"workflowName\", w.description, w.isActive as \"isActive\"
                FROM workflows w
                JOIN circle_workflows cw ON w.workflowId = cw.workflowId
                WHERE cw.circleId = ?
            `;
            // Wait, does 'workflows' have 'circleName' or just 'name'?
            // Let's check workflows table.
            db.all(`SELECT w.workflowId as \"workflowId\", w.name as \"workflowName\", w.description, w.isActive as \"isActive\"
                    FROM workflows w
                    JOIN circle_workflows cw ON w.workflowId = cw.workflowId
                    WHERE cw.circleId = ?`, [circleId], (err, rows) => err ? reject(err) : resolve(rows));
        });
    }

    static async getCircleStats(circleId) {
        return new Promise(async (resolve, reject) => {
            try {
                const memberCount = await new Promise((res, rej) => {
                    db.get("SELECT COUNT(*) as count FROM circle_members WHERE circleId = ?", [circleId], (err, row) => err ? rej(err) : res(row?.count || 0));
                });
                const activeWorkflows = await new Promise((res, rej) => {
                    db.get("SELECT COUNT(*) as count FROM circle_workflows WHERE circleId = ?", [circleId], (err, row) => err ? rej(err) : res(row?.count || 0));
                });

                resolve({
                    memberCount: parseInt(memberCount),
                    activeWorkflows: parseInt(activeWorkflows),
                    pendingApprovals: 0 // Mocking for now
                });
            } catch (e) {
                reject(e);
            }
        });
    }
}

module.exports = CircleService;
