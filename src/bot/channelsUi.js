import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { createCanvas } from '@napi-rs/canvas';
import { buildEmbeds, emojiOf } from './messages.js';
import { registerFonts } from '../core/cards.js';

// The message of the verification channel, with its button (customId verify:start)
export function verificationPanelPayload(config) {
	return {
		content: config.payload.content || undefined,
		embeds: buildEmbeds(config.payload),
		components: [new ActionRowBuilder().addComponents(
			new ButtonBuilder().setCustomId('verify:start').setLabel(config.buttonLabel).setEmoji(config.mode === 'captcha' ? '🔐' : '✅').setStyle(ButtonStyle.Success),
		)],
	};
}

export function captchaModal() {
	return new ModalBuilder().setCustomId('verify:answer').setTitle('Vérification').addComponents(
		new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('code').setLabel('Code de l’image').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(4).setMaxLength(10)),
	);
}

// The code drawn with noise, lines and slanted letters: easy for people, annoying for bots
export function captchaImage(code) {
	registerFonts();
	const width = 320;
	const height = 110;
	const canvas = createCanvas(width, height);
	const ctx = canvas.getContext('2d');
	const random = (min, max) => min + Math.random() * (max - min);
	ctx.fillStyle = '#16120f';
	ctx.fillRect(0, 0, width, height);
	for (let i = 0; i < 400; i++) {
		ctx.fillStyle = `rgba(255, ${Math.round(random(120, 220))}, ${Math.round(random(40, 120))}, ${random(0.05, 0.25)})`;
		ctx.fillRect(random(0, width), random(0, height), 2, 2);
	}
	for (let i = 0; i < 6; i++) {
		ctx.strokeStyle = `rgba(255, 150, 40, ${random(0.2, 0.5)})`;
		ctx.lineWidth = random(1, 3);
		ctx.beginPath();
		ctx.moveTo(random(0, width), random(0, height));
		ctx.bezierCurveTo(random(0, width), random(0, height), random(0, width), random(0, height), random(0, width), random(0, height));
		ctx.stroke();
	}
	const step = (width - 40) / code.length;
	[...code].forEach((char, i) => {
		ctx.save();
		ctx.translate(30 + i * step + random(-4, 4), height / 2 + random(-10, 10));
		ctx.rotate(random(-0.45, 0.45));
		ctx.font = `${Math.round(random(44, 56))}px "Poppins Bold"`;
		ctx.fillStyle = `hsl(${Math.round(random(20, 45))}, 100%, ${Math.round(random(60, 80))}%)`;
		ctx.textBaseline = 'middle';
		ctx.fillText(char, 0, 0);
		ctx.restore();
	});
	return new AttachmentBuilder(canvas.toBuffer('image/png'), { name: 'captcha.png' });
}

export function captchaPayload(code) {
	return {
		content: 'Recopie les 5 caractères de l’image (majuscules ou minuscules, peu importe), puis clique sur **Entrer le code**.',
		files: [captchaImage(code)],
		components: [new ActionRowBuilder().addComponents(
			new ButtonBuilder().setCustomId('verify:code').setLabel('Entrer le code').setEmoji('⌨️').setStyle(ButtonStyle.Primary),
			new ButtonBuilder().setCustomId('verify:start').setLabel('Autre image').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
		)],
	};
}

// Embed builder message: several embeds and link buttons (5 per row)
export function builtPayload(payload) {
	const embeds = payload.embeds.flatMap(embed => buildEmbeds({ embed: { ...embed, enabled: true } }));
	const rows = [];
	for (let i = 0; i < payload.buttons.length; i += 5) {
		rows.push(new ActionRowBuilder().addComponents(payload.buttons.slice(i, i + 5).map((b) => {
			const button = new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(b.url);
			if (b.label) button.setLabel(b.label);
			if (b.emoji) button.setEmoji(emojiOf(b.emoji));
			return button;
		})));
	}
	return { content: payload.content || null, embeds, components: rows };
}
