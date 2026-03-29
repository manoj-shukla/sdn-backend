const XLSX = require('xlsx');
const InvitationService = require('./InvitationService');

class BulkInvitationService {

    /**
     * Generate an Excel template for bulk invitations.
     */
    static generateTemplate() {
        const headers = [
            'Company Legal Name',
            'Primary Contact Email',
            'Business Type',
            'Country',
            'Internal Code'
        ];

        const sampleRow = {
            'Company Legal Name': 'Acme Global Ltd',
            'Primary Contact Email': 'vendor@acme.com',
            'Business Type': 'Enterprise',
            'Country': 'United States',
            'Internal Code': 'VEND-001'
        };

        const ws = XLSX.utils.json_to_sheet([sampleRow], { header: headers });
        ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length + 2, 20) }));

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Invitations');

        return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    }

    /**
     * Process an uploaded Excel file and create invitations.
     */
    static async processUpload(filePath, user) {
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });

        if (!rows.length) {
            throw new Error('The uploaded file contains no data rows.');
        }

        const results = { created: [], failed: [] };

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowNum = i + 2; // Excel row
            try {
                const legalName = (row['Company Legal Name'] || '').toString().trim();
                const email = (row['Primary Contact Email'] || '').toString().trim();
                const supplierType = (row['Business Type'] || 'Enterprise').toString().trim();
                const country = (row['Country'] || '').toString().trim();
                const internalCode = (row['Internal Code'] || '').toString().trim();

                if (!legalName) throw new Error('Company Legal Name is required');
                if (!email) throw new Error('Primary Contact Email is required');
                if (!country) throw new Error('Country is required');

                // Prepare invitation data
                const invitationData = {
                    email,
                    legalName,
                    supplierType,
                    country,
                    internalCode,
                    buyerId: user.buyerId,
                    role: 'SUPPLIER',
                    isPreApproved: false, // Normal invite flow
                    categories: ['General'],
                    riskLevel: 'Medium',
                    paymentMethods: ['Bank Transfer'],
                    currency: 'USD'
                };

                const result = await InvitationService.createInvitation(invitationData, user);

                results.created.push({
                    row: rowNum,
                    legalName,
                    email,
                    invitationId: result.invitationId
                });

            } catch (err) {
                results.failed.push({
                    row: rowNum,
                    legalName: row['Company Legal Name'] || 'Unknown',
                    error: err.message
                });
            }
        }

        return results;
    }

    static async processInvitations(invitations, user) {
        const batchId = `batch_${Date.now()}`;
        const sent = [];
        const failed = [];

        for (let i = 0; i < invitations.length; i++) {
            const invite = invitations[i];
            const rowNum = i + 1;

            try {
                const { email, companyName, legalName, country, businessType, supplierType } = invite;
                const nameToUse = legalName || companyName || email.split('@')[0];
                const countryToUse = country || 'India';
                const typeToUse = businessType || supplierType || 'Enterprise';

                if (!email) {
                    failed.push({ row: rowNum, email: '', error: 'Email is required' });
                    continue;
                }

                // Validate email format
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(email)) {
                    failed.push({ row: rowNum, email, error: 'Invalid email format' });
                    continue;
                }

                // Create the invitation
                const InvitationService = require('./InvitationService');
                const result = await InvitationService.createInvitation({
                    email,
                    legalName: nameToUse,
                    country: countryToUse,
                    supplierType: typeToUse,
                    role: 'SUPPLIER'
                }, user);

                sent.push({
                    row: rowNum,
                    email,
                    companyName,
                    invitationId: result.invitationId
                });

            } catch (err) {
                failed.push({ row: rowNum, email: invite.email || '', error: err.message });
            }
        }

        return {
            invitations: sent,
            errors: failed,
            summary: {
                sent: sent.length,
                failed: failed.length,
                total: invitations.length
            },
            batchId,
            total: invitations.length
        };
    }
}

module.exports = BulkInvitationService;
