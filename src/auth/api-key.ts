import type { AuthProvider, FetchFn } from "./types.js";

export interface ApiKeyAuthOptions {
	apiKey: string;
	headerName?: string;
}

export class ApiKeyAuth implements AuthProvider {
	private readonly apiKey: string;
	private readonly headerName: string;

	constructor(options: ApiKeyAuthOptions) {
		this.apiKey = options.apiKey;
		this.headerName = options.headerName ?? "x-api-key";
	}

	wrap(fetch: FetchFn): FetchFn {
		return (input, init) => {
			const headers = new Headers(init?.headers);
			headers.set(this.headerName, this.apiKey);
			return fetch(input, { ...init, headers });
		};
	}
}
