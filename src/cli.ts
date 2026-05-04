import { parseArgs } from "node:util";
import { generateSdk } from "./codegen/generate.js";

interface ParsedArgs {
	schema: string;
	output: string;
	operations?: string;
	noFilters: boolean;
	noManifest: boolean;
	help: boolean;
}

const HELP_TEXT = `graphql-sdk-emitter

Generate a typed TypeScript SDK from a GraphQL schema.

USAGE
  graphql-sdk-emitter --schema <path> --output <dir> [options]

OPTIONS
  -s, --schema <path>       Path to GraphQL SDL file (required)
  -o, --output <dir>        Output directory (required)
  -d, --operations <glob>   Path or glob to .graphql operation documents
      --no-filters          Skip filter builder emission
      --no-manifest         Skip operations manifest emission
  -h, --help                Show this help

EXAMPLES
  graphql-sdk-emitter -s ./schema.graphql -o ./src/generated
  graphql-sdk-emitter -s ./schema.graphql -o ./src/generated -d 'src/operations/*.graphql'
`;

function parse(argv: string[]): ParsedArgs {
	const { values } = parseArgs({
		args: argv,
		options: {
			schema: { type: "string", short: "s" },
			output: { type: "string", short: "o" },
			operations: { type: "string", short: "d" },
			"no-filters": { type: "boolean", default: false },
			"no-manifest": { type: "boolean", default: false },
			help: { type: "boolean", short: "h", default: false },
		},
		allowPositionals: false,
	});

	const help = values.help === true;
	if (help) {
		return {
			schema: "",
			output: "",
			noFilters: false,
			noManifest: false,
			help: true,
		};
	}

	if (!values.schema || !values.output) {
		throw new Error(
			"Both --schema and --output are required. Use --help for usage.",
		);
	}

	const result: ParsedArgs = {
		schema: values.schema,
		output: values.output,
		noFilters: values["no-filters"] === true,
		noManifest: values["no-manifest"] === true,
		help: false,
	};
	if (values.operations) result.operations = values.operations;
	return result;
}

export async function main(
	argv: string[] = process.argv.slice(2),
): Promise<number> {
	let parsed: ParsedArgs;
	try {
		parsed = parse(argv);
	} catch (err) {
		process.stderr.write(`${(err as Error).message}\n`);
		return 1;
	}

	if (parsed.help) {
		process.stdout.write(HELP_TEXT);
		return 0;
	}

	const opts: Parameters<typeof generateSdk>[0] = {
		schema: parsed.schema,
		output: parsed.output,
		emitFilterBuilder: !parsed.noFilters,
		emitManifest: !parsed.noManifest,
	};
	if (parsed.operations) opts.operations = parsed.operations;

	const result = await generateSdk(opts);
	process.stdout.write(
		`generated ${result.files.length} file(s) in ${result.outputDir}\n`,
	);
	for (const f of result.files) process.stdout.write(`  - ${f}\n`);
	return 0;
}
