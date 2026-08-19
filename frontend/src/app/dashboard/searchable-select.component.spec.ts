import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { SearchableSelectComponent, type SelectOption } from './searchable-select.component';

const OPTIONS: SelectOption[] = [
  { value: '1', label: 'Summit Auto Group' },
  { value: '2', label: 'Harbor Dental Partners' },
  { value: '15', label: 'Sierra Pest Solutions' },
];

/** Host mirrors real usage: the parent owns the selection and feeds it back down. */
@Component({
  imports: [SearchableSelectComponent],
  template: `
    <app-searchable-select
      inputId="test-select"
      label="Account"
      [options]="options()"
      [selectedValue]="selected()"
      (valueChange)="onChange($event)"
    />
  `,
})
class HostComponent {
  readonly options = signal(OPTIONS);
  readonly selected = signal<string | null>('1');
  readonly emitted: string[] = [];

  onChange(value: string): void {
    this.emitted.push(value);
    this.selected.set(value);
  }
}

describe('SearchableSelectComponent', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<HostComponent>>;
  let host: HostComponent;

  const input = (): HTMLInputElement =>
    fixture.nativeElement.querySelector('#test-select') as HTMLInputElement;

  const type = (text: string): void => {
    input().value = text;
    input().dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('shows the selected label in the field', () => {
    expect(input().value).toBe('Summit Auto Group');
  });

  it('commits on input, without waiting for blur', () => {
    // Regression guard: bound only to `change`, this emitted nothing until the field lost focus, so
    // typing an exact name or clicking a datalist option looked like a dead control.
    type('Sierra Pest Solutions');

    expect(host.emitted).toEqual(['15']);
    expect(host.selected()).toBe('15');
  });

  it('does not commit partial text', () => {
    type('Sierra');

    expect(host.emitted).toEqual([]);
    expect(host.selected()).toBe('1');
  });

  it('does not re-emit when the typed label is already the selection', () => {
    type('Summit Auto Group');

    expect(host.emitted).toEqual([]);
  });

  it('empties the field on focus so the datalist is unfiltered and browsable', () => {
    // datalist filters options against the field's text, so leaving the full label there collapses
    // the dropdown to a single entry and makes clicking through the list impossible.
    input().dispatchEvent(new Event('focus'));
    fixture.detectChanges();

    expect(input().value).toBe('');
  });

  it('restores the current selection when blurred with unmatched text', () => {
    type('not an account');
    input().dispatchEvent(new Event('blur'));
    fixture.detectChanges();

    expect(host.emitted).toEqual([]);
    expect(input().value).toBe('Summit Auto Group');
  });

  it('keeps the selection visible outside the field, for screen readers too', () => {
    const help = fixture.nativeElement.querySelector('#test-select-help') as HTMLElement;

    expect(input().getAttribute('aria-describedby')).toBe('test-select-help');
    expect(help.textContent).toContain('Summit Auto Group');
  });

  it('renders every option into the datalist', () => {
    const options = fixture.nativeElement.querySelectorAll('#test-select-options option');

    expect(Array.from(options).map((o) => (o as HTMLOptionElement).value)).toEqual(
      OPTIONS.map((o) => o.label),
    );
  });
});
