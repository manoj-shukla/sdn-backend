const UserService = require('../services/UserService');

class UserController {
    static async getUsers(req, res) {
        try {
            const page = parseInt(req.query.page) || 1;
            const pageSize = parseInt(req.query.pageSize) || 10;
            const filters = {
                role: req.query.role,
                buyerId: req.query.buyerId ? parseInt(req.query.buyerId) : undefined,
                search: req.query.search
            };
            const result = await UserService.getUsers(page, pageSize, filters);
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    static async getAdmins(req, res) {
        try {
            const users = await UserService.getAdmins();
            res.json(users);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    static async getBuyerUsers(req, res) {
        try {
            const buyerId = parseInt(req.params.buyerId);
            if (isNaN(buyerId)) return res.status(400).json({ error: "Invalid buyerId provided." });

            // RBAC/Data Isolation: BUYER role can only see their own buyer's users
            if (req.user.role === 'BUYER' && req.user.buyerId !== buyerId) {
                return res.status(403).json({ error: "Forbidden: You can only access users from your own buyer organization." });
            }

            const users = await UserService.getBuyerUsers(buyerId);
            res.json(users);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    static async changePassword(req, res) {
        try {
            const { currentPassword, newPassword } = req.body;
            const userId = parseInt(req.params.id);
            if (isNaN(userId)) return res.status(400).json({ error: "Invalid userId provided." });

            const result = await require('../services/AuthService').changePassword(userId, currentPassword, newPassword);
            res.json(result);
        } catch (err) {
            const status = err.message.includes('Current password') ? 401 : 400;
            res.status(status).json({ error: err.message });
        }
    }

    static async getUserById(req, res) {
        try {
            const userId = parseInt(req.params.id);
            if (isNaN(userId)) return res.status(400).json({ error: "Invalid userId provided." });

            const user = await UserService.getUserById(userId);
            if (!user) return res.status(404).json({ error: "User not found" });
            res.json(user);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    static async updateUserRole(req, res) {
        try {
            const userId = parseInt(req.params.id);
            if (isNaN(userId)) return res.status(400).json({ error: "Invalid userId provided." });

            const { role, subRole, buyerId, supplierId } = req.body;
            if (!role) return res.status(400).json({ error: "Role is required" });

            const updateData = { role };
            if (subRole) updateData.subRole = subRole;
            if (buyerId !== undefined) updateData.buyerId = buyerId;
            if (supplierId !== undefined) updateData.supplierId = supplierId;

            const user = await UserService.updateUser(userId, updateData);
            res.json(user);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    static async updateUserStatus(req, res) {
        try {
            const userId = parseInt(req.params.id);
            if (isNaN(userId)) return res.status(400).json({ error: "Invalid userId provided." });

            const { isActive, reason } = req.body;
            if (isActive === undefined) return res.status(400).json({ error: "isActive is required" });

            const user = await UserService.updateUser(userId, { isActive: isActive ? 1 : 0 });
            res.json({ ...user, isActive, reason });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    static async updateUserProfile(req, res) {
        try {
            const userId = parseInt(req.params.id);
            if (isNaN(userId)) return res.status(400).json({ error: "Invalid userId provided." });

            // Prevent updating sensitive fields via profile endpoint
            const { role, password, username, isActive, ...profileData } = req.body;
            if (role || password || username || isActive !== undefined) {
                return res.status(400).json({ error: "Cannot update sensitive fields via profile endpoint" });
            }

            const user = await UserService.updateUser(userId, profileData);
            res.json(user);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    static async createUser(req, res) {
        try {
            console.log('[UserController] Creating user. Body:', { ...req.body, password: req.body.password ? '***' : undefined }, 'User:', req.user?.userId);
            // Setup defaults based on caller's role
            if (req.user && req.user.role === 'ADMIN') {
                const { role, subRole, password } = req.body;
                if (password && password.length < 8) {
                    return res.status(400).json({ error: "Password must be at least 8 characters long." });
                }
                if (!subRole && role === 'ADMIN') req.body.subRole = 'User';
            } else if (req.user && req.user.role === 'BUYER') {
                // Buyer Admins creating users MUST be restricted to their own org and BUYER role
                req.body.role = 'BUYER';
                req.body.buyerId = req.user.buyerId || req.user.buyerid;
                console.log('[UserController] Restricted to Buyer org:', req.body.buyerId);
                if (req.body.password && req.body.password.length < 8) {
                    return res.status(400).json({ error: "Password must be at least 8 characters long." });
                }
            }

            const user = await UserService.createUser(req.body);
            console.log('[UserController] User created successfully:', user?.userId);
            res.json(user);
        } catch (err) {
            console.error('[UserController] Create user FAILED:', err);
            // Handle duplicate key errors (username or email already exists)
            if (err.message && (err.message.includes('UNIQUE') || err.message.includes('duplicate') || err.message.includes('already exists'))) {
                const field = err.message.toLowerCase().includes('username') ? 'username' : 'email';
                return res.status(400).json({ error: `A user with this ${field} already exists` });
            }
            res.status(500).json({ error: err.message });
        }
    }

    static async updateUser(req, res) {
        try {
            const userId = parseInt(req.params.id);
            if (isNaN(userId)) return res.status(400).json({ error: "Invalid user ID" });

            // Fetch current user (if needed for other validation, otherwise optional)
            const currentUser = await UserService.getUserById(userId);
            if (!currentUser) return res.status(404).json({ error: "User not found" });

            // Robustness: Always strip username and email from standard update to prevent illegal changes
            // Email also shouldn't be changed here usually, but we'll focus on username as requested.
            // We just ignore the username from the body if sent, instead of erroring.
            const { username, ...updateData } = req.body;

            const user = await UserService.updateUser(userId, updateData);
            res.json(user);
        } catch (err) {
            if (err.message && (err.message.includes('UNIQUE') || err.message.includes('duplicate') || err.message.includes('already exists'))) {
                const field = err.message.toLowerCase().includes('username') ? 'username' : 'email';
                return res.status(400).json({ error: `A user with this ${field} already exists` });
            }
            res.status(500).json({ error: err.message });
        }
    }

    static async deleteUser(req, res) {
        try {
            const userIdToDelete = parseInt(req.params.id);
            const performedByUserId = req.user ? (req.user.userId || req.user.userid) : null;
            
            await UserService.deleteUser(userIdToDelete, performedByUserId);
            res.sendStatus(200);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    static async bulkCreateUsers(req, res) {
        try {
            const { users } = req.body;
            if (!users || !Array.isArray(users)) {
                return res.status(400).json({ error: "Users array is required" });
            }
            const result = await UserService.bulkCreateUsers(users);
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }
}

module.exports = UserController;
