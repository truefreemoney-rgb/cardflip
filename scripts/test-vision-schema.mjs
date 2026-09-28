// Pins the vision read schemas (src/lib/server/vision.ts): every property is
// required (Anthropic structured output rejects a schema that isn't), the
// game variants still carry the whole base read, and the condition
// suggestion fields (corners / edges / surface, 09-27) are there with the
// three wear levels. No API call. Run: npm run test:vision-schema
import assert from "node:assert/strict";

const { CARD_READ_SCHEMA, MTG_READ_SCHEMA, TCG_READ_SCHEMA, LOCATE_SCHEMA } =
  await import(new URL("../src/lib/server/vision.ts", import.meta.url).href);

// Binder page locate (09-27): { cards: [{x,y,w,h}] }, both levels fully required.
assert.deepEqual([...LOCATE_SCHEMA.required], ["cards"]);
assert.equal(LOCATE_SCHEMA.additionalProperties, false);
const boxSchema = LOCATE_SCHEMA.properties.cards.items;
assert.deepEqual([...boxSchema.required].sort(), Object.keys(boxSchema.properties).sort(), "locate box: required == properties");
assert.equal(boxSchema.additionalProperties, false);

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

console.log("test:vision-schema ok");
