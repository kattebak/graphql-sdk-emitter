import { type GraphQLSchema, isInputObjectType } from "graphql";
import { buildFilterShapes, type FilterShape } from "./manifest.js";

export function emitFilterBuilders(schema: GraphQLSchema): string {
	const shapes = buildFilterShapes(schema).filter((shape) =>
		isFilterShape(schema, shape),
	);
	if (shapes.length === 0) {
		return "// No filter input types detected in the schema.\nexport {};\n";
	}
	const lines: string[] = [
		"// AUTO-GENERATED. Do not edit by hand.",
		"// Smart builder helpers for nested filter input types.",
		"",
		'import type * as Types from "./types.js";',
		"",
	];
	for (const shape of shapes) {
		lines.push(emitBuilder(shape));
		lines.push("");
	}
	return lines.join("\n");
}

function isFilterShape(_schema: GraphQLSchema, shape: FilterShape): boolean {
	if (/Filter|Where|Condition/i.test(shape.name)) return true;
	const hasLogicalCombinator = shape.fields.some((f) =>
		/^(and|or|not)$/i.test(f.name),
	);
	return hasLogicalCombinator;
}

function emitBuilder(shape: FilterShape): string {
	const typeRef = `Types.${shape.name}`;
	const builderName = `build${shape.name}`;
	return [
		`export function ${builderName}(input: ${typeRef}): ${typeRef} {`,
		`\treturn input;`,
		`}`,
	].join("\n");
}

export function emitFilterTypeNames(schema: GraphQLSchema): string[] {
	const out: string[] = [];
	for (const type of Object.values(schema.getTypeMap())) {
		if (!isInputObjectType(type)) continue;
		if (/Filter|Where|Condition/i.test(type.name)) out.push(type.name);
	}
	return out.sort();
}
