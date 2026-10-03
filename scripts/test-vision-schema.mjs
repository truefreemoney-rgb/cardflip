// Pins the vision read schemas (src/lib/server/vision.ts): every property is
// required (Anthropic structured output rejects a schema that isn't), the
// game variants still carry the whole base read, and the condition
// suggestion fields (corners / edges / surface, 09-27) are there with the
// three wear levels. No API call. Run: npm run test:vision-schema
import assert from "node:assert/strict";

const { CARD_READ_SCHEMA, MTG_READ_SCHEMA, TCG_READ_SCHEMA } =
  await import(new URL("../src/lib/server/vision.ts", import.meta.url).href);

for (const [name, schema] of Object.entries({ CARD_READ_SCHEMA, MTG_READ_SCHEMA, TCG_READ_SCHEMA })) {
  if (!schema) continue;
  const props = Object.keys(schema.properties).sort();
  const req = [...schema.required].sort();
  assert.deepEqual(req, props, `${name}: required must list every property`);
  assert.equal(schema.additionalProperties, false, `${name}: additionalProperties`);
  for (const key of Object.keys(CARD_READ_SCHEMA.properties)) {
    assert.ok(key in schema.properties, `${name}: missing base field ${key}`);
  }
}

for (const key of ["corners", "edges", "surface"]) {
  const p = CARD_READ_SCHEMA.properties[key];
  assert.ok(p, `condition field ${key}`);
  const en = p.anyOf.find((a) => a.enum)?.enum;
  assert.deepEqual(en, ["clean", "light wear", "worn"], `${key} wear levels`);
  assert.ok(p.anyOf.some((a) => a.type === "null"), `${key} nullable`);
}
assert.deepEqual(
  CARD_READ_SCHEMA.properties.condition.anyOf[0].enum,
  ["Near Mint", "Lightly Played", "Moderately Played", "Heavily Played", "Damaged"],
);

// 09-29: the API rejects a structured-output schema with more than 16
// union-typed (anyOf / type-array) parameters — "Schemas contains too many
// parameters with union types … limit: 16". The Magic read had 20 and every
// Magic scan 400'd; Lorcana / One Piece had 17. Count them the way the API
// does and keep every read schema at or under the cap.
const { SECOND_LOOK_SCHEMA, TIEBREAK_SCHEMA } = await import(new URL("../src/lib/server/vision.ts", import.meta.url).href);
function unionCount(schema) {
  let n = 0;
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node.anyOf) || Array.isArray(node.oneOf) || Array.isArray(node.type)) n++;
    for (const v of Object.values(node.properties ?? {})) walk(v);
    if (node.items) walk(node.items);
  };
  for (const v of Object.values(schema.properties ?? {})) walk(v);
  return n;
}
for (const [name, schema] of Object.entries({ CARD_READ_SCHEMA, MTG_READ_SCHEMA, TCG_READ_SCHEMA, SECOND_LOOK_SCHEMA, TIEBREAK_SCHEMA })) {
  if (!schema) continue;
  const n = unionCount(schema);
  assert.ok(n <= 16, `${name}: ${n} union-typed parameters, the API caps a schema at 16`);
}
// The Magic-only fields stay non-nullable so the count holds; the parse maps "" / "unknown" to null.
for (const key of ["finish", "treatment", "artist", "borderColor", "serialNumber"]) {
  assert.ok(!("anyOf" in MTG_READ_SCHEMA.properties[key]), `MTG ${key} must not be anyOf-nullable`);
}
for (const key of ["subtitle", "variant"]) {
  assert.ok(!("anyOf" in TCG_READ_SCHEMA.properties[key]), `TCG ${key} must not be anyOf-nullable`);
}

console.log("test:vision-schema ok");
