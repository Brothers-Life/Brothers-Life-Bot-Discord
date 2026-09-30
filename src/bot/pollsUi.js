import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import { emojiOf } from './messages.js';

function bar(percent) {
	const full = Math.round(percent / 10);
	return `${'▰'.repeat(full)}${'▱'.repeat(10 - full)}`;
}

// The poll as Discord shows it; results only when allowed (live, or at the end)
export function pollPayload({ poll, results, showResults }, { target } = {}) {
	const lines = results.options.map((o) => {
		const head = `${o.emoji ? `${o.emoji} ` : ''}**${o.label}**${o.description ? ` — ${o.description}` : ''}`;
		return showResults ? `${head}\n${bar(o.percent)} ${o.percent} % · ${o.votes} vote${o.votes > 1 ? 's' : ''}` : head;
	});
	const closed = poll.status === 'closed';
	const footer = [
		`${results.voters} votant${results.voters > 1 ? 's' : ''}`,
		poll.settings.multiple ? `jusqu’à ${poll.settings.maxChoices} choix` : null,
		poll.settings.anonymous ? 'anonyme' : null,
		closed ? 'terminé' : null,
	].filter(Boolean).join(' · ');
	const embed = new EmbedBuilder()
		.setColor(Number.parseInt(poll.settings.color.slice(1), 16))
		.setAuthor({ name: closed ? '📊 Sondage terminé' : '📊 Sondage' })
		.setTitle(poll.question)
		.setDescription([poll.description, poll.description ? '' : null, ...lines].filter(l => l !== null).join('\n').slice(0, 4096))
		.setFooter({ text: footer });
	if (poll.settings.image) embed.setImage(poll.settings.image);
	if (poll.endsAt && !closed) embed.addFields({ name: 'Fin', value: `<t:${Math.round(poll.endsAt / 1000)}:R>`, inline: true });

	const components = [];
	if (!closed) {
		if (poll.settings.style === 'select') {
			const menu = new StringSelectMenuBuilder()
				.setCustomId(`poll:select:${poll.id}`)
				.setPlaceholder(poll.settings.multiple ? `Choisis jusqu’à ${poll.settings.maxChoices} réponses` : 'Choisis ta réponse')
				.setMinValues(poll.settings.multiple ? poll.settings.minChoices : 1)
				.setMaxValues(poll.settings.multiple ? poll.settings.maxChoices : 1)
				.addOptions(poll.options.map((o) => {
					const option = { label: o.label, value: o.id };
					if (o.description) option.description = o.description;
					const emoji = emojiOf(o.emoji);
					if (emoji) option.emoji = emoji;
					return option;
				}));
			components.push(new ActionRowBuilder().addComponents(menu));
		}
		else {
			for (let i = 0; i < poll.options.length; i += 5) {
				components.push(new ActionRowBuilder().addComponents(poll.options.slice(i, i + 5).map((o) => {
					const button = new ButtonBuilder().setCustomId(`poll:vote:${poll.id}:${o.id}`).setLabel(o.label.slice(0, 80)).setStyle(ButtonStyle.Secondary);
					const emoji = emojiOf(o.emoji);
					if (emoji) button.setEmoji(emoji);
					return button;
				})));
			}
		}
		const extra = [new ButtonBuilder().setCustomId(`poll:mine:${poll.id}`).setLabel('Mon vote').setStyle(ButtonStyle.Primary)];
		if (!poll.settings.anonymous) extra.push(new ButtonBuilder().setCustomId(`poll:who:${poll.id}`).setLabel('Qui a voté ?').setStyle(ButtonStyle.Secondary));
		components.push(new ActionRowBuilder().addComponents(extra));
	}

	const ping = target ? { everyone: '@everyone', here: '@here', roles: target.roleIds.map(id => `<@&${id}>`).join(' '), none: '' }[target.ping] : '';
	return {
		content: ping || null,
		embeds: [embed],
		components,
		allowedMentions: target ? { parse: target.ping === 'everyone' || target.ping === 'here' ? ['everyone'] : [], roles: target.ping === 'roles' ? target.roleIds : [] } : { parse: [] },
	};
}

export function pollResultsPayload({ poll, results }) {
	const sorted = [...results.options].sort((a, b) => b.votes - a.votes);
	const winners = sorted.filter(o => o.votes && o.votes === sorted[0].votes);
	return {
		embeds: [new EmbedBuilder()
			.setColor(Number.parseInt(poll.settings.color.slice(1), 16))
			.setTitle(`Résultats : ${poll.question}`.slice(0, 256))
			.setDescription([
				winners.length ? `🏆 ${winners.map(w => `**${w.label}**`).join(' et ')} (${winners[0].percent} %)` : 'Aucun vote.',
				'',
				...sorted.map(o => `${o.emoji ? `${o.emoji} ` : ''}${o.label} · ${o.votes} vote${o.votes > 1 ? 's' : ''} (${o.percent} %)`),
			].join('\n').slice(0, 4096))
			.setFooter({ text: `${results.voters} votant${results.voters > 1 ? 's' : ''}` })],
		allowedMentions: { parse: [] },
	};
}
