import { ChangeDetectionStrategy, Component, ElementRef, computed, input, output, viewChild } from '@angular/core';

export interface SelectOption {
  /** Stable machine value (e.g. account id). Never shown to the user. */
  readonly value: string;
  /** What the user reads and types against. Must be unique within the option list. */
  readonly label: string;
}

/**
 * A type-to-filter picker built on a native `<input list>` + `<datalist>`.
 *
 * Deliberately native rather than a hand-rolled ARIA combobox or a component library: the browser
 * already provides filtering-as-you-type, full keyboard operation, and combobox semantics for
 * assistive tech. A custom listbox would mean owning focus management, arrow-key handling and
 * `aria-activedescendant` — exactly where accessibility bugs live — for no gain at this scale.
 *
 * The one real sharp edge of `datalist` is that the browser filters options against whatever text is
 * currently in the field. Leaving the selected label in the box therefore collapses the dropdown to
 * that single entry, making it impossible to click through the full list. So the field is emptied on
 * focus (ready to browse or type) and the current selection is carried by the placeholder while
 * focused. The selection is also always available to assistive tech via a visually-hidden
 * `aria-describedby` element — never dropped, just not printed as visible page text, so the control
 * can sit inline (label + field, like a native `<select>`) rather than needing a paragraph under it.
 *
 * Free text is accepted while typing but never committed: only an exact label match emits a change,
 * and blurring with unmatched or empty text restores the current selection rather than clearing it.
 */
@Component({
  selector: 'app-searchable-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-center gap-2">
      <label [for]="inputId()" class="shrink-0 text-xs tracking-wide text-ink-dim">{{ label() }}</label>
      <input
        #field
        type="text"
        [id]="inputId()"
        [attr.list]="listId()"
        [value]="selectedLabel()"
        [placeholder]="placeholder()"
        [disabled]="isEmpty()"
        [attr.aria-describedby]="inputId() + '-help'"
        class="min-w-[13rem] rounded-md border border-border-strong bg-white px-2.5 py-1.5 text-[13px] text-ink disabled:bg-canvas disabled:text-ink-whisper"
        autocomplete="off"
        (focus)="clearForBrowsing()"
        (input)="commit($event)"
        (change)="commit($event)"
        (blur)="restoreSelection()"
      />
      <!--
        Not printed on the page: the field's own placeholder already shows the selection while
        focused, and the label/value pair (e.g. "Account: Summit Auto Group") is visually obvious from
        the field itself once populated. This exists purely so assistive tech still gets the same
        "showing X of N, type to filter" context a sighted user picks up from the control's behaviour.
      -->
      <span [id]="inputId() + '-help'" class="sr-only">
        @if (isEmpty()) {
          {{ emptyText() }}
        } @else {
          Showing {{ selectedLabel() }} — click to browse all {{ options().length }}, or type to filter.
        }
      </span>
      <datalist [id]="listId()">
        @for (option of options(); track option.value) {
          <option [value]="option.label"></option>
        }
      </datalist>
    </div>
  `,
})
export class SearchableSelectComponent {
  readonly inputId = input.required<string>();
  readonly label = input.required<string>();
  readonly options = input.required<SelectOption[]>();
  readonly selectedValue = input<string | null>(null);
  readonly emptyText = input('Nothing to select yet');

  readonly valueChange = output<string>();

  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');

  protected readonly listId = computed(() => `${this.inputId()}-options`);
  protected readonly isEmpty = computed(() => this.options().length === 0);

  protected readonly selectedLabel = computed(
    () => this.options().find((o) => o.value === this.selectedValue())?.label ?? '',
  );

  /** Keeps the current selection visible while the field itself is empty for browsing. */
  protected readonly placeholder = computed(() =>
    this.isEmpty() ? this.emptyText() : this.selectedLabel() || 'Type to search…',
  );

  /**
   * Empties the field on focus so the datalist is unfiltered and the whole list can be clicked
   * through. Without this the browser filters options by the selected label already sitting in the
   * box, leaving exactly one entry — which looks like a broken dropdown.
   */
  protected clearForBrowsing(): void {
    this.field().nativeElement.value = '';
  }

  /**
   * Bound to both `input` and `change`. `change` alone is not enough: on a text input it only fires
   * on blur, so typing an exact name — or picking an option from the datalist — appeared to do
   * nothing until the user clicked elsewhere, which reads as a broken control. `input` fires
   * immediately on both, and the exact-match guard means partial typing still commits nothing.
   */
  protected commit(event: Event): void {
    const typed = (event.target as HTMLInputElement).value;
    const match = this.options().find((o) => o.label === typed);
    if (match && match.value !== this.selectedValue()) {
      this.valueChange.emit(match.value);
    }
  }

  /**
   * Restores the live selection on blur, so an emptied or half-typed field never lingers looking as
   * though nothing is selected.
   */
  protected restoreSelection(): void {
    const element = this.field().nativeElement;
    if (element.value !== this.selectedLabel()) {
      element.value = this.selectedLabel();
    }
  }
}
