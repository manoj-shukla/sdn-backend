const ReportService = require('../services/ReportService');

class ReportController {
    static async generateReport(req, res) {
        try {
            const report = await ReportService.generateReport(req.body, req.user);
            res.json(report);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    static async getReport(req, res) {
        try {
            const report = await ReportService.getReportById(req.params.id);
            if (!report) return res.status(404).json({ error: "Report not found" });

            // Add progress field for tests
            const response = {
                ...report,
                progress: report.status === 'COMPLETED' ? 100 : 50
            };
            res.json(response);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    static async getAllReports(req, res) {
        try {
            const { page, pageSize, type } = req.query;
            const buyerId = req.user.buyerId;

            const reports = await ReportService.getAllReports(buyerId, { type });

            // If pagination params are present, return wrapped object
            if (page || pageSize || type) {
                const p = parseInt(page) || 1;
                const ps = parseInt(pageSize) || 10;
                const start = (p - 1) * ps;
                const paginated = reports.slice(start, start + ps);

                return res.json({
                    reports: paginated,
                    total: reports.length,
                    page: p,
                    pageSize: ps
                });
            }

            // Default: return array
            res.json(reports);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    static async deleteReport(req, res) {
        try {
            await ReportService.deleteReport(req.params.id);
            res.sendStatus(200);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }
}

module.exports = ReportController;
