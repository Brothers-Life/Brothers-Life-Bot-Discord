import { feedbackCommand } from '../../feedbackCommand.js';

export const { data, autocomplete, execute } = feedbackCommand({
	name: 'proposer',
	description: 'Faire une suggestion pour le serveur',
	type: 'suggestion',
	nothing: 'il n’y a pas de boîte à suggestions sur ce serveur.',
});
