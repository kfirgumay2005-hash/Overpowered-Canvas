/**
 * Command-palette counterpart of the toolbar pickers: a searchable list of choices
 * (shapes, styles, routes…) applied to the current selection.
 */
import { sanitizeHTMLToDom, setIcon, SuggestModal, type App } from "obsidian";

export interface Choice {
	id: string;
	label: string;
	icon?: string;
	/** SVG markup for a preview (same as the toolbar picker). */
	svg?: string;
	active?: boolean;
}

export class ChoiceModal extends SuggestModal<Choice> {
	constructor(
		app: App,
		placeholder: string,
		private readonly choices: Choice[],
		private readonly onPick: (id: string) => void,
	) {
		super(app);
		this.setPlaceholder(placeholder);
	}

	getSuggestions(query: string): Choice[] {
		const q = query.trim().toLocaleLowerCase();
		return this.choices.filter((c) => c.label.toLocaleLowerCase().includes(q));
	}

	renderSuggestion(choice: Choice, el: HTMLElement): void {
		el.addClass("opc-choice");
		const icon = el.createSpan({ cls: "opc-choice-icon" });
		if (choice.svg) icon.appendChild(sanitizeHTMLToDom(choice.svg));
		else if (choice.icon) setIcon(icon, choice.icon);
		el.createSpan({ text: choice.label });
		if (choice.active) el.createSpan({ cls: "opc-choice-active", text: "✓" });
	}

	onChooseSuggestion(choice: Choice): void {
		this.onPick(choice.id);
	}
}
