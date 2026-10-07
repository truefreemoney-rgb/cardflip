// node --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/test-email-typo.mjs
import assert from "node:assert/strict";
import { suggestEmail } from "../src/lib/emailTypo.ts";

const cases = [
  ["neus@iclod.org", "neus@icloud.com"], // the real 10-07 bounce
  ["a@gmial.com", "a@gmail.com"],
  ["a@gmail.co", "a@gmail.com"],
  ["a@yaho.com", "a@yahoo.com"],
  ["a@hotmal.com", "a@hotmail.com"],
  ["a@icloud.org", "a@icloud.com"],
  ["A@GMAIL.COM", null], // fine, just uppercase
  ["a@gmail.com", null],
  ["a@cardflip.io", null], // real custom domain, nowhere near a common one
  ["a@superiormarketing.com", null],
  ["a@hotmail.co.uk", null], // real UK address, never "fixed" to .com
  ["a@yahoo.ca", null],
  ["a@live.com.au", null],
  ["a@hotmial.co.uk", "a@hotmail.co.uk"], // name fixed, country kept
  ["a@mail.com", null], // real provider, not gmail
  ["a@", null],
  ["nope", null],
];
for (const [input, want] of cases) assert.equal(suggestEmail(input), want, input);
console.log(`email typo: ${cases.length} cases ok`);
