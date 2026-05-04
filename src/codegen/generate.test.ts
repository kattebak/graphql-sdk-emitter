import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { generateSdk } from "./generate.js";

const SDL = /* GraphQL */ `
type Thing { id: ID! name: String! }
input ThingFilter { name: String }
type Query { thing(id: ID!): Thing things(filter: ThingFilter): [Thing!]! }
`;

const OPERATIONS = /* GraphQL */ `
query GetThing($id: ID!) { thing(id: $id) { id name } }
`;

describe("generateSdk", () => {
	it("emits types, manifest, filters, and index for SDL only", async () => {
		const dir = await mkdtemp(join(tmpdir(), "gqlsdk-gen-"));
		try {
			const schemaPath = join(dir, "schema.graphql");
			await writeFile(schemaPath, SDL, "utf8");
			const out = join(dir, "out");
			const result = await generateSdk({ schema: schemaPath, output: out });
			assert.ok(result.files.some((f) => f.endsWith("types.ts")));
			assert.ok(result.files.some((f) => f.endsWith("manifest.json")));
			assert.ok(result.files.some((f) => f.endsWith("filters.ts")));
			assert.ok(result.files.some((f) => f.endsWith("index.ts")));
			const filters = await readFile(join(out, "filters.ts"), "utf8");
			assert.match(filters, /buildThingFilter/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("emits sdk.ts with getSdk when operations are provided", async () => {
		const dir = await mkdtemp(join(tmpdir(), "gqlsdk-gen-"));
		try {
			const schemaPath = join(dir, "schema.graphql");
			const opsPath = join(dir, "ops.graphql");
			await writeFile(schemaPath, SDL, "utf8");
			await writeFile(opsPath, OPERATIONS, "utf8");
			const out = join(dir, "out");
			const result = await generateSdk({
				schema: schemaPath,
				output: out,
				operations: opsPath,
			});
			assert.ok(result.files.some((f) => f.endsWith("sdk.ts")));
			const sdk = await readFile(join(out, "sdk.ts"), "utf8");
			assert.match(sdk, /getSdk/);
			assert.match(sdk, /GetThing/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
