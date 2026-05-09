import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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

	it("emits auth.ts re-exporting auth providers from the /auth subpath, not the bare entry (issue #3)", async () => {
		const dir = await mkdtemp(join(tmpdir(), "gqlsdk-auth-"));
		try {
			const schemaPath = join(dir, "schema.graphql");
			await writeFile(schemaPath, SDL, "utf8");
			const out = join(dir, "out");
			const result = await generateSdk({ schema: schemaPath, output: out });
			assert.ok(
				result.files.some((f) => f.endsWith("auth.ts")),
				"auth.ts should be emitted by default",
			);
			const auth = await readFile(join(out, "auth.ts"), "utf8");
			// The whole point: subpath import. Bare-entry import would pull in
			// `@graphql-codegen/cli` etc. as runtime deps for the consumer.
			assert.match(
				auth,
				/from "@kattebak\/graphql-sdk-emitter\/auth"/,
				"must re-export from the /auth subpath",
			);
			assert.doesNotMatch(
				auth,
				/from "@kattebak\/graphql-sdk-emitter"$/m,
				"must NOT re-export from the bare package entry",
			);
			// All three auth providers + companion types are surfaced so the
			// consumer doesn't have to care about which file they live in.
			assert.match(auth, /ApiKeyAuth/);
			assert.match(auth, /CognitoBearerAuth/);
			assert.match(auth, /SigV4Auth/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("does not re-export auth from index.ts (preserves tree-shaking)", async () => {
		// auth.ts as a sibling-only file is the contract — consumers opt into
		// auth via `import ... from "./generated/auth"`, never via the
		// generated index. Re-exporting from index would defeat the whole
		// point of issue #3 by re-attaching aws4fetch (peer of SigV4Auth) to
		// every consumer of the SDK.
		const dir = await mkdtemp(join(tmpdir(), "gqlsdk-auth-idx-"));
		try {
			const schemaPath = join(dir, "schema.graphql");
			await writeFile(schemaPath, SDL, "utf8");
			const out = join(dir, "out");
			await generateSdk({ schema: schemaPath, output: out });
			const idx = await readFile(join(out, "index.ts"), "utf8");
			assert.doesNotMatch(idx, /auth/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("emitAuth: false skips auth.ts emission", async () => {
		const dir = await mkdtemp(join(tmpdir(), "gqlsdk-no-auth-"));
		try {
			const schemaPath = join(dir, "schema.graphql");
			await writeFile(schemaPath, SDL, "utf8");
			const out = join(dir, "out");
			const result = await generateSdk({
				schema: schemaPath,
				output: out,
				emitAuth: false,
			});
			assert.ok(!result.files.some((f) => f.endsWith("auth.ts")));
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
				// auth.ts re-exports from `@kattebak/graphql-sdk-emitter/auth`,
				// which can't resolve via the symlink-into-the-SDK's-node_modules
				// trick this test uses (the package isn't in its own
				// node_modules). Auth correctness is covered by the dedicated
				// "auth.ts re-exports..." test plus the package's own
				// src/auth/*.test.ts; this strict-tsc check stays focused on
				// types/sdk/filters/index ergonomics.
				emitAuth: false,
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
