import { mkdir, writeFile } from "node:fs/promises";

const query = `
  query studyPlanDetail($slug:String!) {
    studyPlanV2Detail(planSlug:$slug) {
      name
      slug
      planSubGroups {
        name
        slug
        questions {
          questionFrontendId
          title
          titleSlug
          translatedTitle
          difficulty
          paidOnly
        }
      }
    }
  }
`;

const response = await fetch("https://leetcode.cn/graphql/", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ query, variables: { slug: "top-100-liked" } })
});

if (!response.ok) {
  throw new Error(`LeetCode API returned ${response.status}`);
}

const payload = await response.json();
const detail = payload.data?.studyPlanV2Detail;

if (!detail?.planSubGroups?.length) {
  throw new Error("Hot 100 study plan payload is empty");
}

let order = 1;
const groups = detail.planSubGroups.map((group) => ({
  name: group.name,
  slug: group.slug,
  questions: group.questions.map((question) => ({
    order: order++,
    id: question.questionFrontendId,
    title: question.translatedTitle || question.title,
    englishTitle: question.title,
    slug: question.titleSlug,
    difficulty: question.difficulty,
    paidOnly: Boolean(question.paidOnly),
    category: group.name,
    url: `https://leetcode.cn/problems/${question.titleSlug}/`
  }))
}));

const questions = groups.flatMap((group) => group.questions);
const data = {
  source: "https://leetcode.cn/studyplan/top-100-liked/",
  fetchedAt: new Date().toISOString(),
  name: detail.name,
  slug: detail.slug,
  total: questions.length,
  groups,
  questions
};

await mkdir("src/data", { recursive: true });
await writeFile("src/data/hot100.json", `${JSON.stringify(data, null, 2)}\n`);
console.log(`Saved ${questions.length} questions across ${groups.length} groups.`);
