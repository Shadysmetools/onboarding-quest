import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileQuest } from "../lib/compile.mjs";

const example = JSON.parse(readFileSync(new URL("../quests.example.json", import.meta.url), "utf8"));

test("the example quest compiles", () => {
  const q = compileQuest(example);
  assert.ok(q.days.length >= 3);
  assert.equal(q.days[0].steps[0].k, "s1-1");
  // a day with quizzes gets an automatic quiz step at the end
  const last = q.days[0].steps.at(-1);
  assert.deepEqual(last.quiz, example.days[0].quizzes);
  // videos are numbered for "watched #N"
  assert.equal(q.videoNums["1"], example.videos[0].url);
  assert.ok(q.exam.pass <= q.exam.count);
});

test("broken quest files are rejected with every problem listed", () => {
  const bad = structuredClone(example);
  bad.days[0].quizzes = ["nope"];
  bad.days[1].videos = ["missing-video"];
  bad.quizzes.git.questions[0].answer = 9;
  assert.throws(() => compileQuest(bad), e => e.errors.length === 3);
  assert.throws(() => compileQuest({ title: "" }), /title is required/);
});

test("exam can be disabled", () => {
  assert.equal(compileQuest({ ...example, exam: false }).exam, null);
});
