import { readFileSync, writeFileSync } from 'node:fs';

const raw = readFileSync('C:/Users/NEW/.gemini/antigravity-ide/brain/a65c779c-cb70-4e70-acc1-784068df1497/.system_generated/steps/3943/output.txt', 'utf8');
const data = JSON.parse(raw);
const threads = data.review_threads;

const list = threads.map((t, i) => {
  const c = t.comments[0];
  const body = c.body;
  const sevMatch = body.match(/P[123]/);
  const sev = sevMatch ? sevMatch[0] : 'P2';
  const cleanBody = body.replace(/<!--[\s\S]*?-->/g, '').replace(/<details>[\s\S]*?<\/details>/g, '').trim();
  const summary = cleanBody.split('\n')[0];
  const suggestionMatch = body.match(/```suggestion\n([\s\S]*?)\n```/);
  const suggestion = suggestionMatch ? suggestionMatch[1] : null;
  return {
    index: i + 1,
    id: t.id,
    path: c.path,
    line: c.line ?? c.original_line,
    severity: sev,
    summary,
    fullComment: cleanBody,
    suggestion
  };
});

console.log(`Total threads parsed: ${list.length}`);
writeFileSync('scratch_threads.json', JSON.stringify(list, null, 2));
for (const item of list) {
  console.log(`[#${item.index}] [${item.severity}] ${item.path}:${item.line} -> ${item.summary}`);
}
