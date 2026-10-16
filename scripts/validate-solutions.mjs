import { loadContent, validateContent } from "./validate-schema.mjs";

const { hot100, solutions } = loadContent();
const errors = validateContent({ hot100, solutions });
for (const solution of solutions) {
  const id = solution.id || "unknown";
  if (!solution.description || solution.description.length < 100) errors.push(`${id}.description: missing problem description`);
  if (!solution.explanation || solution.explanation.length < 100) errors.push(`${id}.explanation: missing explanation`);
  if (!Array.isArray(solution.examples) || solution.examples.length === 0) errors.push(`${id}.examples: missing reading examples`);
  if (solution.examples?.some((example) => !example.input || !example.output)) errors.push(`${id}.examples: input and output are required`);
  if (!Array.isArray(solution.tables) || !Array.isArray(solution.images)) errors.push(`${id}.media: tables and images must be arrays`);
  if (solution.images?.some((image) => !/^(https?:\/\/|\/solutions\/)/.test(image.url || ""))) errors.push(`${id}.images: invalid image source`);
  if (!solution.solutionSource && !solution.fallbackSource) errors.push(`${id}.sources: missing legacy source link`);
  if (solution.explanation?.includes("C++代码")) errors.push(`${id}.explanation: unrelated language leaked into explanation`);
}
if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log(`validated ${solutions.length} solution records`);
}
