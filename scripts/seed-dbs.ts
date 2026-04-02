import { seedDbs } from "@/lib/db/seedDbs";

async function main() {
  console.log("Seeding dummy analytics databases...");
  await seedDbs({ forceRecreate: true });
  console.log("Done. Dummy DBs created under ./data/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

