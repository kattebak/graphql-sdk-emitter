export interface PageInfo {
	endCursor?: string | null;
	hasNextPage: boolean;
}

export interface Connection<TNode> {
	edges?: Array<{ node: TNode; cursor?: string | null }> | null;
	nodes?: TNode[] | null;
	pageInfo: PageInfo;
}

export type CursoredOperation<TArgs, TResult> = (
	args: TArgs & { after?: string | null; first?: number | null },
) => Promise<TResult>;

export interface PaginateOptions {
	pageSize?: number;
	maxPages?: number;
	connectionPath?: string[];
}

function getByPath<T>(value: unknown, path: string[]): T | undefined {
	let current: unknown = value;
	for (const key of path) {
		if (
			current === null ||
			current === undefined ||
			typeof current !== "object"
		) {
			return undefined;
		}
		current = (current as Record<string, unknown>)[key];
	}
	return current as T | undefined;
}

function findConnection<TNode>(value: unknown): Connection<TNode> | undefined {
	if (value === null || value === undefined || typeof value !== "object")
		return undefined;
	const obj = value as Record<string, unknown>;
	if (
		"pageInfo" in obj &&
		typeof obj.pageInfo === "object" &&
		obj.pageInfo !== null
	) {
		return obj as unknown as Connection<TNode>;
	}
	for (const key of Object.keys(obj)) {
		const found = findConnection<TNode>(obj[key]);
		if (found) return found;
	}
	return undefined;
}

function extractNodes<TNode>(connection: Connection<TNode>): TNode[] {
	if (Array.isArray(connection.nodes)) return connection.nodes;
	if (Array.isArray(connection.edges)) {
		return connection.edges.map((edge) => edge.node);
	}
	return [];
}

export async function* paginate<TArgs, TResult, TNode = unknown>(
	operation: CursoredOperation<TArgs, TResult>,
	args: TArgs,
	options: PaginateOptions = {},
): AsyncGenerator<TNode[], void, void> {
	const { pageSize, maxPages, connectionPath } = options;
	let after: string | null | undefined;
	let pageCount = 0;
	while (true) {
		if (maxPages !== undefined && pageCount >= maxPages) return;
		const result = await operation({
			...args,
			...(after ? { after } : {}),
			...(pageSize ? { first: pageSize } : {}),
		});
		const connection = connectionPath
			? getByPath<Connection<TNode>>(result, connectionPath)
			: findConnection<TNode>(result);
		if (!connection) return;
		const nodes = extractNodes<TNode>(connection);
		if (nodes.length > 0) yield nodes;
		pageCount += 1;
		if (!connection.pageInfo.hasNextPage) return;
		const next = connection.pageInfo.endCursor;
		if (!next || next === after) return;
		after = next;
	}
}

export async function collect<TArgs, TResult, TNode = unknown>(
	operation: CursoredOperation<TArgs, TResult>,
	args: TArgs,
	options: PaginateOptions = {},
): Promise<TNode[]> {
	const all: TNode[] = [];
	for await (const page of paginate<TArgs, TResult, TNode>(
		operation,
		args,
		options,
	)) {
		all.push(...page);
	}
	return all;
}
