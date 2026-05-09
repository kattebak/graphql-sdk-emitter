import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { generateSdk, withAwsAuthDirectives } from "./generate.js";

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

	it("accepts SDL carrying AppSync auth directives without rejecting them as unknown (issue #2)", async () => {
		// Companion typespec emitter (#121) emits these directives on object
		// types and Query fields; the SDK build used to choke on the same SDL
		// AppSync deploys cleanly. The SDK is a client artifact, so the
		// directives carry no client meaning — `buildSchema` just needs to
		// parse past them.
		const dir = await mkdtemp(join(tmpdir(), "gqlsdk-aws-dir-"));
		try {
			const schemaPath = join(dir, "schema.graphql");
			await writeFile(
				schemaPath,
				/* GraphQL */ `
					type Query {
						hello: String! @aws_cognito_user_pools @aws_iam
					}

					type Thing @aws_cognito_user_pools @aws_iam {
						id: ID!
						name: String!
					}
				`,
				"utf8",
			);
			const out = join(dir, "out");
			const result = await generateSdk({ schema: schemaPath, output: out });
			// Generated types include the directive-decorated type — the SDK
			// emit path completed without "Unknown directive" errors.
			const types = await readFile(join(out, "types.ts"), "utf8");
			assert.match(types, /Thing/);
			// Temp augmented-SDL file is cleaned up after generate() finishes.
			assert.ok(
				!result.files.some((f) => f.includes(".__schema-with-aws-directives")),
				"temp augmented SDL file should not appear in the result manifest",
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("does not double-declare directives when the SDL already declares them", async () => {
		// Skip-if-present lets schemas authored by tools that already emit a
		// directive header pass through without "Directive @X already
		// defined" errors.
		const dir = await mkdtemp(join(tmpdir(), "gqlsdk-aws-dir-dup-"));
		try {
			const schemaPath = join(dir, "schema.graphql");
			await writeFile(
				schemaPath,
				/* GraphQL */ `
					directive @aws_iam on OBJECT | FIELD_DEFINITION

					type Query {
						hello: String! @aws_iam
					}
				`,
				"utf8",
			);
			const out = join(dir, "out");
			await generateSdk({ schema: schemaPath, output: out });
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("withAwsAuthDirectives (issue #2)", () => {
	it("prepends declarations for all AppSync auth directives by default", () => {
		const augmented = withAwsAuthDirectives("type Query { hello: String }");
		// Spot-check: each documented directive name shows up exactly once.
		assert.match(augmented, /directive @aws_cognito_user_pools/);
		assert.match(augmented, /directive @aws_iam\b/);
		assert.match(augmented, /directive @aws_api_key\b/);
		assert.match(augmented, /directive @aws_oidc\b/);
		assert.match(augmented, /directive @aws_lambda\b/);
		assert.match(augmented, /directive @aws_auth\b/);
		assert.match(augmented, /directive @aws_subscribe\b/);
	});

	it("skips directives the SDL already declares", () => {
		const sdl = /* GraphQL */ `
			directive @aws_iam on OBJECT | FIELD_DEFINITION
			type Query { hello: String }
		`;
		const augmented = withAwsAuthDirectives(sdl);
		// Exactly one declaration of @aws_iam — the user's. We add the others.
		const matches = augmented.match(/directive @aws_iam\b/g) ?? [];
		assert.equal(matches.length, 1);
		assert.match(augmented, /directive @aws_cognito_user_pools/);
	});

	it("returns the original SDL untouched when all directives are already declared", () => {
		const sdl = [
			"directive @aws_cognito_user_pools(cognito_groups: [String]) on OBJECT | FIELD_DEFINITION",
			"directive @aws_iam on OBJECT | FIELD_DEFINITION",
			"directive @aws_api_key on OBJECT | FIELD_DEFINITION",
			"directive @aws_oidc on OBJECT | FIELD_DEFINITION",
			"directive @aws_lambda on OBJECT | FIELD_DEFINITION",
			"directive @aws_auth(cognito_groups: [String]) on FIELD_DEFINITION",
			"directive @aws_subscribe(mutations: [String]) on FIELD_DEFINITION",
			"type Query { hello: String }",
		].join("\n");
		// Identity guarantee — used by the codegen path to skip writing a
		// temp file when nothing needs augmenting.
		assert.equal(withAwsAuthDirectives(sdl), sdl);
	});
});
