import { test } from "node:test";
import assert from "node:assert/strict";
import {
  notesToMarkdown,
  flashcardsToAnkiCsv,
  quizToMarkdown,
} from "../src/export/exporters.ts";
import type { RevisionNotes, Flashcard, Quiz } from "../src/types.ts";

test("notesToMarkdown renders topics, timestamps, citations, and flags", () => {
  const notes: RevisionNotes = {
    topics: [
      {
        title: "Collisions",
        start: 31,
        points: [
          { text: "Two keys can collide.", sourceRefs: ["seg-3"], confidence: 0.58, flagged: true },
          { text: "Use chaining.", sourceRefs: ["seg-5"], confidence: 0.93, flagged: false },
        ],
      },
    ],
  };
  const md = notesToMarkdown("lec-1", notes);
  assert.match(md, /# lec-1 — Revision Notes/);
  assert.match(md, /## Collisions {2}_\(@0:31\)_/);
  assert.match(md, /- Two keys can collide\. _\(cite: seg-3\)_ ⚠️/);
  assert.match(md, /- Use chaining\. _\(cite: seg-5\)_$/m);
});

test("flashcardsToAnkiCsv quotes and escapes fields", () => {
  const cards: Flashcard[] = [
    { front: 'What is a "hash"?', back: { text: "A map, key,value", sourceRefs: ["seg-1"], confidence: 0.9, flagged: false } },
  ];
  const csv = flashcardsToAnkiCsv(cards);
  // embedded quotes doubled, comma-containing field stays in one column
  assert.equal(csv.trim(), '"What is a ""hash""?","A map, key,value"');
});

test("quizToMarkdown includes questions and an answer key", () => {
  const quiz: Quiz = {
    questions: [
      {
        question: "Best case lookup?",
        options: ["O(1)", "O(n)"],
        answerIndex: 0,
        explanation: { text: "Average O(1).", sourceRefs: ["seg-2"], confidence: 0.92, flagged: false },
      },
    ],
  };
  const md = quizToMarkdown("lec-1", quiz);
  assert.match(md, /\*\*Q1\. Best case lookup\?\*\*/);
  assert.match(md, /- \(A\) O\(1\)/);
  assert.match(md, /## Answer key/);
  assert.match(md, /1\. \*\*A\*\* — Average O\(1\)\./);
});
