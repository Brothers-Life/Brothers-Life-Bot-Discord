import { AppError } from '../core/errors.js';

export function sendError(reply, status, code, message) {
	return reply.code(status).send({ error: { code, message } });
}

// Single error format for the whole API; internal details only go to the logs
export function errorHandler(logger) {
	return function(error, request, reply) {
		if (error instanceof AppError) return sendError(reply, error.status, error.code, error.message);
		if (error.validation) return sendError(reply, 400, 'VALIDATION', error.message);
		if (error.statusCode === 429) return sendError(reply, 429, 'RATE_LIMITED', 'Trop de tentatives, réessaie plus tard.');
		if (error.statusCode && error.statusCode < 500) return sendError(reply, error.statusCode, error.code ?? 'BAD_REQUEST', error.message);

		logger.error(`API error on ${request.method} ${request.url}:`, error);
		return sendError(reply, 500, 'INTERNAL', 'Erreur interne. Le détail est dans la console du bot.');
	};
}
