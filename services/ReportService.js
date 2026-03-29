const db = require('../config/database');

class ReportService {
    static async generateReport(data, user) {
        return new Promise((resolve, reject) => {
            const { reportType, format, filters } = data;
            const buyerId = user.buyerId;
            const generatedByUserId = user.userId;
            const filtersStr = JSON.stringify(filters || {});

            db.run(`INSERT INTO reports (buyerId, reportType, format, filters, status, generatedByUserId) VALUES (?, ?, ?, ?, 'PROCESSING', ?)`,
                [buyerId, reportType, format, filtersStr, generatedByUserId],
                function (err) {
                    if (err) return reject(err);
                    const reportId = this.lastID;

                    // Simulate async generation logic
                    // In a real app, this would trigger a background worker
                    setTimeout(async () => {
                        try {
                            // Mock completion
                            db.run("UPDATE reports SET status = 'COMPLETED', completedAt = CURRENT_TIMESTAMP WHERE reportId = ?", [reportId]);
                        } catch (e) {
                            console.error("Async report generation failed", e);
                            db.run("UPDATE reports SET status = 'FAILED' WHERE reportId = ?", [reportId]);
                        }
                    }, 1000);

                    db.get("SELECT reportId as \"reportId\", status, buyerId as \"buyerId\", reportType as \"reportType\", format, filters, createdAt as \"createdAt\" FROM reports WHERE reportId = ?", [reportId], (err, row) => {
                        if (err) return reject(err);
                        if (row && row.filters) row.filters = JSON.parse(row.filters);
                        resolve(row);
                    });
                }
            );
        });
    }

    static async getReportById(reportId) {
        return new Promise((resolve, reject) => {
            db.get("SELECT reportId as \"reportId\", status, buyerId as \"buyerId\", reportType as \"reportType\", format, filters, createdAt as \"createdAt\", completedAt as \"completedAt\", filePath as \"filePath\" FROM reports WHERE reportId = ?", [reportId], (err, row) => {
                if (err) return reject(err);
                if (row && row.filters) row.filters = JSON.parse(row.filters);
                resolve(row);
            });
        });
    }

    static async getAllReports(buyerId, options = {}) {
        return new Promise((resolve, reject) => {
            let query = "SELECT reportId as \"reportId\", status, buyerId as \"buyerId\", reportType as \"reportType\", format, filters, createdAt as \"createdAt\", completedAt as \"completedAt\" FROM reports WHERE buyerId = ?";
            const params = [buyerId];

            if (options.type) {
                query += " AND reportType = ?";
                params.push(options.type);
            }

            query += " ORDER BY createdAt DESC";

            db.all(query, params, (err, rows) => {
                if (err) return reject(err);
                const reports = rows.map(r => ({ ...r, filters: r.filters ? JSON.parse(r.filters) : {} }));
                resolve(reports);
            });
        });
    }

    static async deleteReport(reportId) {
        return new Promise((resolve, reject) => {
            db.run("DELETE FROM reports WHERE reportId = ?", [reportId], (err) => err ? reject(err) : resolve());
        });
    }
}

module.exports = ReportService;
