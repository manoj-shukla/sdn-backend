const db = require('../config/database');

class RoleService {
    static async getRoles(buyerId) {
        return new Promise((resolve, reject) => {
            db.all("SELECT roleid as \"roleId\", buyerid as \"buyerId\", rolename as \"roleName\", description, permissions, createdat as \"createdAt\" FROM buyer_roles WHERE buyerid = ?", [buyerId], (err, rows) => {
                if (err) return reject(err);
                // Parse permissions JSON if it's a string
                const roles = rows.map(r => ({
                    ...r,
                    permissions: typeof r.permissions === 'string' ? JSON.parse(r.permissions) : (r.permissions || [])
                }));
                resolve(roles);
            });
        });
    }

    static async createRole(data) {
        return new Promise((resolve, reject) => {
            const { buyerId, roleName, description, permissions } = data;
            const permissionsStr = JSON.stringify(permissions || []);

            db.run(`INSERT INTO buyer_roles (buyerid, rolename, description, permissions) VALUES (?, ?, ?, ?)`,
                [buyerId, roleName, description, permissionsStr],
                function (err) {
                    if (err) return reject(err);
                    db.get("SELECT roleid as \"roleId\", buyerid as \"buyerId\", rolename as \"roleName\", description, permissions, createdat as \"createdAt\" FROM buyer_roles WHERE roleid = ?", [this.lastID], (err, row) => {
                        if (err) return reject(err);
                        if (row && typeof row.permissions === 'string') {
                            try { row.permissions = JSON.parse(row.permissions); } catch (e) { row.permissions = []; }
                        }
                        resolve(row);
                    });
                }
            );
        });
    }

    static async updateRole(roleId, data) {
        return new Promise((resolve, reject) => {
            const { roleName, description, permissions } = data;
            const permissionsStr = permissions ? JSON.stringify(permissions) : undefined;

            const updates = [];
            const params = [];

            if (roleName !== undefined) { updates.push('rolename = ?'); params.push(roleName); }
            if (description !== undefined) { updates.push('description = ?'); params.push(description); }
            if (permissionsStr !== undefined) { updates.push('permissions = ?'); params.push(permissionsStr); }

            if (updates.length === 0) return resolve(this.getRoleById(roleId));

            params.push(roleId);
            db.run(`UPDATE buyer_roles SET ${updates.join(', ')} WHERE roleid = ?`, params, function (err) {
                if (err) return reject(err);
                db.get("SELECT roleid as \"roleId\", buyerid as \"buyerId\", rolename as \"roleName\", description, permissions, createdat as \"createdAt\" FROM buyer_roles WHERE roleid = ?", [roleId], (err, row) => {
                    if (err) return reject(err);
                    if (row && typeof row.permissions === 'string') row.permissions = JSON.parse(row.permissions);
                    resolve(row);
                });
            });
        });
    }

    static async deleteRole(roleId) {
        return new Promise((resolve, reject) => {
            db.run("DELETE FROM buyer_roles WHERE roleid = ?", [roleId], (err) => err ? reject(err) : resolve());
        });
    }

    static async getRoleById(roleId) {
        return new Promise((resolve, reject) => {
            db.get("SELECT roleId as \"roleId\", buyerId as \"buyerId\", roleName as \"roleName\", description, permissions, createdAt as \"createdAt\" FROM buyer_roles WHERE roleId = ?", [roleId], (err, row) => {
                if (err) return reject(err);
                if (row && typeof row.permissions === 'string') row.permissions = JSON.parse(row.permissions);
                resolve(row);
            });
        });
    }
}

module.exports = RoleService;
