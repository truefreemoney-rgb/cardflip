/**
 * Pins the Back-button stack behind sheets (review 10-19 #2/#3): Back closes
 * only the top entry, a sheet's own Done releases its entry without touching
 * the camera under it, and none of it reads history.state.
 * Run: npm run test:backstack
 */
const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { createBackStack } = await import(at("lib/client/useBackToClose.ts"));

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  ${detail}`}`);
  if (!ok) failures++;
}
function mk(b, id, log) {
  return b.push({ id, href: "/app", close: () => log.push(id) });
}

{
  // camera -> result sheet -> "This copy"; Done on the top sheet.
  const b = createBackStack();
  const log = [];
  const camera = mk(b, "camera", log);
  mk(b, "result", log);
  const copy = mk(b, "copy-edit", log);
  const token = b.release(copy);
  check("Done on the top sheet asks for one history.back()", token !== null);
  check("the popstate that back() causes closes nothing", b.onPop() === null && log.length === 0, log.join());
  check("camera is still open after Done", b.has(camera) && b.stack.length === 2);
}
{
  // Android Back: top sheet, then the next, then the camera.
  const b = createBackStack();
  const log = [];
  mk(b, "camera", log);
  mk(b, "result", log);
  b.onPop()?.close();
  check("Back closes the topmost sheet first", log.join() === "result", log.join());
  b.onPop()?.close();
  check("then the camera", log.join() === "result,camera", log.join());
  check("an extra popstate with nothing open closes nothing", b.onPop() === null);
}
{
  // A close for a sheet that is not on top (camera closed under a sheet): no history.back().
  const b = createBackStack();
  const log = [];
  const camera = mk(b, "camera", log);
  mk(b, "result", log);
  check("release of a buried entry does not pop history", b.release(camera) === null);
  check("and the sheet above stays the top", b.stack.length === 1 && b.stack[0].id === "result");
  b.onPop()?.close();
  check("Back still closes that sheet", log.join() === "result");
}
{
  // The page changed since the push: no back() (it would leave the new page).
  const b = createBackStack();
  const e = mk(b, "camera", []);
  check("canBack=false releases without popping", b.release(e, false) === null && b.stack.length === 0);
}
{
  // Back that already closed an entry: its later release is a no-op.
  const b = createBackStack();
  const log = [];
  const e = mk(b, "sheet", log);
  b.onPop()?.close();
  check("release after a Back pop is a no-op", b.release(e) === null && b.onPop() === null);
}
{
  // history.back() never answered: forgetting its token frees the next real Back.
  const b = createBackStack();
  const log = [];
  mk(b, "camera", log);
  const s = mk(b, "sheet", log);
  const token = b.release(s);
  b.forget(token);
  b.onPop()?.close();
  check("a forgotten ignore token doesn't swallow the user's Back", log.join() === "camera", log.join());
}

if (failures) {
  console.log(`\n${failures} FAILED`);
  process.exit(1);
}
console.log("\nall back-stack checks passed");
