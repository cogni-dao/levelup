CREATE TABLE "agent_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"claimed_by" text,
	CONSTRAINT "agent_claims_claimed_together" CHECK (("agent_claims"."claimed_at" IS NULL) = ("agent_claims"."claimed_by" IS NULL)),
	CONSTRAINT "agent_claims_claimant_not_agent" CHECK ("agent_claims"."claimed_by" IS NULL OR "agent_claims"."claimed_by" <> "agent_claims"."agent_user_id")
);
--> statement-breakpoint
ALTER TABLE "agent_claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agent_spawn_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issuer_user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_at" timestamp with time zone,
	"redeemed_user_id" text,
	CONSTRAINT "agent_spawn_grants_redeemed_together" CHECK (("agent_spawn_grants"."redeemed_at" IS NULL) = ("agent_spawn_grants"."redeemed_user_id" IS NULL)),
	CONSTRAINT "agent_spawn_grants_expiry_after_issue" CHECK ("agent_spawn_grants"."expires_at" > "agent_spawn_grants"."created_at")
);
--> statement-breakpoint
ALTER TABLE "agent_spawn_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_principals" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
ALTER TABLE "agent_roles" ADD COLUMN "resource_kind" text DEFAULT 'node' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_roles" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
ALTER TABLE "agent_roles" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_claims" ADD CONSTRAINT "agent_claims_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_claims" ADD CONSTRAINT "agent_claims_claimed_by_users_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_spawn_grants" ADD CONSTRAINT "agent_spawn_grants_issuer_user_id_users_id_fk" FOREIGN KEY ("issuer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_spawn_grants" ADD CONSTRAINT "agent_spawn_grants_redeemed_user_id_users_id_fk" FOREIGN KEY ("redeemed_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_claims_agent_idx" ON "agent_claims" USING btree ("agent_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_spawn_grants_token_hash_unique" ON "agent_spawn_grants" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "agent_spawn_grants_issuer_idx" ON "agent_spawn_grants" USING btree ("issuer_user_id");--> statement-breakpoint
ALTER TABLE "agent_principals" ADD CONSTRAINT "agent_principals_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_roles" ADD CONSTRAINT "agent_roles_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_principals_owner_idx" ON "agent_principals" USING btree ("owner_user_id");--> statement-breakpoint
ALTER TABLE "agent_principals" ADD CONSTRAINT "agent_principals_owner_external_only" CHECK ("agent_principals"."kind" = 'external' OR "agent_principals"."owner_user_id" IS NULL);--> statement-breakpoint
ALTER TABLE "agent_principals" ADD CONSTRAINT "agent_principals_owner_not_self" CHECK ("agent_principals"."owner_user_id" IS NULL OR "agent_principals"."owner_user_id" <> "agent_principals"."user_id");--> statement-breakpoint
ALTER TABLE "agent_roles" ADD CONSTRAINT "agent_roles_resource_kind_canonical" CHECK ("agent_roles"."resource_kind" IN ('node','delegated'));--> statement-breakpoint
ALTER TABLE "agent_roles" ADD CONSTRAINT "agent_roles_owner_shape" CHECK (("agent_roles"."resource_kind" = 'node') = ("agent_roles"."owner_user_id" IS NULL));--> statement-breakpoint
ALTER TABLE "agent_roles" ADD CONSTRAINT "agent_roles_personal_approver" CHECK ("agent_roles"."resource_kind" = 'node' OR "agent_roles"."approved_by" IS NULL OR ("agent_roles"."approved_by" = "agent_roles"."owner_user_id" AND "agent_roles"."approved_by" <> "agent_roles"."principal_user_id" AND "agent_roles"."expires_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "agent_roles" ADD CONSTRAINT "agent_roles_personal_scope_delegable" CHECK ("agent_roles"."resource_kind" = 'node' OR "agent_roles"."scope" IN ('knowledge:read','knowledge:contribute'));
--> statement-breakpoint
-- Hand-written below: FORCE RLS is outside Drizzle's DDL scope. Shape: the @cogni-dao/agent-grants templates agent_spawn_grants.sql and
-- agent_personal_grants.sql (node-template 0041 + 0042), folded into one EXPAND-ONLY migration: nullable or defaulted columns and new tables;
-- nothing is rewritten. Every existing agent_roles row is a node row (DEFAULT 'node'), every existing agent_principals row stays ownerless.
-- agent_spawn_grants and agent_claims have NO policy: ENABLE + FORCE = deny-all for the app role. Only the BYPASSRLS service role reads or
-- writes them (the register, claim and owner routes). A personal row is the owner's decision (approved_by = owner_user_id, never the agent),
-- always ends (expires_at), and only for the delegable list; node reads in the package filter on resource_kind = 'node'.
ALTER TABLE "agent_spawn_grants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_claims" FORCE ROW LEVEL SECURITY;
