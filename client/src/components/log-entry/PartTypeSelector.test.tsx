// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { PartType } from '@/domain/types';
import { PartTypeSelector } from './PartTypeSelector';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
afterEach(() => {
  cleanup();
});

const basePartType = {
  accountId: 'account',
  createdAtClient: '2026-01-01T00:00:00Z',
  serverSyncedAt: null,
  serverSeq: null,
} satisfies Partial<PartType>;

const partTypes: PartType[] = [
  {
    ...basePartType,
    id: 'part-oil',
    code: 'engine_oil',
    displayName: 'Dầu máy',
    displayOrder: 1,
    active: true,
  },
  {
    ...basePartType,
    id: 'part-custom',
    code: 'part-custom',
    displayName: 'Hạng mục tuỳ chỉnh',
    displayOrder: 2,
    active: false,
  },
];

describe('PartTypeSelector dropdown', () => {
  it('shows the placeholder when no part is selected', () => {
    render(<PartTypeSelector partTypes={partTypes} value={null} onChange={vi.fn()} />);
    const trigger = document.getElementById('log-part-type');
    expect(trigger?.getAttribute('role')).toBe('combobox');
    expect(screen.getByText('logEntry.selectPartPlaceholder')).toBeTruthy();
  });

  it('shows the selected part name in the trigger without opening the dropdown', () => {
    render(<PartTypeSelector partTypes={partTypes} value="part-oil" onChange={vi.fn()} />);
    expect(screen.getByText('Dầu máy')).toBeTruthy();
    expect(screen.queryByText('logEntry.selectPartPlaceholder')).toBeNull();
  });

  it('still shows an inactive part as selected while its entry is being edited', () => {
    render(<PartTypeSelector partTypes={partTypes} value="part-custom" onChange={vi.fn()} />);
    expect(screen.getByText('Hạng mục tuỳ chỉnh')).toBeTruthy();
  });

  it('marks the trigger invalid when the choose-part error is set', () => {
    render(<PartTypeSelector partTypes={partTypes} value={null} onChange={vi.fn()} invalid />);
    expect(document.getElementById('log-part-type')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('keeps the trigger valid without an aria-invalid attribute by default', () => {
    render(<PartTypeSelector partTypes={partTypes} value={null} onChange={vi.fn()} />);
    expect(document.getElementById('log-part-type')?.getAttribute('aria-invalid')).toBeNull();
  });

  it('renders the empty state instead of a dropdown when no part types exist', () => {
    render(<PartTypeSelector partTypes={[]} value={null} onChange={vi.fn()} />);
    expect(screen.getByText('logEntry.noPartTypes')).toBeTruthy();
    expect(document.getElementById('log-part-type')).toBeNull();
  });
});
