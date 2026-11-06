ALTER TABLE "client" ADD COLUMN "monthlyCost" numeric(14, 2);--> statement-breakpoint
-- Impeesa: admins get the new stats permissions in every existing workspace
-- (new workspaces take them from defaultRolePermissions).
INSERT INTO "workspace_role_permissions" ("workspaceRoleId", "permission", "granted")
SELECT r."id", p."permission", true
FROM "workspace_roles" r
CROSS JOIN (VALUES ('time:view'), ('finance:view')) AS p("permission")
WHERE r."name" = 'admin'
ON CONFLICT ("workspaceRoleId", "permission") DO NOTHING;
