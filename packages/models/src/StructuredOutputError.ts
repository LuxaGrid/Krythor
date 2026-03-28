/**
 * StructuredOutputError — thrown when a model response fails JSON parsing
 * or JSON Schema validation when responseFormat is set on an InferenceRequest.
 */
export class StructuredOutputError extends Error {
  constructor(
    message: string,
    /** The raw model output that failed parsing/validation. */
    public readonly rawOutput: string,
    /** If schema validation failed, the validation error message. */
    public readonly validationError?: string,
  ) {
    super(message);
    this.name = 'StructuredOutputError';
  }
}
