import type { AuthProvider, FetchFn } from "./types.js";

export type TokenProvider = () => string | Promise<string>;

export interface CognitoBearerAuthOptions {
	token: string | TokenProvider;
	headerName?: string;
	scheme?: string;
}

export class CognitoBearerAuth implements AuthProvider {
	private readonly token: string | TokenProvider;
	private readonly headerName: string;
	private readonly scheme: string;

	constructor(options: CognitoBearerAuthOptions) {
		this.token = options.token;
		this.headerName = options.headerName ?? "authorization";
		this.scheme = options.scheme ?? "Bearer";
	}

	wrap(fetch: FetchFn): FetchFn {
		return async (input, init) => {
			const token =
				typeof this.token === "function" ? await this.token() : this.token;
			const headers = new Headers(init?.headers);
			headers.set(this.headerName, `${this.scheme} ${token}`);
			return fetch(input, { ...init, headers });
		};
	}
}
