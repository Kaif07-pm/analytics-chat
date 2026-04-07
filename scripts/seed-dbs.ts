import { seedDbs } from "../src/lib/db/seedDbs";

async function main() {
  console.log("Seeding databases with exhaustive dummy data...");
  try {
    await seedDbs({ forceRecreate: true });
    console.log("Done!");
  } catch (err) {
    console.error("Failed to seed databases:", err);
    process.exit(1);
  }
}

main();
