import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { generate } from "@graphql-codegen/cli";
import type { Types } from "@graphql-codegen/plugin-helpers";
import { buildSchema } from "graphql";
import { emitFilterBuilders } from "./filter-builder.js";
import { buildManifest } from "./manifest.js";

/**
 * AppSync auth directive declarations the emitter pre-registers so consumer
 * SDL can carry them without `buildSchema` rejecting "Unknown directive"
 * (issue #2). The directives have no client-side meaning — the SDK just
 * needs to parse past them. The companion typespec emitter (#121) emits
 * these on object types and Query fields; bare `buildSchema` would reject
 * the same SDL that AppSync deploys cleanly.
 *
 * Locations are kept permissive so any sane placement parses; we don't
 * enforce AppSync's exact placement rules — that's AppSync's job at deploy
 * time. Argument shapes mirror the AppSync docs.
 */
const AWS_AUTH_DIRECTIVE_DECLARATIONS: ReadonlyArray<{
	name: string;
	declaration: string;
}> = [
	{
		name: "aws_cognito_user_pools",
		declaration:
			"directive @aws_cognito_user_pools(cognito_groups: [String]) on OBJECT | FIELD_DEFINITION",
	},
	{
		name: "aws_iam",
		declaration: "directive @aws_iam on OBJECT | FIELD_DEFINITION",
	},
	{
		name: "aws_api_key",
		declaration: "directive @aws_api_key on OBJECT | FIELD_DEFINITION",
	},
	{
		name: "aws_oidc",
		declaration: "directive @aws_oidc on OBJECT | FIELD_DEFINITION",
	},
	{
		name: "aws_lambda",
		declaration: "directive @aws_lambda on OBJECT | FIELD_DEFINITION",
	},
	{
		name: "aws_auth",
		declaration:
			"directive @aws_auth(cognito_groups: [String]) on FIELD_DEFINITION",
	},
	{
		name: "aws_subscribe",
		declaration:
			"directive @aws_subscribe(mutations: [String]) on FIELD_DEFINITION",
	},
];

/**
 * Prepend any AppSync directive declarations that aren't already present in
 * the user's SDL. Skip-if-present keeps schemas that already declare them
 * (e.g. authoring tools that emit their own header) from tripping
 * "Directive @X already defined".
 */
export function withAwsAuthDirectives(sdl: string): string {
	const missing = AWS_AUTH_DIRECTIVE_DECLARATIONS.filter(
		(d) => !sdl.includes(`directive @${d.name}`),
	);
	if (missing.length === 0) return sdl;
	const header = `${missing.map((d) => d.declaration).join("\n")}\n\n`;
	return `${header}${sdl}`;
}

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

	// Augment the SDL with AppSync directive declarations once and reuse for
	// both our own buildSchema call and the graphql-codegen pipeline. Both
	// paths reach `buildSchema` under the hood, so both must see the
	// declarations or `buildSchema` rejects "Unknown directive @aws_*"
	// (issue #2). Materialize as a sibling file inside outputDir so codegen
	// can `schema:` it; clean up after generate() returns.
	const originalSdl = await readFile(schemaPath, "utf8");
	const augmentedSdl = withAwsAuthDirectives(originalSdl);
	const schema = buildSchema(augmentedSdl);
	const sdlForCodegenPath =
		augmentedSdl === originalSdl
			? schemaPath
			: resolve(outputDir, ".__schema-with-aws-directives.graphql");
	if (sdlForCodegenPath !== schemaPath) {
		await writeFile(sdlForCodegenPath, augmentedSdl, "utf8");
	}

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

	try {
		await generate(
			{
				cwd,
				schema: sdlForCodegenPath,
				generates,
				silent: true,
			},
			true,
		);
	} finally {
		if (sdlForCodegenPath !== schemaPath) {
			await rm(sdlForCodegenPath, { force: true });
		}
	}

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
