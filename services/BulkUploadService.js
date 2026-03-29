const db = require('../config/database');
const bcrypt = require('bcryptjs');
const XLSX = require('xlsx');

class BulkUploadService {

    /**
     * Process an uploaded Excel file and create suppliers + user accounts.
     * Each row = one supplier with optional contact and address.
     * All suppliers are marked PRE_APPROVED. User accounts get a temp password.
     */
    static async processUpload(filePath, user) {
        const AnalyticsService = require('./AnalyticsService');
        AnalyticsService.clearCache();

        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });

        if (!rows.length) {
            throw new Error('The uploaded file contains no data rows.');
        }

        const results = { created: [], failed: [] };
        const buyerId = user.buyerId || null;

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowNum = i + 2; // Excel row (1-indexed header + data)
            try {
                // Validate required fields (support both 'Legal Name' and 'Company Legal Name' headers)
                const legalName = (row['Company Legal Name'] || row['Legal Name'] || '').toString().trim();
                const contactEmail = (row['Contact Email'] || row['Email'] || '').toString().trim();

                if (!legalName) {
                    results.failed.push({ row: rowNum, error: 'Company Legal Name is required' });
                    continue;
                }
                if (!contactEmail) {
                    results.failed.push({ row: rowNum, error: 'Contact Email is required (used as login)' });
                    continue;
                }

                // 1. Create the supplier record
                const supplier = await this._createSupplier(row, legalName, buyerId, user);

                // 2. Create the contact record (if we have contact info)
                if (row['Contact First Name'] || row['Contact Last Name']) {
                    await this._createContact(supplier.supplierid || supplier.supplierId, row);
                }

                // 3. Create the address record (if we have address info)
                if (row['Address Line 1'] || row['City']) {
                    await this._createAddress(supplier.supplierid || supplier.supplierId, row);
                }

                // 4. Create a user account with temp password
                const supplierId = supplier.supplierid || supplier.supplierId;
                const tempPassword = this._generateTempPassword();
                const userAccount = await this._createUserAccount(contactEmail, tempPassword, supplierId);

                results.created.push({
                    row: rowNum,
                    supplierId: supplierId,
                    legalName: legalName,
                    username: contactEmail,
                    tempPassword: tempPassword,
                    userId: userAccount.userid || userAccount.userId
                });

            } catch (err) {
                results.failed.push({ row: rowNum, legalName: (row['Company Legal Name'] || ''), error: err.message });
            }
        }

        // Add metadata fields required by tests
        const jobId = `job_${Date.now()}`;
        return {
            imported: results.created.length,
            failed: results.failed.length,
            errors: results.failed,
            duplicates: results.failed.filter(f => f.error && f.error.includes('duplicate')).length,
            created: results.created,
            jobId,
            status: 'completed'
        };
    }

    // --- Private helpers ---

    static _generateTempPassword() {
        return 'Welcome@123';
    }

    static async _createSupplier(row, legalName, buyerId, user) {
        return new Promise((resolve, reject) => {
            const sql = `INSERT INTO suppliers (
                legalName, businessType, country, taxId, gstin, 
                bankName, accountNumber, routingNumber, website, description,
                approvalStatus, isActive, createdByUserId, createdByUsername, buyerId
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`;

            const params = [
                legalName,
                (row['Business Type'] || '').toString().trim(),
                (row['Country'] || '').toString().trim(),
                (row['Tax ID'] || '').toString().trim(),
                (row['GSTIN'] || '').toString().trim(),
                (row['Bank Name'] || '').toString().trim(),
                (row['Account Number'] || '').toString().trim(),
                (row['Routing Number'] || '').toString().trim(),
                (row['Website'] || '').toString().trim(),
                (row['Description'] || '').toString().trim(),
                'PRE_APPROVED',
                true,
                user.userId,
                user.username,
                buyerId
            ];

            db.get(sql, params, (err, result) => {
                if (err) return reject(err);
                resolve(result);
            });
        });
    }

    static async _createContact(supplierId, row) {
        return new Promise((resolve, reject) => {
            const sql = `INSERT INTO contacts (
                supplierId, firstName, lastName, contactType, email, phone, isPrimary
            ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`;

            const params = [
                supplierId,
                (row['Contact First Name'] || '').toString().trim(),
                (row['Contact Last Name'] || '').toString().trim(),
                'Primary',
                (row['Contact Email'] || '').toString().trim(),
                (row['Contact Phone'] || '').toString().trim(),
                true
            ];

            db.get(sql, params, (err, result) => {
                if (err) return reject(err);
                resolve(result);
            });
        });
    }

    static async _createAddress(supplierId, row) {
        return new Promise((resolve, reject) => {
            const sql = `INSERT INTO addresses (
                supplierId, addressType, addressLine1, city, postalCode, country, isPrimary
            ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`;

            const params = [
                supplierId,
                'Registered',
                (row['Address Line 1'] || '').toString().trim(),
                (row['City'] || '').toString().trim(),
                (row['Postal Code'] || '').toString().trim(),
                (row['Country'] || row['Address Country'] || '').toString().trim(),
                true
            ];

            db.get(sql, params, (err, result) => {
                if (err) return reject(err);
                resolve(result);
            });
        });
    }

    static async _createUserAccount(email, tempPassword, supplierId) {
        return new Promise(async (resolve, reject) => {
            try {
                // Check if user already exists
                const existing = await new Promise((res, rej) => {
                    db.get('SELECT userId FROM users WHERE email = $1 OR username = $2', [email, email], (err, row) => {
                        if (err) return rej(err);
                        res(row);
                    });
                });

                if (existing) {
                    // Link existing user to this supplier if not already linked
                    const uid = existing.userid || existing.userId;
                    db.run('UPDATE users SET supplierId = $1 WHERE userId = $2', [supplierId, uid], (err) => {
                        if (err) return reject(err);
                        resolve(existing);
                    });
                    return;
                }

                const hashedPassword = await bcrypt.hash(tempPassword, 10);
                const sql = `INSERT INTO users (username, password, email, role, supplierId, mustChangePassword)
                    VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`;

                db.get(sql, [email, hashedPassword, email, 'SUPPLIER', supplierId, true], (err, result) => {
                    if (err) return reject(err);
                    resolve(result);
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Generate a template workbook as a Buffer for download.
     */
    static generateTemplate() {
        const headers = [
            'Company Legal Name',
            'Business Type',
            'Country',
            'Tax ID',
            'GSTIN',
            'Bank Name',
            'Account Number',
            'Routing Number',
            'Website',
            'Description',
            'Contact First Name',
            'Contact Last Name',
            'Contact Email',
            'Contact Phone',
            'Address Line 1',
            'City',
            'Postal Code'
        ];

        const sampleRow = {
            'Company Legal Name': 'Acme Corp',
            'Business Type': 'Corporation',
            'Country': 'India',
            'Tax ID': 'ABCDE1234F',
            'GSTIN': '22AAAAA0000A1Z5',
            'Bank Name': 'State Bank',
            'Account Number': '1234567890',
            'Routing Number': 'SBIN0001234',
            'Website': 'https://acme.com',
            'Description': 'Manufacturing',
            'Contact First Name': 'John',
            'Contact Last Name': 'Doe',
            'Contact Email': 'john@acme.com',
            'Contact Phone': '+91-9876543210',
            'Address Line 1': '123 Industrial Area',
            'City': 'Mumbai',
            'Postal Code': '400001'
        };

        const ws = XLSX.utils.json_to_sheet([sampleRow], { header: headers });

        // Set column widths
        ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length + 2, 18) }));

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Suppliers');

        return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    }
}

module.exports = BulkUploadService;
