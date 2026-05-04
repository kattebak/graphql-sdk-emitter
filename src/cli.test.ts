import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { main } from "./cli.js";

const SDL = /* GraphQL */ `
type Thing { id: ID! name: String! }
type Query { thing(id: ID!): Thing }
`;

describe("cli", () => {
	it("prints help with --help and exits 0", async () => {
		const originalWrite = process.stdout.write.bind(process.stdout);
		const chunks: string[] = [];
		process.stdout.write = ((c: string | Uint8Array) => {
			chunks.push(typeof c === "string" ? c : Buffer.from(c).toString());
			return true;
		}) as typeof process.stdout.write;
		try {
			const code = await main(["--help"]);
			assert.equal(code, 0);
			assert.match(chunks.join(""), /USAGE/);
		} finally {
			process.stdout.write = originalWrite;
		}
	});

	it("errors when --schema or --output is missing", async () => {
		const originalWrite = process.stderr.write.bind(process.stderr);
		const chunks: string[] = [];
		process.stderr.write = ((c: string | Uint8Array) => {
			chunks.push(typeof c === "string" ? c : Buffer.from(c).toString());
			return true;
		}) as typeof process.stderr.write;
		try {
			const code = await main([]);
			assert.equal(code, 1);
			assert.match(chunks.join(""), /required/);
		} finally {
			process.stderr.write = originalWrite;
		}
	});

	it("generates types, manifest and index for a minimal schema", async () => {
		const dir = await mkdtemp(join(tmpdir(), "gqlsdk-cli-"));
		try {
			const schemaPath = join(dir, "schema.graphql");
			const outDir = join(dir, "out");
			await writeFile(schemaPath, SDL, "utf8");
			const originalOut = process.stdout.write.bind(process.stdout);
			process.stdout.write = (() => true) as typeof process.stdout.write;
			try {
				const code = await main(["--schema", schemaPath, "--output", outDir]);
				assert.equal(code, 0);
			} finally {
				process.stdout.write = originalOut;
			}
			const types = await readFile(join(outDir, "types.ts"), "utf8");
			assert.match(types, /Thing/);
			const manifestRaw = await readFile(join(outDir, "manifest.json"), "utf8");
			const manifest = JSON.parse(manifestRaw) as {
				operations: Array<{ name: string }>;
			};
			assert.ok(manifest.operations.some((o) => o.name === "thing"));
			const index = await readFile(join(outDir, "index.ts"), "utf8");
			assert.match(index, /types\.js/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
