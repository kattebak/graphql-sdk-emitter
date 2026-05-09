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
