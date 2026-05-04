export type FetchFn = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

export interface AuthProvider {
	wrap(fetch: FetchFn): FetchFn;
}
