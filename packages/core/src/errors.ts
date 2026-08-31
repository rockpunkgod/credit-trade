export class DomainError extends Error {
  readonly code: string;
  readonly details?: Readonly<Record<string, string>>;

  constructor(code: string, message: string, details?: Readonly<Record<string, string>>) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}
