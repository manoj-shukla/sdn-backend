const jwt = require('jsonwebtoken');

const SECRET_KEY = process.env.JWT_SECRET || "sdn-tech-super-secret-key";

// Middleware to verify token
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.sendStatus(401);

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) {
            console.error('[AuthMiddleware] Token verification failed:', err.message);
            return res.sendStatus(401);
        }
        req.user = user;

        // Context override headers for multi-tenancy (Secure)
        if (req.headers['x-supplier-id'] && req.headers['x-supplier-id'] !== 'undefined' && req.headers['x-supplier-id'] !== 'null') {
            const requestedSupplierId = parseInt(req.headers['x-supplier-id'], 10);
            if (req.user.role === 'ADMIN' || req.user.supplierId === requestedSupplierId) {
                req.user.supplierId = requestedSupplierId;
            }
            else if (req.user.memberships && Array.isArray(req.user.memberships)) {
                const isMember = req.user.memberships.some(m =>
                    parseInt(m.supplierId || m.supplierid) === requestedSupplierId
                );
                if (isMember) {
                    req.user.supplierId = requestedSupplierId;
                }
            }
        }

        if (req.headers['x-buyer-id'] && req.headers['x-buyer-id'] !== 'undefined' && req.headers['x-buyer-id'] !== 'null') {
            const requestedBuyerId = parseInt(req.headers['x-buyer-id'], 10);
            if (req.user.role === 'ADMIN' || req.user.buyerId === requestedBuyerId) {
                req.user.buyerId = requestedBuyerId;
            } else if (req.user.memberships && Array.isArray(req.user.memberships)) {
                const isMember = req.user.memberships.some(m =>
                    parseInt(m.buyerId || m.buyerid) === requestedBuyerId
                );
                if (isMember) {
                    req.user.buyerId = requestedBuyerId;
                }
            }
        }

        next();
    });
};

const requireRole = (roles) => {
    return (req, res, next) => {
        if (!req.user) return res.sendStatus(401);

        const permittedRoles = Array.isArray(roles) ? roles : [roles];

        if (req.user.role === 'ADMIN' || permittedRoles.includes(req.user.role)) {
            return next();
        }

        console.log(`[requireRole DEBUG] DENIED: ${req.user.role} NOT IN ${JSON.stringify(permittedRoles)}`);
        return res.status(403).json({ error: "Forbidden: Insufficient Role" });
    };
};

const denyRole = (roleToDeny) => {
    return (req, res, next) => {
        if (!req.user) return res.sendStatus(401);
        if (req.user.role === roleToDeny) {
            return res.status(403).json({ error: "Forbidden: Access denied for this role" });
        }
        next();
    };
};

const enforceSelfOrAdmin = (req, res, next) => {
    if (!req.user) return res.sendStatus(401);
    const targetUserId = parseInt(req.params.id);
    if (isNaN(targetUserId)) return res.status(400).json({ error: "Invalid user ID" });

    // 1. Platform Admin
    if (req.user.role === 'ADMIN') return next();

    // 2. Self
    if (req.user.userId === targetUserId) return next();

    // 3. Buyer Admin
    const role = req.user.role;
    const subRole = (req.user.subRole || req.user.subrole || "").toString().toLowerCase().trim();
    // Support a wider range of admin-like subroles for flexibility
    const adminSubRoles = ['admin', 'buyer admin', 'buyer_admin', 'super admin', 'super_admin'];

    if (role === 'BUYER' && adminSubRoles.includes(subRole)) {
        const UserService = require('../services/UserService');
        UserService.getUserById(targetUserId)
            .then(targetUser => {
                if (!targetUser) return res.status(404).json({ error: "Target user not found" });

                const requesterBuyerId = req.user.buyerId || req.user.buyerid;
                const targetBuyerId = targetUser.buyerId || targetUser.buyerid;

                // Use string comparison for robustness across number/string types
                if (requesterBuyerId && targetBuyerId && String(requesterBuyerId) === String(targetBuyerId)) {
                    console.log(`[enforceSelfOrAdmin] Buyer Admin ${req.user.userId} authorized for User ${targetUserId} in Org ${requesterBuyerId}`);
                    return next();
                }

                console.log(`[enforceSelfOrAdmin] DENIED: Org mismatch. RequesterOrg=${requesterBuyerId}, TargetOrg=${targetBuyerId}`);
                return res.status(403).json({ error: "Forbidden: Access denied" });
            })
            .catch(err => {
                console.error('[enforceSelfOrAdmin] Error:', err);
                return res.status(500).json({ error: "Internal server error" });
            });
        return;
    }

    return res.status(403).json({ error: "Forbidden: Access denied" });
};

const requireAdmin = (req, res, next) => {
    if (!req.user) return res.sendStatus(401);

    const role = req.user.role;
    // Handle both subRole and subrole (Postgres lowercase)
    const subRoleRaw = (req.user.subRole || req.user.subrole || "").toString().trim();
    const subRole = subRoleRaw.toLowerCase();

    // Consolidate admin roles to:
    // 1. Super Admin (role === 'ADMIN')
    // 2. Buyer Admin (role === 'BUYER' && subRole in ['admin', 'buyer admin'])
    // 3. Delegation (role === 'BUYER' && subRole in ['supplier inviter', 'supplier inviter / requestor'])
    const adminSubRoles = ['admin', 'buyer admin'];
    // Full mapping of SDN default workflow roles
    const delegatorSubRoles = [
        'supplier inviter',
        'supplier inviter / requestor',
        'procurement reviewer',
        'compliance reviewer',
        'finance approver',
        'accounts payable (ap) activator',
        'ap activator',
        'finance reviewer'
    ];

    const isAllowed = role === 'ADMIN' ||
        (role === 'BUYER' && (adminSubRoles.includes(subRole) || delegatorSubRoles.includes(subRole)));

    if (isAllowed) {
        console.log(`[requireAdmin/requirePrivileged] PASS for role: ${role}, subRole: "${subRoleRaw}"`);
        return next();
    }

    console.log(`[requireAdmin] Access Denied for role: ${role}, subRole: "${subRoleRaw}". Matches: [${adminSubRoles.join(', ')}] = ${adminSubRoles.includes(subRole)}`);
    return res.status(403).json({ error: "Forbidden: Admin or Delegated access required" });
};

module.exports = { authenticateToken, requireRole, requireAdmin, denyRole, enforceSelfOrAdmin, SECRET_KEY };
