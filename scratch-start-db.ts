import { MongoMemoryServer } from "mongodb-memory-server";
import { writeFileSync } from "fs";

async function main() {
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri("pcmb_test");
  writeFileSync("scratch-mongo-uri.txt", uri);
  console.log("MONGO_READY", uri);
  // keep process alive
  process.stdin.resume();
}

main();
