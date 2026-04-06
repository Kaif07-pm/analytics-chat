import { seedDbs } from "@/lib/db/seedDbs";

async function main() {
  console.log("Bootstrapping dummy events into shared events DB (no recreate)...");

  // If events already exist, seedDbs will NOT reinsert dummy events (it checks row count).
  await seedDbs({
    forceRecreate: false,
    eventCount: Number(process.env.SEED_EVENT_COUNT ?? "60000")
  });

  console.log("Done. Events DB populated (if it was empty).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

