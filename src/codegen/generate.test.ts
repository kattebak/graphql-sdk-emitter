import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

	it("generated output type-checks under tsc --strict", async () => {
		const dir = await mkdtemp(join(tmpdir(), "gqlsdk-tsc-"));
		try {
			const schemaPath = join(dir, "schema.graphql");
			const opsPath = join(dir, "ops.graphql");
			await writeFile(schemaPath, SDL, "utf8");
			await writeFile(opsPath, OPERATIONS, "utf8");
			const out = join(dir, "out");
			await generateSdk({
				schema: schemaPath,
				output: out,
				operations: opsPath,
			});
			// Symlink the SDK's own node_modules so tsc can resolve graphql-request etc.
			await symlink(
				resolve(process.cwd(), "node_modules"),
				join(dir, "node_modules"),
				"dir",
			);
			await writeFile(
				join(dir, "tsconfig.json"),
				JSON.stringify({
					compilerOptions: {
						target: "ES2022",
						module: "ESNext",
						moduleResolution: "Bundler",
						strict: true,
						skipLibCheck: true,
						noEmit: true,
					},
					include: ["out/**/*"],
				}),
				"utf8",
			);
			await writeFile(
				join(dir, "package.json"),
				JSON.stringify({ type: "module" }),
				"utf8",
			);
			execFileSync("npx", ["tsc", "-p", join(dir, "tsconfig.json")], {
				stdio: "pipe",
				cwd: process.cwd(),
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
