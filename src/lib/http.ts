/** Error type shared by lib code and API routes. Safe to import anywhere. */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
