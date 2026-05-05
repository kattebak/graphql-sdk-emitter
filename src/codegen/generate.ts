import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { generate } from "@graphql-codegen/cli";
import type { Types } from "@graphql-codegen/plugin-helpers";
import { buildSchema, type GraphQLSchema } from "graphql";
import { emitFilterBuilders } from "./filter-builder.js";
import { buildManifest } from "./manifest.js";

export interface GenerateSdkOptions {
	/** Path or glob to the GraphQL schema SDL. */
	schema: string;
	/** Output directory for generated files. */
	output: string;
	/** Optional path or glob to .graphql operation documents. */
	operations?: string;
	/** Working directory used to resolve relative paths. Defaults to process.cwd(). */
	cwd?: string;
	/** Emit a filter builder helper module. Defaults to true. */
	emitFilterBuilder?: boolean;
	/** Emit operations manifest JSON. Defaults to true. */
	emitManifest?: boolean;
}

export interface GenerateSdkResult {
	outputDir: string;
	files: string[];
}

const TYPES_FILE = "types.ts";
const SDK_FILE = "sdk.ts";
const MANIFEST_FILE = "manifest.json";
const FILTERS_FILE = "filters.ts";
const INDEX_FILE = "index.ts";

export async function generateSdk(
	options: GenerateSdkOptions,
): Promise<GenerateSdkResult> {
	const cwd = options.cwd ?? process.cwd();
	const schemaPath = isAbsolute(options.schema)
		? options.schema
		: resolve(cwd, options.schema);
	const outputDir = isAbsolute(options.output)
		? options.output
		: resolve(cwd, options.output);
	const emitFilters = options.emitFilterBuilder !== false;
	const emitManifestFile = options.emitManifest !== false;

	await mkdir(outputDir, { recursive: true });

	const schema = await loadSchema(schemaPath);

	const opsPath = options.operations
		? isAbsolute(options.operations)
			? options.operations
			: resolve(cwd, options.operations)
		: undefined;

	const generates: Record<string, Types.ConfiguredOutput> = {
		[resolve(outputDir, TYPES_FILE)]: {
			documents: opsPath ? [opsPath] : undefined,
			plugins: opsPath
				? ["typescript", "typescript-operations"]
				: ["typescript"],
			config: {
				avoidOptionals: false,
				skipTypename: false,
				enumsAsTypes: false,
				useTypeImports: true,
			},
		},
	};

	if (opsPath) {
		generates[resolve(outputDir, SDK_FILE)] = {
			documents: [opsPath],
			preset: "import-types",
			presetConfig: {
				typesPath: "./types.js",
			},
			plugins: ["typescript-graphql-request"],
			config: {
				useTypeImports: true,
				rawRequest: false,
				documentMode: "string",
			},
		};
	}

	await generate(
		{
			cwd,
			schema: schemaPath,
			generates,
			silent: true,
		},
		true,
	);

	const written: string[] = [resolve(outputDir, TYPES_FILE)];
	if (options.operations) written.push(resolve(outputDir, SDK_FILE));

	if (emitFilters) {
		const filtersPath = resolve(outputDir, FILTERS_FILE);
		await writeFile(filtersPath, emitFilterBuilders(schema), "utf8");
		written.push(filtersPath);
	}

	if (emitManifestFile) {
		const manifest = buildManifest(schema);
		const manifestPath = resolve(outputDir, MANIFEST_FILE);
		await writeFile(
			manifestPath,
			`${JSON.stringify(manifest, null, 2)}\n`,
			"utf8",
		);
		written.push(manifestPath);
	}

	const indexPath = resolve(outputDir, INDEX_FILE);
	await writeFile(indexPath, buildIndex(options), "utf8");
	written.push(indexPath);

	return { outputDir, files: written };
}

async function loadSchema(schemaPath: string): Promise<GraphQLSchema> {
	const sdl = await readFile(schemaPath, "utf8");
	return buildSchema(sdl);
}

function buildIndex(options: GenerateSdkOptions): string {
	const lines: string[] = [
		"// AUTO-GENERATED. Do not edit by hand.",
		"",
		'export * from "./types.js";',
	];
	if (options.operations) lines.push('export * from "./sdk.js";');
	if (options.emitFilterBuilder !== false)
		lines.push('export * from "./filters.js";');
	lines.push("");
	return lines.join("\n");
}
