import {
	ChannelSelectMenuBuilder, FileUploadBuilder, LabelBuilder, ModalBuilder, RoleSelectMenuBuilder, StringSelectMenuBuilder,
	TextInputBuilder, TextInputStyle, UserSelectMenuBuilder,
} from 'discord.js';
import { emojiOf } from './messages.js';

// Modal of one step of a form (src/core/forms.js)
export function formModal(customId, title, step) {
	const modal = new ModalBuilder().setCustomId(customId).setTitle(title.slice(0, 45));
	modal.addLabelComponents(step.questions.map((q) => {
		const label = new LabelBuilder().setLabel(q.label);
		if (q.description) label.setDescription(q.description);
		switch (q.type) {
		case 'select': {
			const menu = new StringSelectMenuBuilder().setCustomId(q.id).setRequired(q.required).setMinValues(q.minValues).setMaxValues(q.maxValues)
				.addOptions(q.options.map((o) => {
					const option = { label: o.label, value: o.value };
					if (o.description) option.description = o.description;
					const emoji = emojiOf(o.emoji);
					if (emoji) option.emoji = emoji;
					return option;
				}));
			if (q.placeholder) menu.setPlaceholder(q.placeholder);
			return label.setStringSelectMenuComponent(menu);
		}
		case 'user':
		case 'role':
		case 'channel': {
			const Builder = { user: UserSelectMenuBuilder, role: RoleSelectMenuBuilder, channel: ChannelSelectMenuBuilder }[q.type];
			const menu = new Builder().setCustomId(q.id).setRequired(q.required).setMinValues(q.required ? 1 : 0).setMaxValues(q.maxValues);
			if (q.placeholder) menu.setPlaceholder(q.placeholder);
			if (q.type === 'user') return label.setUserSelectMenuComponent(menu);
			if (q.type === 'role') return label.setRoleSelectMenuComponent(menu);
			return label.setChannelSelectMenuComponent(menu);
		}
		case 'file':
			return label.setFileUploadComponent(new FileUploadBuilder().setCustomId(q.id).setRequired(q.required).setMinValues(q.required ? 1 : 0).setMaxValues(q.maxValues));
		default: {
			const input = new TextInputBuilder()
				.setCustomId(q.id)
				.setStyle(q.type === 'short' ? TextInputStyle.Short : TextInputStyle.Paragraph)
				.setRequired(q.required)
				.setMaxLength(q.maxLength);
			if (q.minLength) input.setMinLength(q.minLength);
			if (q.placeholder) input.setPlaceholder(q.placeholder);
			if (q.defaultValue) input.setValue(q.defaultValue);
			return label.setTextInputComponent(input);
		}
		}
	}));
	return modal;
}

// Raw values of a submitted modal: { [fieldId]: string | string[] }
export function readModal(interaction, step) {
	const { fields } = interaction;
	const values = {};
	for (const q of step.questions) {
		try {
			switch (q.type) {
			case 'select': values[q.id] = fields.getStringSelectValues(q.id); break;
			case 'user': values[q.id] = [...(fields.getSelectedUsers(q.id)?.keys() ?? [])].map(id => `<@${id}>`); break;
			case 'role': values[q.id] = [...(fields.getSelectedRoles(q.id)?.keys() ?? [])].map(id => `<@&${id}>`); break;
			case 'channel': values[q.id] = [...(fields.getSelectedChannels(q.id)?.keys() ?? [])].map(id => `<#${id}>`); break;
			case 'file': values[q.id] = [...(fields.getUploadedFiles(q.id)?.values() ?? [])].map(a => a.url); break;
			default: values[q.id] = fields.getTextInputValue(q.id);
			}
		}
		catch {
			values[q.id] = undefined;
		}
	}
	return values;
}
