/**
 * Application-specific error class for consistent error handling
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
    public readonly details?: Record<string, any>
  ) {
    super(message);
    this.name = 'AppError';
    // Ensures proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, AppError.prototype);
  }

  /**
   * Convert error to HTTP response
   */
  toResponse(): Response {
    return new Response(
      JSON.stringify({
        error: {
          code: this.code,
          message: this.message,
          details: this.details,
        },
      }),
      {
        status: this.statusCode,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * Factory functions for common error types
 */

export const ValidationError = (message: string, details?: Record<string, any>) =>
  new AppError('validation_error', message, 400, details);

export const NotFoundError = (message: string = 'Resource not found') =>
  new AppError('not_found', message, 404);

export const RateLimitError = (message: string, retryAfter: number) =>
  new AppError('rate_limit_exceeded', message, 429, { retryAfter });

export const UnauthorizedError = (message: string = 'Unauthorized') =>
  new AppError('unauthorized', message, 401);

export const ForbiddenError = (message: string = 'Forbidden') =>
  new AppError('forbidden', message, 403);

export const InternalServerError = (message: string = 'Internal server error') =>
  new AppError('internal_server_error', message, 500);

/**
 * Global error handler middleware
 */
export async function errorHandler(
  request: Request,
  context: ExecutionContext,
  handler: () => Promise<Response>,
  logger?: any
): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    // Handle AppError instances
    if (error instanceof AppError) {
      // Log the error if logger is available
      if (logger) {
        logger.warn(`AppError: ${error.code}`, {
          statusCode: error.statusCode,
          message: error.message,
          details: error.details,
        });
      }
      
      return error.toResponse();
    }

    // Handle other errors
    if (logger) {
      logger.error('Unhandled error', { 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        url: request.url,
        method: request.method 
      });
    } else {
      console.error('Unhandled error:', error);
    }
    
    // Return generic error for other exceptions
    return new Response(
      JSON.stringify({
        error: {
          code: 'internal_server_error',
          message: 'An unexpected error occurred',
        },
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}