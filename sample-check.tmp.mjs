const csv = await import("./src/lib/cohorts/parse.ts");
const coh = await import("./src/lib/db/cohorts.ts");

const SAMPLE = `Roll No,Student Name,Project Title,Idea Description
21CS001,Aarav Shah,Mess Forecast,"A tool that predicts how many students will eat dinner in the hostel mess so the kitchen cooks less and wastes less"
21CS002,Diya Nair,Lab Matcher,"A platform connecting undergraduates with professors' research labs based on their coursework and interests"
21CS003,Kabir Das,Meal Demand,"Predicting hostel dinner headcount ahead of time so kitchens can reduce over-preparation and food waste"
21CS004,Meera Rao,Air Watch,"A low-cost sensor that logs classroom carbon dioxide through the day and flags poorly ventilated rooms"
21CS005,Rohan Iyer,Research Connect,"Helping students find professors whose labs match what they have studied and want to work on"
21CS006,Sana Qureshi,Drain Sense,"Ranking municipal drains by how likely they are to block and cause waterlogging during monsoon"
21CS007,Vikram Menon,Solar Check,"Checking whether a rooftop solar installation quote is fairly priced against local benchmarks"
21CS008,Ananya Bose,Viva Prep,"Generating likely viva questions from a student's own project report so they can rehearse"`;

const parsed = csv.parseSubmissions(SAMPLE);
console.log(`parsed ${parsed.rows.length} rows, skipped ${parsed.skipped.length}`);

const org = `sample-check-${Date.now()}`;
await coh.importCohort({ orgId: org, batch: "Sample", rows: parsed.rows });
const r = await coh.cohortReport({ orgId: org, batch: "Sample" });

console.log(`\n${r.groups.length} group(s), ${r.clustered} of ${r.submissions.length} clustered\n`);
for (const g of r.groups) {
  console.log(`  ${Math.round(g.peak * 100)}% alike:`);
  for (const id of g.ids) {
    const s = r.submissions.find((x) => x.id === id);
    console.log(`     ${s.studentName.padEnd(14)} ${s.title}`);
  }
}
console.log("\nleast distinctive first:");
for (const s of [...r.submissions].sort((a, b) => a.novelty - b.novelty)) {
  console.log(`  ${String(Math.round(s.novelty * 100)).padStart(3)}%  ${s.studentName.padEnd(14)} ${s.title}`);
}
await coh.deleteBatch(org, "Sample");
console.log("\n(cleaned up)");
