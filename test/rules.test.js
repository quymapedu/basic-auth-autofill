import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RESOURCE_TYPES,
  encodeCredentials,
  normalizeOrigin,
  buildRules,
} from "../lib/rules.js";

const site = (over = {}) => ({
  id: "id-1",
  origin: "https://dev.mapedu.com",
  username: "quy",
  password: "secret",
  enabled: true,
  ...over,
});

test("encodeCredentials produces standard base64 for ASCII", () => {
  assert.equal(encodeCredentials("quy", "secret"), "cXV5OnNlY3JldA==");
});

test("encodeCredentials encodes non-Latin-1 passwords as UTF-8", () => {
  // btoa() alone throws InvalidCharacterError on these code points.
  const token = encodeCredentials("quy", "mật-khẩu");
  assert.equal(typeof token, "string");
  assert.ok(token.length > 0);
  assert.equal(Buffer.from(token, "base64").toString("utf8"), "quy:mật-khẩu");
});

test("normalizeOrigin accepts a bare host and defaults to https", () => {
  assert.equal(normalizeOrigin("dev.mapedu.com"), "https://dev.mapedu.com");
});

test("normalizeOrigin strips path, query and hash", () => {
  assert.equal(
    normalizeOrigin("https://dev.mapedu.com/courses/625?tab=1#x"),
    "https://dev.mapedu.com",
  );
});

test("normalizeOrigin preserves an explicit http scheme and port", () => {
  assert.equal(normalizeOrigin("http://localhost:3000/app"), "http://localhost:3000");
});

test("normalizeOrigin trims surrounding whitespace", () => {
  assert.equal(normalizeOrigin("  dev.mapedu.com  "), "https://dev.mapedu.com");
});

test("normalizeOrigin rejects empty input", () => {
  assert.throws(() => normalizeOrigin("   "), /Enter a site address/);
});

test("normalizeOrigin rejects a hostname with no dot that is not localhost", () => {
  assert.throws(() => normalizeOrigin("notahost"), /not a valid address/);
});

test("buildRules returns an empty array for no sites", () => {
  assert.deepEqual(buildRules([]), []);
});

test("buildRules excludes disabled sites", () => {
  assert.deepEqual(buildRules([site({ enabled: false })]), []);
});

test("buildRules excludes sites with an empty username", () => {
  assert.deepEqual(buildRules([site({ username: "" })]), []);
});

test("buildRules assigns sequential ids starting at 1", () => {
  const rules = buildRules([
    site({ id: "a", origin: "https://a.example.com" }),
    site({ id: "b", origin: "https://b.example.com" }),
  ]);
  assert.deepEqual(rules.map((r) => r.id), [1, 2]);
});

test("buildRules renumbers so filtered-out sites leave no gaps", () => {
  const rules = buildRules([
    site({ origin: "https://a.example.com", enabled: false }),
    site({ origin: "https://b.example.com" }),
  ]);
  assert.deepEqual(rules.map((r) => r.id), [1]);
});

test("buildRules anchors urlFilter to the exact origin", () => {
  const [rule] = buildRules([site()]);
  assert.equal(rule.condition.urlFilter, "|https://dev.mapedu.com/");
});

test("buildRules sets the Authorization header with a Basic prefix", () => {
  const [rule] = buildRules([site()]);
  assert.equal(rule.action.type, "modifyHeaders");
  assert.deepEqual(rule.action.requestHeaders, [
    { header: "Authorization", operation: "set", value: "Basic cXV5OnNlY3JldA==" },
  ]);
});

test("buildRules includes main_frame in resource types", () => {
  const [rule] = buildRules([site()]);
  assert.ok(rule.condition.resourceTypes.includes("main_frame"));
  assert.deepEqual(rule.condition.resourceTypes, RESOURCE_TYPES);
});
