import {
	type GraphQLField,
	type GraphQLNamedType,
	type GraphQLOutputType,
	type GraphQLSchema,
	type GraphQLType,
	isEnumType,
	isInputObjectType,
	isListType,
	isNonNullType,
	isObjectType,
	isScalarType,
	isUnionType,
} from "graphql";

export interface ManifestParameter {
	name: string;
	type: string;
	required: boolean;
	description?: string;
	defaultValue?: string;
}

export interface ManifestOperation {
	name: string;
	kind: "query" | "mutation";
	description?: string;
	deprecated?: string;
	parameters: ManifestParameter[];
	returns: string;
	returnsDescription?: string;
}

export interface OperationsManifest {
	version: 1;
	generatedAt: string;
	operations: ManifestOperation[];
}

function renderType(type: GraphQLType): string {
	if (isNonNullType(type)) return `${renderType(type.ofType)}!`;
	if (isListType(type)) return `[${renderType(type.ofType)}]`;
	return (type as GraphQLNamedType).name;
}

function fieldToOperation(
	field: GraphQLField<unknown, unknown>,
	kind: "query" | "mutation",
): ManifestOperation {
	const parameters: ManifestParameter[] = field.args.map((arg) => {
		const param: ManifestParameter = {
			name: arg.name,
			type: renderType(arg.type),
			required: isNonNullType(arg.type),
		};
		if (arg.description) param.description = arg.description;
		if (arg.defaultValue !== undefined) {
			param.defaultValue = JSON.stringify(arg.defaultValue);
		}
		return param;
	});

	const op: ManifestOperation = {
		name: field.name,
		kind,
		parameters,
		returns: renderType(field.type as GraphQLOutputType),
	};
	if (field.description) op.description = field.description;
	if (field.deprecationReason) op.deprecated = field.deprecationReason;
	return op;
}

export function buildManifest(schema: GraphQLSchema): OperationsManifest {
	const operations: ManifestOperation[] = [];

	const queryType = schema.getQueryType();
	if (queryType) {
		for (const field of Object.values(queryType.getFields())) {
			operations.push(fieldToOperation(field, "query"));
		}
	}

	const mutationType = schema.getMutationType();
	if (mutationType) {
		for (const field of Object.values(mutationType.getFields())) {
			operations.push(fieldToOperation(field, "mutation"));
		}
	}

	operations.sort((a, b) => a.name.localeCompare(b.name));

	return {
		version: 1,
		generatedAt: new Date().toISOString(),
		operations,
	};
}

export interface FilterShape {
	name: string;
	description?: string;
	fields: Array<{
		name: string;
		type: string;
		required: boolean;
		description?: string;
	}>;
}

export function buildFilterShapes(schema: GraphQLSchema): FilterShape[] {
	const shapes: FilterShape[] = [];
	const types = schema.getTypeMap();
	for (const type of Object.values(types)) {
		if (!isInputObjectType(type)) continue;
		if (type.name.startsWith("__")) continue;
		const shape: FilterShape = {
			name: type.name,
			fields: Object.values(type.getFields()).map((field) => {
				const f: FilterShape["fields"][number] = {
					name: field.name,
					type: renderType(field.type),
					required: isNonNullType(field.type),
				};
				if (field.description) f.description = field.description;
				return f;
			}),
		};
		if (type.description) shape.description = type.description;
		shapes.push(shape);
	}
	shapes.sort((a, b) => a.name.localeCompare(b.name));
	return shapes;
}

export function describeSchemaTypes(schema: GraphQLSchema): Array<{
	name: string;
	kind: string;
	description?: string;
}> {
	const out: Array<{ name: string; kind: string; description?: string }> = [];
	for (const type of Object.values(schema.getTypeMap())) {
		if (type.name.startsWith("__")) continue;
		let kind = "unknown";
		if (isObjectType(type)) kind = "object";
		else if (isInputObjectType(type)) kind = "input";
		else if (isEnumType(type)) kind = "enum";
		else if (isUnionType(type)) kind = "union";
		else if (isScalarType(type)) kind = "scalar";
		const item: { name: string; kind: string; description?: string } = {
			name: type.name,
			kind,
		};
		if (type.description) item.description = type.description;
		out.push(item);
	}
	out.sort((a, b) => a.name.localeCompare(b.name));
	return out;
}
