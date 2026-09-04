CREATE TABLE "worker_heartbeats" (
	"worker_id" uuid PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL
);
