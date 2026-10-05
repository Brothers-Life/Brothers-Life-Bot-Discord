import { feedbackCommand } from '../../feedbackCommand.js';

export const { data, autocomplete, execute } = feedbackCommand({
	name: 'bug',
	description: 'Signaler un bug (en jeu, sur le Discord…)',
	type: 'bug',
	nothing: 'il n’y a pas de boîte de reports de bug sur ce serveur.',
});
