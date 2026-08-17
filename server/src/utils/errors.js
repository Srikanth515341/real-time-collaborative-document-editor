// Typed errors that carry a statusCode/code pair errorHandler.js understands.
// Anything thrown as one of these results in its own message being returned
// to the client (safe by construction); anything else becomes a generic 500.
export class AppError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class ValidationError extends AppError {
  constructor(message) {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

export class AuthError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class PermissionError extends AppError {
  constructor(message = 'You do not have access to this resource.') {
    super(message, 403, 'PERMISSION_DENIED');
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message) {
    super(message, 409, 'CONFLICT');
  }
}
