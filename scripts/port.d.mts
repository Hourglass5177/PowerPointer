export const defaultPort: number;
export function listenFailure(
  error: { code?: string; message: string },
  port: number,
): string;
