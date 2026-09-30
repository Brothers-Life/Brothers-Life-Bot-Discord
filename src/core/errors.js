// Business errors: the web layer turns them into { error: { code, message } } with the given status
export class AppError extends Error {
	constructor(code, message, status = 400) {
		super(message);
		this.code = code;
		this.status = status;
	}
}

export class ValidationError extends AppError {
	constructor(message) {
		super('VALIDATION', message, 400);
	}
}

export class ForbiddenError extends AppError {
	constructor(message = 'Action non autorisée.') {
		super('FORBIDDEN', message, 403);
	}
}

export class NotFoundError extends AppError {
	constructor(message = 'Introuvable.') {
		super('NOT_FOUND', message, 404);
	}
}

export class ConflictError extends AppError {
	constructor(message) {
		super('CONFLICT', message, 409);
	}
}
