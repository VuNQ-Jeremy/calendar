import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { LanguageProvider } from '../src/lib/i18n.jsx';
import { MSelect, MTimePicker } from '../src/ui.jsx';

// jsdom implements neither of these; the picker calls them on open.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

function withLang(el: React.ReactElement) {
  return React.createElement(LanguageProvider, null, el);
}

describe('MSelect popover', () => {
  it('opens the listbox when the trigger is clicked', () => {
    render(
      withLang(
        <MSelect
          value=""
          onChange={() => {}}
          options={[
            { value: 'a', label: 'Apple' },
            { value: 'b', label: 'Banana' },
          ]}
        />,
      ),
    );
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByText('Banana')).toBeInTheDocument();
  });

  it('stays open when the menu itself scrolls (time-picker case)', () => {
    render(
      withLang(<MTimePicker value="09:00" onChange={() => {}} />),
    );
    fireEvent.click(screen.getByRole('combobox'));
    const menu = screen.getByRole('listbox');
    expect(menu).toBeInTheDocument();

    // Scrolling inside the long list must NOT close the popover.
    fireEvent.scroll(menu);
    expect(screen.queryByRole('listbox')).toBeInTheDocument();
  });

  it('closes when the underlying page scrolls', () => {
    render(withLang(<MTimePicker value="09:00" onChange={() => {}} />));
    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    // A scroll originating outside the menu should close it.
    fireEvent.scroll(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('selects an option and reports the value', () => {
    const onChange = vi.fn();
    render(withLang(<MTimePicker value="09:00" onChange={onChange} />));
    fireEvent.click(screen.getByRole('combobox'));
    const menu = screen.getByRole('listbox');
    fireEvent.click(within(menu).getByText('10:00 am')); // fmtTime('10:00', true)
    expect(onChange).toHaveBeenCalledWith('10:00');
  });
});
