import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import * as LanguageContext from '../../contexts/LanguageContext';
import { JsonViewer } from './JsonViewer';

vi.mock('../../contexts/LanguageContext', () => ({
  useLanguage: vi.fn(),
}));

describe('JsonViewer', () => {
  const mockT = vi.fn((key) => key);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(LanguageContext.useLanguage).mockReturnValue({ t: mockT } as any);
  });

  it('renders primitive values correctly', () => {
    const data = {
      str: 'hello',
      num: 42,
      boolTrue: true,
      boolFalse: false,
      nullVal: null,
      undefVal: undefined,
    };

    render(<JsonViewer data={data} />);

    expect(screen.getByText('"hello"')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('true')).toBeInTheDocument();
    expect(screen.getByText('false')).toBeInTheDocument();
    expect(screen.getByText('null')).toBeInTheDocument();
    expect(screen.getByText('undefined')).toBeInTheDocument();
  });

  it('renders arrays correctly', () => {
    render(<JsonViewer data={[1, 2, 3]} />);

    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders empty objects and arrays', () => {
    const { rerender } = render(<JsonViewer data={{}} name="emptyObj" />);
    expect(screen.getByText('{}')).toBeInTheDocument();

    rerender(<JsonViewer data={[]} name="emptyArr" />);
    expect(screen.getByText('[]')).toBeInTheDocument();
  });

  it('can collapse and expand', async () => {
    const data = { nested: { value: 123 } };

    render(<JsonViewer data={data} />);

    expect(screen.getByText('123')).toBeInTheDocument();

    const toggle = screen.getByText('nested:').closest('.cursor-pointer');
    fireEvent.click(toggle!);

    expect(screen.getByText('1 keys')).toBeInTheDocument();

    fireEvent.click(toggle!);
    expect(screen.queryByText('1 keys')).not.toBeInTheDocument();
  });

  it('copies data to clipboard', async () => {
    const data = { foo: 'bar' };

    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(),
      },
    });

    render(<JsonViewer data={data} />);

    const copyBtn = screen.getByTitle('misc.copyJson');
    fireEvent.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(JSON.stringify(data, null, 2));
  });
});
