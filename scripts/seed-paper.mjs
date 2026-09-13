// Inserts a hand-authored paper (questions with LaTeX maths) into MongoDB.
//
//   node --env-file=.env scripts/seed-paper.mjs scripts/data/trigonometry-set1.json
//
// The JSON holds { paper, questions } in the shapes of src/models/Paper.ts and
// src/models/Question.ts. Re-running with the same paper title replaces the
// earlier copy and its questions, so a data file can be edited and re-seeded.
import { readFile } from "fs/promises";
import mongoose from "mongoose";

const file = process.argv[2];
if (!file) {
  console.error("usage: node --env-file=.env scripts/seed-paper.mjs <data.json>");
  process.exit(1);
}
if (!process.env.MONGODB_URI) {
  console.error("MONGODB_URI is not set (run with --env-file=.env)");
  process.exit(1);
}

const { paper, questions } = JSON.parse(await readFile(file, "utf8"));

await mongoose.connect(process.env.MONGODB_URI);
// Same collection names the app's models resolve to (Mongoose 9 maps the
// "Paper" model to a collection called "paper", not "papers").
const collectionFor = (modelName) => mongoose.connection.collection(mongoose.pluralize()(modelName));
const papers = collectionFor("Paper");
const questionsCol = collectionFor("Question");

const existing = await papers.findOne({ title: paper.title });
if (existing) {
  await questionsCol.deleteMany({ paperId: existing._id });
  await papers.deleteOne({ _id: existing._id });
  console.log(`replaced existing paper ${existing._id}`);
}

const { insertedId } = await papers.insertOne({
  ...paper,
  totalQuestions: questions.length,
  uploadedDate: new Date(),
});

await questionsCol.insertMany(
  questions.map((q) => ({
    section: "A",
    answerType: "MCQ",
    difficulty: "Medium",
    explanation: "",
    source: "",
    diagramUrls: [],
    explanationDiagramUrls: [],
    optionDiagramUrls: { A: [], B: [], C: [], D: [] },
    ...q,
    paperId: insertedId,
  }))
);

console.log(`seeded "${paper.title}" (${insertedId}) with ${questions.length} questions`);
console.log(`open http://localhost:3000/papers/${insertedId}`);
await mongoose.disconnect();
