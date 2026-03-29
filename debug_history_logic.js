const DocumentService = require('./services/DocumentService');
const db = require('./config/database');

async function test() {
    console.log("--- TEST START ---");

    // 1. Mock DB returns
    // We can't easily mock DB here without intrusive changes or a mocking library.
    // Instead, I'll copy the logic function and run it with mock data.

    const mockPersistentDocs = [
        { documentId: 101, documentType: 'Tax Cert', documentName: 'Old_Approved.pdf', verificationStatus: 'APPROVED', createdAt: '2023-01-01T00:00:00Z' },
        { documentId: 102, documentType: 'Other', documentName: 'Random.pdf', verificationStatus: 'APPROVED', createdAt: '2023-01-01T00:00:00Z' }
    ];

    const mockPendingDocs = [
        { documentId: -50, documentType: 'Tax Cert', documentName: 'New_Pending.pdf', verificationStatus: 'PENDING_APPROVAL', createdAt: '2023-06-01T00:00:00Z' }
    ];

    // LOGIC FROM DocumentService.getSupplierDocuments
    let allDocs = [...mockPendingDocs, ...mockPersistentDocs];
    const docsByType = {};
    allDocs.forEach(d => {
        const type = d.documentType || 'Other';
        if (!docsByType[type]) docsByType[type] = [];
        docsByType[type].push(d);
    });

    const processedDocs = [];
    Object.values(docsByType).forEach(group => {
        // Sort by createdAt DESC
        group.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        let foundLatestApproved = false;
        group.forEach(doc => {
            const status = (doc.verificationStatus || '').toUpperCase();
            const isApproved = ['APPROVED', 'VERIFIED'].includes(status);

            if (isApproved) {
                if (!foundLatestApproved) {
                    foundLatestApproved = true; // Keep as APPROVED/VERIFIED
                } else {
                    doc.verificationStatus = 'ARCHIVED'; // Flag as old
                }
            }
            processedDocs.push(doc);
        });
    });

    // Sort
    processedDocs.sort((a, b) => {
        if (a.documentType < b.documentType) return -1;
        if (a.documentType > b.documentType) return 1;
        return new Date(b.createdAt) - new Date(a.createdAt);
    });

    console.log("--- RESULTS ---");
    processedDocs.forEach(d => {
        console.log(`[${d.documentId}] ${d.documentType} - ${d.documentName} (${d.verificationStatus})`);
    });
}

test();
